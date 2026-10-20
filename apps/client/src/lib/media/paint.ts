/**
 * The painter toolkit behind board thumbnails, snapshots and PDF cells: image
 * decoding, shape geometry, memoised asset loads, and the shared card palette.
 * Each item type's own painter (`thumbnail` in src/itemTypes/<type>.tsx)
 * draws with these; lib/media/thumbnail.ts drives them over a document.
 */
import type { Item, ShapeItem, VideoEmbed } from '@boardcache/schema';
import { getAssetBlob } from '../board/assetStore';
import type { Point } from '../canvas/coords';
import {
  arrowHead,
  diagonalEndpoints,
  diamondPoints,
  polygonPoints,
  starPoints,
} from '../canvas/shapeGeometry';
import { embedThumbnailUrl } from './videoEmbed';

/** What a type's painter receives: the 2D context already translated and
 *  rotated to the item's centre, the item-local top-left, and the shared bits. */
export interface PaintContext {
  ctx: CanvasRenderingContext2D;
  /** Item-local top-left (the box spans x..x+width, y..y+height). */
  x: number;
  y: number;
  dark: boolean;
  /** Card chrome colours for the current theme. */
  card: { bg: string; text: string; sub: string; glyph: string };
  cache?: RenderCache;
  /** Full item map — timelines weight point spacing by attached shelves. */
  itemsById?: Record<string, Item>;
  /** Draw the play badge on playable media. */
  playBadge: boolean;
}

export function cardPalette(dark: boolean): PaintContext['card'] {
  return {
    bg: dark ? '#1c1f26' : '#eef1f5',
    text: dark ? '#e6e8ec' : '#23272e',
    sub: dark ? '#9aa2ad' : '#6b7480',
    glyph: dark ? '#8b93a1' : '#8a93a0',
  };
}

/**
 * Decode an image blob to a canvas. SVGs — which createImageBitmap rejects —
 * render via an <img> at a generous target size (they're vectors, so the
 * resolution is ours to pick). Returns null when the blob can't be decoded.
 */
export async function decodeImageCanvas(
  blob: Blob,
  svgTargetPx = 2048,
): Promise<HTMLCanvasElement | null> {
  if (blob.type === 'image/svg+xml') return svgBlobToCanvas(blob, svgTargetPx);
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return c;
  } catch {
    return null;
  }
}

async function svgBlobToCanvas(blob: Blob, maxPx: number): Promise<HTMLCanvasElement | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // Intrinsic size when the SVG declares one; else fall back to its viewBox
    // aspect (Chromium reports 0×0 for viewBox-only SVGs).
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) {
      const vb = /viewBox\s*=\s*["']([\d.\s,+-]+)["']/.exec(await blob.text());
      const parts = vb?.[1]?.split(/[\s,]+/).map(Number) ?? [];
      w = parts[2] || 512;
      h = parts[3] || 512;
    }
    const scale = maxPx / Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draw a shape into a context whose origin is the item's top-left. */
export function drawShape(ctx: CanvasRenderingContext2D, item: ShapeItem): void {
  const { width: w, height: h } = item;
  const inset = item.strokeWidth / 2 + 1;
  ctx.lineWidth = item.strokeWidth;
  ctx.strokeStyle = item.stroke ?? '#888';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(item.dashed ? [item.strokeWidth * 2.5, item.strokeWidth * 2] : []);
  const tracePoly = (pts: Point[], close: boolean) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (close) ctx.closePath();
  };
  const fillStroke = () => {
    if (item.fill) {
      ctx.fillStyle = item.fill;
      ctx.fill();
    }
    ctx.stroke();
  };

  switch (item.shape) {
    case 'rect':
      ctx.beginPath();
      ctx.roundRect(
        inset,
        inset,
        Math.max(0, w - inset * 2),
        Math.max(0, h - inset * 2),
        item.cornerRadius,
      );
      fillStroke();
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(
        w / 2,
        h / 2,
        Math.max(0, w / 2 - inset),
        Math.max(0, h / 2 - inset),
        0,
        0,
        Math.PI * 2,
      );
      fillStroke();
      break;
    case 'diamond':
      tracePoly(diamondPoints(w, h, inset), true);
      fillStroke();
      break;
    case 'star':
      tracePoly(
        starPoints(w / 2, h / 2, w / 2 - inset, h / 2 - inset, item.sides, item.innerRadiusRatio),
        true,
      );
      fillStroke();
      break;
    case 'polygon':
      tracePoly(polygonPoints(w / 2, h / 2, w / 2 - inset, h / 2 - inset, item.sides), true);
      fillStroke();
      break;
    case 'draw':
      if (item.points && item.points.length > 1) {
        tracePoly(
          item.points.map((p) => ({
            x: inset + p.x * (w - inset * 2),
            y: inset + p.y * (h - inset * 2),
          })),
          false,
        );
        ctx.stroke();
      }
      break;
    case 'line':
    case 'arrow': {
      const { a, b } = diagonalEndpoints(w, h, inset, item.flipDiagonal);
      tracePoly([a, b], false);
      ctx.stroke();
      if (item.shape === 'arrow') {
        const len = Math.min(22, Math.max(9, item.strokeWidth * 3.5));
        const [b1, b2] = arrowHead(a, b, len);
        tracePoly([b1, b, b2], false);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.setLineDash([]);
}

/**
 * Draw `src` cover-fitted into a box, the way CSS `object-fit: cover` shows
 * it: centred, scaled to fill, the overflow cut off — never stretched.
 */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (!(srcW > 0 && srcH > 0 && w > 0 && h > 0)) return;
  let sw = srcW;
  let sh = srcH;
  if (srcW / srcH > w / h) sw = srcH * (w / h);
  else sh = srcW / (w / h);
  ctx.drawImage(src, (srcW - sw) / 2, (srcH - sh) / 2, sw, sh, x, y, w, h);
}

/** Load an image, resolving null on error (e.g. a cross-origin/CORS failure). */
function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The highest-resolution preview thumbnail for a provider embed (CORS-loaded
 *  so it can be drawn without tainting the canvas). */
export async function loadEmbedThumb(embed: VideoEmbed): Promise<HTMLImageElement | null> {
  if (embed.provider === 'youtube') {
    // maxresdefault may 404 → fall back to the always-present hqdefault.
    return (
      (await loadImage(`https://i.ytimg.com/vi/${embed.videoId}/maxresdefault.jpg`, true)) ??
      (await loadImage(`https://i.ytimg.com/vi/${embed.videoId}/hqdefault.jpg`, true))
    );
  }
  const url = embedThumbnailUrl(embed);
  return url ? loadImage(url, true) : null;
}

/** Rasterize a PDF page (1-based) to an offscreen canvas, or null on failure. */
export async function renderPdfPage(
  assetId: string,
  pageNum: number,
  boxW: number,
  boxH: number,
): Promise<HTMLCanvasElement | null> {
  // The offline viewer build has no pdf.js — this keeps it dead-code-eliminated.
  if (import.meta.env.VIEWER) return null;
  const blob = await getAssetBlob(assetId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const { loadPdf } = await import('./pdfDoc');
    const { doc, destroy } = await loadPdf(url);
    try {
      const page = await doc.getPage(Math.min(Math.max(1, pageNum), doc.numPages));
      const v1 = page.getViewport({ scale: 1 });
      // Render ~3× the box so it stays crisp when the export is supersampled.
      const target = Math.max(boxW, boxH) * 3;
      const scale = Math.min(4, target / Math.max(v1.width, v1.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const c = canvas.getContext('2d')!;
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: c, viewport }).promise;
      return canvas;
    } finally {
      destroy();
    }
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Memoized expensive lookups (asset decode, PDF pages, embed thumbnails) so
 * multi-pass renders — the light+dark thumbnail pair — pay for each only once.
 */
/** Live accent token (falls back to the default blue outside the DOM). */
export function accentColor(dark: boolean): string {
  const v =
    typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      : '';
  return v || (dark ? '#7fb2ff' : '#3b82f6');
}

export type RenderCache = Map<string, Promise<unknown>>;

export function memo<T>(
  cache: RenderCache | undefined,
  key: string,
  make: () => Promise<T>,
): Promise<T> {
  if (!cache) return make();
  let hit = cache.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = make();
    cache.set(key, hit);
  }
  return hit;
}

/** Decode a blob to a canvas (bitmap path), or null. Cache-friendly: canvases
 *  have no close() lifetime issues, unlike ImageBitmap. */
export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return c;
  } catch {
    return null;
  }
}

/** Map-poster heal, cooled down so a dead network doesn't get hammered by
 *  every sprite/thumb repaint. generateMapPoster itself no-ops for items
 *  outside the open doc and dedupes concurrent runs. */
const mapHealAttempts = new Map<string, number>();

const MAP_HEAL_COOLDOWN_MS = 60_000;

export function scheduleMapPosterHeal(itemId: string): void {
  const last = mapHealAttempts.get(itemId) ?? 0;
  if (Date.now() - last < MAP_HEAL_COOLDOWN_MS) return;
  mapHealAttempts.set(itemId, Date.now());
  void import('../../plugins/maps/mapSnapshot').then((m) => m.generateMapPoster(itemId));
}

/** Relative luminance (0..1) of a CSS #rgb/#rrggbb color; 0.5 on parse failure. */
export function colorLuminance(color: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return 0.5;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const CAPTION_FS = 12.5;
const CAPTION_LH = CAPTION_FS * 1.4; // DOM line-height 1.4
const CAPTION_PAD = 6; // DOM padding 6px 9px
const CAPTION_FONT = `${CAPTION_FS}px -apple-system, 'Segoe UI', sans-serif`;

/** The lines an outside caption shows: wrapped to the bar, capped at half
 *  the box (as the DOM's max-height: 50%), or a single clipped line. */
function captionLines(
  ctx: CanvasRenderingContext2D,
  item: Extract<Item, { type: 'image' }>,
): string[] {
  const text = (item.description ?? '').replace(/\s+/g, ' ').trim();
  const maxW = item.width - 18;
  if (!text || maxW < 24) return [];
  const fits = (s: string) => ctx.measureText(s).width <= maxW;
  const clip = (s: string) => {
    let t = s;
    while (t.length > 1 && !fits(t + '…')) t = t.slice(0, -1).trimEnd();
    return t + '…';
  };
  const maxLines = item.captionWrap
    ? Math.max(1, Math.floor((item.height / 2 - CAPTION_PAD * 2) / CAPTION_LH))
    : 1;
  const lines: string[] = [];
  const words = text.split(' ');
  let line = '';
  let lineStart = 0; // index of the first word on `line`
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? '';
    const next = line ? `${line} ${w}` : w;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (lines.length === maxLines - 1) {
      // Last allowed line: everything left is clipped onto it.
      lines.push(clip(words.slice(lineStart).join(' ')));
      return lines;
    }
    if (line) lines.push(line);
    // A single word wider than the bar breaks mid-word, like overflow-wrap.
    line = w;
    lineStart = i;
    while (!fits(line)) {
      if (lines.length === maxLines - 1) {
        lines.push(clip(line));
        return lines;
      }
      let cut = line.length - 1;
      while (cut > 1 && !fits(line.slice(0, cut))) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** How much of the box an outside caption reserves (0 for inside/no caption). */
export function captionReserve(
  ctx: CanvasRenderingContext2D,
  item: Extract<Item, { type: 'image' }>,
): number {
  if (!item.caption || item.captionPlacement !== 'outside') return 0;
  ctx.save();
  ctx.font = CAPTION_FONT;
  const n = captionLines(ctx, item).length;
  ctx.restore();
  return n ? Math.round(n * CAPTION_LH + CAPTION_PAD * 2) : 0;
}

/** Mirror of the DOM caption: a translucent corner box inside the picture,
 *  or a card-coloured bar above/below it when placed outside. */
export function drawImageCaption(
  ctx: CanvasRenderingContext2D,
  item: Extract<Item, { type: 'image' }>,
  x: number,
  y: number,
  card: { bg: string; text: string } = { bg: '#ffffff', text: '#16181d' },
): void {
  if (!item.caption || !item.description?.trim()) return;
  const pad = 5;
  const fs = CAPTION_FS;
  const top = item.captionCorner.startsWith('t');
  const left = item.captionCorner.endsWith('l');
  ctx.save();
  ctx.font = CAPTION_FONT;
  if (item.captionPlacement === 'outside') {
    const lines = captionLines(ctx, item);
    if (lines.length === 0) {
      ctx.restore();
      return;
    }
    const h = Math.round(lines.length * CAPTION_LH + CAPTION_PAD * 2);
    const by = top ? y : y + item.height - h;
    ctx.fillStyle = card.bg;
    ctx.fillRect(x, by, item.width, h);
    ctx.fillStyle = card.text;
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const tw = ctx.measureText(line).width;
      ctx.fillText(
        line,
        left ? x + 9 : x + item.width - 9 - tw,
        by + CAPTION_PAD + CAPTION_LH * (i + 0.5) + 0.5,
      );
    });
    ctx.restore();
    return;
  }
  const maxW = item.width - 16 - pad * 2;
  if (maxW < 24) {
    ctx.restore();
    return;
  }
  let text = item.description.replace(/\s+/g, ' ').trim();
  while (text.length > 1 && ctx.measureText(text).width > maxW) {
    text = text.slice(0, -2).trimEnd();
  }
  if (text.length < item.description.trim().length) text += '…';
  const w = ctx.measureText(text).width + pad * 2;
  const h = fs + pad * 2;
  const bx = left ? x + 8 : x + item.width - 8 - w;
  const by = top ? y + 8 : y + item.height - 8 - h;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 7);
  ctx.fillStyle = `rgba(12, 13, 16, ${item.captionOpacity})`;
  ctx.fill();
  ctx.fillStyle = '#f4f5f7';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + pad, by + h / 2 + 0.5);
  ctx.restore();
}
