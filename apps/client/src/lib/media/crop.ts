import type { Crop, ImageItem } from '@boardcache/schema';
import type { Point, Rect } from '../canvas/coords';
import { rotatePoint } from '../canvas/geometry';

/**
 * Image cropping is non-destructive: the asset and `naturalWidth/Height` are
 * never touched. An item's `crop` is the normalized (0..1) sub-rectangle of the
 * source that is currently shown, and the item's on-canvas rect is sized to
 * that sub-rectangle. The full image therefore extends beyond the item; the
 * helpers below reconstruct it so a crop can be re-cropped or fully restored.
 */

/** The whole (uncropped) source image as a placed rect in canvas space. */
export interface FullImage {
  center: Point;
  width: number;
  height: number;
  rotation: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Smallest crop edge (as a fraction of the source) we'll accept — avoids slivers. */
const MIN_CROP = 0.02;

/**
 * Reconstruct where the entire source image sits in canvas space, given a
 * possibly-cropped item. With no crop the item already IS the full image.
 */
export function fullImageRect(item: ImageItem): FullImage {
  const center = { x: item.x + item.width / 2, y: item.y + item.height / 2 };
  const c = item.crop;
  if (!c) return { center, width: item.width, height: item.height, rotation: item.rotation };

  const width = item.width / c.width;
  const height = item.height / c.height;
  // Vector from the crop-region centre to the source centre, expressed in the
  // source's own frame, then flipped/rotated into canvas space.
  const sx = item.flipH ? -1 : 1;
  const sy = item.flipV ? -1 : 1;
  const localDx = (0.5 - (c.x + c.width / 2)) * width * sx;
  const localDy = (0.5 - (c.y + c.height / 2)) * height * sy;
  const moved = rotatePoint(
    { x: center.x + localDx, y: center.y + localDy },
    center,
    item.rotation,
  );
  return { center: moved, width, height, rotation: item.rotation };
}

/** Map a canvas point to normalized source coordinates (0..1) of the full image. */
export function canvasToSource(p: Point, full: FullImage, flipH: boolean, flipV: boolean): Point {
  const local = rotatePoint(p, full.center, -full.rotation);
  let u = (local.x - full.center.x) / full.width + 0.5;
  let v = (local.y - full.center.y) / full.height + 0.5;
  if (flipH) u = 1 - u;
  if (flipV) v = 1 - v;
  return { x: u, y: v };
}

/** Inverse of {@link canvasToSource}: normalized source coords → canvas point. */
function sourceToCanvas(
  u: number,
  v: number,
  full: FullImage,
  flipH: boolean,
  flipV: boolean,
): Point {
  const du = (flipH ? 1 - u : u) - 0.5;
  const dv = (flipV ? 1 - v : v) - 0.5;
  const local = { x: full.center.x + du * full.width, y: full.center.y + dv * full.height };
  return rotatePoint(local, full.center, full.rotation);
}

export interface CropResult {
  /** Normalized crop rect of the source image. */
  crop: Crop;
  /** The item's new on-canvas rect (x/y are the unrotated top-left). */
  rect: Rect;
}

/**
 * Turn a drag box (two canvas-space corners) into a new crop plus the item's
 * new on-canvas rect. The box is converted to source space and clamped to the
 * image; composes correctly when the item is already cropped, flipped, or
 * rotated. Returns null if the box collapses to a sliver.
 */
export function computeCropFromBox(item: ImageItem, p1: Point, p2: Point): CropResult | null {
  const full = fullImageRect(item);
  const a = canvasToSource(p1, full, item.flipH, item.flipV);
  const b = canvasToSource(p2, full, item.flipH, item.flipV);

  const x = clamp01(Math.min(a.x, b.x));
  const y = clamp01(Math.min(a.y, b.y));
  const width = clamp01(Math.max(a.x, b.x)) - x;
  const height = clamp01(Math.max(a.y, b.y)) - y;
  if (width < MIN_CROP || height < MIN_CROP) return null;

  const crop: Crop = { x, y, width, height };
  const center = sourceToCanvas(x + width / 2, y + height / 2, full, item.flipH, item.flipV);
  const w = width * full.width;
  const h = height * full.height;
  return { crop, rect: { x: center.x - w / 2, y: center.y - h / 2, width: w, height: h } };
}

/** The on-canvas rect that restores the full (uncropped) image at current scale. */
export function uncroppedRect(item: ImageItem): Rect {
  const full = fullImageRect(item);
  return {
    x: full.center.x - full.width / 2,
    y: full.center.y - full.height / 2,
    width: full.width,
    height: full.height,
  };
}
