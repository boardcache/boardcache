import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageItem } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';
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

/** The picture on the stage: its URL and pixel size. */
interface Shown {
  url: string;
  width: number;
  height: number;
}

/** How long a zoom rests before its scale is baked into the layout. */
const SETTLE_MS = 150;

/**
 * Pan/zoom image viewer. Wheel zooms to the cursor, drag pans (only while
 * zoomed in), double-click toggles fit ↔ 2×, and a small control overlay +
 * the +/-/0 keys drive it too. Translation is clamped so the image can't be
 * dragged out of view. Remounted per item (keyed by id) so each starts fit.
 *
 * Sharpness: a CSS transform scales a raster the browser drew once at fit
 * size, so a zoomed-in picture is a stretched copy until the browser gets
 * round to redrawing it, and a 50-megapixel photo stays soft for seconds.
 * The transform carries the gesture; once the zoom rests, its scale moves
 * into the image's real width and height and the transform returns to 1,
 * which makes the browser draw the picture at true resolution. The original
 * is decoded off-screen before it is shown, so the first frame is sharp
 * too; while it decodes, the canvas rendition (when there is one) stands in
 * at the same geometry.
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

  // Decode the picture before it goes on the stage. The Image is kept while
  // the viewer is open so the browser's decoded copy stays warm.
  const [decoded, setDecoded] = useState<Shown | null>(null);
  const keep = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const im = new Image();
    im.src = url;
    im.decode()
      .catch(() => undefined)
      .then(() => {
        if (!alive) return;
        keep.current = im;
        setDecoded({ url, width: im.naturalWidth, height: im.naturalHeight });
      });
    return () => {
      alive = false;
    };
  }, [url]);
  useEffect(
    () => () => {
      keep.current = null;
    },
    [],
  );
  // The stand-in while the original decodes: the untouched rendition shown
  // on the canvas, placed at the original's size so the swap moves nothing.
  const edited = item.crop !== null || item.flipH || item.flipV;
  const standIn = useAssetUrl(!decoded && !edited ? (item.previewAssetId ?? null) : null);
  const shown: Shown | null =
    decoded ??
    (standIn ? { url: standIn, width: item.naturalWidth, height: item.naturalHeight } : null);

  // The stage's size, kept current (the chrome hiding gives the picture
  // more room; a window resize takes some away).
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit size in CSS pixels: contained in the stage, never enlarged past the
  // picture's own pixels. Null until the picture's size is known.
  const fit =
    shown && stage && shown.width > 0 && shown.height > 0
      ? (() => {
          const k = Math.min(1, stage.width / shown.width, stage.height / shown.height);
          return { width: shown.width * k, height: shown.height * k };
        })()
      : null;
  // Scale at which 1 image pixel == 1 CSS pixel (the "Actual size" target).
  // It's natural/fit, so 1 when the image already fits within the viewport.
  const actualScale = fit && shown ? shown.width / fit.width : 1;

  // The zoom baked into the layout size. It follows the gesture scale once
  // the zoom has rested; between the two, the transform makes up the rest.
  const [baked, setBaked] = useState(1);
  useEffect(() => {
    if (t.scale === baked) return;
    const id = window.setTimeout(() => setBaked(t.scale), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [t.scale, baked]);
  const layoutScale = fit ? baked : 1;

  // Clamp scale to range and translation so the image stays in view.
  const clamp = useCallback(
    (next: Transform): Transform => {
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.scale));
      const el = stageRef.current;
      const img = imgRef.current;
      if (!el || !img) return { scale, x: next.x, y: next.y };
      // Displayed size at `scale`: the fit size when known, else whatever
      // the browser laid out.
      const w = fit ? fit.width : img.offsetWidth;
      const h = fit ? fit.height : img.offsetHeight;
      const maxX = Math.max(0, (w * scale - el.clientWidth) / 2);
      const maxY = Math.max(0, (h * scale - el.clientHeight) / 2);
      return {
        scale,
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      };
    },
    [fit],
  );

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
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0017));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

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
  const goActual = () => setT(clamp({ scale: actualScale, x: 0, y: 0 }));

  const zoomed = t.scale > 1;
  const isFit = Math.abs(t.scale - 1) < 0.001 && t.x === 0 && t.y === 0;
  const isActual = Math.abs(t.scale - actualScale) < 0.01;

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
        {shown ? (
          <img
            ref={imgRef}
            className="lightbox-media"
            src={shown.url}
            alt={item.name ?? ''}
            draggable={false}
            style={{
              ...(fit
                ? {
                    width: fit.width * layoutScale,
                    height: fit.height * layoutScale,
                    maxWidth: 'none',
                    maxHeight: 'none',
                  }
                : {}),
              transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale / layoutScale})`,
              filter: filterCss(item.filters),
            }}
          />
        ) : (
          <div className="lightbox-loading">Loading</div>
        )}
      </div>
    </div>
  );
}
