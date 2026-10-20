import { useEffect, useRef, useState } from 'react';
import type { ImageItem } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { PanoRenderer, type PanoState } from '../../lib/media/pano';
import { useSessionStore } from '../../state/sessionStore';
import { filterCss } from '../../lib/media/imageFilters';

/**
 * 360° panorama player: drag to look around, wheel/pinch-zoom to change
 * FOV. On the canvas it goes live when the item is SELECTED (unselected,
 * drags keep moving the item like any other); the lightbox stage is always
 * live. Frame size is free — the projection just follows the box.
 */
export function PanoView({ item, stage = false }: { item: ImageItem; stage?: boolean }) {
  // Full-resolution original: panoramas live on their detail.
  const url = useAssetUrl(item.assetId) ?? null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PanoRenderer | null>(null);
  const state = useRef<PanoState>({ yaw: 0, pitch: 0, fov: 75 });
  const [failed, setFailed] = useState(false);
  // Look-around only when the pano is the SOLE selection — as part of a
  // group/multi-selection, drags must move the selection like any item.
  const selected = useSessionStore((s) => s.selection.length === 1 && s.selection[0] === item.id);
  const interactive = stage || selected;
  // Color adjustments apply as a CSS filter over the WebGL frame — the live
  // slider preview wins over the stored value, same as flat images.
  const previewFilters = useSessionStore((s) =>
    s.filterPreview?.id === item.id ? s.filterPreview.filters : null,
  );
  const filter = filterCss(previewFilters ?? item.filters);

  // Auto-rotate: on by default, a slow drift until the user grabs the view.
  const autoRef = useRef(true);
  const [auto, setAuto] = useState(true);
  const rafRef = useRef(0);
  const paint = () => {
    rendererRef.current?.draw(state.current);
    // Exposed for tests (and cheap): the current heading in radians.
    if (canvasRef.current) canvasRef.current.dataset.yaw = state.current.yaw.toFixed(4);
  };
  const runAuto = () => {
    cancelAnimationFrame(rafRef.current);
    let last = performance.now();
    const tick = (now: number) => {
      if (!autoRef.current || !rendererRef.current) return;
      state.current.yaw += ((now - last) / 1000) * 0.15; // ~8.6°/s
      last = now;
      paint();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const stopAuto = () => {
    autoRef.current = false;
    setAuto(false);
    cancelAnimationFrame(rafRef.current);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return;
    let renderer: PanoRenderer;
    try {
      renderer = new PanoRenderer(canvas);
    } catch {
      // Deferred: a sync setState inside an effect cascades renders.
      queueMicrotask(() => setFailed(true));
      return;
    }
    rendererRef.current = renderer;
    let alive = true;
    const draw = () => renderer.draw(state.current);
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      draw();
    });
    ro.observe(canvas);
    void renderer
      .load(url)
      .then(() => {
        if (!alive) return;
        draw();
        if (autoRef.current) runAuto();
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runAuto reads only refs
  }, [url]);

  // Interactions attach only while live — otherwise pointer events fall
  // through to the item's normal move/select handling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive) return;
    const draw = () => rendererRef.current?.draw(state.current);
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      stopAuto();
      canvas.setPointerCapture(e.pointerId);
      let lastX = e.clientX;
      let lastY = e.clientY;
      const onMove = (ev: PointerEvent) => {
        const s = state.current;
        // Degrees-per-pixel scales with FOV so panning feels 1:1.
        const scale = (s.fov / canvas.clientHeight) * (Math.PI / 180);
        // Grab semantics: dragging right turns the view right (the scene
        // slides with your hand, like street-view).
        s.yaw += (ev.clientX - lastX) * scale;
        s.pitch += (ev.clientY - lastY) * scale;
        s.pitch = Math.max(-1.55, Math.min(1.55, s.pitch));
        lastX = ev.clientX;
        lastY = ev.clientY;
        paint();
      };
      const onUp = () => {
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
      };
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const s = state.current;
      s.fov = Math.max(28, Math.min(110, s.fov + e.deltaY * 0.05));
      draw();
    };
    // dblclick is left alone on purpose: it bubbles to the item and opens
    // the immersive lightbox stage.
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [interactive, url, failed]);

  if (failed || !url) {
    // No WebGL / asset still syncing: flat fallback keeps the item visible.
    return url ? (
      <img
        className="pano-fallback"
        src={url}
        alt={item.name ?? ''}
        draggable={false}
        style={{ filter }}
      />
    ) : (
      <div className="item-placeholder" />
    );
  }
  return (
    <div
      className={`pano-view${stage ? ' pano-stage' : ''}`}
      data-testid="pano-view"
      data-interactive={interactive ? '1' : '0'}
    >
      <canvas ref={canvasRef} className="pano-canvas" style={{ filter }} />
      <span className="pano-badge" aria-hidden>
        360°
      </span>
      <button
        type="button"
        className={`pano-auto${auto ? ' active' : ''}`}
        data-testid="pano-auto"
        aria-pressed={auto}
        title={auto ? 'Stop auto-rotate' : 'Auto-rotate'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (autoRef.current) stopAuto();
          else {
            autoRef.current = true;
            setAuto(true);
            runAuto();
          }
        }}
      >
        ⟳
      </button>
      {!interactive && !stage && <span className="pano-hint">Select to look around</span>}
    </div>
  );
}
