import { activePageId, onPage } from '../../lib/board/pages';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { visibleCanvasRect } from '../../lib/canvas/coords';
import { beginMove, effectiveBounds } from '../../lib/canvas/gestures';
import { expandToGroups, selectionUnit } from '../../lib/canvas/grouping';
import { duplicateItems } from '../../state/commands';
import { isMobileViewport } from '../../lib/mobile';
import { VIEWER } from '../../lib/viewerMode';
import type { Item } from '@boardcache/schema';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { getSpriteBitmap, onSpriteReady } from '../../lib/canvas/lod';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/** Whether an item carries an evidence-status chip (the strength badge sits beside it). */
const status = (it: Item): boolean => it.status !== undefined;

/**
 * Deep-zoom-out replacement for the mounted items: a single canvas drawing
 * every item's cached sprite (placeholder boxes until sprites land). One
 * layer instead of a thousand — panning a fully-visible 1,000-item board
 * becomes a redraw of small bitmaps, not a compositor melt-down.
 *
 * Interaction: pointer-down hit-tests geometrically — an item under the
 * cursor selects and drags (move); empty space falls through to the
 * viewport's pan/marquee. Double-click opens the item's lightbox.
 */
/** Topmost item whose (rotated) bounds contain the client point, or null —
 *  the raster's stand-in for DOM hit-testing (context menu uses it too). */
export function overviewItemAt(clientX: number, clientY: number): string | null {
  const pt = clientToCanvas(clientX, clientY);
  const { doc } = useDocumentStore.getState();
  const page = activePageId(doc);
  const items = Object.values(doc.items)
    .filter((i) => !i.hidden)
    .filter((i) => onPage(doc, i, page))
    .sort((a, b) => b.zIndex - a.zIndex || (a.id < b.id ? 1 : -1));
  for (const item of items) {
    const aabb = rotatedRectAABB(effectiveBounds(item, undefined));
    if (
      pt.x >= aabb.x &&
      pt.x <= aabb.x + aabb.width &&
      pt.y >= aabb.y &&
      pt.y <= aabb.y + aabb.height
    ) {
      return item.id;
    }
  }
  return null;
}

/** Run fn on pointerup if the gesture stayed a TAP (no drag, not held). */
function onTap(e: { clientX: number; clientY: number }, fn: () => void): void {
  const sx = e.clientX;
  const sy = e.clientY;
  const t0 = Date.now();
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointerup', up);
    if (Date.now() - t0 > 600) return;
    if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) return;
    fn();
  };
  window.addEventListener('pointerup', up);
}

export function OverviewLayer({
  containerRef,
  fading = false,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  /** Crossfade ghost drawn over freshly-mounted real items — inert, fades out. */
  fading?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let raf = 0;
    let dirty = true;
    const markDirty = () => {
      dirty = true;
    };

    const draw = () => {
      const { doc } = useDocumentStore.getState();
      const session = useSessionStore.getState();
      const vp = doc.viewport;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const rect = visibleCanvasRect(vp, w, h);
      // The element lives in canvas space (parent is the transformed layer):
      // park it exactly over the visible region, raster at screen resolution.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.left = `${rect.x}px`;
      canvas.style.top = `${rect.y}px`;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const bw = Math.max(1, Math.round(w * dpr));
      const bh = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bw, bh);
      const k = vp.scale * dpr;
      ctx.setTransform(k, 0, 0, k, -rect.x * k, -rect.y * k);
      const selection = new Set(session.selection);
      const gesture = session.gesture;
      const page = activePageId(doc);
      const items = Object.values(doc.items)
        .filter((i) => !i.hidden)
        .filter((i) => onPage(doc, i, page))
        .sort((a, b) => a.zIndex - b.zIndex || (a.id < b.id ? -1 : 1));
      for (const item of items) {
        const b = effectiveBounds(item, gesture?.overrides[item.id]);
        const bmp = getSpriteBitmap(item);
        ctx.save();
        ctx.globalAlpha = item.opacity;
        if (b.rotation) {
          ctx.translate(b.x + b.width / 2, b.y + b.height / 2);
          ctx.rotate((b.rotation * Math.PI) / 180);
          ctx.translate(-(b.x + b.width / 2), -(b.y + b.height / 2));
        }
        if (bmp) {
          ctx.drawImage(bmp, b.x, b.y, b.width, b.height);
        } else {
          ctx.fillStyle = 'rgba(127, 127, 127, 0.16)';
          ctx.fillRect(b.x, b.y, b.width, b.height);
        }
        // Strength badge (View → Show Evidence Strength), top-left like the
        // mounted item's chip, sized in screen pixels so it stays legible.
        if (item.weight && useSessionStore.getState().weightsVisible) {
          const r = 10 / vp.scale;
          const cx = b.x + (status(item) ? 24 / vp.scale : 0);
          ctx.beginPath();
          ctx.arc(cx, b.y, r, 0, Math.PI * 2);
          ctx.fillStyle = '#3b5bdb';
          ctx.fill();
          ctx.lineWidth = 1.5 / vp.scale;
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = `700 ${11 / vp.scale}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(item.weight), cx, b.y + 0.5 / vp.scale);
          ctx.textAlign = 'start';
        }
        if (selection.has(item.id)) {
          ctx.strokeStyle = '#608cff';
          ctx.lineWidth = 2 / vp.scale;
          ctx.strokeRect(b.x, b.y, b.width, b.height);
        }
        ctx.restore();
      }
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!dirty) return;
      dirty = false;
      draw();
    };
    raf = requestAnimationFrame(loop);

    const unsubDoc = useDocumentStore.subscribe((s) => s.doc, markDirty);
    const unsubGesture = useSessionStore.subscribe((s) => s.gesture, markDirty);
    const unsubSelection = useSessionStore.subscribe((s) => s.selection, markDirty);
    const unsubPage = useSessionStore.subscribe((s) => s.activePageId, markDirty);
    const unsubWeights = useSessionStore.subscribe((s) => s.weightsVisible, markDirty);
    const unsubSprites = onSpriteReady(markDirty);
    const ro = new ResizeObserver(markDirty);
    ro.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      unsubDoc();
      unsubGesture();
      unsubSelection();
      unsubPage();
      unsubWeights();
      unsubSprites();
      ro.disconnect();
    };
  }, [containerRef]);

  return (
    <canvas
      ref={canvasRef}
      className={fading ? 'overview-canvas overview-fading' : 'overview-canvas'}
      data-testid={fading ? 'overview-canvas-fading' : 'overview-canvas'}
      onPointerDown={(e) => {
        if (fading) return;
        if (e.button !== 0) return;
        const session = useSessionStore.getState();
        if (session.tool !== 'select' || session.spaceHeld) return;
        const id = overviewItemAt(e.clientX, e.clientY);
        if (!id) return; // empty space → viewport pan/marquee
        const doc = useDocumentStore.getState().doc;
        const item = doc.items[id];
        if (!item) return;
        e.stopPropagation();

        // Mobile parity: view-only taps OPEN items; edit mode tap-selects
        // first, and a dimension lock hands the touch to the viewport.
        if (e.pointerType === 'touch' && isMobileViewport()) {
          if (!session.mobileEditMode) {
            onTap(e, () => useSessionStore.getState().setLightbox(id));
            return;
          }
          if (session.mobileTransformLock !== 'move' && session.selection.length > 0) return;
          if (!session.selection.includes(id)) {
            onTap(e, () => {
              const s2 = useSessionStore.getState();
              const d2 = useDocumentStore.getState().doc;
              const it2 = d2.items[id];
              if (!it2) return;
              s2.setSelection(expandToGroups(d2, [id], s2.isolatedGroupId));
            });
            return;
          }
        }

        // Same rules as the mounted items from here down.
        const targets = expandToGroups(doc, [id], session.isolatedGroupId);
        const wasSelected = session.selection.includes(id);

        // Alt-drag duplicates: clone IN PLACE and drag the clones.
        if (e.altKey && !item.locked) {
          const dragIds = wasSelected ? session.selection : targets;
          const cloneIds = duplicateItems(dragIds, 'Duplicate', 0);
          session.setSelection(cloneIds);
          beginMove(e);
          return;
        }

        const toggleTargets = () => {
          const allIn = targets.every((t) => session.selection.includes(t));
          session.setSelection(
            allIn
              ? session.selection.filter((sid) => !targets.includes(sid))
              : [...session.selection, ...targets.filter((t) => !session.selection.includes(t))],
          );
        };
        // Shift-drag pulls one member out of its group; shift-click toggles.
        if (e.shiftKey && item.groupId && !item.locked) {
          beginMove(e, { soloDragId: id, onClick: toggleTargets });
          return;
        }
        if (e.shiftKey) {
          const allIn = targets.every((t) => session.selection.includes(t));
          toggleTargets();
          if (allIn) return; // shift-click deselected — no drag
        } else if (!wasSelected) {
          session.setSelection(targets);
        }
        // Only narrow to a single item on a plain click of an ungrouped item.
        const collapseToId = !e.shiftKey && wasSelected && !item.groupId ? id : undefined;
        beginMove(e, collapseToId ? { collapseToId } : {});
      }}
      onDoubleClick={(e) => {
        if (fading) return;
        const id = overviewItemAt(e.clientX, e.clientY);
        if (!id) return;
        e.stopPropagation();
        const session = useSessionStore.getState();
        const item = useDocumentStore.getState().doc.items[id];
        if (item?.type === 'project' && !VIEWER) {
          window.dispatchEvent(
            new CustomEvent('boardcache:open-projects', { detail: { projectId: id } }),
          );
          return;
        }
        // View-only (offline viewer, mobile before the Edit button) always
        // VIEWS: no group isolation, no selection — the lightbox opens.
        if (VIEWER || (isMobileViewport() && !session.mobileEditMode)) {
          session.setLightbox(id);
          return;
        }
        // Double-click a grouped item ISOLATES its group (mounted-item rule);
        // inside isolation — and for everything else — it opens the lightbox.
        const docNow = useDocumentStore.getState().doc;
        const unit = item ? selectionUnit(docNow, id, session.isolatedGroupId) : null;
        if (unit?.kind === 'group' && item && !item.locked) {
          session.setIsolatedGroup(unit.id);
          session.setSelection(expandToGroups(docNow, [id], unit.id));
          return;
        }
        session.setLightbox(id);
      }}
    />
  );
}
