import type { Item } from '@boardcache/schema';
import { renderItemCanvas } from '../media/thumbnail';
import { onAssetStored, requestAsset } from '../board/assetStore';
import { useEffect, useState } from 'react';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Zoom-out level-of-detail. Far below 1:1, per-item DOM is the bottleneck
 * itself (a thousand composited nodes re-rastering while the layer pans), so
 * the items layer swaps to ONE screen-space canvas that draws small cached
 * rasters of every item — rendered through the same pipeline as board
 * thumbnails so every type looks right. Sprites build lazily with bounded
 * concurrency; items draw as soft placeholders until theirs is ready.
 *
 * A sprite painted without an asset's bytes (a picture still being pulled
 * from the server, a database read that failed) is provisional: the asset
 * is requested, the sprite is rebuilt when it arrives and retried on a
 * short backoff meanwhile. A render that threw is retried the same way. Left
 * alone, either would be a grey box for the rest of the session.
 *
 * Known tradeoff (consistent with virtualization's existing semantics, where
 * panning far away unmounts a playing audio element): entering deep zoom-out
 * unmounts live media; playbackMemory resumes positions on the way back.
 */

/** Hysteresis: enter low-detail at ≤ the user threshold (default 15%),
 *  leave at ≥ 1.2× it. The threshold is a setting (Settings → Canvas). */
const lodEnter = (): number => useSessionStore.getState().lodThreshold;
const lodExit = (): number => lodEnter() * 1.2;
/** Past this the sprites are visibly soft — exit immediately, mid-gesture or not. */
const LOD_EXIT_HARD = 0.45;
/** Exit debounce: wait for the zoom gesture to settle before the big remount. */
const LOD_EXIT_SETTLE_MS = 140;
/** Sprite raster size (longest edge, px). Plenty at ≤25% zoom. */
const SPRITE_LONGEST = 320;
const MAX_SPRITES = 1500;
const CONCURRENCY = 3;
/** Backoff for a provisional or failed sprite, after the arrival signal. */
const RETRY_MS = [1500, 6000, 20000];

// --- low-detail flag (one shared viewport subscription) ----------------------

let lodActive = false;
const lodListeners = new Set<(active: boolean) => void>();

export function initLod(): void {
  lodActive = useDocumentStore.getState().doc.viewport.scale <= lodEnter();
  // An asset arriving (a sync pull, a room fetch, a retry) repaints every
  // sprite that stood in for it.
  onAssetStored((assetId) => {
    for (const entry of sprites.values()) {
      if (!entry.missing.includes(assetId)) continue;
      entry.attempts = 0;
      clearRetry(entry);
      rebuild(entry);
    }
  });
  let exitTimer: ReturnType<typeof setTimeout> | null = null;
  const clearExit = () => {
    if (exitTimer !== null) {
      clearTimeout(exitTimer);
      exitTimer = null;
    }
  };
  const setActive = (next: boolean) => {
    lodActive = next;
    lodListeners.forEach((l) => l(next));
  };
  // Changing the setting re-evaluates immediately at the current zoom.
  useSessionStore.subscribe(
    (s) => s.lodThreshold,
    () => {
      const scale = useDocumentStore.getState().doc.viewport.scale;
      clearExit();
      const next = lodActive ? scale < lodExit() : scale <= lodEnter();
      if (next !== lodActive) setActive(next);
    },
  );
  useDocumentStore.subscribe(
    (s) => s.doc.viewport.scale,
    (scale) => {
      if (!lodActive) {
        if (scale <= lodEnter()) setActive(true);
        return;
      }
      if (scale < lodExit()) {
        clearExit(); // dipped back under the threshold — stay in low detail
        return;
      }
      // Leaving low detail remounts every visible item in one commit — doing
      // that mid-gesture hitches the zoom. Debounce until the scale stops
      // changing, unless we're so far past the threshold sprites look soft.
      if (scale >= LOD_EXIT_HARD) {
        clearExit();
        setActive(false);
        return;
      }
      clearExit();
      exitTimer = setTimeout(() => {
        exitTimer = null;
        const s = useDocumentStore.getState().doc.viewport.scale;
        if (lodActive && s >= lodExit()) setActive(false);
      }, LOD_EXIT_SETTLE_MS);
    },
  );
}

export function useLowDetail(): boolean {
  const [low, setLow] = useState(lodActive);
  useEffect(() => {
    lodListeners.add(setLow);
    if (lodActive !== low) queueMicrotask(() => setLow(lodActive));
    return () => {
      lodListeners.delete(setLow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only resync
  }, []);
  return low;
}

// --- sprite bitmap cache -----------------------------------------------------

interface SpriteEntry {
  key: string;
  /** The item as last drawn: what a retry renders. */
  item: Item;
  bitmap: ImageBitmap | null;
  rendering: boolean;
  /** Assets the painter had no bytes for: the sprite is provisional. */
  missing: string[];
  /** The render threw; the placeholder stands until a retry succeeds. */
  failed: boolean;
  attempts: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

const sprites = new Map<string, SpriteEntry>();
const lru: string[] = [];
const readyListeners = new Set<() => void>();
let inFlight = 0;
let built = 0;
const queue: Item[] = [];

function spriteKey(item: Item): string {
  // Content key by value; theme-dependent card styling keys per theme.
  return `${document.documentElement.dataset.theme ?? 'light'}|${JSON.stringify(item)}`;
}

function dispose(entry: SpriteEntry): void {
  clearRetry(entry);
  entry.bitmap?.close();
}

function touch(id: string): void {
  const i = lru.indexOf(id);
  if (i !== -1) lru.splice(i, 1);
  lru.push(id);
  while (lru.length > MAX_SPRITES) {
    const evict = lru.shift()!;
    const entry = sprites.get(evict);
    if (entry) dispose(entry);
    sprites.delete(evict);
  }
}

function clearRetry(entry: SpriteEntry): void {
  if (entry.retryTimer !== null) {
    clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
  }
}

/** Render the entry's item again (its key is unchanged). */
function rebuild(entry: SpriteEntry): void {
  if (entry.rendering) return;
  entry.rendering = true;
  queue.push(entry.item);
  pump();
}

/** One more try later, while the backoff lasts. */
function scheduleRetry(entry: SpriteEntry): void {
  if (entry.retryTimer !== null) return;
  const delay = RETRY_MS[entry.attempts];
  if (delay === undefined) return;
  entry.attempts++;
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    if (sprites.get(entry.item.id) === entry) rebuild(entry);
  }, delay);
}

function pump(): void {
  while (inFlight < CONCURRENCY && queue.length > 0) {
    const item = queue.shift()!;
    const entry = sprites.get(item.id);
    if (!entry || !entry.rendering) continue;
    inFlight++;
    void (async () => {
      const missing: string[] = [];
      try {
        const scale = Math.min(1, SPRITE_LONGEST / Math.max(1, item.width, item.height));
        const canvas = await renderItemCanvas(item, scale, false, {
          onMissing: (id) => missing.push(id),
        });
        const bitmap = await createImageBitmap(canvas);
        const current = sprites.get(item.id);
        if (current && current.key === entry.key) {
          current.bitmap?.close();
          current.bitmap = bitmap;
          current.rendering = false;
          current.failed = false;
          current.missing = [...new Set(missing)];
          if (current.missing.length > 0) {
            for (const id of current.missing) void requestAsset(id);
            scheduleRetry(current);
          } else {
            current.attempts = 0;
          }
          built++;
          readyListeners.forEach((l) => l());
        } else {
          bitmap.close();
        }
      } catch {
        const current = sprites.get(item.id);
        if (current && current.key === entry.key) {
          current.rendering = false;
          current.failed = true; // placeholder stays until a retry succeeds
          scheduleRetry(current);
        }
      } finally {
        inFlight--;
        pump();
      }
    })();
  }
}

/** Current sprite (possibly stale-but-close while a fresh one renders). */
export function getSpriteBitmap(item: Item): ImageBitmap | null {
  const key = spriteKey(item);
  const entry = sprites.get(item.id);
  touch(item.id);
  if (entry && entry.key === key) return entry.bitmap;
  if (entry) clearRetry(entry);
  sprites.set(item.id, {
    key,
    item,
    bitmap: entry?.bitmap ?? null,
    rendering: true,
    missing: [],
    failed: false,
    attempts: 0,
    retryTimer: null,
  });
  queue.push(item);
  pump();
  return entry?.bitmap ?? null;
}

/**
 * Drop every sprite: the overview repaints with placeholders and builds
 * them all again (View → Rebuild Low-Detail Previews). For whatever the
 * arrival signal and the retries did not catch.
 */
export function invalidateSprites(): void {
  for (const entry of sprites.values()) dispose(entry);
  sprites.clear();
  lru.length = 0;
  queue.length = 0;
  readyListeners.forEach((l) => l());
}

/** Fires whenever any sprite finishes — the overview redraws on it. */
export function onSpriteReady(cb: () => void): () => void {
  readyListeners.add(cb);
  return () => {
    readyListeners.delete(cb);
  };
}

/** Perf-probe stats (e2e waits on sprite builds). `provisional` counts
 *  sprites painted without an asset or whose render failed. */
export function lodStats(): {
  built: number;
  cached: number;
  pending: number;
  provisional: number;
} {
  let provisional = 0;
  for (const e of sprites.values()) if (e.missing.length > 0 || e.failed) provisional++;
  return { built, cached: sprites.size, pending: queue.length + inFlight, provisional };
}
