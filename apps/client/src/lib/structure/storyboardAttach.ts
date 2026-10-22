import type { CanvasDocument, Item, StoryboardItem, StoryboardPanel } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { runCommand, topZIndex } from '../../state/commands';

/**
 * Storyboard attachments (fourth container, mirroring the tier-list shelf
 * machinery): each shot panel's FRAME is a drop target. Dropping a canvas
 * item on a panel makes it the shot's frame — the item stays a real canvas
 * item, fitted inside the aspect box and carried when the card moves.
 * Dropping onto an occupied panel replaces the frame; the old item is set
 * free just below the card.
 */

export interface StoryboardTarget {
  itemId: string;
  panelId: string;
}

/* Design-space chrome sizes (zoom 1). On the canvas every size is multiplied
 * by the card's zoom, which only a uniform scale (corner drag) changes. */
export const SB_HEADER = 40;
export const SB_PAD = 14;
const SB_GAP = 12;
/** Metadata strip under each frame (label/scene/action lines). */
export const SB_META_H = 52;
/** The smallest frame a short card squeezes its panels to. */
const SB_MIN_FRAME_H = 24;
const CAPTURE_PAD = 20;
const DETACH_PAD = 80;
const MIN_CARD_W = 420;

function aspectRatio(sb: StoryboardItem): number {
  switch (sb.aspect) {
    case '9:16':
      return 9 / 16;
    case '4:3':
      return 4 / 3;
    case '2.39:1':
      return 2.39;
    default:
      return 16 / 9;
  }
}

/** The card's content zoom: set by uniform scales; absent = 1 (cards made before zoom). */
export function storyboardZoom(sb: StoryboardItem): number {
  return sb.zoom ?? 1;
}

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  frameH: number;
  h: number;
}

/**
 * Panel geometry in DESIGN space (zoom 1, relative to the card's top-left)
 * for a card of `designW` × `designH`. Columns split the width; frames keep
 * the aspect and fit inside both the column and the row height the card
 * leaves them, centered in their column. So an edge drag only changes the
 * room panels have, and a corner drag (zoom) scales everything at once.
 */
export function storyboardLayout(
  sb: StoryboardItem,
  designW: number,
  designH: number,
): PanelRect[] {
  const cols = Math.max(1, sb.columns);
  const rows = Math.max(1, Math.ceil(sb.panels.length / cols));
  const ar = aspectRatio(sb);
  const cellW = Math.max(1, (designW - SB_PAD * 2 - SB_GAP * (cols - 1)) / cols);
  const rowRoom = (designH - SB_HEADER - SB_PAD * 2 - SB_GAP * (rows - 1)) / rows - SB_META_H;
  const frameH = Math.max(SB_MIN_FRAME_H, Math.min(cellW / ar, rowRoom));
  const w = Math.min(cellW, frameH * ar);
  const h = frameH + SB_META_H;
  return sb.panels.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: SB_PAD + col * (cellW + SB_GAP) + (cellW - w) / 2,
      y: SB_HEADER + SB_PAD + row * (h + SB_GAP),
      w,
      frameH,
      h,
    };
  });
}

/** Panel geometry on the canvas (frame box + meta strip). */
function panelRects(sb: StoryboardItem): PanelRect[] {
  const k = storyboardZoom(sb);
  return storyboardLayout(sb, sb.width / k, sb.height / k).map((r) => ({
    x: sb.x + r.x * k,
    y: sb.y + r.y * k,
    w: r.w * k,
    frameH: r.frameH * k,
    h: r.h * k,
  }));
}

/** The height that fits the panel grid exactly at the card's width and zoom. */
export function storyboardHeight(sb: StoryboardItem): number {
  const k = storyboardZoom(sb);
  const cols = Math.max(1, sb.columns);
  const rows = Math.max(1, Math.ceil(sb.panels.length / cols));
  const cellW = (sb.width / k - SB_PAD * 2 - SB_GAP * (cols - 1)) / cols;
  const h = cellW / aspectRatio(sb) + SB_META_H;
  return (SB_HEADER + SB_PAD * 2 + rows * h + (rows - 1) * SB_GAP) * k;
}

/** The shortest card that still shows every row at the smallest frame. */
function storyboardMinHeight(sb: StoryboardItem): number {
  const k = storyboardZoom(sb);
  const cols = Math.max(1, sb.columns);
  const rows = Math.max(1, Math.ceil(sb.panels.length / cols));
  const h = SB_MIN_FRAME_H + SB_META_H;
  return (SB_HEADER + SB_PAD * 2 + rows * h + (rows - 1) * SB_GAP) * k;
}

/** The panel whose FRAME contains `pt`, if any. */
export function storyboardPanelAt(
  doc: CanvasDocument,
  pt: Point,
  exclude: ReadonlySet<string>,
): StoryboardTarget | null {
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'storyboard' || item.locked || exclude.has(item.id)) continue;
    if (item.panels.length === 0) continue;
    if (
      pt.x < item.x - CAPTURE_PAD ||
      pt.x > item.x + item.width + CAPTURE_PAD ||
      pt.y < item.y + SB_HEADER ||
      pt.y > item.y + item.height + CAPTURE_PAD
    ) {
      continue;
    }
    const rects = panelRects(item);
    let best: { panel: StoryboardPanel; d: number } | null = null;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.frameH / 2;
      const d = Math.hypot(pt.x - cx, pt.y - cy);
      if (
        pt.x >= r.x - SB_GAP / 2 &&
        pt.x <= r.x + r.w + SB_GAP / 2 &&
        pt.y >= r.y - SB_GAP / 2 &&
        pt.y <= r.y + r.h + SB_GAP / 2 &&
        (best === null || d < best.d)
      ) {
        best = { panel: item.panels[i]!, d };
      }
    }
    if (best) return { itemId: item.id, panelId: best.panel.id };
  }
  return null;
}

/** The panel an item is currently framed in, if any. */
export function attachedPanelOf(doc: CanvasDocument, itemId: string): StoryboardTarget | null {
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'storyboard') continue;
    for (const panel of item.panels) {
      if (panel.itemIds.includes(itemId)) return { itemId: item.id, panelId: panel.id };
    }
  }
  return null;
}

/** True when the item's center has left its card's (padded) territory. */
export function outsideStoryboardTerritory(item: Item, sb: StoryboardItem): boolean {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return (
    cx < sb.x - DETACH_PAD ||
    cx > sb.x + sb.width + DETACH_PAD ||
    cy < sb.y - DETACH_PAD ||
    cy > sb.y + sb.height + DETACH_PAD
  );
}

/** Fit an item inside a frame box (contain, centered, rotation cleared). */
function fitToFrame(item: Item, r: PanelRect): void {
  const maxW = r.w - 6;
  const maxH = r.frameH - 6;
  const scale = Math.min(maxW / item.width, maxH / item.height);
  if (scale < 1 || scale > 1) {
    // Frames SCALE UP small drops too — the frame is the size authority.
    const k = Math.min(scale, 4); // don't blow tiny swatches up absurdly
    item.width *= k;
    item.height *= k;
    if (item.type === 'text' || item.type === 'code') {
      item.fontSize = Math.max(7, item.fontSize * k);
    }
  }
  item.x = r.x + (r.w - item.width) / 2;
  item.y = r.y + (r.frameH - item.height) / 2;
  item.rotation = 0;
}

/** What decides the grid's shape: a change here refits the card's height. */
function gridShape(sb: StoryboardItem): string {
  const cols = Math.max(1, sb.columns);
  return `${cols}:${Math.ceil(sb.panels.length / cols)}:${sb.aspect}`;
}

/**
 * Reflow: framed items sit in their frames. The height is the user's (an edge
 * drag sets it) unless the grid itself changed shape (shots added or removed,
 * columns, aspect), which refits it to the panels.
 */
function reshelfStoryboard(draft: CanvasDocument, sb: StoryboardItem, fitHeight: boolean): void {
  sb.width = Math.max(sb.width, MIN_CARD_W * storyboardZoom(sb));
  sb.height = fitHeight ? storyboardHeight(sb) : Math.max(sb.height, storyboardMinHeight(sb));
  const rects = panelRects(sb);
  sb.panels.forEach((panel, i) => {
    if (panel.freeArrange) return;
    const r = rects[i];
    if (!r) return;
    for (const id of panel.itemIds) {
      const item = draft.items[id];
      if (!item) continue;
      fitToFrame(item, r);
    }
  });
}

/** Run a labeled mutation on one storyboard, then reflow it. */
export function updateStoryboard(
  itemId: string,
  label: string,
  recipe: (sb: StoryboardItem, draft: CanvasDocument) => void,
): void {
  runCommand(label, (draft) => {
    const sb = draft.items[itemId];
    if (sb?.type !== 'storyboard') return;
    const shape = gridShape(sb);
    recipe(sb, draft);
    reshelfStoryboard(draft, sb, gridShape(sb) !== shape);
  });
}

/**
 * Frame items into a panel. Items leave any other panel first; a previously
 * framed item is set free just below the card (a replace, not a stack).
 */
export function attachItemsToPanel(ids: string[], target: StoryboardTarget): void {
  updateStoryboard(target.itemId, 'Frame in storyboard', (sb, draft) => {
    const moving = new Set(ids);
    for (const item of Object.values(draft.items)) {
      if (item.type !== 'storyboard') continue;
      for (const panel of item.panels) {
        panel.itemIds = panel.itemIds.filter((id) => !moving.has(id));
      }
    }
    const panel = sb.panels.find((p) => p.id === target.panelId);
    if (!panel) return;
    // Evict the current frame: it stays on the canvas, parked under the card.
    let parkX = sb.x;
    for (const oldId of panel.itemIds) {
      const old = draft.items[oldId];
      if (!old) continue;
      old.x = parkX;
      old.y = sb.y + sb.height + 24;
      parkX += old.width + 16;
    }
    panel.itemIds = [];
    let z = topZIndex(draft) + 1;
    for (const id of ids) {
      const item = draft.items[id];
      if (
        !item ||
        item.type === 'storyboard' ||
        item.type === 'tierlist' ||
        item.type === 'timeline' ||
        item.type === 'tree'
      ) {
        continue;
      }
      panel.itemIds.push(id);
      item.zIndex = z++;
    }
  });
}

/** Remove items from whatever panels frame them, reflowing affected cards. */
export function detachFromPanels(ids: string[]): void {
  const moving = new Set(ids);
  runCommand('Remove from storyboard', (draft) => {
    for (const item of Object.values(draft.items)) {
      if (item.type !== 'storyboard') continue;
      let touched = false;
      for (const panel of item.panels) {
        const next = panel.itemIds.filter((id) => !moving.has(id));
        if (next.length !== panel.itemIds.length) {
          panel.itemIds = next;
          touched = true;
        }
      }
      if (touched) reshelfStoryboard(draft, item, false);
    }
  });
}

/** Clone remap (duplicate/paste): framed ids follow their clones. */
export function remapClonedStoryboards(clones: Item[], idMap: ReadonlyMap<string, string>): void {
  for (const clone of clones) {
    if (clone.type !== 'storyboard') continue;
    clone.panels = clone.panels.map((panel) => ({
      ...panel,
      itemIds: panel.itemIds
        .map((id) => idMap.get(id))
        .filter((id): id is string => id !== undefined),
    }));
  }
}
