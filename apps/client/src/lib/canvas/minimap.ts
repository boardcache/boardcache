import type { Point, Rect } from './coords';
import { unionRects } from './geometry';

/**
 * Pure minimap geometry. The minimap shows a "world" rect (all content plus
 * the current view) letterbox-fitted into the minimap box; these helpers map
 * canvas ↔ minimap coordinates. Kept pure so it's unit-tested and shared by
 * the renderer and the drag-to-navigate handler.
 */
export interface MinimapView {
  /** canvas units → minimap px */
  scale: number;
  /** letterbox centering offset, minimap px */
  offsetX: number;
  offsetY: number;
  world: Rect;
}

/** The world the minimap covers: content bounds ∪ current view, padded. */
export function minimapWorld(content: Rect | null, visible: Rect, pad: number): Rect {
  const base = content ? (unionRects([content, visible]) ?? visible) : visible;
  return {
    x: base.x - pad,
    y: base.y - pad,
    width: Math.max(1, base.width + pad * 2),
    height: Math.max(1, base.height + pad * 2),
  };
}

/** Fit `world` into an (mmW × mmH) box with a uniform, centered scale. */
export function computeMinimapView(world: Rect, mmW: number, mmH: number): MinimapView {
  const w = Math.max(1, world.width);
  const h = Math.max(1, world.height);
  const scale = Math.min(mmW / w, mmH / h);
  return {
    scale,
    offsetX: (mmW - w * scale) / 2,
    offsetY: (mmH - h * scale) / 2,
    world,
  };
}

export function canvasToMinimap(p: Point, v: MinimapView): Point {
  return {
    x: (p.x - v.world.x) * v.scale + v.offsetX,
    y: (p.y - v.world.y) * v.scale + v.offsetY,
  };
}

export function minimapToCanvas(p: Point, v: MinimapView): Point {
  return {
    x: (p.x - v.offsetX) / v.scale + v.world.x,
    y: (p.y - v.offsetY) / v.scale + v.world.y,
  };
}

/** Map a canvas-space rect into minimap pixels. */
export function minimapRect(r: Rect, v: MinimapView): Rect {
  const tl = canvasToMinimap({ x: r.x, y: r.y }, v);
  return { x: tl.x, y: tl.y, width: r.width * v.scale, height: r.height * v.scale };
}
