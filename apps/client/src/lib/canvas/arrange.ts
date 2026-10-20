import type { Item } from '@boardcache/schema';
import { getCanvasContainer } from './canvasDom';
import { rotatedRectAABB } from './geometry';
import type { Rect } from './coords';
import { zoomToFit } from './viewportActions';
import { transformItems } from '../../state/commands';
import type { BoundsPatch } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Alignment / distribution / organize. Everything operates on UNITS: a group
 * is one unit (its bounding box moves/scales as a block, members keep their
 * internal layout), an ungrouped item is its own unit. Results are per-item
 * BoundsPatches committed as ONE transform command.
 */
export interface UnitMember {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArrangeUnit {
  /** Unit frame (the group bounding box, or the item's own frame). */
  x: number;
  y: number;
  width: number;
  height: number;
  members: UnitMember[];
  /** True when this unit is a multi-member group. */
  group: boolean;
  /** Organize may not scale this unit below this factor (≤1). Set when the
   *  unit contains text, which becomes unreadable if shrunk too far. */
  minScale?: number;
}

/** Text boxes never organize below this width (canvas units). */
const MIN_TEXT_WIDTH = 200;

/** Convenience: a single-item unit. */
export function soloUnit(m: UnitMember): ArrangeUnit {
  return { x: m.x, y: m.y, width: m.width, height: m.height, members: [m], group: false };
}

/** A group unit from its members' union bounds. */
export function groupUnit(members: UnitMember[]): ArrangeUnit {
  const x = Math.min(...members.map((m) => m.x));
  const y = Math.min(...members.map((m) => m.y));
  const right = Math.max(...members.map((m) => m.x + m.width));
  const bottom = Math.max(...members.map((m) => m.y + m.height));
  return { x, y, width: right - x, height: bottom - y, members, group: members.length > 1 };
}

/** Move a whole unit by a delta. */
function shiftUnit(
  unit: ArrangeUnit,
  dx: number,
  dy: number,
  out: Record<string, BoundsPatch>,
): void {
  if (dx === 0 && dy === 0) return;
  for (const m of unit.members) out[m.id] = { ...out[m.id], x: m.x + dx, y: m.y + dy };
}

/** Scale a whole unit about its top-left corner. */
function scaleUnit(unit: ArrangeUnit, k: number, out: Record<string, BoundsPatch>): void {
  for (const m of unit.members) {
    out[m.id] = {
      ...out[m.id],
      x: unit.x + (m.x - unit.x) * k,
      y: unit.y + (m.y - unit.y) * k,
      width: m.width * k,
      height: m.height * k,
    };
  }
}

export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'middleY' | 'bottom';

export function computeAlign(units: ArrangeUnit[], edge: AlignEdge): Record<string, BoundsPatch> {
  if (units.length < 2) return {};
  const left = Math.min(...units.map((u) => u.x));
  const right = Math.max(...units.map((u) => u.x + u.width));
  const top = Math.min(...units.map((u) => u.y));
  const bottom = Math.max(...units.map((u) => u.y + u.height));
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const out: Record<string, BoundsPatch> = {};
  for (const u of units) {
    let dx = 0;
    let dy = 0;
    switch (edge) {
      case 'left':
        dx = left - u.x;
        break;
      case 'right':
        dx = right - u.width - u.x;
        break;
      case 'centerX':
        dx = cx - u.width / 2 - u.x;
        break;
      case 'top':
        dy = top - u.y;
        break;
      case 'bottom':
        dy = bottom - u.height - u.y;
        break;
      case 'middleY':
        dy = cy - u.height / 2 - u.y;
        break;
    }
    shiftUnit(u, dx, dy, out);
  }
  return out;
}

/** Minimum breathing room between distributed units — they never stack. */
export const DISTRIBUTE_MIN_GAP = 16;

/**
 * Even spacing between units along an axis. The first stays put; if the
 * natural gap would be below DISTRIBUTE_MIN_GAP (overlapping selections),
 * spacing expands to the minimum instead of stacking.
 */
export function computeDistribute(
  units: ArrangeUnit[],
  axis: 'x' | 'y',
): Record<string, BoundsPatch> {
  if (units.length < 3) return {};
  const sorted = [...units].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
  const size = (u: ArrangeUnit) => (axis === 'x' ? u.width : u.height);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const start = axis === 'x' ? first.x : first.y;
  const end = (axis === 'x' ? last.x : last.y) + size(last);
  const total = sorted.reduce((s, u) => s + size(u), 0);
  const gap = Math.max(DISTRIBUTE_MIN_GAP, (end - start - total) / (sorted.length - 1));
  const out: Record<string, BoundsPatch> = {};
  let cursor = start;
  for (const u of sorted) {
    const target = cursor;
    if (axis === 'x') shiftUnit(u, target - u.x, 0, out);
    else shiftUnit(u, 0, target - u.y, out);
    cursor += size(u) + gap;
  }
  return out;
}

/** Scale every unit proportionally so the given dimension matches the largest. */
export function computeMatch(
  units: ArrangeUnit[],
  dim: 'width' | 'height',
): Record<string, BoundsPatch> {
  if (units.length < 2) return {};
  const target = Math.max(...units.map((u) => (dim === 'width' ? u.width : u.height)));
  const out: Record<string, BoundsPatch> = {};
  for (const u of units) {
    const current = dim === 'width' ? u.width : u.height;
    if (current <= 0 || current === target) continue;
    scaleUnit(u, target / current, out);
  }
  return out;
}

/**
 * Masonry layout over units: each unit is normalized to the column width
 * (groups scale as a block, preserving their internal layout), placed
 * shortest-column-first in reading order. Solo items get rotation reset;
 * group members keep theirs (the group's composition is respected).
 *
 * Units with a minScale (text inside) refuse to shrink past it; if that
 * leaves them wider than one column, they span several columns so nothing
 * overlaps.
 */
export function computeOrganize(
  units: ArrangeUnit[],
  opts: { columnWidth?: number; gap?: number } = {},
): Record<string, BoundsPatch> {
  if (units.length === 0) return {};
  const COL_W = opts.columnWidth ?? 320;
  const GAP = opts.gap ?? 24;
  const cols = Math.max(1, Math.ceil(Math.sqrt(units.length)));
  const ordered = [...units].sort((a, b) => a.y - b.y || a.x - b.x);
  const heights = Array.from({ length: cols }, () => 0);
  const out: Record<string, BoundsPatch> = {};
  for (const unit of ordered) {
    const desired = unit.width > 0 ? COL_W / unit.width : 1;
    const k = Math.max(desired, Math.min(1, unit.minScale ?? 0));
    const w = unit.width > 0 ? unit.width * k : COL_W;
    const h = Math.max(24, unit.height * k);
    // Wide (min-scale-floored) units span enough columns to fit.
    const span = Math.min(cols, Math.max(1, Math.ceil((w + GAP) / (COL_W + GAP))));
    let col = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let c = 0; c + span <= cols; c++) {
      const y = Math.max(...heights.slice(c, c + span));
      if (y < best) {
        best = y;
        col = c;
      }
    }
    const targetX = col * (COL_W + GAP);
    const targetY = best;
    if (unit.group) {
      // Scale the block in place, then move it to its cell.
      scaleUnit(unit, k, out);
      for (const m of unit.members) {
        const p = out[m.id]!;
        p.x = targetX + (p.x! - unit.x);
        p.y = targetY + (p.y! - unit.y);
      }
    } else {
      const m = unit.members[0]!;
      out[m.id] = { x: targetX, y: targetY, width: w, height: h, rotation: 0 };
    }
    for (let c = col; c < col + span; c++) heights[c] = targetY + h + GAP;
  }
  return out;
}

/**
 * Organize just a selection: the same masonry, but sized from the selection
 * (column width = its median unit width), anchored at the selection's own
 * top-left, and pushed straight down past any OTHER items it would overlap.
 */
export function computeOrganizeSelection(
  units: ArrangeUnit[],
  obstacles: Rect[],
  opts: { gap?: number } = {},
): Record<string, BoundsPatch> {
  if (units.length === 0) return {};
  const GAP = opts.gap ?? 24;
  const widths = units.map((u) => u.width).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)]!;
  const colW = Math.min(480, Math.max(160, Math.round(median)));
  const patches = computeOrganize(units, { columnWidth: colW, gap: GAP });

  // Grid bounds (patches are laid out from 0,0).
  let gridW = 0;
  let gridH = 0;
  for (const u of units)
    for (const m of u.members) {
      const p = patches[m.id];
      if (!p) continue;
      gridW = Math.max(gridW, (p.x ?? 0) + (p.width ?? m.width));
      gridH = Math.max(gridH, (p.y ?? 0) + (p.height ?? m.height));
    }

  // Anchor at the selection's current top-left, then push DOWN until the grid
  // rect clears every obstacle.
  const anchorX = Math.min(...units.map((u) => u.x));
  let anchorY = Math.min(...units.map((u) => u.y));
  for (let guard = 0; guard < 100; guard++) {
    const hit = obstacles.filter(
      (o) =>
        anchorX < o.x + o.width &&
        o.x < anchorX + gridW &&
        anchorY < o.y + o.height &&
        o.y < anchorY + gridH,
    );
    if (hit.length === 0) break;
    anchorY = Math.max(...hit.map((o) => o.y + o.height)) + GAP;
  }

  for (const p of Object.values(patches)) {
    p.x = (p.x ?? 0) + anchorX;
    p.y = (p.y ?? 0) + anchorY;
  }
  return patches;
}

// ── Command wrappers ──

/** Selected items → units: whole groups become one unit each. Locked items
 *  and arrows are left alone (a group containing a locked member is skipped —
 *  its layout is pinned by the lock). */
export function unitsFor(ids: string[], opts: { flatten?: boolean } = {}): ArrangeUnit[] {
  const { doc } = useDocumentStore.getState();
  const items = ids.map((id) => doc.items[id]).filter((i): i is Item => !!i && i.type !== 'arrow');
  const solo: Item[] = [];
  const byGroup = new Map<string, Item[]>();
  for (const it of items) {
    // `flatten`: members act as individuals (organizing INSIDE a group).
    if (it.groupId && !opts.flatten) {
      const list = byGroup.get(it.groupId) ?? [];
      list.push(it);
      byGroup.set(it.groupId, list);
    } else if (!it.locked) {
      solo.push(it);
    }
  }
  // Text becomes unreadable when shrunk — floor the unit's scale so every
  // text member keeps at least MIN_TEXT_WIDTH.
  const minScaleFor = (list: Item[]): number | undefined => {
    let floor = 0;
    for (const it of list) {
      if (it.type === 'text' && it.width > 0) {
        floor = Math.max(floor, MIN_TEXT_WIDTH / it.width);
      }
    }
    return floor > 0 ? Math.min(1, floor) : undefined;
  };

  const units = solo.map((i) => {
    const u = soloUnit({ id: i.id, x: i.x, y: i.y, width: i.width, height: i.height });
    const ms = minScaleFor([i]);
    if (ms !== undefined) u.minScale = ms;
    return u;
  });
  for (const members of byGroup.values()) {
    if (members.some((m) => m.locked)) continue;
    const u = groupUnit(
      members.map((m) => ({ id: m.id, x: m.x, y: m.y, width: m.width, height: m.height })),
    );
    const ms = minScaleFor(members);
    if (ms !== undefined) u.minScale = ms;
    units.push(u);
  }
  return units;
}

const ALIGN_LABEL: Record<AlignEdge, string> = {
  left: 'Align left',
  centerX: 'Align horizontal centers',
  right: 'Align right',
  top: 'Align top',
  middleY: 'Align vertical centers',
  bottom: 'Align bottom',
};

/**
 * Minimal de-overlap: push intersecting units apart along the axis of least
 * overlap (half each; repeat to a fixed point). The rough layout survives —
 * unlike organize, nothing is re-flowed — so it's the right cleanup after an
 * agent (or a paste) placed items by guesswork.
 */
function computeSpread(units: ArrangeUnit[], margin = 24): Record<string, BoundsPatch> {
  const pos = units.map((u) => ({ x: u.x, y: u.y }));
  for (let iter = 0; iter < 120; iter++) {
    let moved = false;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i]!;
        const b = units[j]!;
        const ox =
          Math.min(pos[i]!.x + a.width, pos[j]!.x + b.width) -
          Math.max(pos[i]!.x, pos[j]!.x) +
          margin;
        const oy =
          Math.min(pos[i]!.y + a.height, pos[j]!.y + b.height) -
          Math.max(pos[i]!.y, pos[j]!.y) +
          margin;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const acx = pos[i]!.x + a.width / 2;
        const bcx = pos[j]!.x + b.width / 2;
        const acy = pos[i]!.y + a.height / 2;
        const bcy = pos[j]!.y + b.height / 2;
        if (ox < oy) {
          const dir = acx <= bcx ? 1 : -1;
          pos[i]!.x -= (dir * ox) / 2;
          pos[j]!.x += (dir * ox) / 2;
        } else {
          const dir = acy <= bcy ? 1 : -1;
          pos[i]!.y -= (dir * oy) / 2;
          pos[j]!.y += (dir * oy) / 2;
        }
      }
    }
    if (!moved) break;
  }
  const out: Record<string, BoundsPatch> = {};
  units.forEach((u, i) => shiftUnit(u, pos[i]!.x - u.x, pos[i]!.y - u.y, out));
  return out;
}

export function spreadItems(ids: string[]): void {
  transformItems(computeSpread(unitsFor(ids)), 'Spread apart');
}

export function alignItems(ids: string[], edge: AlignEdge): void {
  transformItems(computeAlign(unitsFor(ids), edge), ALIGN_LABEL[edge]);
}

export function distributeItems(ids: string[], axis: 'x' | 'y'): void {
  transformItems(
    computeDistribute(unitsFor(ids), axis),
    axis === 'x' ? 'Distribute horizontally' : 'Distribute vertically',
  );
}

export function matchItemSize(ids: string[], dim: 'width' | 'height'): void {
  transformItems(
    computeMatch(unitsFor(ids), dim),
    dim === 'width' ? 'Match width' : 'Match height',
  );
}

/** Right-click → Organize: masonry the selection in place, avoiding overlaps
 *  with everything else on the board. */
/**
 * Is this selection exactly the inside of one group (every selected item a
 * member of the same group)? Then Organize should lay the MEMBERS out, not
 * treat the group as a single block to be shrunk into one column.
 */
function selectionIsOneGroup(ids: string[]): string | null {
  const { doc } = useDocumentStore.getState();
  const items = ids.map((id) => doc.items[id]).filter((i): i is Item => !!i && i.type !== 'arrow');
  if (items.length < 2) return null;
  const g = items[0]!.groupId;
  return g && items.every((i) => i.groupId === g) ? g : null;
}

export function organizeSelection(ids: string[]): void {
  const { doc } = useDocumentStore.getState();
  const selected = new Set(ids);
  const obstacles = Object.values(doc.items)
    .filter((i) => !selected.has(i.id) && i.type !== 'arrow')
    .map((i) =>
      rotatedRectAABB({ x: i.x, y: i.y, width: i.width, height: i.height, rotation: i.rotation }),
    );
  // A group's members masonry among themselves, at the group's own size.
  const flatten = selectionIsOneGroup(ids) !== null;
  transformItems(
    computeOrganizeSelection(unitsFor(ids, { flatten }), obstacles),
    'Organize selection',
  );
}

/** View → Organize Items: masonry the whole board, then fit it in view. */
export function organizeItems(): void {
  const { doc } = useDocumentStore.getState();
  transformItems(computeOrganize(unitsFor(Object.keys(doc.items))), 'Organize items');
  zoomToFit(getCanvasContainer());
}
