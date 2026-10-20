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

export const SB_HEADER = 40;
export const SB_PAD = 14;
const SB_GAP = 12;
/** Metadata strip under each frame (label/scene/action lines). */
export const SB_META_H = 52;
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

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  frameH: number;
  h: number;
}

/** Panel geometry inside the card (frame box + meta strip). */
export function panelRects(sb: StoryboardItem): PanelRect[] {
  const cols = Math.max(1, sb.columns);
  const w = (sb.width - SB_PAD * 2 - SB_GAP * (cols - 1)) / cols;
  const frameH = w / aspectRatio(sb);
  const h = frameH + SB_META_H;
  return sb.panels.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: sb.x + SB_PAD + col * (w + SB_GAP),
      y: sb.y + SB_HEADER + SB_PAD + row * (h + SB_GAP),
      w,
      frameH,
      h,
    };
  });
}

/** The height the card needs for its panel grid. */
export function storyboardHeight(sb: StoryboardItem): number {
  const cols = Math.max(1, sb.columns);
  const rows = Math.max(1, Math.ceil(sb.panels.length / cols));
  const w = (sb.width - SB_PAD * 2 - SB_GAP * (cols - 1)) / cols;
  const h = w / aspectRatio(sb) + SB_META_H;
  return SB_HEADER + SB_PAD * 2 + rows * h + (rows - 1) * SB_GAP;
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

/** Reflow: card height follows the grid; framed items sit in their frames. */
function reshelfStoryboard(draft: CanvasDocument, sb: StoryboardItem): void {
  sb.width = Math.max(sb.width, MIN_CARD_W);
  sb.height = storyboardHeight(sb);
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
    recipe(sb, draft);
    reshelfStoryboard(draft, sb);
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
      if (touched) reshelfStoryboard(draft, item);
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
