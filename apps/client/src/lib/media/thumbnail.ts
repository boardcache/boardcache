import type { CanvasDocument, Item } from '@boardcache/schema';
import { drawMarkdownText } from '../export/exportText';
import type { Rect } from '../canvas/coords';
import { rotatedRectAABB, unionRects, DEG_TO_RAD } from '../canvas/geometry';
import { groupChain, isInsideGroup } from '../canvas/grouping';
import { darkVariant } from '../color/color';
import { cardPalette, colorLuminance } from './paint';
import type { RenderCache } from './paint';
export type { RenderCache } from './paint';
import { itemType } from '../../itemTypes';

/**
 * Renders a document straight from its data onto a canvas — never from the
 * DOM (rule 3.1). Used for board-library thumbnails, the .boardcache embedded
 * preview, and PNG snapshot export.
 */

function itemRect(item: Item): Rect {
  return rotatedRectAABB({
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    rotation: item.rotation,
  });
}

/** Bounds of all content, or null for an empty board. */
export function contentBounds(doc: CanvasDocument, items?: Item[]): Rect | null {
  return unionRects((items ?? Object.values(doc.items)).map(itemRect));
}

/**
 * The region a board's cover/thumbnail captures: the user-chosen cover item
 * (Set Cover) when present, otherwise the whole content. A stale cover id
 * (item deleted since) falls back to the whole board.
 */
export function coverBounds(
  doc: CanvasDocument,
  pageId: string | null | 'all' = 'all',
): Rect | null {
  const coverId = doc.settings.coverItemId;
  const item = coverId ? doc.items[coverId] : undefined;
  if (item) return itemRect(item);
  const firstPg = doc.pages[0]?.id ?? null;
  const items =
    pageId === 'all'
      ? undefined
      : Object.values(doc.items).filter((i) => (i.pageId ?? firstPg) === (pageId ?? firstPg));
  return contentBounds(doc, items);
}

async function drawItem(
  ctx: CanvasRenderingContext2D,
  item: Item,
  opts: {
    playBadge?: boolean;
    dark?: boolean;
    cache?: RenderCache;
    /** Full item map — timelines weight point spacing by attached shelves. */
    itemsById?: Record<string, Item>;
  } = {},
): Promise<void> {
  const cache = opts.cache;
  const playBadge = opts.playBadge ?? true;
  const dark = opts.dark ?? document.documentElement.dataset.theme === 'dark';
  const card = cardPalette(dark);
  ctx.save();
  ctx.globalAlpha = item.opacity;
  ctx.translate(item.x + item.width / 2, item.y + item.height / 2);
  ctx.rotate(item.rotation * DEG_TO_RAD);
  const x = -item.width / 2;
  const y = -item.height / 2;

  const paint = itemType(item).thumbnail;
  if (paint) {
    await paint(item, {
      ctx,
      x,
      y,
      dark,
      card,
      playBadge,
      ...(cache ? { cache } : {}),
      ...(opts.itemsById ? { itemsById: opts.itemsById } : {}),
    });
  } else {
    ctx.fillStyle = 'rgba(127,127,127,0.25)';
    ctx.fillRect(x, y, item.width, item.height);
    ctx.strokeStyle = 'rgba(127,127,127,0.5)';
    ctx.strokeRect(x, y, item.width, item.height);
  }
  ctx.restore();
}

/**
 * Render a single item, upright (ignoring its canvas x/y/rotation), into its
 * own high-res canvas — used by the Asset PDF export. `lightText` forces text
 * boxes to render dark-on-light for printing onto white pages.
 */
export async function renderItemCanvas(
  item: Item,
  scale = 2,
  lightText = false,
): Promise<HTMLCanvasElement> {
  const w = Math.max(1, Math.round(item.width * scale));
  const h = Math.max(1, Math.round(item.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  if (lightText && item.type === 'text') {
    if (!item.background) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, item.width, item.height);
    }
    drawMarkdownText(ctx, item, 0, 0, false);
  } else {
    await drawItem(ctx, { ...item, x: 0, y: 0, rotation: 0 } as Item, { playBadge: false });
  }
  return canvas;
}

/** Breathing room and corner radius of a group's backdrop (as on the canvas:
 *  GroupBackgroundsLayer and .group-bg). */
const GROUP_BG_PADDING = 16;
const GROUP_BG_RADIUS = 12;

/**
 * The tinted backdrops of groups that have one, behind every item — outer
 * groups first so a nested group's tint sits on its parent's. Only the items
 * being painted count towards a group's bounds (hidden / other-page items
 * are not on this picture).
 */
function drawGroupBackgrounds(
  ctx: CanvasRenderingContext2D,
  doc: CanvasDocument,
  items: Item[],
  dark: boolean,
): void {
  const groups = Object.values(doc.groups)
    .filter((g) => g.background)
    .sort((a, b) => groupChain(doc, a.id).length - groupChain(doc, b.id).length);
  for (const group of groups) {
    const union = unionRects(items.filter((it) => isInsideGroup(doc, it, group.id)).map(itemRect));
    if (!union) continue;
    ctx.save();
    ctx.globalAlpha = group.backgroundOpacity ?? 1;
    ctx.fillStyle = dark ? darkVariant(group.background!) : group.background!;
    ctx.beginPath();
    ctx.roundRect(
      union.x - GROUP_BG_PADDING,
      union.y - GROUP_BG_PADDING,
      union.width + GROUP_BG_PADDING * 2,
      union.height + GROUP_BG_PADDING * 2,
      GROUP_BG_RADIUS,
    );
    ctx.fill();
    ctx.restore();
  }
}

/** Render a canvas-space region of the document into a sized PNG blob. */
export async function renderRegion(
  doc: CanvasDocument,
  region: Rect,
  outWidth: number,
  outHeight: number,
  background: string | null,
  dark?: boolean,
  cache?: RenderCache,
  fit: 'contain' | 'cover' = 'contain',
  /** Pages partition: paint only this page ('all' = every item — only right
   *  for single-page boards or explicit whole-board captures). */
  pageId: string | null | 'all' = 'all',
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d')!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, outWidth, outHeight);
  }
  // 'cover' center-crops the region to FILL the output (chosen cover items
  // go edge to edge on the card); 'contain' letterboxes.
  const scale = (fit === 'cover' ? Math.max : Math.min)(
    outWidth / region.width,
    outHeight / region.height,
  );
  // Center the region in the output.
  ctx.translate((outWidth - region.width * scale) / 2, (outHeight - region.height * scale) / 2);
  ctx.scale(scale, scale);
  ctx.translate(-region.x, -region.y);

  const firstPg = doc.pages[0]?.id ?? null;
  const wantPg = pageId === 'all' ? null : (pageId ?? firstPg);
  const items = Object.values(doc.items)
    .filter((i) => !i.hidden)
    .filter((i) => pageId === 'all' || (i.pageId ?? firstPg) === wantPg)
    .sort((a, b) => a.zIndex - b.zIndex || (a.id < b.id ? -1 : 1));
  drawGroupBackgrounds(ctx, doc, items, dark ?? document.documentElement.dataset.theme === 'dark');
  for (const item of items)
    await drawItem(ctx, item, {
      ...(dark === undefined ? {} : { dark }),
      ...(cache === undefined ? {} : { cache }),
      itemsById: doc.items,
    });

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

/** Library-card raster. Cards can render ~290 CSS px wide on a 3× phone
 *  (≈870 device px), so 320px sources looked jagged — 720 covers hi-DPI
 *  large cards with headroom; text-heavy boards benefit the most. */
const THUMB_W = 720;
const THUMB_H = 450;

export interface BoardThumbnails {
  light: Blob;
  dark: Blob;
}

/**
 * Library thumbnails: whole-content overview with padding, rendered once per
 * theme. A custom board background shows in both, as picked in light and as
 * its deep counterpart in dark (the canvas does the same); item cards inside
 * follow its luminance.
 */
export async function renderThumbnails(doc: CanvasDocument): Promise<BoardThumbnails> {
  // Pages: the thumbnail is ONE page — the cover item's page when a cover is
  // set, else the first page (mixing pages stacks unrelated content).
  const coverItem = doc.settings.coverItemId ? doc.items[doc.settings.coverItemId] : undefined;
  const thumbPage: string | null | 'all' =
    doc.pages.length > 1 ? (coverItem?.pageId ?? doc.pages[0]?.id ?? null) : 'all';
  const bounds = coverBounds(doc, thumbPage);
  // A chosen cover item fills the frame edge to edge; the whole-board
  // overview keeps its breathing room.
  const pad = doc.settings.coverItemId && doc.items[doc.settings.coverItemId] ? 0 : 40;
  const region = bounds
    ? {
        x: bounds.x - pad,
        y: bounds.y - pad,
        width: Math.max(1, bounds.width + pad * 2),
        height: Math.max(1, bounds.height + pad * 2),
      }
    : { x: -160, y: -100, width: 320, height: 200 };
  const custom = doc.settings.background !== 'default' ? doc.settings.background : null;
  const fit = pad === 0 ? ('cover' as const) : ('contain' as const);
  // Decodes, PDF pages and embed thumbs are shared across the two passes —
  // the second theme render only re-paints, it never re-decodes.
  const cache: RenderCache = new Map();
  if (custom) {
    const paint = (bg: string) =>
      renderRegion(
        doc,
        region,
        THUMB_W,
        THUMB_H,
        bg,
        colorLuminance(bg) < 0.5,
        cache,
        fit,
        thumbPage,
      );
    const deep = darkVariant(custom);
    const light = await paint(custom);
    return { light, dark: deep === custom ? light : await paint(deep) };
  }
  // Default background renders TRANSPARENT: the library card paints the
  // current theme's canvas color behind the PNG, so one thumbnail adapts to
  // every theme.
  return {
    light: await renderRegion(doc, region, THUMB_W, THUMB_H, null, false, cache, fit, thumbPage),
    dark: await renderRegion(doc, region, THUMB_W, THUMB_H, null, true, cache, fit, thumbPage),
  };
}
