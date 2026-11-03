import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** Pull distance that commits a refresh, and the farthest the row opens. */
export const PULL_THRESHOLD = 64;
const PULL_MAX = 96;
/** The spinner shows at least this long, so a fast check still registers. */
const MIN_SPIN_MS = 600;

/**
 * Pull-to-refresh on a touch scroller: a one-finger drag down from the top
 * opens a row (the caller renders it at `pull` px); releasing past the
 * threshold runs `onRefresh` and keeps the row open, spinning, until it
 * settles. Touch only: a mouse wheel at the top does nothing, and nothing
 * happens while `enabled` is false. The scroller's own overscroll bounce
 * must be off (CSS), or the native rubber band swallows the drag.
 */
export function usePullToRefresh(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onRefresh: () => Promise<unknown>,
): { pull: number; refreshing: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startY: number | null = null;
    let dist = 0;
    let busy = false;
    const start = (e: TouchEvent) => {
      startY = busy || el.scrollTop > 0 || e.touches.length !== 1 ? null : e.touches[0]!.clientY;
      dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      if (el.scrollTop > 0) {
        startY = null;
        dist = 0;
        setPull(0);
        return;
      }
      const dy = e.touches[0]!.clientY - startY;
      dist = dy > 0 ? Math.min(PULL_MAX, dy * 0.5) : 0;
      setPull(dist);
    };
    const end = () => {
      if (startY === null) return;
      startY = null;
      if (dist < PULL_THRESHOLD) {
        setPull(0);
        return;
      }
      busy = true;
      setRefreshing(true);
      setPull(PULL_THRESHOLD);
      const started = Date.now();
      Promise.resolve()
        .then(() => refresh.current())
        .catch(() => undefined)
        .then(() => {
          const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - started));
          setTimeout(() => {
            busy = false;
            setRefreshing(false);
            setPull(0);
          }, wait);
        });
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [ref, enabled]);

  return { pull, refreshing };
}
