import type { CanvasDocument, Connection, ConnectionEndpoint } from '@boardcache/schema';
import type { Point, Rect } from './coords';
import { rotatedRectAABB, unionRects } from './geometry';
import { effectiveBounds } from './gestures';
import type { BoundsPatch } from '../../state/commands';
import { isInsideGroup } from './grouping';

/**
 * Connection graph helpers. Connections live in doc.connections — a visual
 * connector line on the canvas AND a semantic edge other features (search,
 * chat, export) can query via these helpers.
 */

/** The current AABB an endpoint occupies (live gesture overrides included). */
export function endpointRect(
  doc: CanvasDocument,
  ep: ConnectionEndpoint,
  overrides?: Record<string, BoundsPatch> | undefined,
): Rect | null {
  if (ep.kind === 'item') {
    const item = doc.items[ep.id];
    if (!item) return null;
    return rotatedRectAABB(effectiveBounds(item, overrides?.[ep.id]));
  }
  const memberRects = Object.values(doc.items)
    .filter((it) => isInsideGroup(doc, it, ep.id))
    .map((it) => rotatedRectAABB(effectiveBounds(it, overrides?.[it.id])));
  return unionRects(memberRects);
}

/** Where the connector meets the rect: border point on the line to `towards`. */
export function anchorOnRect(rect: Rect, towards: Point): Point {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Does this endpoint still resolve to something in the document? */
export function endpointExists(doc: CanvasDocument, ep: ConnectionEndpoint): boolean {
  return ep.kind === 'item' ? ep.id in doc.items : ep.id in doc.groups;
}

const sameEndpoint = (a: ConnectionEndpoint, b: ConnectionEndpoint) =>
  a.kind === b.kind && a.id === b.id;

/** True if an equivalent connection (either direction) already exists. */
export function connectionExists(
  doc: CanvasDocument,
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
): boolean {
  return Object.values(doc.connections).some(
    (c) =>
      (sameEndpoint(c.from, from) && sameEndpoint(c.to, to)) ||
      (sameEndpoint(c.from, to) && sameEndpoint(c.to, from)),
  );
}

/** All connections touching an item or group id (either end). */
export function connectionsFor(doc: CanvasDocument, id: string): Connection[] {
  return Object.values(doc.connections).filter((c) => c.from.id === id || c.to.id === id);
}
