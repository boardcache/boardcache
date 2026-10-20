import type { CanvasDocument } from '@boardcache/schema';
import type { Point } from './coords';
import { activePageId, pageItems } from '../board/pages';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Anti-stacking placement: menu/tool adds all target the view center, so
 * repeated adds used to land exactly on top of each other. findOpenSpot walks
 * outward from the desired point in rings and returns the nearest center
 * where a w×h item clears every existing item by a margin.
 */

const GAP = 84;
const STEP = 60;
const MAX_RINGS = 40;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clear(a: Box, b: Box): boolean {
  return (
    a.x + a.w + GAP <= b.x ||
    b.x + b.w + GAP <= a.x ||
    a.y + a.h + GAP <= b.y ||
    b.y + b.h + GAP <= a.y
  );
}

/** A box reserved by an in-flight batch (items not yet in the document). */
export interface ReservedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function findOpenSpot(
  doc: CanvasDocument,
  at: Point,
  w = 320,
  h = 240,
  reserved: ReservedBox[] = [],
): Point {
  // Only the active page's items occupy space: other pages are elsewhere.
  const boxes: Box[] = [
    ...pageItems(doc, activePageId(doc)).map((i) => ({ x: i.x, y: i.y, w: i.width, h: i.height })),
    ...reserved.map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
  ];
  const fits = (cx: number, cy: number) =>
    boxes.every((b) => clear({ x: cx - w / 2, y: cy - h / 2, w, h }, b));
  if (fits(at.x, at.y)) return at;

  for (let r = 1; r <= MAX_RINGS; r++) {
    const d = r * STEP;
    const ring: Point[] = [];
    for (let k = -r; k <= r; k++) {
      ring.push({ x: at.x + k * STEP, y: at.y - d }, { x: at.x + k * STEP, y: at.y + d });
      if (Math.abs(k) < r) {
        ring.push({ x: at.x - d, y: at.y + k * STEP }, { x: at.x + d, y: at.y + k * STEP });
      }
    }
    // Nearest first; distance ties break in reading order — right, then
    // below, then left, then above (canvas y grows downward) — so batches
    // flow like text instead of stacking upward.
    const angle = (pt: Point) => {
      const t = Math.atan2(pt.y - at.y, pt.x - at.x);
      return t < 0 ? t + Math.PI * 2 : t;
    };
    ring.sort((a, b) => {
      const da = Math.hypot(a.x - at.x, a.y - at.y);
      const db = Math.hypot(b.x - at.x, b.y - at.y);
      return Math.abs(da - db) > 1 ? da - db : angle(a) - angle(b);
    });
    for (const c of ring) if (fits(c.x, c.y)) return c;
  }
  return at; // a very crowded board — stacking beats vanishing off-screen
}

/** findOpenSpot against the live document (the common call). */
export function openSpotNear(at: Point, w?: number, h?: number, reserved?: ReservedBox[]): Point {
  return findOpenSpot(useDocumentStore.getState().doc, at, w, h, reserved);
}

/**
 * Row-flow placement for a batch: the first item lands near `start`, each
 * following item seeds just right of the previous one (falling back to the
 * ring search when that spot is taken). Keeps a multi-file drop in file
 * order, reading left to right, instead of scattering by nearest-fit.
 */
const ROW_WRAP_WIDTH = 1100; // ≈ one comfortable screen of content

export function reserveNext(reserved: ReservedBox[], start: Point, w: number, h: number): Point {
  const prev = reserved[reserved.length - 1];
  let seed = start;
  if (prev) {
    const left = Math.min(...reserved.map((r) => r.x));
    if (prev.x + prev.width + GAP + w - left > ROW_WRAP_WIDTH) {
      // Wrap below everything reserved so far, back at the batch's left edge.
      const bottom = Math.max(...reserved.map((r) => r.y + r.height));
      seed = { x: left + w / 2, y: bottom + GAP + h / 2 };
    } else {
      seed = { x: prev.x + prev.width + GAP + w / 2, y: prev.y + prev.height / 2 };
    }
  }
  const spot = openSpotNear(seed, w, h, reserved);
  reserved.push({ x: spot.x - w / 2, y: spot.y - h / 2, width: w, height: h });
  return spot;
}
