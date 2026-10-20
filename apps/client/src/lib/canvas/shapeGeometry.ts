import type { PathNode, NormPoint, ShapeItem } from '@boardcache/schema';
import type { Point } from './coords';

/**
 * Pure geometry for box-based shapes. Everything is computed in the shape's
 * local pixel box (0,0)–(w,h); the renderer, draft preview, and thumbnail
 * canvas all use these so a shape looks identical everywhere.
 */

/** Regular polygon vertices, first vertex pointing up. */
export function polygonPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

/** Star vertices, alternating outer/inner radius, first point up. */
export function starPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
  innerRatio: number,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < sides * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / sides;
    const r = i % 2 === 0 ? 1 : innerRatio;
    pts.push({ x: cx + rx * r * Math.cos(a), y: cy + ry * r * Math.sin(a) });
  }
  return pts;
}

export function diamondPoints(w: number, h: number, inset: number): Point[] {
  return [
    { x: w / 2, y: inset },
    { x: w - inset, y: h / 2 },
    { x: w / 2, y: h - inset },
    { x: inset, y: h / 2 },
  ];
}

/** The two endpoints of a line/arrow within its box, per the diagonal flag. */
export function diagonalEndpoints(
  w: number,
  h: number,
  inset: number,
  flip: boolean,
): { a: Point; b: Point } {
  return flip
    ? { a: { x: inset, y: h - inset }, b: { x: w - inset, y: inset } } // ╱ sw→ne
    : { a: { x: inset, y: inset }, b: { x: w - inset, y: h - inset } }; // ╲ nw→se
}

/** Arrowhead barbs at `tip`, pointing along the direction from `from`→`tip`. */
export function arrowHead(from: Point, tip: Point, size: number): [Point, Point] {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = Math.PI / 7;
  return [
    { x: tip.x - size * Math.cos(angle - spread), y: tip.y - size * Math.sin(angle - spread) },
    { x: tip.x - size * Math.cos(angle + spread), y: tip.y - size * Math.sin(angle + spread) },
  ];
}

export function pointsToString(points: readonly Point[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

/** Freehand points (normalized 0..1) → an SVG polyline path in box pixels. */
export function freehandPath(
  points: readonly NormPoint[],
  w: number,
  h: number,
  inset: number,
): string {
  if (points.length === 0) return '';
  const sx = (n: number) => inset + n * (w - inset * 2);
  const sy = (n: number) => inset + n * (h - inset * 2);
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(sx(p.x))} ${round(sy(p.y))}`)
    .join(' ');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A pen anchor in absolute coordinates (canvas or screen space). */
export interface AbsPathNode {
  x: number;
  y: number;
  hix?: number;
  hiy?: number;
  hox?: number;
  hoy?: number;
}

/** Cubic-bezier `d` for pen anchors in absolute coordinates. */
export function absBezierD(nodes: readonly AbsPathNode[], closed: boolean): string {
  if (nodes.length === 0) return '';
  const seg = (a: AbsPathNode, b: AbsPathNode) =>
    `C ${round(a.hox ?? a.x)} ${round(a.hoy ?? a.y)} ${round(b.hix ?? b.x)} ${round(b.hiy ?? b.y)} ${round(b.x)} ${round(b.y)}`;
  const parts = [`M ${round(nodes[0]!.x)} ${round(nodes[0]!.y)}`];
  for (let i = 1; i < nodes.length; i++) parts.push(seg(nodes[i - 1]!, nodes[i]!));
  if (closed && nodes.length > 1) parts.push(seg(nodes[nodes.length - 1]!, nodes[0]!), 'Z');
  return parts.join(' ');
}

/** Cubic-bezier `d` for normalized pen anchors scaled into a w×h box. */
export function bezierPathD(
  nodes: readonly PathNode[],
  w: number,
  h: number,
  inset: number,
  closed: boolean,
): string {
  const sx = (n: number) => inset + n * (w - inset * 2);
  const sy = (n: number) => inset + n * (h - inset * 2);
  return absBezierD(
    nodes.map((n) => ({
      x: sx(n.x),
      y: sy(n.y),
      ...(n.hix != null ? { hix: sx(n.hix) } : {}),
      ...(n.hiy != null ? { hiy: sy(n.hiy) } : {}),
      ...(n.hox != null ? { hox: sx(n.hox) } : {}),
      ...(n.hoy != null ? { hoy: sy(n.hoy) } : {}),
    })),
    closed,
  );
}

/** True for connector kinds (drawn from start→end rather than as a box). */
export function isConnector(shape: ShapeItem['shape']): boolean {
  return shape === 'line' || shape === 'arrow';
}

/**
 * Convert raw freehand canvas points to a placed shape: bounding box plus the
 * points normalized into [0,1] within that box. Degenerate (perfectly
 * straight) strokes get a 1px box dimension so normalization stays finite.
 */
export function freehandToBox(points: readonly Point[]): {
  x: number;
  y: number;
  width: number;
  height: number;
  norm: NormPoint[];
} {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - minX);
  const height = Math.max(1, Math.max(...ys) - minY);
  const norm = points.map((p) => ({ x: (p.x - minX) / width, y: (p.y - minY) / height }));
  return { x: minX, y: minY, width, height, norm };
}
