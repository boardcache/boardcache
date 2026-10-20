import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { expandRect, rectsIntersect, visibleCanvasRect } from '../../lib/canvas/coords';
import { effectiveBounds } from '../../lib/canvas/gestures';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { activePageId, onPage } from '../../lib/board/pages';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { ItemView } from './ItemView';
import { OverviewLayer } from './OverviewLayer';
import { useLowDetail } from '../../lib/canvas/lod';

/** Overscan beyond the viewport, in screen pixels. */
const VIRTUALIZATION_MARGIN_PX = 300;

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Renders only the items whose (rotated, gesture-adjusted) bounds intersect
 * the viewport plus a margin. Recomputation is rAF-coalesced and only
 * triggers a React render when the visible id set actually changes — panning
 * across a quiet area re-renders nothing.
 */
export function ItemsLayer({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  // Far below 1:1 every item is in view at once — swap to the lite renderer.
  const lowDetail = useLowDetail();
  // Leaving low detail: keep the overview canvas painted on top while the
  // real items mount and their images decode, then fade it out — the swap
  // reads as a crossfade instead of a pop. Render-phase adjust on the
  // transition; a timer unmounts the ghost after the fade completes.
  const [prevLow, setPrevLow] = useState(lowDetail);
  const [exitFade, setExitFade] = useState(false);
  if (prevLow !== lowDetail) {
    setPrevLow(lowDetail);
    setExitFade(prevLow && !lowDetail);
  }
  useEffect(() => {
    if (!exitFade) return;
    const t = setTimeout(() => setExitFade(false), 480);
    return () => clearTimeout(t);
  }, [exitFade]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;

    const recompute = () => {
      raf = 0;
      // The overview canvas owns low-detail rendering — skip the per-frame
      // O(n) visibility sweep entirely while it's active.
      if (lowDetail) return;
      const { doc } = useDocumentStore.getState();
      const gesture = useSessionStore.getState().gesture;
      const view = expandRect(
        visibleCanvasRect(doc.viewport, container.clientWidth, container.clientHeight),
        VIRTUALIZATION_MARGIN_PX / doc.viewport.scale,
      );
      const ids: string[] = [];
      const page = activePageId(doc);
      for (const item of Object.values(doc.items)) {
        if (item.hidden) continue; // layers-panel eye: hidden = not rendered
        if (!onPage(doc, item, page)) continue; // pages partition (rule: pageItems)
        const bounds = effectiveBounds(item, gesture?.overrides[item.id]);
        if (rectsIntersect(view, rotatedRectAABB(bounds))) ids.push(item.id);
      }
      ids.sort(); // stable order: stacking comes from CSS z-index, not DOM order
      setVisibleIds((prev) => (sameIds(prev, ids) ? prev : ids));
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(recompute);
    };

    recompute();
    const unsubDoc = useDocumentStore.subscribe((s) => s.doc, schedule);
    const unsubGesture = useSessionStore.subscribe((s) => s.gesture, schedule);
    const unsubPage = useSessionStore.subscribe((s) => s.activePageId, schedule);
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(container);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      unsubDoc();
      unsubGesture();
      unsubPage();
      resizeObserver.disconnect();
    };
    // lowDetail is a dep so the settle-timer exit (no viewport change fires
    // the doc subscription) still recomputes visibility immediately.
  }, [containerRef, lowDetail]);

  return (
    <>
      {lowDetail ? (
        <OverviewLayer containerRef={containerRef} />
      ) : (
        <>
          {visibleIds.map((id) => (
            <ItemView key={id} id={id} />
          ))}
          {exitFade && <OverviewLayer containerRef={containerRef} fading />}
        </>
      )}
    </>
  );
}
