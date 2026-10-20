import type { Item, TimelineItem, TimelinePoint } from '@boardcache/schema';

/**
 * Pure geometry for timeline items, shared by the canvas component and the
 * thumbnail/canvas renderer so previews match the live layout exactly.
 * Points sit evenly along the axis; cards alternate sides of the spine.
 */

/** Minimum axis length per point before the item auto-grows. */
const TIMELINE_MIN_SPACING = 200;
/** Axis inset before the first / after the last point. */
const TIMELINE_END_PAD = 44;
/** Extra along-axis room an occupied point claims beyond its shelf grid. */
const SHELF_ALONG_MARGIN = 140;
/** Shelf grid: first row starts this far past the spine */
export const SHELF_START = 56;
/** …items and rows this far apart */
const SHELF_GAP = 14;
/** …at most this many items per row along the axis. */
const SHELF_COLS = 3;

interface ShelfOffset {
  /** Item CENTER offset from the slot center, along the axis. */
  dAlong: number;
  /** Item near-edge distance from the stack start (0 = first row). */
  crossStart: number;
}

export interface ShelfGrid {
  offsets: Record<string, ShelfOffset>;
  /** Widest row (along the axis). */
  alongExtent: number;
  /** Total stack depth away from the spine. */
  crossExtent: number;
}

/**
 * Grid layout for a point's attached items: rows of up to SHELF_COLS along
 * the axis (never one endless line), stacking away from the spine. Pure
 * geometry — shared by live rendering, drop commits, and bounds fitting.
 */
export function shelfGrid(
  items: readonly { id: string; width: number; height: number }[],
  horizontal: boolean,
): ShelfGrid {
  const offsets: Record<string, ShelfOffset> = {};
  let alongExtent = 0;
  let cross = 0;
  for (let r = 0; r * SHELF_COLS < items.length; r++) {
    const row = items.slice(r * SHELF_COLS, (r + 1) * SHELF_COLS);
    const sizes = row.map((it) => (horizontal ? it.width : it.height));
    const rowAlong = sizes.reduce((a, b) => a + b, 0) + SHELF_GAP * (row.length - 1);
    const rowCross = Math.max(...row.map((it) => (horizontal ? it.height : it.width)));
    let a = -rowAlong / 2;
    row.forEach((it, i) => {
      offsets[it.id] = { dAlong: a + sizes[i]! / 2, crossStart: cross };
      a += sizes[i]! + SHELF_GAP;
    });
    alongExtent = Math.max(alongExtent, rowAlong);
    cross += rowCross + SHELF_GAP;
  }
  return { offsets, alongExtent, crossExtent: Math.max(0, cross - SHELF_GAP) };
}

/** Members of a point present in the item map, with their ids. */
function pointMembers(
  point: TimelinePoint,
  itemsById?: Record<string, { width: number; height: number }>,
): { id: string; width: number; height: number }[] {
  if (!itemsById) return [];
  return point.itemIds.flatMap((id) => {
    const m = itemsById[id];
    return m ? [{ id, width: m.width, height: m.height }] : [];
  });
}

export interface TimelineSlot {
  point: TimelinePoint;
  /** Position along the axis, px from the item's left/top edge. */
  along: number;
  /** Card on the before-side (above / left of the spine)? Alternates. */
  before: boolean;
}

/**
 * Best-effort date parsing for freeform point dates: "2026", "Q3 2026",
 * anything Date.parse accepts ("May 4 2026", "2026-08-16", "Jan 2026").
 * Returns epoch ms, or null when the text isn't a date.
 */
export function parseTimelineDate(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  const year = /^(\d{4})$/.exec(s);
  if (year) return Date.UTC(Number(year[1]), 0, 1);
  const quarter = /^[Qq]([1-4])\s+(\d{4})$/.exec(s);
  if (quarter) return Date.UTC(Number(quarter[2]), (Number(quarter[1]) - 1) * 3, 1);
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Along-axis extent of each point's shelf grid (0 when empty). */
function pointExtents(
  item: TimelineItem,
  itemsById?: Record<string, { width: number; height: number }>,
): number[] {
  const horizontal = item.orientation === 'horizontal';
  return item.points.map((point) => {
    const members = pointMembers(point, itemsById);
    return members.length ? shelfGrid(members, horizontal).alongExtent : 0;
  });
}

/** Axis share a point claims in even mode: base spacing, more when loaded. */
const slotFootprint = (ext: number): number =>
  Math.max(TIMELINE_MIN_SPACING, ext ? ext + SHELF_ALONG_MARGIN : 0);

/** Minimum center distance in date mode: shelves must clear, labels breathe. */
const crowdingFloor = (ext: number): number => (ext ? ext + SHELF_ALONG_MARGIN : 110);

/** End inset: at the edge when the end point is light, in only as far as its
 *  shelf needs to stay inside the box. */
const endMargin = (ext: number): number => Math.max(TIMELINE_END_PAD, ext / 2 + 16);

/**
 * Point positions along the axis. Spacing is weighted by each point's shelf
 * footprint (pass the doc's items for that); in 'date' mode — when every
 * point has a parseable date — positions are proportional to time instead,
 * with forward/backward passes keeping crowded points at least a footprint
 * apart.
 */
export function timelineSlots(
  item: TimelineItem,
  itemsById?: Record<string, { width: number; height: number }>,
): TimelineSlot[] {
  const len = item.orientation === 'horizontal' ? item.width : item.height;
  const n = item.points.length;
  if (n === 0) return [];
  if (n === 1) return [{ point: item.points[0]!, along: len / 2, before: true }];

  const exts = pointExtents(item, itemsById);
  const footprints = exts.map(slotFootprint);
  // First/last points anchor at the ends of the line — inset only as far
  // as their own shelves need to stay inside the box.
  const startA = endMargin(exts[0]!);
  const endA = len - endMargin(exts[n - 1]!);
  const span = Math.max(1, endA - startA);

  let along: number[] | null = null;
  if (item.scaleMode === 'date') {
    const times = item.points.map((p) => parseTimelineDate(p.date));
    const min = Math.min(...(times as number[]));
    const max = Math.max(...(times as number[]));
    if (times.every((t) => t !== null) && max > min) {
      const floors = exts.map(crowdingFloor);
      along = times.map((t) => startA + ((t! - min) / (max - min)) * span);
      // Crowding: keep neighbours at least a floor apart (forward), then
      // pull everything back inside the span (backward).
      for (let i = 1; i < n; i++) {
        const gap = (floors[i - 1]! + floors[i]!) / 2;
        along[i] = Math.max(along[i]!, along[i - 1]! + Math.min(gap, span / (n - 1)));
      }
      for (let i = n - 1; i >= 0; i--) {
        const limit =
          i === n - 1
            ? endA
            : along[i + 1]! - Math.min((floors[i]! + floors[i + 1]!) / 2, span / (n - 1));
        along[i] = Math.min(along[i]!, limit);
      }
    }
  }
  if (!along) {
    // Weighted-even: consecutive gaps proportional to the neighbouring
    // footprints, stretched so the end points hit their anchors exactly.
    const gaps: number[] = [];
    for (let i = 0; i < n - 1; i++) gaps.push((footprints[i]! + footprints[i + 1]!) / 2);
    const total = gaps.reduce((a, b) => a + b, 0);
    const scale = span / Math.max(1, total);
    along = [startA];
    for (let i = 0; i < n - 1; i++) along.push(along[i]! + gaps[i]! * scale);
  }

  return item.points.map((point, i) => ({
    point,
    along: along[i]!,
    before: i % 2 === 0,
  }));
}

/** The axis length a timeline wants for its point count. */
export function timelineMinLength(pointCount: number): number {
  return Math.max(2, pointCount) * TIMELINE_MIN_SPACING + TIMELINE_END_PAD;
}

/** The axis length that fits every point's shelf without crowding. */
export function timelineRequiredLength(
  item: TimelineItem,
  itemsById?: Record<string, { width: number; height: number }>,
): number {
  const n = item.points.length;
  if (n === 0) return TIMELINE_END_PAD * 2 + TIMELINE_MIN_SPACING;
  const exts = pointExtents(item, itemsById);
  const footprints = exts.map(slotFootprint);
  if (n === 1) return endMargin(exts[0]!) * 2 + footprints[0]!;
  let gaps = 0;
  for (let i = 0; i < n - 1; i++) gaps += (footprints[i]! + footprints[i + 1]!) / 2;
  return endMargin(exts[0]!) + gaps + endMargin(exts[n - 1]!);
}

/** Deepest shelf stack (spine → far edge) across a timeline's points. */
export function timelineMaxStack(
  item: TimelineItem,
  itemsById?: Record<string, { width: number; height: number }>,
): number {
  const horizontal = item.orientation === 'horizontal';
  let max = 0;
  for (const point of item.points) {
    const members = pointMembers(point, itemsById);
    if (!members.length) continue;
    max = Math.max(max, SHELF_START + shelfGrid(members, horizontal).crossExtent);
  }
  return max;
}

/** Effective accent for a point (its own color, else the timeline style). */
export function pointColor(item: TimelineItem, point: TimelinePoint): string {
  return point.color ?? item.style.pointColor;
}

let counter = 0;

/** Unique point id (time-based like other item ids, collision-suffixed). */
function newPointId(): string {
  counter += 1;
  return `tp-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Fix up cloned timelines (duplicate/paste): membership follows items cloned
 * in the same batch (idMap: original → clone); everything else is dropped —
 * two timelines must never claim the same attachment.
 */
export function remapClonedTimelines(clones: Item[], idMap: ReadonlyMap<string, string>): void {
  for (const clone of clones) {
    if (clone.type !== 'timeline') continue;
    clone.points = clone.points.map((point) => ({
      ...point,
      itemIds: point.itemIds
        .map((id) => idMap.get(id))
        .filter((id): id is string => id !== undefined),
    }));
  }
}

/** A fresh point with placeholder label ("Point N"). */
export function makePoint(n: number): TimelinePoint {
  return {
    id: newPointId(),
    label: `Point ${n}`,
    description: '',
    date: '',
    color: null,
    collapsed: true,
    itemIds: [],
    freeArrange: false,
  };
}
