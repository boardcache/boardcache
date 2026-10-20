import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageItem } from '@boardcache/schema';
import { useDisplayImageUrl } from '../../hooks/useDisplayImageUrl';
import { isMobileViewport } from '../../lib/mobile';
import { filterCss } from '../../lib/media/imageFilters';
import { createPortal } from 'react-dom';

const MIN_ZOOM = 1;
// Generous cap so "Actual size" works even for images much larger than the
// viewport (1:1 can need a big multiple of the fit scale).
const MAX_ZOOM = 16;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

/**
 * Pan/zoom image viewer. Wheel zooms to the cursor, drag pans (only while
 * zoomed in), double-click toggles fit ↔ 2×, and a small control overlay +
 * the +/-/0 keys drive it too. Translation is clamped so the image can't be
 * dragged out of view. Remounted per item (keyed by id) so each starts fit.
 */
export function ZoomableImage({
  item,
  controlsHost,
}: {
  item: ImageItem;
  controlsHost?: HTMLElement | null;
}) {
  const url = useDisplayImageUrl(item);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  // Scale at which 1 image pixel == 1 CSS pixel (the "Actual size" target).
  // It's natural/fit, so 1 when the image already fits within the viewport.
  const [actualScale, setActualScale] = useState(1);

  const measureActual = useCallback(() => {
    const img = imgRef.current;
    if (img && img.offsetWidth > 0 && img.naturalWidth > 0) {
      setActualScale(img.naturalWidth / img.offsetWidth);
    }
  }, []);

  useEffect(() => {
    measureActual();
    window.addEventListener('resize', measureActual);
    return () => window.removeEventListener('resize', measureActual);
  }, [measureActual, url]);

  // Clamp scale to range and translation so the image stays in view.
  const clamp = useCallback((next: Transform): Transform => {
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.scale));
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return { scale, x: next.x, y: next.y };
    const maxX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
    return {
      scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, []);

  // Zoom by `factor`, keeping the point under (clientX, clientY) fixed.
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const cx = clientX - (r.left + r.width / 2);
      const cy = clientY - (r.top + r.height / 2);
      setT((prev) => {
        const s2 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale * factor));
        const k = s2 / prev.scale;
        return clamp({ scale: s2, x: cx * (1 - k) + prev.x * k, y: cy * (1 - k) + prev.y * k });
      });
    },
    [clamp],
  );

  // Native wheel listener so we can preventDefault (passive listeners can't).
  // Depends on `url` so it (re)attaches once the stage element actually exists
  // — at first render the image is still loading and the stage isn't mounted.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0017));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomAt, url]);

  // Keyboard zoom (+/-/0); arrows stay item navigation in the Lightbox.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') {
        zoomAtCenter(1.25);
      } else if (e.key === '-' || e.key === '_') {
        zoomAtCenter(1 / 1.25);
      } else if (e.key === '0') {
        setT({ scale: 1, x: 0, y: 0 });
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    const zoomAtCenter = (factor: number) => {
      const r = stageRef.current?.getBoundingClientRect();
      if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [zoomAt]);

  // Touch: two fingers pinch-zoom around their midpoint; one finger pans a
  // zoomed image. A single finger at fit scale is left to bubble so the
  // Lightbox can treat it as a swipe between items.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()] as [
          { x: number; y: number },
          { x: number; y: number },
        ];
        pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
        drag.current = null;
        e.currentTarget.setPointerCapture(e.pointerId);
        // Deliberately NOT stopped: the stage must see the second finger so
        // it cancels its swipe tracking (else a pinch release would swipe).
      } else if (touches.current.size === 1 && t.scale > 1) {
        drag.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
        // Deliberately NOT stopped: the stage sees a pan start on a zoomed
        // image (it won't swipe or dismiss for it) so a clean tap can still
        // toggle the chrome.
      }
      return;
    }
    if (e.button !== 0 || t.scale <= 1) return;
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current !== null && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()] as [
          { x: number; y: number },
          { x: number; y: number },
        ];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.current > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinch.current);
        pinch.current = dist;
        return;
      }
    }
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setT((prev) => clamp({ scale: prev.scale, x: prev.x + dx, y: prev.y + dy }));
  };
  const endDrag = (e?: React.PointerEvent) => {
    if (e && e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
      // Resume a one-finger pan with whichever touch remains (zoomed only).
      const rest = [...touches.current.values()][0];
      drag.current = touches.current.size === 1 && t.scale > 1 && rest ? rest : null;
      return;
    }
    drag.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (t.scale > 1) setT({ scale: 1, x: 0, y: 0 });
    else zoomAt(e.clientX, e.clientY, 2);
  };

  const goFit = () => setT({ scale: 1, x: 0, y: 0 });
  const goActual = () => {
    const img = imgRef.current;
    const s = img && img.offsetWidth > 0 ? img.naturalWidth / img.offsetWidth : 1;
    setT(clamp({ scale: s, x: 0, y: 0 }));
  };

  const zoomed = t.scale > 1;
  const isFit = Math.abs(t.scale - 1) < 0.001 && t.x === 0 && t.y === 0;
  const isActual = Math.abs(t.scale - actualScale) < 0.01;
  if (!url) return <div className="lightbox-loading">Loading</div>;

  const controls = (
    <div
      className="lightbox-zoom-controls"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.25)}
        title="Zoom out (-)"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        className="lz-percent"
        onClick={() => setT({ scale: 1, x: 0, y: 0 })}
        title="Reset (0)"
        data-testid="lightbox-zoom-level"
      >
        {Math.round(t.scale * 100)}%
      </button>
      <button
        type="button"
        onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25)}
        title="Zoom in (+)"
        aria-label="Zoom in"
      >
        +
      </button>
      <span className="lz-sep" />
      <button
        type="button"
        className={`lz-text${isFit ? ' active' : ''}`}
        onClick={goFit}
        title="Fit to window"
        data-testid="lightbox-fit"
      >
        Fit
      </button>
      <button
        type="button"
        className={`lz-text${isActual ? ' active' : ''}`}
        onClick={goActual}
        title="Actual size (1:1)"
        data-testid="lightbox-actual"
      >
        Actual size
      </button>
    </div>
  );

  return (
    <div className="lightbox-zoom-wrap">
      {/* Slim-bar slot when the Lightbox provides one; on mobile the pill
          floats over the bottom of the image instead of crowding the bar. */}
      {controlsHost && !isMobileViewport() ? createPortal(controls, controlsHost) : controls}
      <div
        ref={stageRef}
        className={`lightbox-zoomable${zoomed ? ' zoomed' : ''}`}
        data-testid="lightbox-zoomable"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e)}
        onPointerCancel={(e) => endDrag(e)}
        onDoubleClick={onDoubleClick}
      >
        <img
          ref={imgRef}
          className="lightbox-media"
          src={url}
          alt={item.name ?? ''}
          draggable={false}
          onLoad={measureActual}
          style={{
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
            filter: filterCss(item.filters),
          }}
        />
      </div>
    </div>
  );
}
