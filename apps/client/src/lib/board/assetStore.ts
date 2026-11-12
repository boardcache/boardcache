import { decryptLockedAsset, encryptAssetForBoard, getSessionLock } from './boardLock';
import { getDb, mediaRange } from '../db';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Media store. Every board keeps its own copy of the media it shows, keyed
 * by (board, hash): the hash is the SHA-256 of the plaintext bytes, so one
 * file dropped twice on a board is stored once, and a board's media is
 * exactly the records under its id — deleting the board deletes them,
 * locking it seals them, nothing is shared with another board. Two boards
 * showing the same picture hold two copies; moving items between boards
 * copies the bytes (adoptAssets). Items reference media by hash alone, so
 * the board a lookup is for is the open one unless a caller says otherwise.
 *
 * This module is the ONLY owner of the assetId → objectURL cache — nothing
 * else in the app may call URL.createObjectURL.
 */

const openBoardId = (): string => useDocumentStore.getState().doc.id;

/** One stored record, as the mirror and the local source see it. */
export interface MediaRecord {
  board: string;
  hash: string;
  blob: Blob;
  mime: string;
  bytes: number;
  locked?: true;
}

/**
 * A copy of every record stored for a board kept outside this store (a
 * board folder on disk, lib/vault): told of each record as it is written,
 * and asked for one the store does not hold. Both are installed by the
 * desktop app and absent everywhere else.
 */
let mediaMirror: ((record: MediaRecord) => Promise<void>) | null = null;
export function setMediaMirror(fn: typeof mediaMirror): void {
  mediaMirror = fn;
}
let localSource: ((board: string, hash: string) => Promise<MediaRecord | null>) | null = null;
export function setLocalMediaSource(fn: typeof localSource): void {
  localSource = fn;
}
async function store(db: Awaited<ReturnType<typeof getDb>>, record: MediaRecord): Promise<void> {
  await db.put('media', record);
  if (mediaMirror) await mediaMirror(record);
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Store a blob for a board (default: the open one) and return its assetId.
 * Bytes stored for a board that is open with its password are sealed under
 * its media key — the hash stays that of the PLAINTEXT. A record the board
 * already holds is left alone: the content is the id.
 */
export async function putAsset(
  blob: Blob,
  { board = openBoardId() }: { board?: string } = {},
): Promise<string> {
  const hash = await sha256Hex(blob);
  const db = await getDb();
  if ((await db.getKey('media', [board, hash])) === undefined) {
    const cipher = getSessionLock(board) ? await encryptAssetForBoard(board, blob) : null;
    await store(
      db,
      cipher
        ? {
            board,
            hash,
            blob: cipher,
            mime: 'application/octet-stream',
            bytes: blob.size,
            locked: true,
          }
        : { board, hash, blob, mime: blob.type, bytes: blob.size },
    );
  }
  notifyAssetStored(hash);
  return hash;
}

/** Store bytes that arrived from the account's server or a team room for a
 *  board, in the form they came: plain. A sealed record gives way — the
 *  server's copy is current. */
export async function putPulledAsset(board: string, blob: Blob): Promise<string> {
  const hash = await sha256Hex(blob);
  const db = await getDb();
  const existing = await db.get('media', [board, hash]);
  if (existing === undefined || existing.locked) {
    await store(db, { board, hash, blob, mime: blob.type, bytes: blob.size });
  }
  notifyAssetStored(hash);
  return hash;
}

/** Store a lock-sealed record pulled from sync under its DECLARED hash.
 *  Integrity comes from the transport's AES-GCM (and the lock's own GCM on
 *  unlock) — the plaintext hash can't be checked without the password. */
export async function putLockedRecord(
  board: string,
  hash: string,
  blob: Blob,
  { replace = false } = {},
): Promise<void> {
  const db = await getDb();
  if (!replace && (await db.getKey('media', [board, hash])) !== undefined) return;
  await store(db, {
    board,
    hash,
    blob,
    mime: 'application/octet-stream',
    bytes: blob.size,
    locked: true,
  });
  notifyAssetStored(hash);
}

/**
 * Give a board its own copies of media another board holds (items pasted,
 * sent or duplicated across boards). A record the destination already has
 * is kept; one the source holds sealed opens with the source's session key
 * and is sealed again for the destination when that is open with its own.
 * Returns the hashes copied.
 */
export async function adoptAssets(
  board: string,
  hashes: Iterable<string>,
  from: string,
): Promise<string[]> {
  if (board === from) return [];
  const db = await getDb();
  const copied: string[] = [];
  for (const hash of new Set(hashes)) {
    if ((await db.getKey('media', [board, hash])) !== undefined) continue;
    const source = await db.get('media', [from, hash]);
    if (!source) continue;
    const blob = source.locked ? await decryptLockedAsset(from, source.blob) : source.blob;
    if (!blob) continue;
    const cipher = getSessionLock(board) ? await encryptAssetForBoard(board, blob) : null;
    await store(
      db,
      cipher
        ? {
            board,
            hash,
            blob: cipher,
            mime: 'application/octet-stream',
            bytes: blob.size,
            locked: true,
          }
        : { board, hash, blob, mime: blob.type || source.mime, bytes: blob.size },
    );
    copied.push(hash);
    notifyAssetStored(hash);
  }
  return copied;
}

/** The plaintext bytes of a board's asset (default: the open board's; see readAsset). */
export async function getAssetBlob(assetId: string, board?: string): Promise<Blob | undefined> {
  const found = await readAsset(assetId, board);
  return found instanceof Blob ? found : undefined;
}

// Assets opened with a board lock's key, by the board whose key it was. When
// that key is forgotten, their decrypted renditions go with it.
const openedBy = new Map<string, string>();
async function openLockedRecord(
  assetId: string,
  board: string,
  cipher: Blob,
): Promise<Blob | undefined> {
  const blob = await decryptLockedAsset(board, cipher);
  if (blob) openedBy.set(assetId, board);
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

/** A board's record from the store, else from the folder a board kept on
 *  disk is read from (its bytes come in as they are first asked for, and
 *  stay in the store while the board is open). */
async function storedRecord(board: string, assetId: string): Promise<MediaRecord | undefined> {
  const db = await getDb();
  const record = await db.get('media', [board, assetId]);
  if (record || !localSource) return record;
  const found = await localSource(board, assetId).catch(() => null);
  if (!found) return undefined;
  await db.put('media', found);
  return found;
}

/** A board's stored record as it is (a sealed one stays ciphertext): sync
 *  transport and the locked board file. */
export async function getRawAssetRecord(
  board: string,
  assetId: string,
): Promise<{ blob: Blob; mime: string; bytes: number; locked: boolean } | null> {
  const record = await storedRecord(board, assetId);
  if (!record) return null;
  return { blob: record.blob, mime: record.mime, bytes: record.bytes, locked: !!record.locked };
}

/** A board's asset as the canvas shows it, with its type and size: what an
 *  export carries. A sealed record opens with the board's key; a board kept
 *  on disk is read from its folder. Null when the bytes are not here. */
export async function getAssetRecord(
  assetId: string,
  board: string,
): Promise<{ blob: Blob; mime: string; bytes: number } | null> {
  const found = await readAsset(assetId, board);
  if (!(found instanceof Blob)) return null;
  const record = await (await getDb()).get('media', [board, assetId]);
  const mime = (record && !record.locked ? record.mime : found.type) || 'application/octet-stream';
  return { blob: found, mime, bytes: found.size };
}

export async function hasAsset(assetId: string, board = openBoardId()): Promise<boolean> {
  const db = await getDb();
  return (await db.getKey('media', [board, assetId])) !== undefined;
}

/** Total stored bytes of a board's given assets (deduped; missing ones count 0). */
export async function assetTotalBytes(board: string, ids: readonly string[]): Promise<number> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;
  const db = await getDb();
  const tx = db.transaction('media', 'readonly');
  let total = 0;
  await Promise.all(
    unique.map(async (id) => {
      const record = await tx.store.get([board, id]);
      if (record) total += record.bytes;
    }),
  );
  await tx.done;
  return total;
}

/** Remove one of a board's records (tests stage a missing download this way). */
export async function deleteAsset(assetId: string, board = openBoardId()): Promise<void> {
  const db = await getDb();
  await db.delete('media', [board, assetId]);
}

/** Every record a board holds goes with it. */
export async function deleteBoardMedia(board: string): Promise<void> {
  const db = await getDb();
  // The in-memory renditions go with the records: a board folder reopened
  // after its files changed must read the folder, not last time's copies.
  for (const key of await db.getAllKeys('media', mediaRange(board))) forgetRenditions(key[1]);
  await db.delete('media', mediaRange(board));
}

/** Drop a board's records that nothing on it references any more (a picture
 *  deleted from the board, once the history that could bring it back is
 *  gone). Returns how many went. */
export async function pruneBoardMedia(board: string, keep: Iterable<string>): Promise<number> {
  const db = await getDb();
  const wanted = new Set(keep);
  const keys = await db.getAllKeys('media', mediaRange(board));
  let pruned = 0;
  for (const key of keys) {
    if (wanted.has(key[1])) continue;
    await db.delete('media', key);
    pruned++;
  }
  return pruned;
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
 * A fallback fetcher for an asset a board cannot show from this device. It
 * stores what it finds for that board. `replace` is set when a record IS
 * here but cannot be read: the fetcher should then write the server's copy
 * over it.
 */
export type AssetFetcher = (
  assetId: string,
  opts: { board: string; replace: boolean },
) => Promise<Blob | null>;

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
 * Why an asset cannot be shown. `absent`: the board has no record of it on
 * this device and no source could fetch one. `unreadable`: a record is here
 * but could not be read or decoded (damaged, or sealed under a key the
 * board no longer has).
 */
export type AssetMiss = { reason: 'absent' } | { reason: 'unreadable' };

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
function markMissing(assetId: string, miss: AssetMiss): void {
  const prev = misses.get(assetId);
  if (prev && prev.reason === miss.reason) return;
  misses.set(assetId, miss);
  for (const fn of missingListeners) fn();
}
function clearMiss(assetId: string): void {
  if (misses.delete(assetId)) for (const fn of missingListeners) fn();
}

/** One readable record of a hash, whichever board holds it: a plain copy,
 *  or a sealed one whose board is open with its key. For lookups that name
 *  no board — painters rendering a board that is not the open one (a
 *  thumbnail after a sync pull, a duplicate) ask by hash alone. */
async function readAnyBoard(assetId: string): Promise<Blob | AssetMiss> {
  const db = await getDb();
  const records = await db.getAllFromIndex('media', 'byHash', assetId);
  for (const record of records) {
    if (!record.locked) return record.blob instanceof Blob ? record.blob : { reason: 'unreadable' };
    try {
      const blob = await openLockedRecord(assetId, record.board, record.blob);
      if (blob) return blob;
    } catch {
      /* not readable from here */
    }
  }
  return { reason: records.length > 0 ? 'unreadable' : 'absent' };
}

/** A board's asset from this device: its bytes, or why they cannot be shown.
 *  With no board named, the open board's copy, else any board's readable one. */
async function readAsset(assetId: string, board?: string): Promise<Blob | AssetMiss> {
  const scope = board ?? openBoardId();
  const read = await storedRecord(scope, assetId).then(
    (record) => ({ record }),
    () => null, // a severed IndexedDB connection: not readable right now
  );
  if (!read) return { reason: 'unreadable' };
  const { record } = read;
  if (!record) return board === undefined ? readAnyBoard(assetId) : { reason: 'absent' };
  if (!record.locked) return record.blob instanceof Blob ? record.blob : { reason: 'unreadable' };
  try {
    const blob = await openLockedRecord(assetId, scope, record.blob);
    if (blob) return blob;
  } catch {
    /* falls through to unreadable */
  }
  return { reason: 'unreadable' };
}

// Records that would not read and that the server was already asked about
// this session: asked again only on an explicit Retry.
const serverAsked = new Set<string>();

/**
 * The open board's asset from this device or, failing that, from the
 * fallback fetchers (a room's shared store, the account's server), which
 * store what they find for the board. A record that is here but will not
 * read is asked about once: the server's copy may be whole.
 */
async function resolveAsset(assetId: string): Promise<Blob | AssetMiss> {
  const board = openBoardId();
  const local = await readAsset(assetId);
  if (local instanceof Blob) return local;
  if (local.reason === 'unreadable' && serverAsked.has(assetId)) return local;
  const fetcher = assetMissHandler ?? defaultMissHandler;
  if (!fetcher) return local;
  const fetched = await fetcher(assetId, { board, replace: local.reason === 'unreadable' }).catch(
    () => null,
  );
  if (!fetched && local.reason === 'unreadable') serverAsked.add(assetId);
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
