import { clientToCanvas } from './canvasDom';
import { createShape } from '../import/createItems';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import type { PenDraftNode } from '../../state/sessionStore';
import type { PathNode } from '@boardcache/schema';

/**
 * The vector pen tool (Illustrator/Figma-style). Click places a corner
 * anchor; click-drag pulls out symmetric bezier handles; clicking the first
 * anchor closes the path — press-drag there first to pull the closing
 * curve's handles, committing on release; Enter (or double-click) commits an
 * open path;
 * Escape commits what exists, or cancels with fewer than two anchors.
 * Modifiers mirror Illustrator exactly. Alt is the Anchor Point tool:
 * dragging an anchor pulls fresh symmetric handles out of it (corner →
 * smooth), a plain Alt-click on an anchor strips its handles (smooth →
 * corner), and dragging a handle dot moves ONLY that hand — breaking the
 * pair into a cusp. On the LAST anchor mid-path, Alt-drag aims only the
 * leading (out) hand — the direction the line is going — leaving the drawn
 * segment untouched. Cmd/Ctrl is Direct Selection: dragging an anchor moves
 * the point with its handles, and dragging a handle keeps a smooth pair
 * collinear (opposite hand mirrors the angle at its own length) or moves a
 * broken hand alone. Cmd/Ctrl-click on empty canvas ends the path, like
 * deselecting in Illustrator. Holding Alt WHILE pulling a new anchor's
 * handles freezes the in-handle and moves only the out-handle (cusp).
 * Cmd/Ctrl+Z / +Shift+Z step through the anchors of the path being drawn
 * instead of touching document history.
 *
 * Unlike drag-gesture tools, a pen session spans many pointer events, so it
 * keeps module state, renders through the session `penDraft`, and commits
 * with one createShape (rule 3.4). Switching tools mid-session commits.
 */

const CLOSE_THRESHOLD = 8; // screen px
const HANDLE_THRESHOLD = 4; // screen px of drag before an anchor grows handles
const DOUBLE_MS = 350;
const DOUBLE_DIST = 6; // screen px

interface PenSession {
  nodes: PenDraftNode[];
  lastClick: { t: number; x: number; y: number } | null;
  /** Point-level history: node-array snapshots taken before each change. */
  undoStack: PenDraftNode[][];
  redoStack: PenDraftNode[][];
  cleanup: () => void;
}

/** Record the current nodes before a change; a new change clears redo. */
function snapshot(): void {
  if (!session) return;
  session.undoStack.push(session.nodes.map((n) => ({ ...n })));
  session.redoStack = [];
}

let session: PenSession | null = null;

function scale(): number {
  return useDocumentStore.getState().doc.viewport.scale;
}

function publish(cursor: { x: number; y: number } | null, closing = false): void {
  const s = useSessionStore.getState();
  if (!session) {
    s.setPenDraft(null);
    return;
  }
  s.setPenDraft({
    nodes: session.nodes.map((n) => ({ ...n })),
    cursor,
    closing,
    style: s.shapeStyle,
  });
}

function startSession(): PenSession {
  const onCursor = (ev: PointerEvent) => publish(clientToCanvas(ev.clientX, ev.clientY));
  const onKey = (ev: KeyboardEvent) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && session && (ev.key.toLowerCase() === 'z' || ev.key.toLowerCase() === 'y')) {
      const redo = ev.key.toLowerCase() === 'y' || ev.shiftKey;
      const from = redo ? session.redoStack : session.undoStack;
      if (from.length > 0) {
        ev.preventDefault();
        ev.stopPropagation();
        const to = redo ? session.undoStack : session.redoStack;
        to.push(session.nodes.map((n) => ({ ...n })));
        session.nodes = from.pop()!;
        publish(null);
        return;
      }
      // Nothing pen-side to undo AND the path is empty → let the document
      // handle it. With anchors still down, swallow so a stray extra Cmd+Z
      // never rips into board history mid-path.
      if (session.nodes.length > 0) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commitPen(false);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      if (session && session.nodes.length >= 2) commitPen(false);
      else cancelPen();
    }
  };
  window.addEventListener('pointermove', onCursor);
  // Capture phase so the lightbox/global Escape handlers don't race the pen.
  window.addEventListener('keydown', onKey, true);
  const unsubTool = useSessionStore.subscribe((state, prev) => {
    if (state.tool !== prev.tool && session) {
      // Leaving the pen mid-path: keep what was drawn when it's a real path.
      if (session.nodes.length >= 2) commitPen(false);
      else cancelPen();
    }
  });
  return {
    nodes: [],
    lastClick: null,
    undoStack: [],
    redoStack: [],
    cleanup: () => {
      window.removeEventListener('pointermove', onCursor);
      window.removeEventListener('keydown', onKey, true);
      unsubTool();
    },
  };
}

/** Pointer-down with the pen tool active: add an anchor / drag its handles. */
const HIT_THRESHOLD = 8; // screen px around anchors/handle dots

type HitPart = 'anchor' | 'hi' | 'ho';

/** Nearest anchor or handle dot within the hit threshold, if any. */
function hitTest(p: { x: number; y: number }): { node: PenDraftNode; part: HitPart } | null {
  if (!session) return null;
  const limit = HIT_THRESHOLD / scale();
  let best: { node: PenDraftNode; part: HitPart; d: number } | null = null;
  const consider = (node: PenDraftNode, part: HitPart, x: number, y: number) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < limit && (!best || d < best.d)) best = { node, part, d };
  };
  for (const n of session.nodes) {
    consider(n, 'anchor', n.x, n.y);
    if (n.hix != null && n.hiy != null) consider(n, 'hi', n.hix, n.hiy);
    if (n.hox != null && n.hoy != null) consider(n, 'ho', n.hox, n.hoy);
  }
  return best
    ? { node: (best as { node: PenDraftNode }).node, part: (best as { part: HitPart }).part }
    : null;
}

/** Were this node's handles a smooth (collinear, opposing) pair? */
export function wasSmooth(n: {
  x: number;
  y: number;
  hix?: number;
  hiy?: number;
  hox?: number;
  hoy?: number;
}): boolean {
  if (n.hix == null || n.hiy == null || n.hox == null || n.hoy == null) return false;
  const ix = n.hix - n.x;
  const iy = n.hiy - n.y;
  const ox = n.hox - n.x;
  const oy = n.hoy - n.y;
  const li = Math.hypot(ix, iy);
  const lo = Math.hypot(ox, oy);
  if (li < 0.01 || lo < 0.01) return false;
  // Anti-collinear within ~11°.
  return (ix * ox + iy * oy) / (li * lo) < -0.98;
}

/**
 * Alt = Anchor Point tool; Cmd/Ctrl = Direct Selection — see the module
 * comment for the exact Illustrator behavior each combination produces.
 */
function beginAdjust(
  e: { pointerId: number; clientX: number; clientY: number },
  hit: { node: PenDraftNode; part: HitPart },
  modifier: 'alt' | 'mod',
): void {
  const { node, part } = hit;
  snapshot();
  const orig = { ...node };
  const smooth = wasSmooth(orig);
  let dragged = false;
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId || !session) return;
    if (!dragged && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < HANDLE_THRESHOLD) {
      return;
    }
    dragged = true;
    const q = clientToCanvas(ev.clientX, ev.clientY);

    if (modifier === 'alt') {
      if (part === 'anchor') {
        // Anchor Point tool on an anchor: pull fresh symmetric handles —
        // except on the LAST anchor mid-path, where Alt aims only the
        // leading (out) hand so the segment already drawn stays put.
        node.hox = q.x;
        node.hoy = q.y;
        if (session.nodes[session.nodes.length - 1] !== node) {
          node.hix = 2 * node.x - q.x;
          node.hiy = 2 * node.y - q.y;
        }
      } else if (part === 'ho') {
        // On a handle: move ONLY that hand — break the pair (cusp).
        node.hox = q.x;
        node.hoy = q.y;
      } else {
        node.hix = q.x;
        node.hiy = q.y;
      }
      publish(q);
      return;
    }

    // Direct Selection (Cmd/Ctrl).
    if (part === 'anchor') {
      const dx = q.x - orig.x;
      const dy = q.y - orig.y;
      node.x = q.x;
      node.y = q.y;
      if (orig.hix != null) node.hix = orig.hix + dx;
      if (orig.hiy != null) node.hiy = orig.hiy + dy;
      if (orig.hox != null) node.hox = orig.hox + dx;
      if (orig.hoy != null) node.hoy = orig.hoy + dy;
    } else {
      // Smooth pair stays collinear (opposite hand mirrors the angle at its
      // own length); a broken pair moves the dragged hand alone.
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
    publish(q);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (!dragged) {
      if (modifier === 'alt' && part === 'anchor') {
        // Anchor Point tool CLICK: smooth → corner (strip the handles).
        delete node.hix;
        delete node.hiy;
        delete node.hox;
        delete node.hoy;
        publish(null);
      } else {
        // No change happened — drop the snapshot we took optimistically.
        session?.undoStack.pop();
      }
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

export function beginPenPoint(e: {
  pointerId: number;
  clientX: number;
  clientY: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): void {
  const now = Date.now();
  const p = clientToCanvas(e.clientX, e.clientY);

  if (!session) session = startSession();

  // Modifier = edit mode: grab an anchor or handle instead of placing.
  const mod = !!(e.ctrlKey || e.metaKey);
  if (e.altKey || mod) {
    const hit = hitTest(p);
    if (hit) {
      beginAdjust(e, hit, e.altKey ? 'alt' : 'mod');
      return;
    }
    // Cmd/Ctrl-click on empty canvas ends the path (Illustrator deselect).
    if (mod && !e.altKey && session.nodes.length >= 2) {
      commitPen(false);
      return;
    }
    return; // Alt-click on empty canvas never adds an anchor
  }

  // Double-click: commit the open path (the first click already added its node).
  if (
    session.lastClick &&
    now - session.lastClick.t < DOUBLE_MS &&
    Math.hypot(e.clientX - session.lastClick.x, e.clientY - session.lastClick.y) < DOUBLE_DIST
  ) {
    commitPen(false);
    return;
  }
  session.lastClick = { t: now, x: e.clientX, y: e.clientY };

  // Press on the first anchor closes the path — but not until release:
  // dragging first pulls the closing anchor's handles (smooth join), exactly
  // like placing a smooth point, so the final curve can be shaped in one move.
  const first = session.nodes[0];
  if (first && session.nodes.length >= 2) {
    const d = Math.hypot(p.x - first.x, p.y - first.y) * scale();
    if (d < CLOSE_THRESHOLD) {
      snapshot();
      const orig = { ...first };
      let dragged = false;
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId || !session) return;
        if (
          !dragged &&
          Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < HANDLE_THRESHOLD
        ) {
          return;
        }
        dragged = true;
        const q = clientToCanvas(ev.clientX, ev.clientY);
        first.hox = q.x;
        first.hoy = q.y;
        first.hix = 2 * first.x - q.x;
        first.hiy = 2 * first.y - q.y;
        publish(q, true);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (ev.type === 'pointercancel') {
          // Aborted (e.g. touch cancel): restore and stay in the session.
          Object.assign(first, orig);
          session?.undoStack.pop();
          publish(null);
          return;
        }
        commitPen(true);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      publish({ x: first.x, y: first.y }, true);
      return;
    }
  }

  snapshot();
  const node: PenDraftNode = { x: p.x, y: p.y };
  session.nodes.push(node);
  publish(p);

  // Dragging after the press pulls out symmetric handles.
  let dragged = false;
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId || !session) return;
    const q = clientToCanvas(ev.clientX, ev.clientY);
    if (!dragged && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < HANDLE_THRESHOLD) {
      return;
    }
    dragged = true;
    node.hox = q.x;
    node.hoy = q.y;
    // Alt while pulling: the in-handle freezes where the mirror left it, so
    // the outgoing slope bends independently (a cusp, Illustrator-style).
    if (!ev.altKey) {
      node.hix = 2 * node.x - q.x;
      node.hiy = 2 * node.y - q.y;
    } else if (node.hix == null) {
      node.hix = 2 * node.x - q.x;
      node.hiy = 2 * node.y - q.y;
    }
    publish(q);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    publish(clientToCanvas(ev.clientX, ev.clientY));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function endSession(): void {
  session?.cleanup();
  session = null;
  useSessionStore.getState().setPenDraft(null);
}

function cancelPen(): void {
  endSession();
  useSessionStore.getState().setTool('select');
}

function commitPen(closed: boolean): void {
  if (!session) return;
  const nodes = session.nodes;
  if (nodes.length < 2) {
    cancelPen();
    return;
  }
  const style = useSessionStore.getState().shapeStyle;
  endSession();

  // Bounding box over anchors AND handles so curves never clip.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of nodes) {
    xs.push(n.x, ...(n.hix != null ? [n.hix] : []), ...(n.hox != null ? [n.hox] : []));
    ys.push(n.y, ...(n.hiy != null ? [n.hiy] : []), ...(n.hoy != null ? [n.hoy] : []));
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(8, Math.max(...xs) - minX);
  const height = Math.max(8, Math.max(...ys) - minY);
  const nx = (v: number) => (v - minX) / width;
  const ny = (v: number) => (v - minY) / height;
  const pathNodes: PathNode[] = nodes.map((n) => ({
    x: nx(n.x),
    y: ny(n.y),
    ...(n.hix != null ? { hix: nx(n.hix) } : {}),
    ...(n.hiy != null ? { hiy: ny(n.hiy) } : {}),
    ...(n.hox != null ? { hox: nx(n.hox) } : {}),
    ...(n.hoy != null ? { hoy: ny(n.hoy) } : {}),
  }));

  createShape('path', { x: minX, y: minY, width, height, pathNodes, pathClosed: closed }, style);
}
