import { useCallback, useState, type CSSProperties, type PointerEvent } from 'react';
import { isMobileViewport } from '../lib/mobile';
import { useMobileViewport } from './useMobileViewport';

/**
 * Drag geometry for the floating windows (Layers, Presentation). On desktop
 * the titlebar moves the window freely. On phones the window is pinned to a
 * full-width slot by CSS (`left/top !important`), so the same titlebar drag
 * lifts it up or down with a transform instead — the slot stays the resting
 * place, the offset keeps the whole window on screen.
 */
export function useFloatingWindow(width: number): {
  style: CSSProperties;
  onTitlePointerDown: (e: PointerEvent<HTMLElement>) => void;
} {
  const mobile = useMobileViewport();
  const [pos, setPos] = useState(() => ({
    x: Math.max(8, (typeof window !== 'undefined' ? window.innerWidth : 1200) - width - 16),
    y: 64,
  }));
  const [lift, setLift] = useState(0);

  const onTitlePointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      // The close button lives in the titlebar; a press on it is a click, not a drag.
      if ((e.target as HTMLElement).closest('button')) return;
      const phone = isMobileViewport();
      const win = e.currentTarget.parentElement;
      const rect = win?.getBoundingClientRect();
      const start = {
        mx: e.clientX,
        my: e.clientY,
        px: pos.x,
        py: pos.y,
        lift,
        top: rect?.top ?? 0,
        h: rect?.height ?? 0,
      };
      const bar = e.currentTarget;
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {
        /* older engines */
      }
      const onMove = (ev: globalThis.PointerEvent) => {
        if (phone) {
          const dy = ev.clientY - start.my;
          const minDy = 8 - start.top;
          const maxDy = window.innerHeight - 8 - (start.top + start.h);
          setLift(start.lift + Math.max(minDy, Math.min(maxDy, dy)));
        } else {
          setPos({
            x: Math.max(0, Math.min(window.innerWidth - 80, start.px + ev.clientX - start.mx)),
            y: Math.max(0, Math.min(window.innerHeight - 40, start.py + ev.clientY - start.my)),
          });
        }
      };
      const done = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', done);
        window.removeEventListener('pointercancel', done);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', done);
      window.addEventListener('pointercancel', done);
    },
    [pos, lift],
  );

  const style: CSSProperties = mobile
    ? { transform: lift ? `translateY(${lift}px)` : undefined }
    : { left: pos.x, top: pos.y };
  return { style, onTitlePointerDown };
}
