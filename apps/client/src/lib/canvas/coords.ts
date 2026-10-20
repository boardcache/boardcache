import type { Viewport } from '@boardcache/schema';

/**
 * Coordinate systems
 * ------------------
 * Canvas space: infinite plane the document lives in; items store canvas
 * coordinates. Screen space: CSS pixels relative to the canvas container's
 * top-left corner.
 *
 * The viewport maps canvas → screen:  screen = canvas * scale + (x, y)
 * i.e. `viewport.x/y` is the screen position of the canvas origin and
 * `viewport.scale` is the zoom factor.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 16;

export function clampScale(scale: number): number {
  if (Number.isNaN(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToCanvas(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function canvasToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

/** Translate the viewport by a screen-space delta (panning). */
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

/**
 * Zoom to `newScale`, keeping the canvas point currently under `screenPoint`
 * stationary on screen (zoom-to-cursor).
 */
export function zoomAtPoint(viewport: Viewport, screenPoint: Point, newScale: number): Viewport {
  const scale = clampScale(newScale);
  const anchor = screenToCanvas(screenPoint, viewport);
  return {
    scale,
    x: screenPoint.x - anchor.x * scale,
    y: screenPoint.y - anchor.y * scale,
  };
}

/** Multiply the current scale by `factor`, anchored at `screenPoint`. */
export function zoomBy(viewport: Viewport, screenPoint: Point, factor: number): Viewport {
  return zoomAtPoint(viewport, screenPoint, viewport.scale * factor);
}

/** The canvas-space rect currently visible in a container of the given size. */
export function visibleCanvasRect(
  viewport: Viewport,
  containerWidth: number,
  containerHeight: number,
): Rect {
  const topLeft = screenToCanvas({ x: 0, y: 0 }, viewport);
  const bottomRight = screenToCanvas({ x: containerWidth, y: containerHeight }, viewport);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Grow a rect by `margin` on every side (virtualization overscan). */
export function expandRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

/**
 * Smooth wheel-delta → zoom factor. Exponential so equal wheel travel gives
 * equal zoom ratio regardless of current scale.
 */
export function wheelZoomFactor(deltaY: number, speed: number): number {
  return Math.exp(-deltaY * speed);
}

/**
 * Effective grid spacing in screen px: doubles the canvas-space step until the
 * on-screen spacing is comfortable, so the grid stays useful at any zoom.
 */
export function gridSpacing(baseStep: number, scale: number, minScreenPx = 24): number {
  let spacing = baseStep * scale;
  if (spacing <= 0 || !Number.isFinite(spacing)) return minScreenPx;
  while (spacing < minScreenPx) spacing *= 2;
  while (spacing >= minScreenPx * 2) spacing /= 2;
  return spacing;
}
