import { activePageId, effectiveAppearance } from '../../lib/board/pages';
import { canvasReadOnly, useCanvasReadOnly } from '../../lib/canvas/readOnly';
import { viewItem } from './viewItem';
import { useEffect, useRef } from 'react';
import type { CanvasDocument, Viewport, BoardSettings } from '@boardcache/schema';
import { registerCanvasContainer, clientToCanvas } from '../../lib/canvas/canvasDom';
import { noteMiddleButton } from '../../lib/canvas/middleClickGuard';
import { panBy, wheelZoomFactor, zoomBy } from '../../lib/canvas/coords';
import { CORK_TILE_PX } from '../../lib/themes';
import { gridCss } from '../../lib/canvas/gridStyle';
import { overviewItemAt } from './OverviewLayer';
import type { Point } from '../../lib/canvas/coords';
import { beginDraw } from '../../lib/canvas/drawGesture';
import { beginPenPoint } from '../../lib/canvas/penGesture';
import { beginMarquee, beginLockedScale, beginLockedRotate } from '../../lib/canvas/gestures';
import {
  presentGo,
  presentPan,
  presentZoom,
  presentZoomToggle,
  presentZoomed,
} from '../../lib/canvas/presentation';
import { expandToGroups, groupChain, parentGroup } from '../../lib/canvas/grouping';
import { isMobileViewport } from '../../lib/mobile';
import { PresentationBadges } from './PresentationBadges';
import { smartCreateFromText } from '../../lib/import/smartPaste';
import { importMediaFiles, MEDIA_ACCEPT } from '../../lib/import/importMedia';
import { VIEWER } from '../../lib/viewerMode';
import { createVideoEmbed } from '../../lib/import/importVideos';
import { parseVideoUrl } from '../../lib/media/videoEmbed';
import { importBoardFromFile } from '../../lib/board/transfer';
import { useDocumentStore } from '../../state/documentStore';
import { collabActive } from '../../state/collabStore';
import { isDrawTool, resolveTheme, useSessionStore } from '../../state/sessionStore';
import { darkVariant } from '../../lib/color/color';
import { noteGesture } from '../../lib/deviceLog';
import { isEditableTarget } from '../../hooks/useGlobalShortcuts';
import { AIGenerationStatus } from '../chrome/AIGenerationStatus';
import { CanvasVideoControls } from './CanvasVideoControls';
import { CanvasBackgroundLayer } from './CanvasBackgroundLayer';
import { DraftPreview } from './DraftPreview';
import { PathEditOverlay } from './PathEditOverlay';
import { GroupBackgroundsLayer } from './GroupBackgroundsLayer';
import { ConnectionsLayer } from './ConnectionsLayer';
import { PresenceLayer } from './PresenceLayer';
import { GroupNameLabel } from './SelectionActionBar';
import { ItemsLayer } from './ItemsLayer';
import { PendingImportsLayer } from './PendingImportsLayer';
import { SelectionOverlay } from './SelectionOverlay';
import { useShallow } from 'zustand/react/shallow';

/** Canvas-space distance between minor grid lines at 100% zoom. */
/**
 * The infinite canvas surface.
 *
 * Pan/zoom never goes through React's render cycle: the world transform and
 * grid background are written imperatively from a store subscription, so a
 * 60fps drag re-renders zero item components (rule from §2 of the brief).
 */
/** Does a wheel over `target` scroll something inside its canvas item? */
function scrollsWithinItem(target: HTMLElement | null): boolean {
  for (let el = target; el && !el.classList.contains('canvas-world'); el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (
      (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight + 1
    )
      return true;
    if (el.hasAttribute('data-item-id')) break;
  }
  return false;
}

export function CanvasViewport() {
  const isolatedGroupId = useSessionStore((s) => s.isolatedGroupId);
  const groupsAlive = useDocumentStore((s) =>
    isolatedGroupId ? !!s.doc.groups[isolatedGroupId] : true,
  );
  if (isolatedGroupId && !groupsAlive) {
    // The isolated group dissolved (ungroup/undo) — step back out.
    useSessionStore.getState().setIsolatedGroup(null);
  }
  const readOnly = useCanvasReadOnly();
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const dropPoint = useRef<Point>({ x: 0, y: 0 });

  const tool = useSessionStore((s) => s.tool);
  const spaceHeld = useSessionStore((s) => s.spaceHeld);
  const cropHeld = useSessionStore((s) => s.cropHeld);
  const panning = useSessionStore((s) => s.panning);

  useEffect(() => {
    registerCanvasContainer(containerRef.current);
    return () => registerCanvasContainer(null);
  }, []);

  // --- imperative viewport projection -----------------------------------
  useEffect(() => {
    const world = worldRef.current;
    const grid = gridRef.current;
    if (!world || !grid) return;

    // Promote the world to a GPU layer only while it's actively moving. A
    // persistent `will-change: transform` makes the browser rasterize the layer
    // once and stretch that texture on zoom, so vector content (shapes, text,
    // colors) turns blurry when you zoom in. Dropping the hint once the gesture
    // settles lets the browser re-rasterize crisply at the current scale.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const apply = (viewport: Viewport, settings: BoardSettings) => {
      // Custom canvas background color ('default' falls back to the theme).
      // Picked against the light page; in dark mode a pale tint shows as its
      // deep counterpart, like group backdrops (lib/color).
      const container = containerRef.current;
      if (container) {
        const dark = resolveTheme(useSessionStore.getState().theme) === 'dark';
        container.style.background =
          settings.background !== 'default'
            ? dark
              ? darkVariant(settings.background)
              : settings.background
            : '';
      }
      // Corkboard's cork tile lives in WORLD space: translate and scale the
      // pattern with the viewport so the board feels physical when panning.
      // (Other themes have no viewport texture — clearing keeps them inert.)
      if (container) {
        const root = document.documentElement;
        if (root.dataset.themeId === 'corkboard') {
          const tile = CORK_TILE_PX * viewport.scale;
          container.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
          container.style.backgroundSize = `${tile}px ${tile}px`;
        } else {
          container.style.backgroundPosition = '';
          container.style.backgroundSize = '';
        }
      }
      world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
      world.style.willChange = 'transform';
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        world.style.willChange = 'auto';
      }, 180);
      if (settings.gridVisible) {
        const css = gridCss(settings.gridType, viewport.scale);
        grid.style.opacity = String(settings.gridOpacity);
        grid.style.backgroundImage = css.backgroundImage;
        grid.style.backgroundSize = css.backgroundSize;
        // A plain translation of the pattern — correct for every layer no
        // matter its own repeat period.
        grid.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
      } else {
        grid.style.opacity = '0';
      }
    };

    // Pages: the ACTIVE page's overrides win over board settings.
    const settingsFor = (d: CanvasDocument): BoardSettings => ({
      ...d.settings,
      ...effectiveAppearance(d, activePageId(d)),
    });
    const { doc } = useDocumentStore.getState();
    apply(doc.viewport, settingsFor(doc));
    const unsub = useDocumentStore.subscribe(
      (s) => s.doc,
      (d) => apply(d.viewport, settingsFor(d)),
    );
    const reapply = () => {
      const d = useDocumentStore.getState().doc;
      apply(d.viewport, settingsFor(d));
    };
    const unsubPage = useSessionStore.subscribe((s) => s.activePageId, reapply);
    const unsubTheme = useSessionStore.subscribe((s) => resolveTheme(s.theme), reapply);
    return () => {
      if (settle) clearTimeout(settle);
      unsub();
      unsubPage();
      unsubTheme();
    };
  }, []);

  // --- wheel: scroll pans (Figma-style); Cmd/Ctrl-scroll (and pinch) zooms --
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      // Presenting: a scroll inside the step's own content (a PDF, a long
      // note) goes through; otherwise the wheel takes a closer look —
      // Ctrl/Cmd (or zoom-scroll mode) zooms in around the cursor, and a
      // plain scroll pans only while zoomed in. Both stay inside the step.
      if (useSessionStore.getState().presenting) {
        if (scrollsWithinItem(e.target as HTMLElement)) return;
        e.preventDefault();
        const norm = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
        const dx = e.deltaX * norm;
        const dy = e.deltaY * norm;
        if (e.ctrlKey || e.metaKey || useSessionStore.getState().wheelMode === 'zoom') {
          const zd = dy !== 0 ? dy : dx;
          const speed = 0.01 * useSessionStore.getState().zoomSpeed * (e.shiftKey ? 0.25 : 1);
          presentZoom(wheelZoomFactor(zd, speed), { x: e.clientX, y: e.clientY });
        } else if (presentZoomed()) {
          presentPan(-dx, -dy);
        }
        return;
      }
      if (!e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        // The markdown editor + its slash menu always own their scroll.
        const editorEl = target.closest('.md-editor, .md-slash-menu, .cm-scroller');
        if (editorEl && editorEl.scrollHeight > editorEl.clientHeight + 1) return;
        // A scrollable text/RSS box consumes the scroll ONLY while selected —
        // hovering an unselected box must not block canvas panning.
        const box = target.closest(
          '.text-item, .rss-list, .code-static, .tasklist-body, .project-body, .case-conclusions',
        );
        if (box && box.scrollHeight > box.clientHeight + 1) {
          const id = box.closest('[data-item-id]')?.getAttribute('data-item-id');
          if (id && useSessionStore.getState().selection.includes(id)) return;
        }
      }
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const norm = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      let dx = e.deltaX * norm;
      let dy = e.deltaY * norm;

      const { doc, setViewport } = useDocumentStore.getState();
      const viewport = doc.viewport;
      const zoomScroll = useSessionStore.getState().wheelMode === 'zoom';

      if (e.ctrlKey || e.metaKey || zoomScroll) {
        // Zoom to cursor — explicit Cmd/Ctrl-scroll, trackpad pinch (which
        // browsers deliver as ctrl+wheel), and zoom-scroll mode all land
        // here. Shift zooms at quarter speed for fine control (browsers
        // report shift+wheel on deltaX, so fall back to it).
        const zd = dy !== 0 ? dy : dx;
        // User-set sensitivity scales both speeds; shift stays ¼ of normal.
        const speed = 0.01 * useSessionStore.getState().zoomSpeed * (e.shiftKey ? 0.25 : 1);
        setViewport(zoomBy(viewport, cursor, wheelZoomFactor(zd, speed)));
      } else {
        // Plain scroll pans the canvas. Shift maps a vertical wheel to horizontal
        // (some browsers already do this and report it on deltaX).
        if (e.shiftKey && dx === 0) {
          dx = dy;
          dy = 0;
        }
        setViewport(panBy(viewport, -dx, -dy));
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });

    // Trackpad pinch on Safari (iPad keyboard case, Mac) arrives as WebKit's
    // proprietary gesture events — not as ctrl+wheel — and, left alone, it
    // zooms the PAGE. Claim it: cancel the default and zoom the canvas by the
    // gesture's running scale, around the pointer. A finger pinch on the
    // screen fires these too, but the touch pinch above already owns that
    // one, so it is left to it.
    type GestureEvt = UIEvent & { scale: number; clientX: number; clientY: number };
    let gestureScale = 1;
    const onGestureStart = (e: Event) => {
      if (pinch.current) return;
      e.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      if (pinch.current) return;
      e.preventDefault();
      const g = e as GestureEvt;
      if (!Number.isFinite(g.scale) || g.scale <= 0) return;
      const factor = g.scale / gestureScale;
      gestureScale = g.scale;
      if (useSessionStore.getState().presenting) {
        presentZoom(factor, { x: g.clientX, y: g.clientY }); // a closer look at the step
        return;
      }
      const rect = container.getBoundingClientRect();
      const { doc, setViewport } = useDocumentStore.getState();
      setViewport(
        zoomBy(doc.viewport, { x: g.clientX - rect.left, y: g.clientY - rect.top }, factor),
      );
    };
    const onGestureEnd = (e: Event) => {
      if (!pinch.current) e.preventDefault();
    };
    const opts = { passive: false } as const;
    container.addEventListener('gesturestart', onGestureStart, opts);
    container.addEventListener('gesturechange', onGestureChange, opts);
    container.addEventListener('gestureend', onGestureEnd, opts);
    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('gesturestart', onGestureStart);
      container.removeEventListener('gesturechange', onGestureChange);
      container.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // --- pointer: pan (middle / space / pan tool) or marquee (select tool) --
  const panDrag = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  // Active touch points on the canvas background (items handle their own drags).
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  // A motionless single-finger tap on the empty canvas deselects, matching
  // an empty-canvas mouse click. Items stopPropagation, so onItem only flags
  // taps that started over an item with a pan-style tool.
  const tap = useRef<{ id: number; x: number; y: number; onItem: boolean } | null>(null);
  const touchDist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  type Pt = { x: number; y: number };

  /** Two fingers are down: the gesture is a pinch from here on. */
  const beginPinch = (a: Pt, b: Pt) => {
    panDrag.current = null; // a second finger upgrades a pan into a pinch
    tap.current = null; // multi-touch is a pinch, never a tap
    pinch.current = { dist: touchDist(a, b), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    const session = useSessionStore.getState();
    session.setPanning(true);
    // A finger that landed on a menu button opened its menu; the pinch is
    // the intent, so the menu goes.
    if (session.menubarOpen) session.setMenubarOpen(null);
    if (session.contextMenu) session.setContextMenu(null);
    // Breadcrumb for a tab that dies mid-pinch (see deviceLog).
    const { doc } = useDocumentStore.getState();
    noteGesture({
      kind: 'pinch',
      board: doc.id,
      team: collabActive(),
      scale: doc.viewport.scale,
      items: Object.keys(doc.items).length,
      iframes: document.querySelectorAll('iframe').length,
      images: document.images.length,
      dpr: window.devicePixelRatio,
    });
  };

  /** Re-derive zoom and pan from the current pair of fingers. */
  const movePinch = (a: Pt, b: Pt) => {
    const p = pinch.current;
    const container = containerRef.current;
    if (!p || !container) return;
    const newDist = touchDist(a, b);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rect = container.getBoundingClientRect();
    const factor = p.dist > 0 ? newDist / p.dist : 1;
    const { doc, setViewport } = useDocumentStore.getState();
    if (useSessionStore.getState().presenting) {
      // A closer look at the step: zoom and pan, kept inside its frame.
      presentZoom(factor, { x: cx, y: cy });
      presentPan(cx - p.cx, cy - p.cy);
    } else {
      let vp = zoomBy(doc.viewport, { x: cx - rect.left, y: cy - rect.top }, factor);
      vp = panBy(vp, cx - p.cx, cy - p.cy);
      setViewport(vp);
    }
    pinch.current = { dist: newDist, cx, cy };
  };

  /** Fewer than two fingers remain: the pinch is over. */
  const endPinch = (remaining: number) => {
    if (!pinch.current) return;
    pinch.current = null;
    noteGesture(null);
    if (remaining === 0 || touches.current.size !== 1) {
      panDrag.current = null;
      if (remaining === 0) useSessionStore.getState().setPanning(false);
      return;
    }
    // One finger remains and it is the viewport's own: resume a pan with it.
    // (A finger left on the chrome is not in `touches` and pans nothing.)
    const [id, pt] = [...touches.current.entries()][0]!;
    panDrag.current = { pointerId: id, lastX: pt.x, lastY: pt.y };
  };

  // Two fingers anywhere zoom the board. The pinch is read from the
  // browser's own list of active touches (TouchEvent.touches) at the
  // document, in the capture phase, so it counts wherever the fingers land
  // — a toolbar, the zoom pill, the selection bar, or an item that stops
  // propagation for its own tap handling — and it can never be fooled by a
  // finger the app lost track of: one finger is one finger. Modal surfaces
  // (dialogs, the lightbox, popovers) and text editing keep their own
  // gestures. While a pinch is on, the page's own scroll and zoom are
  // cancelled — the listeners are non-passive so the default can be.
  useEffect(() => {
    const allowedAt = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      const session = useSessionStore.getState();
      if (session.view !== 'canvas' || session.lightboxId) return false;
      if (
        target.closest(
          '[role="dialog"], .dlg-sheet, .md-editor, input, textarea, [contenteditable="true"]',
        )
      )
        return false;
      // Popovers keep their gestures (a color wheel, a select list); menus
      // are transient and simply close.
      const popper = target.closest('[data-radix-popper-content-wrapper]');
      return !popper || !!target.closest('[role="menu"]');
    };
    const pair = (e: TouchEvent): [Pt, Pt] | null => {
      if (e.touches.length < 2) return null;
      const a = e.touches[0]!;
      const b = e.touches[1]!;
      if (!pinch.current && !(allowedAt(a.target) && allowedAt(b.target))) return null;
      return [
        { x: a.clientX, y: a.clientY },
        { x: b.clientX, y: b.clientY },
      ];
    };
    const onStart = (e: TouchEvent) => {
      if (pinch.current) {
        e.preventDefault();
        return;
      }
      // A finger already moving an item keeps it; a second finger on top of
      // that is not a pinch.
      if (useSessionStore.getState().gesture) return;
      const pts = pair(e);
      if (!pts) return;
      beginPinch(pts[0], pts[1]);
      e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch.current) return;
      const pts = pair(e);
      if (pts) movePinch(pts[0], pts[1]);
      e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      if (pinch.current && e.touches.length < 2) endPinch(e.touches.length);
    };
    const opts = { passive: false, capture: true } as const;
    document.addEventListener('touchstart', onStart, opts);
    document.addEventListener('touchmove', onMove, opts);
    document.addEventListener('touchend', onEnd, true);
    document.addEventListener('touchcancel', onEnd, true);
    return () => {
      document.removeEventListener('touchstart', onStart, opts);
      document.removeEventListener('touchmove', onMove, opts);
      document.removeEventListener('touchend', onEnd, true);
      document.removeEventListener('touchcancel', onEnd, true);
    };
    // The handlers only read refs; nothing here changes between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Presentation Mode: a press on empty canvas starts a tap (right two
  // thirds advance, left third goes back) or a swipe; the step's own items
  // keep their controls — a PDF pages, a video plays — but never select or
  // drag (ItemView knows too).
  const presentTap = useRef<{ x: number; y: number; at: number } | null>(null);
  // A tap advances only once the double-click window has passed: the first
  // click of a double-click (a closer look) must not turn the page.
  const presentTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (useSessionStore.getState().presenting) {
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      // Zoomed in on the step: a drag from anywhere pans around inside it
      // (a tap still advances). At the frame, only empty canvas takes taps
      // and swipes; the step's items keep their own controls.
      const zoomed = presentZoomed();
      if (!zoomed && (e.target as HTMLElement).closest('[data-item-id]')) return;
      if (presentTapTimer.current) {
        clearTimeout(presentTapTimer.current); // second press: a double-click, not two taps
        presentTapTimer.current = null;
      }
      presentTap.current = { x: e.clientX, y: e.clientY, at: Date.now() };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone (or synthetic in tests) */
      }
      if (zoomed) {
        panDrag.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
        useSessionStore.getState().setPanning(true);
      }
      return;
    }
    const { tool: activeTool, spaceHeld: space, setPanning } = useSessionStore.getState();
    if (e.button === 1) noteMiddleButton(); // pan-only; suppress its OS paste

    // Touch: one finger pans the canvas; a pinch is recognised from the
    // touch list above and only ever from TWO fingers. The viewport keeps
    // its own fingers captured, so this map never goes stale.
    if (e.pointerType === 'touch') {
      // Mobile dimension lock: while Scale/Rotate is armed, a one-finger
      // drag anywhere manipulates the selection instead of panning (the
      // whole screen is the precision surface). Pinch still zooms.
      {
        const session = useSessionStore.getState();
        if (
          session.mobileEditMode &&
          session.selection.length > 0 &&
          session.mobileTransformLock !== 'move' &&
          touches.current.size === 0 &&
          !pinch.current
        ) {
          if (session.mobileTransformLock === 'scale') beginLockedScale(e);
          else beginLockedRotate(e);
          return;
        }
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone (or synthetic in tests) */
      }
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current) return; // the pinch owns every finger for now
      tap.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        onItem: !!(e.target as HTMLElement).closest('[data-item-id]'),
      };
      panDrag.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      setPanning(true);
      return;
    }

    const panIntent = e.button === 1 || (e.button === 0 && (activeTool === 'pan' || space));
    if (panIntent && !panDrag.current) {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone (or synthetic in tests) */
      }
      panDrag.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      setPanning(true);
      return;
    }
    if (e.button === 0 && activeTool === 'select') {
      // Empty-canvas press: leave node editing first, then marquee as usual
      // (item presses stopPropagation before reaching here).
      if (useSessionStore.getState().pathEditId) {
        useSessionStore.getState().setPathEditId(null);
        return;
      }
      beginMarquee(e, e.shiftKey);
    } else if (e.button === 0 && activeTool === 'shape:path') {
      e.preventDefault();
      beginPenPoint({
        pointerId: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      });
    } else if (e.button === 0 && isDrawTool(activeTool)) {
      e.preventDefault();
      beginDraw(e, activeTool);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (useSessionStore.getState().presenting) {
      // Zoomed in on the step: the drag pans inside it. Otherwise the
      // camera is the show's.
      const drag = panDrag.current;
      if (drag && e.pointerId === drag.pointerId) {
        presentPan(e.clientX - drag.lastX, e.clientY - drag.lastY);
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
      }
      return;
    }
    if (e.pointerType === 'touch') {
      if (!touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (tap.current?.id === e.pointerId) {
        const t = tap.current;
        if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) tap.current = null;
      }
      if (pinch.current) return; // the touch list drives the pinch
      const t = panDrag.current;
      if (t && t.pointerId === e.pointerId) {
        const { doc, setViewport } = useDocumentStore.getState();
        setViewport(panBy(doc.viewport, e.clientX - t.lastX, e.clientY - t.lastY));
        t.lastX = e.clientX;
        t.lastY = e.clientY;
      }
      return;
    }

    const drag = panDrag.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { doc, setViewport } = useDocumentStore.getState();
    setViewport(panBy(doc.viewport, e.clientX - drag.lastX, e.clientY - drag.lastY));
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  };

  const endPan = (e: React.PointerEvent) => {
    if (useSessionStore.getState().presenting) {
      const dragged = panDrag.current?.pointerId === e.pointerId;
      if (dragged) {
        panDrag.current = null;
        useSessionStore.getState().setPanning(false);
      }
      const s = presentTap.current;
      presentTap.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      if (!dragged && Math.abs(dx) > 40) {
        presentGo(dx < 0 ? 1 : -1); // swipe (a zoomed drag panned instead)
        return;
      }
      if (Date.now() - s.at > 500 || Math.hypot(dx, e.clientY - s.y) > 10) return;
      const dir = e.clientX < window.innerWidth / 3 ? -1 : 1; // tap
      presentTapTimer.current = setTimeout(() => {
        presentTapTimer.current = null;
        presentGo(dir);
      }, 280);
      return;
    }
    if (e.button === 1) noteMiddleButton(); // release fires the paste — keep suppressing
    if (e.pointerType === 'touch') {
      if (tap.current?.id === e.pointerId && !tap.current.onItem) {
        // A clean tap on empty canvas — clear the selection like a click
        // (including a selected connection, or its editor pill never closes).
        const session = useSessionStore.getState();
        if (session.selection.length > 0) session.setSelection([]);
        if (session.selectedConnectionId) session.setSelectedConnection(null);
        if (session.autoHideChrome) session.setChromeHidden(!session.chromeHidden);
      }
      tap.current = null;
      touches.current.delete(e.pointerId);
      if (pinch.current) return; // endPinch settles the rest
      if (touches.current.size === 0) {
        panDrag.current = null;
        useSessionStore.getState().setPanning(false);
      } else {
        // Resume a single-finger pan with whichever touch remains.
        const [id, pt] = [...touches.current.entries()][0]!;
        panDrag.current = { pointerId: id, lastX: pt.x, lastY: pt.y };
      }
      return;
    }
    const drag = panDrag.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    panDrag.current = null;
    useSessionStore.getState().setPanning(false);
  };

  // --- double-click empty canvas → add media (file picker) -----------------
  const onDoubleClick = (e: React.MouseEvent) => {
    if (useSessionStore.getState().presenting) {
      presentZoomToggle({ x: e.clientX, y: e.clientY }); // a closer look, or back out
      return;
    }
    if (canvasReadOnly()) {
      // The pan gesture captured the pointer, so the double-click lands on
      // the container, not the item under it: find that item and open it
      // for looking. (Nothing is added or edited on a locked canvas.)
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-item-id]');
      const id = el?.getAttribute('data-item-id');
      const item = id ? useDocumentStore.getState().doc.items[id] : undefined;
      if (item) viewItem(item);
      return;
    }
    if (VIEWER || isMobileViewport()) return; // view-only: nothing to add
    const { tool: activeTool, spaceHeld: space } = useSessionStore.getState();
    if (activeTool !== 'select' || space) return;
    if ((e.target as HTMLElement).closest('[data-item-id]')) return; // item dbl-clicks edit
    const iso = useSessionStore.getState().isolatedGroupId;
    if (iso) {
      // Double-click outside the group steps out one level (to the parent
      // group, or all the way out of a top-level one).
      useSessionStore
        .getState()
        .setIsolatedGroup(parentGroup(useDocumentStore.getState().doc, iso));
      useSessionStore.getState().clearSelection();
      return;
    }
    dropPoint.current = clientToCanvas(e.clientX, e.clientY);
    mediaInputRef.current?.click();
  };

  // --- right-click → context menu (canvas vs item) --------------------------
  const onContextMenu = (e: React.MouseEvent) => {
    // Inside a text editor the browser's own menu is the right one: it has
    // cut/copy/paste and spelling, which no custom menu can offer.
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    if (isMobileViewport()) return; // view-only on mobile (long-press)
    if (useSessionStore.getState().presenting) return;
    const session = useSessionStore.getState();
    const target = e.target as HTMLElement;
    const itemEl = target.closest<HTMLElement>('[data-item-id]');
    // Zoomed-out LOD: items are pixels on the overview raster — hit-test.
    const itemId =
      itemEl?.dataset.itemId ??
      (target.classList.contains('overview-canvas') ? overviewItemAt(e.clientX, e.clientY) : null);
    if (itemId && !session.selection.includes(itemId) && !canvasReadOnly()) {
      // Same group-aware selection as a left-click: a grouped item selects
      // its whole group (unless isolated), so group actions appear. LOCKED
      // items never select — their menu is the minimal Open/Unlock one — and
      // nothing selects while the canvas is locked (pan tool).
      const doc = useDocumentStore.getState().doc;
      const item = doc.items[itemId];
      if (!item?.locked) {
        session.setSelection(expandToGroups(doc, [itemId], session.isolatedGroupId));
      }
    }
    session.setContextMenu({ x: e.clientX, y: e.clientY, itemId });
  };

  // --- drag & drop: media files, board archives, and video URLs ----------
  // Handled at the window level so the whole canvas screen is a drop zone and
  // the browser never "opens" a dropped file (e.g. a PDF) — panels and embedded
  // iframes would otherwise swallow element-level drag events.
  useEffect(() => {
    const draggingPayload = (dt: DataTransfer | null) =>
      !!dt &&
      (dt.types.includes('Files') ||
        dt.types.includes('text/uri-list') ||
        dt.types.includes('text/plain'));

    const onDragOver = (e: DragEvent) => {
      if (!draggingPayload(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };

    const onWindowDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      // The offline viewer is read-only: never import dropped files.
      if (VIEWER) return;
      e.preventDefault();
      const point = clientToCanvas(e.clientX, e.clientY);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        void (async () => {
          const media: File[] = [];
          for (const file of files) {
            // Board archives open as boards; everything else is media import.
            if (!(await importBoardFromFile(file))) media.push(file);
          }
          if (media.length) await importMediaFiles(media, point);
        })();
        return;
      }
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const embed = url ? parseVideoUrl(url) : null;
      if (embed) createVideoEmbed(embed, point);
      else if (url) smartCreateFromText(url, point);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, []);

  const cursor = panning
    ? 'grabbing'
    : tool === 'pan' || spaceHeld
      ? 'grab'
      : isDrawTool(tool) || cropHeld
        ? 'crosshair'
        : 'default';

  return (
    <div
      ref={containerRef}
      className="canvas-viewport"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      // Middle button is pan-only: swallow its native action (X11
      // primary-selection paste / autoscroll) so it never pastes.
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      data-testid="canvas-viewport"
    >
      <CanvasBackgroundLayer />
      <div ref={gridRef} className="canvas-grid" aria-hidden />
      <div ref={worldRef} className="canvas-world" data-read-only={readOnly ? '' : undefined}>
        <GroupBackgroundsLayer />
        <ConnectionsLayer />
        <ItemsLayer containerRef={containerRef} />
        <PresentationBadges />
        <PendingImportsLayer />
        <PresenceLayer />
      </div>
      <SelectionOverlay />
      <DraftPreview />
      <PathEditOverlay />
      <IsolationBanner />
      <CanvasVideoControls />
      <AIGenerationStatus />
      <input
        ref={mediaInputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        data-testid="canvas-media-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void importMediaFiles(files, dropPoint.current);
        }}
      />
    </div>
  );
}

/** Top-center bar while a group is isolated: renameable label + explicit way
 * out. Shares the selection-action-bar's classes so the two read as one kit. */
function IsolationBanner() {
  const iso = useSessionStore((s) => s.isolatedGroupId);
  const name = useDocumentStore((s) => (iso ? s.doc.groups[iso]?.name : undefined));
  // The ancestors of a nested isolation, outermost first: a breadcrumb back
  // up. Selected as strings so the shallow compare holds between renders.
  const trailKeys = useDocumentStore(
    useShallow((s) =>
      iso
        ? groupChain(s.doc, iso)
            .slice(1)
            .reverse()
            .map((id) => `${id}\n${s.doc.groups[id]?.name ?? 'Group'}`)
        : [],
    ),
  );
  const trail = trailKeys.map((k) => {
    const [id, name] = k.split('\n') as [string, string];
    return { id, name };
  });
  if (!iso) return null;
  const exit = () => {
    const session = useSessionStore.getState();
    session.setIsolatedGroup(null);
    session.clearSelection();
  };
  const stepTo = (id: string) => {
    const session = useSessionStore.getState();
    session.setIsolatedGroup(id);
    session.clearSelection();
  };
  return (
    <div className="iso-banner" data-testid="iso-banner">
      <span className="iso-banner-label">Editing group</span>
      {trail.map((g) => (
        <span className="iso-crumb" key={g.id}>
          <button
            type="button"
            className="iso-crumb-btn"
            data-testid="iso-crumb"
            title="Back to this group"
            onClick={() => stepTo(g.id)}
          >
            {g.name}
          </button>
          <span className="iso-crumb-sep" aria-hidden>
            ›
          </span>
        </span>
      ))}
      <GroupNameLabel key={iso} groupId={iso} name={name} />
      <button type="button" className="sab-primary" data-testid="iso-exit" onClick={exit}>
        Done
      </button>
    </div>
  );
}
