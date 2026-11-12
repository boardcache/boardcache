import type { CanvasDocument, Item, KanbanItem } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { runCommand, topZIndex } from '../../state/commands';
import { AUDIO_MIN_HEIGHT } from '../media/audioActions';

/**
 * Kanban attachments (the tier list's shelf machinery turned on its side):
 * each column of the card is a drop lane. Dropping a canvas item on a
 * column files it — the item stays a real canvas item, sized to the
 * column's width and stacked top to bottom in column order. Moving the
 * card carries its filed items. Rotation is ignored — capture zones use
 * the unrotated frame.
 *
 * The card is a zoom card (lib/canvas/cardZoom): its chrome — header,
 * column heads, paddings — is designed at zoom 1 and multiplied by `zoom`,
 * which only a uniform scale (a corner drag) changes; an edge drag changes
 * the box and the columns reflow into it. `kanbanBoxes` is the one layout,
 * read by the reflow on release and by the live preview mid-drag.
 */

export interface KanbanTarget {
  itemId: string;
  columnId: string;
  /** Where in the column the drop lands (cards above it keep their place). */
  index?: number;
}

export const KANBAN_HEADER = 40;
/** The column head (name and count), design space. */
export const KANBAN_COL_HEAD = 32;
const COL_GAP = 10;
export const KANBAN_COL_PAD = 8;
const COL_PAD = KANBAN_COL_PAD;
const CARD_GAP = 8;
/** The title strip under a filed card when the board shows titles (design space). */
export const KANBAN_TITLE_H = 18;
/** How far past the card edges a drop still counts as "on the card". */
const CAPTURE_PAD = 24;
/** Beyond this padding, dropping a filed item detaches it. */
const DETACH_PAD = 80;
const MIN_CARD_H = 200;
/** A column's filled lane keeps at least this much room under its last card. */
const LANE_TAIL = 40;

/** The card's content zoom: set by uniform scales; absent = 1. */
export function kanbanZoom(kb: Pick<KanbanItem, 'zoom'>): number {
  return kb.zoom ?? 1;
}

/** One column's width in design space for a card of this width at zoom `k`. */
export function kanbanColumnWidth(kb: Pick<KanbanItem, 'columns' | 'width'>, k: number): number {
  const n = Math.max(1, kb.columns.length);
  return Math.max(60, (kb.width / k - COL_PAD * 2 - COL_GAP * (n - 1)) / n);
}

/** The column whose lane contains `pt`, with the slot the pointer is over. */
export function kanbanColumnAt(
  doc: CanvasDocument,
  pt: Point,
  exclude: ReadonlySet<string>,
): KanbanTarget | null {
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'kanban' || item.locked || exclude.has(item.id)) continue;
    if (item.columns.length === 0) continue;
    const k = kanbanZoom(item);
    const header = KANBAN_HEADER * k;
    if (
      pt.x < item.x - CAPTURE_PAD ||
      pt.x > item.x + item.width + CAPTURE_PAD ||
      pt.y < item.y + header ||
      pt.y > item.y + item.height + CAPTURE_PAD
    ) {
      continue;
    }
    const colW = kanbanColumnWidth(item, k) * k;
    const pitch = colW + COL_GAP * k;
    const index = Math.max(
      0,
      Math.min(item.columns.length - 1, Math.floor((pt.x - item.x - COL_PAD * k) / pitch)),
    );
    const column = item.columns[index]!;
    // The slot: before the first filed card whose middle is below the pointer.
    let slot = column.itemIds.length;
    column.itemIds.forEach((id, i) => {
      const card = doc.items[id];
      if (slot === column.itemIds.length && card && pt.y < card.y + card.height / 2) slot = i;
    });
    return { itemId: item.id, columnId: column.id, index: slot };
  }
  return null;
}

/** The column an item is currently filed in, if any. */
export function attachedKanbanColumnOf(doc: CanvasDocument, itemId: string): KanbanTarget | null {
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'kanban') continue;
    for (const column of item.columns) {
      if (column.itemIds.includes(itemId)) return { itemId: item.id, columnId: column.id };
    }
  }
  return null;
}

/** True when the item's center has left its card's (padded) territory. */
export function outsideKanbanTerritory(item: Item, kb: KanbanItem): boolean {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return (
    cx < kb.x - DETACH_PAD ||
    cx > kb.x + kb.width + DETACH_PAD ||
    cy < kb.y - DETACH_PAD ||
    cy > kb.y + kb.height + DETACH_PAD
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The size an item takes in a lane `laneW` wide at zoom `k`: shrunk (never
 *  grown) to the lane's width, players clamped to usable dimensions. */
function laneSizeFor(
  item: Pick<Item, 'type' | 'width' | 'height'>,
  laneW: number,
  k: number,
): { width: number; height: number } {
  const maxW = Math.max(24 * k, laneW);
  if (item.type === 'audio' || item.type === 'playlist') {
    return {
      width: Math.min(Math.max(item.width, 220), Math.max(220, maxW)),
      height: Math.max(AUDIO_MIN_HEIGHT, Math.min(item.height || AUDIO_MIN_HEIGHT, 160 * k)),
    };
  }
  const scale = Math.min(1, maxW / item.width);
  return { width: item.width * scale, height: item.height * scale };
}

/**
 * Where every filed item sits for a card at this box and zoom: boxes on the
 * canvas, and the height the card needs to hold its longest column. Pure,
 * so the resize gesture can preview the lanes mid-drag with the same
 * numbers the reflow writes on release. `sizes` lets the preview hand in
 * scaled sizes for a uniform drag.
 */
export function kanbanBoxes(
  kb: KanbanItem,
  items: Record<string, Item | undefined>,
  sizes?: ReadonlyMap<string, { width: number; height: number }>,
): { boxes: Map<string, Box>; neededHeight: number } {
  const k = kanbanZoom(kb);
  const colW = kanbanColumnWidth(kb, k) * k;
  const laneW = colW - COL_PAD * 2 * k;
  // Under the header, the columns' padding, the column head and the lane's own padding.
  const top = kb.y + (KANBAN_HEADER + COL_PAD + KANBAN_COL_HEAD + COL_PAD) * k;
  const titleH = kb.showTitles ? KANBAN_TITLE_H * k : 0;
  const boxes = new Map<string, Box>();
  let needed = MIN_CARD_H * k;
  kb.columns.forEach((column, i) => {
    const left = kb.x + (COL_PAD + i * (kanbanColumnWidth(kb, k) + COL_GAP)) * k + COL_PAD * k;
    let y = top;
    for (const id of column.itemIds) {
      const item = items[id];
      if (!item) continue;
      const size = laneSizeFor({ type: item.type, ...(sizes?.get(id) ?? item) }, laneW, k);
      boxes.set(id, { x: left + (laneW - size.width) / 2, y, ...size });
      y += size.height + titleH + CARD_GAP * k;
    }
    if (column.itemIds.length) needed = Math.max(needed, y - kb.y + (LANE_TAIL - CARD_GAP) * k);
  });
  return { boxes, neededHeight: needed };
}

/**
 * Stack every column's items top to bottom in their lanes, sized to fit;
 * the card grows taller (never shorter) to hold its longest column.
 */
function reflowKanban(draft: CanvasDocument, kb: KanbanItem): void {
  const { boxes, neededHeight } = kanbanBoxes(kb, draft.items);
  for (const [id, box] of boxes) {
    const item = draft.items[id];
    if (!item) continue;
    const scale = box.width / item.width;
    if ((item.type === 'text' || item.type === 'code') && scale < 1)
      item.fontSize = Math.max(7, item.fontSize * scale);
    if (item.type === 'audio') item.zoom = 1;
    item.x = box.x;
    item.y = box.y;
    item.width = box.width;
    item.height = box.height;
    item.rotation = 0;
  }
  kb.height = Math.max(kb.height, neededHeight);
}

/** Run a labeled mutation on one kanban card, then reflow its columns. */
export function updateKanban(
  itemId: string,
  label: string,
  recipe: (kb: KanbanItem, draft: CanvasDocument) => void,
): void {
  runCommand(label, (draft) => {
    const kb = draft.items[itemId];
    if (kb?.type !== 'kanban') return;
    recipe(kb, draft);
    reflowKanban(draft, kb);
  });
}

/** Whether an item can be filed in a column: containers never are. */
function kanbanAccepts(item: Item): boolean {
  return (
    item.type !== 'kanban' &&
    item.type !== 'tierlist' &&
    item.type !== 'timeline' &&
    item.type !== 'storyboard' &&
    item.type !== 'tree'
  );
}

/**
 * File items in a column at the target's slot (moving them off any other
 * column first, on any card). Dropped items rise above the card and the
 * columns reflow.
 */
export function attachItemsToKanbanColumn(ids: string[], target: KanbanTarget): void {
  updateKanban(target.itemId, 'File on kanban', (kb, draft) => {
    const moving = new Set(ids);
    const column = kb.columns.find((c) => c.id === target.columnId);
    if (!column) return;
    // The slot counts the cards above it that are not themselves moving.
    const at = target.index ?? column.itemIds.length;
    const above = column.itemIds.slice(0, at).filter((id) => !moving.has(id)).length;
    for (const item of Object.values(draft.items)) {
      if (item.type !== 'kanban') continue;
      for (const c of item.columns) c.itemIds = c.itemIds.filter((id) => !moving.has(id));
    }
    let z = topZIndex(draft) + 1;
    const filed: string[] = [];
    for (const id of ids) {
      const item = draft.items[id];
      if (!item || !kanbanAccepts(item)) continue;
      filed.push(id);
      item.zIndex = z++;
    }
    column.itemIds.splice(Math.min(above, column.itemIds.length), 0, ...filed);
  });
}

/** Remove items from whatever columns hold them, reflowing affected cards. */
export function detachFromKanban(ids: string[]): void {
  const moving = new Set(ids);
  runCommand('Remove from kanban', (draft) => {
    for (const item of Object.values(draft.items)) {
      if (item.type !== 'kanban') continue;
      let touched = false;
      for (const column of item.columns) {
        const next = column.itemIds.filter((id) => !moving.has(id));
        if (next.length !== column.itemIds.length) {
          column.itemIds = next;
          touched = true;
        }
      }
      if (touched) reflowKanban(draft, item);
    }
  });
}
