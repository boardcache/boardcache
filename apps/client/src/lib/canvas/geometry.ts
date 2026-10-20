import type { Point, Rect } from './coords';

/** An item's placed bounds: rect + rotation in degrees about the rect center. */
export interface RotatedRect extends Rect {
  rotation: number;
}

export const DEG_TO_RAD = Math.PI / 180;

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Rotate `point` around `origin` by `degrees`. */
export function rotatePoint(point: Point, origin: Point, degrees: number): Point {
  const rad = degrees * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/** The four corners of a rotated rect in canvas space (nw, ne, se, sw order). */
export function rotatedRectCorners(rect: RotatedRect): [Point, Point, Point, Point] {
  const c = rectCenter(rect);
  const corners: [Point, Point, Point, Point] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  if (rect.rotation === 0) return corners;
  return corners.map((p) => rotatePoint(p, c, rect.rotation)) as [Point, Point, Point, Point];
}

/** Axis-aligned bounding box of a rotated rect (used for virtualization). */
export function rotatedRectAABB(rect: RotatedRect): Rect {
  if (rect.rotation === 0) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  const corners = rotatedRectCorners(rect);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Point-in-rotated-rect: un-rotate the point into the rect's local frame. */
export function pointInRotatedRect(point: Point, rect: RotatedRect): boolean {
  const local = rotatePoint(point, rectCenter(rect), -rect.rotation);
  return (
    local.x >= rect.x &&
    local.x <= rect.x + rect.width &&
    local.y >= rect.y &&
    local.y <= rect.y + rect.height
  );
}

/**
 * Does an axis-aligned rect (e.g. the marquee) intersect a rotated rect?
 * Separating Axis Theorem over the 4 candidate axes (2 from each rect).
 */
export function aabbIntersectsRotatedRect(aabb: Rect, rect: RotatedRect): boolean {
  const cornersA: Point[] = [
    { x: aabb.x, y: aabb.y },
    { x: aabb.x + aabb.width, y: aabb.y },
    { x: aabb.x + aabb.width, y: aabb.y + aabb.height },
    { x: aabb.x, y: aabb.y + aabb.height },
  ];
  const cornersB = rotatedRectCorners(rect);
  const rad = rect.rotation * DEG_TO_RAD;
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: Math.cos(rad), y: Math.sin(rad) },
    { x: -Math.sin(rad), y: Math.cos(rad) },
  ];
  for (const axis of axes) {
    let minA = Infinity,
      maxA = -Infinity,
      minB = Infinity,
      maxB = -Infinity;
    for (const p of cornersA) {
      const proj = p.x * axis.x + p.y * axis.y;
      minA = Math.min(minA, proj);
      maxA = Math.max(maxA, proj);
    }
    for (const p of cornersB) {
      const proj = p.x * axis.x + p.y * axis.y;
      minB = Math.min(minB, proj);
      maxB = Math.max(maxB, proj);
    }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

/** Union AABB of several rects (selection bounds). */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function isCornerHandle(handle: ResizeHandle): boolean {
  return handle.length === 2;
}

/** Unit position of a handle in the rect's local frame: -1..1 from center. */
function handleSign(handle: ResizeHandle): Point {
  const x = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const y = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  return { x, y };
}

export interface ResizeOptions {
  /** Corner handles keep aspect ratio (default true for corners). */
  proportional: boolean;
  /** Alt: resize about the center instead of the opposite handle. */
  fromCenter: boolean;
  minSize: number;
  /**
   * Minimum height for the resulting width (e.g. a text box can't shrink below
   * its rendered content). Only applied to handles that change height.
   */
  minHeight?: (width: number) => number;
}

/**
 * Compute new bounds while dragging `handle` to `pointer` (canvas coords).
 *
 * Works under rotation: the fixed anchor (opposite handle, or the center with
 * `fromCenter`) keeps its exact canvas position; the math happens in the
 * rect's unrotated local frame.
 */
export function computeResize(
  start: RotatedRect,
  handle: ResizeHandle,
  pointer: Point,
  options: ResizeOptions,
): RotatedRect {
  const { proportional, fromCenter, minSize, minHeight } = options;
  const sign = handleSign(handle);
  const center = rectCenter(start);

  // Pointer in the unrotated local frame, as an offset from the center.
  const localPointer = rotatePoint(pointer, center, -start.rotation);
  const px = localPointer.x - center.x;
  const py = localPointer.y - center.y;

  // Anchor in local-offset coordinates.
  const anchor: Point = fromCenter
    ? { x: 0, y: 0 }
    : { x: (-sign.x * start.width) / 2, y: (-sign.y * start.height) / 2 };

  // Span from anchor to pointer along each affected axis; doubled when
  // resizing about the center (the pointer only covers half the span).
  const factor = fromCenter ? 2 : 1;
  let width = sign.x !== 0 ? Math.abs(px - anchor.x) * factor : start.width;
  let height = sign.y !== 0 ? Math.abs(py - anchor.y) * factor : start.height;

  if (proportional && isCornerHandle(handle)) {
    const scale = Math.max(width / start.width, height / start.height);
    width = start.width * scale;
    height = start.height * scale;
  }

  width = Math.max(width, minSize);
  // A content floor (e.g. text) only constrains handles that change height.
  const minH = minHeight && sign.y !== 0 ? Math.max(minSize, minHeight(width)) : minSize;
  height = Math.max(height, minH);

  // New center in local-offset coords: anchored resizes grow away from the
  // anchor toward the dragged side; center resizes keep the center.
  let newCenterLocal: Point = { x: 0, y: 0 };
  if (!fromCenter) {
    newCenterLocal = {
      x: sign.x !== 0 ? anchor.x + (sign.x * width) / 2 : 0,
      y: sign.y !== 0 ? anchor.y + (sign.y * height) / 2 : 0,
    };
  }

  // Back to canvas space: the local frame rotates about the OLD center.
  const newCenter = rotatePoint(
    { x: center.x + newCenterLocal.x, y: center.y + newCenterLocal.y },
    center,
    start.rotation,
  );

  return {
    x: newCenter.x - width / 2,
    y: newCenter.y - height / 2,
    width,
    height,
    rotation: start.rotation,
  };
}

/** Angle in degrees of `point` as seen from `origin` (0° = up, clockwise). */
export function angleFromOrigin(origin: Point, point: Point): number {
  return (Math.atan2(point.x - origin.x, -(point.y - origin.y)) / DEG_TO_RAD + 360) % 360;
}

/** Snap an angle to the nearest multiple of `step` degrees. */
export function snapAngle(degrees: number, step: number): number {
  return Math.round(degrees / step) * step;
}

/** Normalize to (-180, 180] for storage sanity. */
export function normalizeAngle(degrees: number): number {
  let a = degrees % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}
