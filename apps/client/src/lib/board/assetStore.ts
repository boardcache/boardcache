import { decryptBytes, unpackAsset } from '@boardcache/e2ee';
import {
  assetIdsUsedElsewhere,
  decryptLockedAsset,
  encryptAssetForBoard,
  getSessionLock,
} from './boardLock';
import { queueReplacement } from './assetReplaceQueue';
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

/**
 * Store a blob and return its assetId. `board` is the board the bytes are
 * imported into (default: the open one); bytes imported into an unlocked
 * locked board are stored under its lock — the hash stays that of the
 * PLAINTEXT so content addressing is unaffected. `board: null` is for bytes
 * that belong to no particular board (a file being imported as a new board):
 * they are stored as they are, whatever board happens to be open.
 *
 * An existing record is left alone — the content is the id — with one
 * exception: a record held under a board lock that is now imported into an
 * unlocked board is shared, and a shared asset is stored plain (the rule
 * locking applies: a lock covers only the board's exclusive media). The
 * server copy is queued for the same change.
 */
export async function putAsset(
  blob: Blob,
  { board = useDocumentStore.getState().doc.id }: { board?: string | null } = {},
): Promise<string> {
  const hash = await sha256Hex(blob);
  const db = await getDb();
  const existing = await db.get('assets', hash);
  const cipher = board && getSessionLock(board) ? await encryptAssetForBoard(board, blob) : null;
  if (existing === undefined) {
    if (cipher && board) {
      await db.put('assets', {
        hash,
        blob: cipher,
        mime: 'application/octet-stream',
        bytes: blob.size,
        lock: { boardId: board },
      });
    } else {
      await db.put('assets', { hash, blob, mime: blob.type, bytes: blob.size });
    }
  } else if (existing.lock && !cipher) {
    await db.put('assets', { hash, blob, mime: blob.type, bytes: blob.size });
    await queueReplacement([hash]);
  }
  notifyAssetStored(hash);
  return hash;
}

/** Store bytes that arrived from the account's server or a team room, in the
 *  form they came: plain. A record held under a board lock here gives way —
 *  the server's copy is the shared form, already written as such. */
export async function putPulledAsset(blob: Blob): Promise<string> {
  const hash = await sha256Hex(blob);
  const db = await getDb();
  const existing = await db.get('assets', hash);
  if (existing === undefined || existing.lock) {
    await db.put('assets', { hash, blob, mime: blob.type, bytes: blob.size });
  }
  notifyAssetStored(hash);
  return hash;
}

/**
 * A board was just unlocked: any asset held under its lock that an unlocked
 * board also uses is shared, so it is stored plain from here on — locally
 * now, and on the server by the next push. (Such records come from earlier
 * builds, which stored every byte arriving while a locked board was open
 * under that board's key.) Returns the hashes repaired.
 */
export async function repairSharedLockedAssets(boardId: string): Promise<string[]> {
  const session = getSessionLock(boardId);
  if (!session) return [];
  const db = await getDb();
  const shared = await assetIdsUsedElsewhere(boardId);
  if (shared.size === 0) return [];
  const repaired: string[] = [];
  for (const hash of shared) {
    const record = await db.get('assets', hash);
    if (!record?.lock || record.lock.boardId !== boardId) continue;
    try {
      const packed = await decryptBytes(
        session.key,
        new Uint8Array(await record.blob.arrayBuffer()),
      );
      const { mime, bytes } = unpackAsset(packed);
      const blob = new Blob([bytes as BlobPart], { type: mime });
      if ((await sha256Hex(blob)) !== hash) continue;
      await db.put('assets', { hash, blob, mime, bytes: blob.size });
      repaired.push(hash);
    } catch {
      /* not this board's after all — leave it */
    }
  }
  if (repaired.length > 0) {
    await queueReplacement(repaired);
    for (const hash of repaired) notifyAssetStored(hash);
  }
  return repaired;
}

export async function getAssetBlob(assetId: string): Promise<Blob | undefined> {
  const db = await getDb();
  const record = await db.get('assets', assetId);
  if (!record) return undefined;
  if (record.lock) return openLockedRecord(assetId, record.lock.boardId, record.blob);
  return record.blob;
}

// Assets opened with a board lock's key, by the board whose key it was. When
// that key is forgotten, their decrypted renditions go with it.
const openedBy = new Map<string, string>();
async function openLockedRecord(
  assetId: string,
  ownerBoardId: string,
  cipher: Blob,
): Promise<Blob | undefined> {
  const blob = await decryptLockedAsset(ownerBoardId, cipher);
  if (blob) openedBy.set(assetId, ownerBoardId);
  return blob;
}

/** A board's key was forgotten: drop every in-memory rendition it opened, so
 *  the next look needs the key again. A URL still held by a renderer stays
 *  valid until released (the renderer goes with the board). */
export function forgetUnlockedMedia(boardId: string): void {
  for (const [assetId, owner] of [...openedBy]) {
    if (owner !== boardId) continue;
    openedBy.delete(assetId);
    forgetRenditions(assetId);
  }
}
function forgetRenditions(assetId: string): void {
  const ready = thumbReady.get(assetId);
  if (ready) URL.revokeObjectURL(ready);
  thumbReady.delete(assetId);
  thumbs.delete(assetId);
  const entry = urlCache.get(assetId);
  if (!entry) return;
  if (entry.refCount > 0) {
    entry.expired = true; // its holders are on the closing board; see releaseAssetUrl
    return;
  }
  if (entry.revokeTimer) clearTimeout(entry.revokeTimer);
  if (entry.url) URL.revokeObjectURL(entry.url);
  urlCache.delete(assetId);
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
  { replace = false } = {},
): Promise<void> {
  const db = await getDb();
  if (!replace && (await db.getKey('assets', hash))) return; // immutable — already present
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
  /** The key that opened it was forgotten while holders remain: revoke the
   *  moment the last one lets go, with no grace for a re-acquire. */
  expired: boolean;
}

/** How long a URL outlives its last holder. Renderers peek the cache during
 *  render and only take their reference in an effect, so a URL released and
 *  re-acquired within one commit (an item scrolling out of view while a
 *  twin scrolls in, a lightbox opening on a canvas image) must stay valid. */
const REVOKE_GRACE_MS = 2000;

const urlCache = new Map<string, CacheEntry>();

/**
 * A fallback fetcher for an asset this device cannot show. `overLocked` is
 * set when a record IS here but held under a board lock with no key: the
 * fetcher should then take the server's copy only if that copy opens
 * without the lock, and store it over the record.
 */
export type AssetFetcher = (assetId: string, opts: { overLocked: boolean }) => Promise<Blob | null>;

/**
 * Optional fallback for assets missing locally — a live team-board session
 * installs a fetcher that pulls the bytes from the room's shared store (and
 * caches them in IndexedDB). Null outside collaboration.
 */
let assetMissHandler: AssetFetcher | null = null;
export function setAssetMissHandler(fn: AssetFetcher | null): void {
  assetMissHandler = fn;
}

/** The fallback fetcher outside a collab session — sync installs one that
 *  pulls a missing asset from the account's server on demand. */
let defaultMissHandler: AssetFetcher | null = null;
export function setDefaultAssetMissHandler(fn: AssetFetcher | null): void {
  defaultMissHandler = fn;
}

// --- arrival / miss signals ----------------------------------------------
// Renderers that came up empty listen for the asset arriving later (a sync
// pull, a room fetch, a retry) instead of staying blank for the session.

/**
 * Why an asset cannot be shown. `absent`: the bytes are not on this device
 * and no source could fetch them. `locked`: the bytes are here, encrypted
 * with the password of a board (the owner) that is not open. `unreadable`:
 * a record is here but could not be read or decoded.
 */
export type AssetMiss =
  | { reason: 'absent' }
  | { reason: 'locked'; owner: { boardId: string; name: string | null; local: boolean } }
  | { reason: 'unreadable' };

const storedListeners = new Set<(assetId: string) => void>();
const misses = new Map<string, AssetMiss>();
const missingListeners = new Set<() => void>();

export function onAssetStored(fn: (assetId: string) => void): () => void {
  storedListeners.add(fn);
  return () => storedListeners.delete(fn);
}
export function notifyAssetStored(assetId: string): void {
  clearMiss(assetId);
  for (const fn of storedListeners) fn(assetId);
}
/** Why the last lookup for this id came up empty; null once it arrives. */
export function assetMiss(assetId: string): AssetMiss | null {
  return misses.get(assetId) ?? null;
}
export function onAssetMissingChange(fn: () => void): () => void {
  missingListeners.add(fn);
  return () => missingListeners.delete(fn);
}
function sameMiss(a: AssetMiss, b: AssetMiss): boolean {
  if (a.reason !== b.reason) return false;
  if (a.reason !== 'locked' || b.reason !== 'locked') return true;
  return (
    a.owner.boardId === b.owner.boardId &&
    a.owner.name === b.owner.name &&
    a.owner.local === b.owner.local
  );
}
function markMissing(assetId: string, miss: AssetMiss): void {
  const prev = misses.get(assetId);
  if (prev && sameMiss(prev, miss)) return;
  misses.set(assetId, miss);
  for (const fn of missingListeners) fn();
}
function clearMiss(assetId: string): void {
  if (misses.delete(assetId)) for (const fn of missingListeners) fn();
}

/** Who holds the key to a locked record: the owning board, if it is here. */
async function lockOwner(boardId: string): Promise<{
  boardId: string;
  name: string | null;
  local: boolean;
}> {
  try {
    const record = await (await getDb()).get('boards', boardId);
    return { boardId, name: record?.name ?? null, local: Boolean(record?.lock) };
  } catch {
    return { boardId, name: null, local: false };
  }
}

/** The asset from this device: its bytes, or why they cannot be shown. */
async function readAsset(assetId: string): Promise<Blob | AssetMiss> {
  const read = await getDb()
    .then((db) => db.get('assets', assetId))
    .then(
      (record) => ({ record }),
      () => null, // a severed IndexedDB connection: not readable right now
    );
  if (!read) return { reason: 'unreadable' };
  const { record } = read;
  if (!record) return { reason: 'absent' };
  if (!record.lock) return record.blob instanceof Blob ? record.blob : { reason: 'unreadable' };
  try {
    const blob = await openLockedRecord(assetId, record.lock.boardId, record.blob);
    if (blob) return blob;
  } catch {
    return { reason: 'unreadable' };
  }
  return { reason: 'locked', owner: await lockOwner(record.lock.boardId) };
}

// Locked records the server was already asked about this session (its copy
// was locked too): asked again only on an explicit Retry.
const serverAsked = new Set<string>();

/**
 * The asset from this device or, failing that, from the fallback fetchers
 * (a room's shared store, the account's server), which store what they find.
 * A record held under a board lock with no key is asked about once: another
 * device may since have stored the shared, open form on the server.
 */
async function resolveAsset(assetId: string): Promise<Blob | AssetMiss> {
  const local = await readAsset(assetId);
  if (local instanceof Blob || local.reason === 'unreadable') return local;
  if (local.reason === 'locked' && serverAsked.has(assetId)) return local;
  const fetcher = assetMissHandler ?? defaultMissHandler;
  if (!fetcher) return local;
  const fetched = await fetcher(assetId, { overLocked: local.reason === 'locked' }).catch(
    () => null,
  );
  if (!fetched && local.reason === 'locked') serverAsked.add(assetId);
  return fetched ?? local;
}

/**
 * Ask for an asset that a renderer could not show. The stored signal follows
 * a successful fetch; a miss is marked with its reason. One lookup per asset
 * at a time, however many renderers ask.
 */
const requests = new Map<string, Promise<boolean>>();
export function requestAsset(assetId: string): Promise<boolean> {
  let p = requests.get(assetId);
  if (!p) {
    p = resolveAsset(assetId).then((result) => {
      requests.delete(assetId);
      if (result instanceof Blob) {
        clearMiss(assetId);
        return true;
      }
      markMissing(assetId, result);
      return false;
    });
    requests.set(assetId, p);
  }
  return p;
}

/** Forget a miss and ask holders to look again (the Retry button). A small
 *  rendition that came up empty is forgotten too, so it is rebuilt. */
export function retryAsset(assetId: string): void {
  misses.delete(assetId);
  serverAsked.delete(assetId);
  forgetRenditions(assetId);
  for (const fn of missingListeners) fn();
  for (const fn of storedListeners) fn(assetId);
}

/** After a board is unlocked: every asset held back by its lock looks again. */
export function retryLockedAssets(boardId: string): void {
  for (const [assetId, miss] of [...misses]) {
    if (miss.reason === 'locked' && miss.owner.boardId === boardId) retryAsset(assetId);
  }
}

/**
 * Acquire an object URL for an asset. Every acquire must be paired with a
 * release; the URL is revoked when the last reference is released.
 * Resolves null if the asset cannot be shown (see AssetMiss).
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
    expired: false,
    promise: resolveAsset(assetId)
      .catch((): AssetMiss => ({ reason: 'unreadable' }))
      .then((result) => {
        const current = urlCache.get(assetId);
        // Released (or replaced) while loading — don't leak a URL.
        if (!current || current !== fresh) return null;
        if (!(result instanceof Blob)) {
          // A miss is never remembered by the cache: drop the entry so the
          // next acquire looks again, and tell renderers why it failed.
          urlCache.delete(assetId);
          markMissing(assetId, result);
          return null;
        }
        clearMiss(assetId);
        fresh.url = URL.createObjectURL(result);
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
  if (entry.expired) {
    if (entry.url) URL.revokeObjectURL(entry.url);
    urlCache.delete(assetId);
    return;
  }
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
