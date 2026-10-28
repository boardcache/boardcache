import { decryptLockedAsset, encryptAssetForBoard, getSessionLock } from './boardLock';
import { getDb } from '../db';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Content-addressed asset store (rule 3.3). Blobs are keyed by SHA-256 hash;
 * items reference `assetId`. Duplicate imports of the same bytes store one
 * blob. This module is the ONLY owner of the assetId → objectURL cache —
 * nothing else in the app may call URL.createObjectURL.
 */

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Store a blob (no-op if the hash already exists) and return its assetId.
 *  Assets imported into an open locked board are stored encrypted — the hash
 *  stays that of the PLAINTEXT so content addressing is unaffected. */
export async function putAsset(blob: Blob): Promise<string> {
  const hash = await sha256Hex(blob);
  const db = await getDb();
  const existing = await db.getKey('assets', hash);
  if (existing === undefined) {
    const boardId = useDocumentStore.getState().doc.id;
    const cipher = getSessionLock(boardId) ? await encryptAssetForBoard(boardId, blob) : null;
    if (cipher) {
      await db.put('assets', {
        hash,
        blob: cipher,
        mime: 'application/octet-stream',
        bytes: blob.size,
        lock: { boardId },
      });
    } else {
      await db.put('assets', { hash, blob, mime: blob.type, bytes: blob.size });
    }
  }
  notifyAssetStored(hash);
  return hash;
}

export async function getAssetBlob(assetId: string): Promise<Blob | undefined> {
  const db = await getDb();
  const record = await db.get('assets', assetId);
  if (!record) return undefined;
  if (record.lock) return decryptLockedAsset(record.lock.boardId, record.blob);
  return record.blob;
}

/** Raw stored record (locked assets stay ciphertext) — sync transport only. */
export async function getRawAssetRecord(
  assetId: string,
): Promise<{ blob: Blob; mime: string; bytes: number; lock?: { boardId: string } } | null> {
  const db = await getDb();
  const record = await db.get('assets', assetId);
  if (!record) return null;
  return {
    blob: record.blob,
    mime: record.mime,
    bytes: record.bytes,
    ...(record.lock ? { lock: record.lock } : {}),
  };
}

/** Store a lock-encrypted asset pulled from sync under its DECLARED hash.
 *  Integrity comes from the transport's AES-GCM (and the lock's own GCM on
 *  unlock) — the plaintext hash can't be checked without the password. */
export async function putLockedAssetRecord(
  hash: string,
  blob: Blob,
  boardId: string,
): Promise<void> {
  const db = await getDb();
  if (await db.getKey('assets', hash)) return; // immutable — already present
  await db.put('assets', {
    hash,
    blob,
    mime: 'application/octet-stream',
    bytes: blob.size,
    lock: { boardId },
  });
  notifyAssetStored(hash);
}

export async function hasAsset(assetId: string): Promise<boolean> {
  const db = await getDb();
  return (await db.getKey('assets', assetId)) !== undefined;
}

/** Total stored bytes of the given assets (deduped; missing assets count 0). */
export async function assetTotalBytes(ids: readonly string[]): Promise<number> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;
  const db = await getDb();
  const tx = db.transaction('assets', 'readonly');
  let total = 0;
  await Promise.all(
    unique.map(async (id) => {
      const record = await tx.store.get(id);
      if (record) total += record.bytes;
    }),
  );
  await tx.done;
  return total;
}

/** Remove a blob from the local store (e.g. after it's synced from another device). */
export async function deleteAsset(assetId: string): Promise<void> {
  const db = await getDb();
  await db.delete('assets', assetId);
}

// --- objectURL cache with reference counting -------------------------------

interface CacheEntry {
  refCount: number;
  url: string | null; // null while loading
  promise: Promise<string | null>;
  /** Pending revocation after the last release (see releaseAssetUrl). */
  revokeTimer: ReturnType<typeof setTimeout> | null;
}

/** How long a URL outlives its last holder. Renderers peek the cache during
 *  render and only take their reference in an effect, so a URL released and
 *  re-acquired within one commit (an item scrolling out of view while a
 *  twin scrolls in, a lightbox opening on a canvas image) must stay valid. */
const REVOKE_GRACE_MS = 2000;

const urlCache = new Map<string, CacheEntry>();

/**
 * Optional fallback for assets missing locally — a live team-board session
 * installs a fetcher that pulls the bytes from the room's shared store (and
 * caches them in IndexedDB). Null outside collaboration.
 */
let assetMissHandler: ((assetId: string) => Promise<Blob | null>) | null = null;
export function setAssetMissHandler(fn: ((assetId: string) => Promise<Blob | null>) | null): void {
  assetMissHandler = fn;
}

/** The fallback fetcher outside a collab session — sync installs one that
 *  pulls a missing asset from the account's server on demand. */
let defaultMissHandler: ((assetId: string) => Promise<Blob | null>) | null = null;
export function setDefaultAssetMissHandler(
  fn: ((assetId: string) => Promise<Blob | null>) | null,
): void {
  defaultMissHandler = fn;
}

// --- arrival / miss signals ----------------------------------------------
// Renderers that came up empty listen for the asset arriving later (a sync
// pull, a room fetch, a retry) instead of staying blank for the session.

const storedListeners = new Set<(assetId: string) => void>();
const missingIds = new Set<string>();
const missingListeners = new Set<() => void>();

export function onAssetStored(fn: (assetId: string) => void): () => void {
  storedListeners.add(fn);
  return () => storedListeners.delete(fn);
}
export function notifyAssetStored(assetId: string): void {
  if (missingIds.delete(assetId)) for (const fn of missingListeners) fn();
  for (const fn of storedListeners) fn(assetId);
}
/** True once a lookup for this id resolved to nothing (cleared when it arrives). */
export function isAssetMissing(assetId: string): boolean {
  return missingIds.has(assetId);
}
export function onAssetMissingChange(fn: () => void): () => void {
  missingListeners.add(fn);
  return () => missingListeners.delete(fn);
}
function markMissing(assetId: string): void {
  if (!missingIds.has(assetId)) {
    missingIds.add(assetId);
    for (const fn of missingListeners) fn();
  }
}
/** Forget a miss and ask holders to look again (the Retry button). */
export function retryAsset(assetId: string): void {
  missingIds.delete(assetId);
  for (const fn of missingListeners) fn();
  for (const fn of storedListeners) fn(assetId);
}

/**
 * Acquire an object URL for an asset. Every acquire must be paired with a
 * release; the URL is revoked when the last reference is released.
 * Resolves null if the asset is missing.
 */
export function acquireAssetUrl(assetId: string): Promise<string | null> {
  const entry = urlCache.get(assetId);
  if (entry) {
    entry.refCount += 1;
    if (entry.revokeTimer) {
      clearTimeout(entry.revokeTimer);
      entry.revokeTimer = null;
    }
    return entry.promise;
  }
  const fresh: CacheEntry = {
    refCount: 1,
    url: null,
    revokeTimer: null,
    promise: getAssetBlob(assetId)
      .then(async (blob) => {
        if (blob) return blob;
        // Not local — a collab room or the sync server may have it.
        const fetcher = assetMissHandler ?? defaultMissHandler;
        return fetcher ? await fetcher(assetId) : undefined;
      })
      .catch(() => undefined) // a severed IndexedDB connection reads as "not here right now"
      .then((blob) => {
        const current = urlCache.get(assetId);
        // Released (or replaced) while loading — don't leak a URL.
        if (!current || current !== fresh) return null;
        if (!blob) {
          // A miss is never remembered: drop the entry so the next acquire
          // looks again, and tell renderers so they can say so.
          urlCache.delete(assetId);
          markMissing(assetId);
          return null;
        }
        missingIds.delete(assetId);
        fresh.url = URL.createObjectURL(blob);
        return fresh.url;
      }),
  };
  urlCache.set(assetId, fresh);
  return fresh.promise;
}

/** Synchronous cache read: the resolved URL if some holder already acquired
 *  it, else null. Does NOT take a reference — pair with acquire for that. */
export function peekAssetUrl(assetId: string): string | null {
  return urlCache.get(assetId)?.url ?? null;
}

export function releaseAssetUrl(assetId: string): void {
  const entry = urlCache.get(assetId);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0 || entry.revokeTimer) return;
  entry.revokeTimer = setTimeout(() => {
    if (urlCache.get(assetId) !== entry || entry.refCount > 0) return;
    if (entry.url) URL.revokeObjectURL(entry.url);
    urlCache.delete(assetId);
  }, REVOKE_GRACE_MS);
}

/** Test/debug hook: number of live cached URLs. */
export function assetUrlCacheSize(): number {
  return urlCache.size;
}

// --- small renditions -----------------------------------------------------
// Far out, an image item is a few hundred device pixels wide while its
// display rendition is up to 2048px: fifty of them decoded at full size is
// what runs a phone out of memory. A 512px copy is made once per asset
// (never revoked: a handful of kilobytes each) and shown while the item is
// small on screen.

export const THUMB_PX = 512;
const thumbs = new Map<string, Promise<string | null>>();
const thumbReady = new Map<string, string>();

async function shrink(blob: Blob): Promise<Blob | null> {
  if (!/^image\/(png|jpeg|webp|avif|heic|bmp)$/.test(blob.type)) return null; // SVG, GIF: as is
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= THUMB_PX) {
    bitmap.close();
    return null; // already small
  }
  const k = THUMB_PX / longest;
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', 0.82));
}

/** A 512px rendition's URL (null when the asset is small, vector, animated
 *  or missing). `source` fetches the bytes: the local store, or a URL in
 *  the hosted viewer. */
export function thumbAssetUrl(
  assetId: string,
  source: () => Promise<Blob | null> = () => getAssetBlob(assetId).then((b) => b ?? null),
): Promise<string | null> {
  let p = thumbs.get(assetId);
  if (!p) {
    p = source()
      .then((blob) => (blob ? shrink(blob) : null))
      .then((small) => {
        if (!small) return null;
        const url = URL.createObjectURL(small);
        thumbReady.set(assetId, url);
        return url;
      })
      .catch(() => null);
    thumbs.set(assetId, p);
  }
  return p;
}

/** Synchronous read of a rendition already made. */
export function peekThumbUrl(assetId: string): string | null {
  return thumbReady.get(assetId) ?? null;
}
