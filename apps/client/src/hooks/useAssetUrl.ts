import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  acquireAssetUrl,
  getAssetBlob,
  isAssetMissing,
  onAssetMissingChange,
  onAssetStored,
  peekAssetUrl,
  releaseAssetUrl,
  peekThumbUrl,
  thumbAssetUrl,
} from '../lib/board/assetStore';
import { OFFLINE_VIEWER, VIEWER, viewerAssetUrl } from '../lib/viewerMode';

/**
 * Resolve an assetId to a displayable object URL via the refcounted cache.
 * Returns null while loading or if the asset is missing.
 *
 * In the offline viewer, assets are local files referenced by relative path —
 * resolve those directly (no IndexedDB, no object URLs).
 */
export function useAssetUrl(assetId: string | null): string | null {
  const [state, setState] = useState<{ id: string | null; url: string | null }>(() => ({
    id: assetId,
    url: assetId ? (VIEWER ? viewerAssetUrl(assetId) : peekAssetUrl(assetId)) : null,
  }));

  // Render-phase adjust on id change: resolve synchronously from the URL
  // cache when possible; otherwise KEEP the previous image while the new one
  // loads — swapping an item's asset (e.g. Reset Bounding Box) must not
  // flash a blank frame.
  if (state.id !== assetId) {
    const sync = assetId ? (VIEWER ? viewerAssetUrl(assetId) : peekAssetUrl(assetId)) : null;
    setState({ id: assetId, url: sync ?? (assetId ? state.url : null) });
  }

  useEffect(() => {
    if (!assetId || VIEWER) return;
    let alive = true;
    let held = false; // a successful acquire holds one reference until unmount
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    // A miss is retried while the item stays mounted: a few times with
    // backoff (a severed IndexedDB connection comes back), whenever the tab
    // wakes, and the moment the asset is stored by a sync pull or a retry.
    const RETRY_MS = [1500, 6000, 20000];
    const look = () => {
      if (!alive || held) return;
      void acquireAssetUrl(assetId).then((resolved) => {
        if (!alive) {
          if (resolved) releaseAssetUrl(assetId);
          return;
        }
        if (resolved) {
          held = true;
          setState({ id: assetId, url: resolved });
          return;
        }
        setState({ id: assetId, url: null });
        const delay = RETRY_MS[attempt++];
        if (delay !== undefined) timer = setTimeout(look, delay);
      });
    };
    look();
    const offStored = onAssetStored((id) => {
      if (id === assetId) {
        attempt = 0;
        look();
      }
    });
    const onWake = () => {
      if (document.visibilityState === 'visible') {
        attempt = 0;
        look();
      }
    };
    document.addEventListener('visibilitychange', onWake);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      offStored();
      document.removeEventListener('visibilitychange', onWake);
      if (held) releaseAssetUrl(assetId);
    };
  }, [assetId]);

  return assetId ? state.url : null;
}

/** True once a lookup for the asset came up empty (the bytes are not on this
 *  device and could not be fetched). Cleared when the asset arrives. */
export function useAssetMissing(assetId: string | null): boolean {
  return useSyncExternalStore(onAssetMissingChange, () =>
    assetId ? isAssetMissing(assetId) : false,
  );
}

/**
 * Resolve an assetId to its TEXT content (for srcdoc-style inlining).
 * Sandboxed iframes have opaque origins and may not load blob: URLs
 * ("Not allowed to load local resource") — inlining sidesteps URLs entirely.
 */
export function useAssetText(assetId: string | null): string | null {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!assetId) {
      // Microtask so the effect body stays free of sync setState (lint rule).
      void Promise.resolve().then(() => {
        if (alive) setText(null);
      });
      return () => {
        alive = false;
      };
    }
    const load = VIEWER
      ? fetch(viewerAssetUrl(assetId) ?? '').then((r) => (r.ok ? r.text() : null))
      : getAssetBlob(assetId).then((b) => (b ? b.text() : null));
    void load
      .then((t) => {
        if (alive) setText(t);
      })
      .catch(() => {
        if (alive) setText(null);
      });
    return () => {
      alive = false;
      setText(null);
    };
  }, [assetId]);

  return assetId ? text : null;
}

/**
 * The small rendition of an asset while `wanted` (the item is far out on
 * screen), else null. Resolves from the cache at once when it has been made;
 * the caller shows the full rendition until then.
 */
export function useThumbUrl(assetId: string | null, wanted: boolean): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    assetId && wanted ? peekThumbUrl(assetId) : null,
  );
  useEffect(() => {
    if (!assetId || !wanted || OFFLINE_VIEWER) {
      queueMicrotask(() => setUrl(null));
      return;
    }
    const ready = peekThumbUrl(assetId);
    if (ready) {
      queueMicrotask(() => setUrl(ready));
      return;
    }
    let alive = true;
    const source = VIEWER
      ? async () => {
          const src = viewerAssetUrl(assetId);
          if (!src) return null;
          const res = await fetch(src);
          return res.ok ? res.blob() : null;
        }
      : undefined;
    void thumbAssetUrl(assetId, source).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [assetId, wanted]);
  return wanted ? url : null;
}
