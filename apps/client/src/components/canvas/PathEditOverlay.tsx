import { useEffect, useRef } from 'react';
import type { PathNode, ShapeItem } from '@boardcache/schema';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { canvasToScreen } from '../../lib/canvas/coords';
import { wasSmooth } from '../../lib/canvas/penGesture';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useHistoryStore } from '../../state/history';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Node editing for committed pen paths (double-click a path, or context menu
 * → Edit Points). Same gesture language as drawing: drag an anchor to move
 * it, drag a hand to shape (smooth pairs stay collinear, broken ones move
 * alone); Alt pulls fresh handles from an anchor / strips them on click /
 * breaks a pair on a hand. Every move writes through to the document — the
 * box renormalizes live so curves never clip — and each drag coalesces into
 * one undo entry. Rotation-safe: edits happen in the item's unrotated local
 * frame and the box shift is compensated so the shape never jumps.
 */

interface LocalNode {
  x: number;
  y: number;
  hix?: number;
  hiy?: number;
  hox?: number;
  hoy?: number;
}

const HIT_R = 8; // screen px

function rot(p: { x: number; y: number }, c: { x: number; y: number }, rad: number) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Denormalize the item's nodes into its unrotated local canvas frame. */
function toLocal(item: ShapeItem): LocalNode[] {
  return (item.pathNodes ?? []).map((n) => ({
    x: item.x + n.x * item.width,
    y: item.y + n.y * item.height,
    ...(n.hix != null ? { hix: item.x + n.hix * item.width } : {}),
    ...(n.hiy != null ? { hiy: item.y + n.hiy * item.height } : {}),
    ...(n.hox != null ? { hox: item.x + n.hox * item.width } : {}),
    ...(n.hoy != null ? { hoy: item.y + n.hoy * item.height } : {}),
  }));
}

/** Write local nodes back: recompute the box, renormalize, keep the shape
 *  stationary in world space even when the item is rotated. */
function commitLocal(item: ShapeItem, nodes: LocalNode[]): void {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of nodes) {
    xs.push(n.x, ...(n.hix != null ? [n.hix] : []), ...(n.hox != null ? [n.hox] : []));
    ys.push(n.y, ...(n.hiy != null ? [n.hiy] : []), ...(n.hoy != null ? [n.hoy] : []));
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(8, Math.max(...xs) - minX);
  const h = Math.max(8, Math.max(...ys) - minY);
  const nx = (v: number) => (v - minX) / w;
  const ny = (v: number) => (v - minY) / h;
  const pathNodes: PathNode[] = nodes.map((n) => ({
    x: nx(n.x),
    y: ny(n.y),
    ...(n.hix != null ? { hix: nx(n.hix) } : {}),
    ...(n.hiy != null ? { hiy: ny(n.hiy) } : {}),
    ...(n.hox != null ? { hox: nx(n.hox) } : {}),
    ...(n.hoy != null ? { hoy: ny(n.hoy) } : {}),
  }));

  // The box moved in the local frame; with rotation, re-anchor x/y so every
  // world position is unchanged: place the new box so its center lands where
  // the old rotation would have put it.
  const oldC = { x: item.x + item.width / 2, y: item.y + item.height / 2 };
  const newLocalC = { x: minX + w / 2, y: minY + h / 2 };
  const rad = (item.rotation * Math.PI) / 180;
  const worldC = rot(newLocalC, oldC, rad);

  updateItems([item.id], 'Edit path', (it) => {
    if (it.type !== 'shape') return;
    it.x = worldC.x - w / 2;
    it.y = worldC.y - h / 2;
    it.width = w;
    it.height = h;
    it.pathNodes = pathNodes;
  });
}

export function PathEditOverlay() {
  const pathEditId = useSessionStore((s) => s.pathEditId);
  const item = useDocumentStore((s) =>
    pathEditId ? (s.doc.items[pathEditId] as ShapeItem | undefined) : undefined,
  );
  const viewport = useDocumentStore((s) => s.doc.viewport);
  const dragBase = useRef(-1);

  const valid = !!item && item.type === 'shape' && item.shape === 'path' && !!item.pathNodes;

  // The edited item vanished (deleted / undone / not a path) → leave the mode.
  useEffect(() => {
    if (pathEditId && !valid) useSessionStore.getState().setPathEditId(null);
  }, [pathEditId, valid]);

  // Switching tools leaves node editing too.
  useEffect(() => {
    if (!pathEditId) return;
    return useSessionStore.subscribe((state, prev) => {
      if (state.tool !== prev.tool) useSessionStore.getState().setPathEditId(null);
    });
  }, [pathEditId]);

  if (!valid || !item) return null;

  const rad = (item.rotation * Math.PI) / 180;
  const center = { x: item.x + item.width / 2, y: item.y + item.height / 2 };
  const locals = toLocal(item);
  const toScreen = (p: { x: number; y: number }) => canvasToScreen(rot(p, center, rad), viewport);
  const toLocalPoint = (clientX: number, clientY: number) =>
    rot(clientToCanvas(clientX, clientY), center, -rad);

  const startDrag = (e: React.PointerEvent, index: number, part: 'anchor' | 'hi' | 'ho') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const alt = e.altKey;
    // Work on a mutable copy of the CURRENT nodes; the item box stays fixed
    // as the reference frame for the whole drag (commitLocal renormalizes,
    // but our local copy keeps its own coordinates — no feedback loop).
    const nodes = toLocal(item).map((n) => ({ ...n }));
    const node = nodes[index]!;
    const orig = { ...node };
    const smooth = wasSmooth(orig);
    const isLast = index === nodes.length - 1 && !item.pathClosed;
    let dragged = false;
    dragBase.current = useHistoryStore.getState().index;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!dragged && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      dragged = true;
      const q = toLocalPoint(ev.clientX, ev.clientY);

      if (alt) {
        if (part === 'anchor') {
          node.hox = q.x;
          node.hoy = q.y;
          if (!isLast) {
            node.hix = 2 * node.x - q.x;
            node.hiy = 2 * node.y - q.y;
          }
        } else if (part === 'ho') {
          node.hox = q.x;
          node.hoy = q.y;
        } else {
          node.hix = q.x;
          node.hiy = q.y;
        }
      } else if (part === 'anchor') {
        const dx = q.x - orig.x;
        const dy = q.y - orig.y;
        node.x = q.x;
        node.y = q.y;
        if (orig.hix != null) node.hix = orig.hix + dx;
        if (orig.hiy != null) node.hiy = orig.hiy + dy;
        if (orig.hox != null) node.hox = orig.hox + dx;
        if (orig.hoy != null) node.hoy = orig.hoy + dy;
      } else {
        const ang = Math.atan2(q.y - node.y, q.x - node.x);
        if (part === 'ho') {
          node.hox = q.x;
          node.hoy = q.y;
          if (smooth && orig.hix != null && orig.hiy != null) {
            const len = Math.hypot(orig.hix - node.x, orig.hiy - node.y);
            node.hix = node.x - Math.cos(ang) * len;
            node.hiy = node.y - Math.sin(ang) * len;
          }
        } else {
          node.hix = q.x;
          node.hiy = q.y;
          if (smooth && orig.hox != null && orig.hoy != null) {
            const len = Math.hypot(orig.hox - node.x, orig.hoy - node.y);
            node.hox = node.x - Math.cos(ang) * len;
            node.hoy = node.y - Math.sin(ang) * len;
          }
        }
      }
      commitLocal(item, nodes);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (dragged) {
        useHistoryStore.getState().coalesceSince(dragBase.current, 'Edit path');
      } else if (alt && part === 'anchor') {
        // Alt-click: strip the handles (smooth → corner).
        delete node.hix;
        delete node.hiy;
        delete node.hox;
        delete node.hoy;
        commitLocal(item, nodes);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <svg className="draft-preview path-edit" data-testid="path-edit">
      {locals.map((n, i) => {
        const a = toScreen(n);
        const hi = n.hix != null && n.hiy != null ? toScreen({ x: n.hix, y: n.hiy }) : null;
        const ho = n.hox != null && n.hoy != null ? toScreen({ x: n.hox, y: n.hoy }) : null;
        return (
          <g key={i}>
            {hi && (
              <>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={hi.x}
                  y2={hi.y}
                  stroke="var(--accent)"
                  strokeWidth={1}
                />
                <circle cx={hi.x} cy={hi.y} r={2.5} fill="var(--accent)" />
                <circle
                  cx={hi.x}
                  cy={hi.y}
                  r={HIT_R}
                  fill="transparent"
                  style={{ pointerEvents: 'all', cursor: 'move' }}
                  data-testid={`pe-hi-${i}`}
                  onPointerDown={(e) => startDrag(e, i, 'hi')}
                />
              </>
            )}
            {ho && (
              <>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={ho.x}
                  y2={ho.y}
                  stroke="var(--accent)"
                  strokeWidth={1}
                />
                <circle cx={ho.x} cy={ho.y} r={2.5} fill="var(--accent)" />
                <circle
                  cx={ho.x}
                  cy={ho.y}
                  r={HIT_R}
                  fill="transparent"
                  style={{ pointerEvents: 'all', cursor: 'move' }}
                  data-testid={`pe-ho-${i}`}
                  onPointerDown={(e) => startDrag(e, i, 'ho')}
                />
              </>
            )}
            <rect
              x={a.x - 3.5}
              y={a.y - 3.5}
              width={7}
              height={7}
              fill="var(--panel-solid, #fff)"
              stroke="var(--accent)"
              strokeWidth={1.5}
            />
            <circle
              cx={a.x}
              cy={a.y}
              r={HIT_R}
              fill="transparent"
              style={{ pointerEvents: 'all', cursor: 'move' }}
              data-testid={`pe-anchor-${i}`}
              onPointerDown={(e) => startDrag(e, i, 'anchor')}
            />
          </g>
        );
      })}
    </svg>
  );
}
