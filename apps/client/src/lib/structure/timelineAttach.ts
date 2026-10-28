import type { CanvasDocument, Item, TimelineItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { runCommand, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { AUDIO_MIN_HEIGHT } from '../media/audioActions';
import {
  SHELF_START,
  makePoint,
  shelfGrid,
  timelineMaxStack,
  timelineMinLength,
  timelineRequiredLength,
  timelineSlots,
} from './timelineLayout';

/**
 * Phase-2 timeline attachments: points are drop targets. Dropping an item
 * near a point attaches it (point.itemIds); attached items stack in a
 * "shelf" on the opposite side of the point's label card — unless the point
 * is freeArrange, in which case they stay wherever they're dropped. Moving
 * the timeline carries its attachments (gestures expands the drag set).
 * Rotation is ignored — capture zones use the unrotated frame.
 */

export interface TimelineTarget {
  itemId: string;
  pointId: string;
}

/** Attached items shrink (never grow) to fit this square, keeping aspect. */
const SHELF_ITEM_MAX = 160;
/** How far past the box edges a drop still counts as "on the timeline". */
const CAPTURE_PAD = 48;
/** Beyond this box padding, dropping an attached item detaches it. */
const DETACH_PAD_ALONG = 140;
const DETACH_PAD_CROSS = 320;

/** The point whose capture zone contains `pt`, if any. */
export function timelinePointAt(
  doc: CanvasDocument,
  pt: Point,
  exclude: ReadonlySet<string>,
): TimelineTarget | null {
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'timeline' || item.locked || exclude.has(item.id)) continue;
    if (
      pt.x < item.x - CAPTURE_PAD ||
      pt.x > item.x + item.width + CAPTURE_PAD ||
      pt.y < item.y - CAPTURE_PAD ||
      pt.y > item.y + item.height + CAPTURE_PAD
    ) {
      continue;
    }
    const slots = timelineSlots(item, doc.items);
    if (slots.length === 0) continue;
    const along = item.orientation === 'horizontal' ? pt.x - item.x : pt.y - item.y;
    let best = slots[0]!;
    for (const slot of slots) {
      if (Math.abs(slot.along - along) < Math.abs(best.along - along)) best = slot;
    }
    const spacing =
      slots.length > 1 ? Math.abs(slots[1]!.along - slots[0]!.along) : Number.POSITIVE_INFINITY;
    if (Math.abs(best.along - along) <= Math.max(60, spacing / 2)) {
      return { itemId: item.id, pointId: best.point.id };
    }
  }
  return null;
}

/** The point an item is currently attached to, if any. */
export function attachedPointOf(doc: CanvasDocument, itemId: string): TimelineTarget | null {
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'timeline') continue;
    for (const point of item.points) {
      if (point.itemIds.includes(itemId)) return { itemId: item.id, pointId: point.id };
    }
  }
  return null;
}

/** True when the item's center has left its timeline's (padded) territory. */
export function outsideTimelineTerritory(item: Item, timeline: TimelineItem): boolean {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const horizontal = timeline.orientation === 'horizontal';
  const padX = horizontal ? DETACH_PAD_ALONG : DETACH_PAD_CROSS;
  const padY = horizontal ? DETACH_PAD_CROSS : DETACH_PAD_ALONG;
  return (
    cx < timeline.x - padX ||
    cx > timeline.x + timeline.width + padX ||
    cy < timeline.y - padY ||
    cy > timeline.y + timeline.height + padY
  );
}

/** Shelf coordinates for a point's items: the grid (rows of up to three)
 *  centered on the slot, stacked away from the label card's side. */
export function shelfPositions(
  timeline: TimelineItem,
  pointId: string,
  items: readonly Item[],
  itemsById?: Record<string, { width: number; height: number }>,
): Record<string, Point> {
  const slot = timelineSlots(timeline, itemsById).find((s) => s.point.id === pointId);
  if (!slot) return {};
  const horizontal = timeline.orientation === 'horizontal';
  const mid = horizontal ? timeline.height / 2 : timeline.width / 2;
  const grid = shelfGrid(items, horizontal);
  const positions: Record<string, Point> = {};
  for (const it of items) {
    const off = grid.offsets[it.id];
    if (!off) continue;
    if (horizontal) {
      const x = timeline.x + slot.along + off.dAlong - it.width / 2;
      const y = slot.before
        ? timeline.y + mid + SHELF_START + off.crossStart
        : timeline.y + mid - SHELF_START - off.crossStart - it.height;
      positions[it.id] = { x, y };
    } else {
      const y = timeline.y + slot.along + off.dAlong - it.height / 2;
      const x = slot.before
        ? timeline.x + mid + SHELF_START + off.crossStart
        : timeline.x + mid - SHELF_START - off.crossStart - it.width;
      positions[it.id] = { x, y };
    }
  }
  return positions;
}

/** Normalize an item (about its center) for shelf life. Media shrinks to a
 *  square footprint keeping aspect; players clamp to usable dimensions
 *  instead — a proportionally squashed audio player is dead weight. */
function normalizeShelfSize(item: Item): void {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  if (item.type === 'audio' || item.type === 'playlist') {
    item.width = Math.min(Math.max(item.width, 220), 280);
    item.height =
      item.type === 'audio'
        ? Math.min(Math.max(item.height, AUDIO_MIN_HEIGHT), 160)
        : Math.min(item.height, 280);
    // The clamped box is sized for the player at zoom 1.
    if (item.type === 'audio') item.zoom = 1;
    item.x = cx - item.width / 2;
    item.y = cy - item.height / 2;
    return;
  }
  const scale = SHELF_ITEM_MAX / Math.max(item.width, item.height);
  if (scale >= 1) return;
  item.width *= scale;
  item.height *= scale;
  item.x = cx - item.width / 2;
  item.y = cy - item.height / 2;
  // Text reflows at its set font size — scale it too or the content crops.
  if (item.type === 'text' || item.type === 'code') {
    item.fontSize = Math.max(7, item.fontSize * scale);
  }
}

/** Grow the axis when the shelves need more room (never shrinks). */
function growForShelves(timeline: TimelineItem, itemsById: Record<string, Item>): void {
  const required = timelineRequiredLength(timeline, itemsById);
  if (timeline.orientation === 'horizontal') {
    timeline.width = Math.max(timeline.width, required);
  } else {
    timeline.height = Math.max(timeline.height, required);
  }
}

/** Fit the cross axis around the deepest shelf so the bounding box always
 *  contains every attached item — anchored on the spine, not the top edge. */
function fitTimelineCross(timeline: TimelineItem, itemsById: Record<string, Item>): void {
  const half = Math.max(120, timelineMaxStack(timeline, itemsById) + 20);
  if (timeline.orientation === 'horizontal') {
    const spine = timeline.y + timeline.height / 2;
    timeline.height = half * 2;
    timeline.y = spine - half;
  } else {
    const spine = timeline.x + timeline.width / 2;
    timeline.width = half * 2;
    timeline.x = spine - half;
  }
}

/**
 * Re-stack every auto-arrange point's shelf from the CURRENT slot layout.
 * Any change that moves slots (attach/detach, resize, orientation flip,
 * point edits, spacing mode) must end with this, or shelves go stale.
 */
function reshelfTimeline(draft: CanvasDocument, timeline: TimelineItem): void {
  for (const point of timeline.points) {
    if (point.freeArrange) continue;
    const items = point.itemIds
      .map((id) => draft.items[id])
      .filter((it): it is Item => it !== undefined);
    if (items.length === 0) continue;
    const positions = shelfPositions(timeline, point.id, items, draft.items);
    for (const it of items) {
      const p = positions[it.id];
      if (p) {
        it.x = p.x;
        it.y = p.y;
      }
    }
  }
}

/**
 * Run a labeled mutation on one timeline, then grow the axis for its
 * shelves and reflow them — the standard wrapper for every timeline edit.
 */
export function updateTimeline(
  itemId: string,
  label: string,
  recipe: (timeline: TimelineItem, draft: CanvasDocument) => void,
): void {
  runCommand(label, (draft) => {
    const timeline = draft.items[itemId];
    if (timeline?.type !== 'timeline') return;
    recipe(timeline, draft);
    growForShelves(timeline, draft.items);
    fitTimelineCross(timeline, draft.items);
    reshelfTimeline(draft, timeline);
  });
}

/** Append or insert a point, growing the axis when it gets crowded. */
export function addTimelinePoint(itemId: string, atIndex?: number): string {
  const point = makePoint(0);
  updateTimeline(itemId, 'Add timeline point', (timeline) => {
    const index = atIndex ?? timeline.points.length;
    point.label = `Point ${timeline.points.length + 1}`;
    timeline.points.splice(index, 0, point);
    const min = timelineMinLength(timeline.points.length);
    if (timeline.orientation === 'horizontal') {
      timeline.width = Math.max(timeline.width, min);
    } else {
      timeline.height = Math.max(timeline.height, min);
    }
  });
  return point.id;
}

/** Reflow a timeline's shelves after an external transform (e.g. resize). */
export function reshelfTimelineById(itemId: string): void {
  updateTimeline(itemId, 'Reflow timeline', () => {});
}

/**
 * Attach items to a point (moving them off any other point first). Dropped
 * items normalize to the shelf size; the axis grows when the new shelf
 * needs more room; every shelf reflows around the re-weighted spacing.
 * freeArrange points leave their own items where they're dropped.
 */
export function attachItemsToTimelinePoint(ids: string[], target: TimelineTarget): void {
  updateTimeline(target.itemId, 'Attach to timeline', (timeline, draft) => {
    const moving = new Set(ids);
    for (const item of Object.values(draft.items)) {
      if (item.type !== 'timeline') continue;
      for (const point of item.points) {
        point.itemIds = point.itemIds.filter((id) => !moving.has(id));
      }
    }
    const point = timeline.points.find((p) => p.id === target.pointId);
    if (!point) return;
    const attachable = ids.filter((id) => {
      const item = draft.items[id];
      return item !== undefined && item.type !== 'timeline';
    });
    point.itemIds = [...point.itemIds.filter((id) => draft.items[id] !== undefined), ...attachable];
    for (const id of attachable) {
      const attached = draft.items[id]!;
      normalizeShelfSize(attached);
      // Above the timeline card, or its (transparent) box would swallow
      // clicks/double-clicks meant for the attached item.
      attached.zIndex = Math.max(attached.zIndex, timeline.zIndex + 1);
    }
  });
}

const fmtCreatedAt = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * Build a timeline from the selection: one point per item (ordered by
 * creation time), labeled from the item's name, dated from createdAt, with
 * each item attached and shelved at its point. One undo entry.
 */
export function createTimelineFromSelection(ids: string[]): string | null {
  const doc = useDocumentStore.getState().doc;
  const source = ids
    .map((id) => doc.items[id])
    .filter((it): it is Item => it !== undefined && it.type !== 'timeline' && !it.locked);
  if (source.length < 2) return null;
  const ordered = [...source].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const minX = Math.min(...ordered.map((i) => i.x));
  const maxX = Math.max(...ordered.map((i) => i.x + i.width));
  const maxY = Math.max(...ordered.map((i) => i.y + i.height));
  const timelineId = newId();

  runCommand('Create timeline from selection', (draft) => {
    const points = ordered.map((it, i) => {
      const point = makePoint(i + 1);
      if (it.name) point.label = it.name;
      point.date = it.createdAt ? fmtCreatedAt(it.createdAt) : '';
      point.itemIds = [it.id];
      return point;
    });
    const timelineZ = topZIndex(draft) + 1;
    ordered.forEach((it, i) => {
      const item = draft.items[it.id]!;
      normalizeShelfSize(item);
      // Attached items stack above the timeline card (click-through).
      item.zIndex = timelineZ + 1 + i;
    });
    draft.items[timelineId] = {
      id: timelineId,
      type: 'timeline',
      x: 0,
      y: 0,
      width: 520,
      height: 240,
      rotation: 0,
      zIndex: timelineZ,
      locked: false,
      opacity: 1,
      groupId: null,
      orientation: 'horizontal',
      scaleMode: 'even',
      points,
      style: { lineColor: '#98a2b3', lineWidth: 4, pointColor: '#608cff', pointSize: 12 },
    };
    const timeline = draft.items[timelineId] as TimelineItem;
    growForShelves(timeline, draft.items);
    fitTimelineCross(timeline, draft.items);
    timeline.x = (minX + maxX) / 2 - timeline.width / 2;
    // Spine lands a fixed drop below the selection, whatever the fitted height.
    timeline.y = maxY + 220 - timeline.height / 2;
    reshelfTimeline(draft, timeline);
  });
  useSessionStore.getState().setSelection([timelineId]);
  return timelineId;
}

/** Remove items from whatever points hold them; spacing reflows around it. */
export function detachItems(ids: string[]): void {
  runCommand('Detach from timeline', (draft) => {
    const leaving = new Set(ids);
    for (const item of Object.values(draft.items)) {
      if (item.type !== 'timeline') continue;
      let touched = false;
      for (const point of item.points) {
        const next = point.itemIds.filter((id) => !leaving.has(id));
        if (next.length !== point.itemIds.length) touched = true;
        point.itemIds = next;
      }
      if (touched) reshelfTimeline(draft, item);
    }
  });
}
