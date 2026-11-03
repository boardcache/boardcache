import type { CanvasDocument } from '@boardcache/schema';
import { scheduleDirectoryPublish } from '../sync/boardDirectory';
import { collectAssetIds, migrateDocument, validateDocument } from '@boardcache/schema';
import {
  CURRENT_KDF,
  decryptBytes,
  deriveEncKeyRaw,
  encryptBytes,
  fromBase64,
  importAesKey,
  packAsset,
  randomKeyBytes,
  randomSalt,
  toBase64,
  unpackAsset,
} from '@boardcache/e2ee';
import type { Kdf } from '@boardcache/e2ee';
import { getDb } from '../db';
import { queueReplacement } from './assetReplaceQueue';

/**
 * Per-board password locks. A locked board is encrypted AT REST: the document
 * (and every asset only that board references) is AES-GCM encrypted with the
 * board's MEDIA KEY, a random key the board gets the first time it is locked
 * and keeps for life. The password only wraps that key (through a key derived
 * with Argon2id for locks made since 2026-10, PBKDF2 for older ones; the
 * record says which). Re-locking with any password wraps the same media key,
 * so media sealed under an earlier lock — a stale server copy, another
 * device's record — opens again; removing the lock keeps the media key on the
 * open record for the next one. Locks from before media keys (no `key` on
 * the record) used the password-derived key directly; that key becomes the
 * board's media key when such a lock is removed.
 *
 * The unwrapped media key exists only in this module's memory while the board
 * is open and is dropped when it closes — the password is never stored.
 *
 * Scope: this protects the local browser store from casual inspection
 * (another user of the machine, IndexedDB browsing). Assets shared with
 * other, unlocked boards stay in plaintext — they're visible through those
 * boards anyway.
 */

interface SessionLock {
  /** The board's media key (or, for a lock from before media keys, the
   *  password-derived key itself). */
  key: CryptoKey;
  salt: string;
  kdf: Kdf;
  /** The media key wrapped under the password key, as the record keeps it. */
  wrapped?: string;
}

const sessions = new Map<string, SessionLock>();

const utf8 = new TextEncoder();

export async function deriveLockKey(
  password: string,
  salt: string,
  kdf: Kdf = 'pbkdf2-v1',
): Promise<CryptoKey> {
  // The sync E2EE derivation (the server-facing authKey is unused here).
  // Extractable: a lock from before media keys hands this key over as the
  // board's media key when it is removed.
  return importAesKey(await deriveEncKeyRaw(password, salt, kdf), true);
}

/** The media key a password key wraps — or, with no wrap, the password key itself. */
async function openMediaKey(
  kek: CryptoKey,
  wrapped: string | undefined,
): Promise<{ key: CryptoKey; raw: Uint8Array<ArrayBuffer> }> {
  const raw = wrapped
    ? await decryptBytes(kek, fromBase64(wrapped))
    : new Uint8Array(await crypto.subtle.exportKey('raw', kek));
  return { key: await importAesKey(raw), raw };
}

/** The session key for a board, if it was opened with its password. */
export function getSessionLock(boardId: string): SessionLock | null {
  return sessions.get(boardId) ?? null;
}

export function dropSessionLock(boardId: string): void {
  sessions.delete(boardId);
  borrowed.delete(boardId);
}

// A key unlocked for the sake of media shown on ANOTHER board (not by opening
// its own): kept only while that other board stays open.
const borrowed = new Set<string>();
export function borrowSessionLock(boardId: string): void {
  borrowed.add(boardId);
}
export function dropBorrowedLocks(): string[] {
  const dropped = [...borrowed];
  for (const id of dropped) sessions.delete(id);
  borrowed.clear();
  return dropped;
}

/** Encrypt a document for storage. */
export async function encryptDoc(key: CryptoKey, doc: CanvasDocument): Promise<string> {
  return toBase64(await encryptBytes(key, utf8.encode(JSON.stringify(doc))));
}

async function decryptDoc(key: CryptoKey, packedB64: string): Promise<CanvasDocument> {
  const json = new TextDecoder().decode(await decryptBytes(key, fromBase64(packedB64)));
  return validateDocument(migrateDocument(JSON.parse(json)));
}

/** Asset ids referenced by any OTHER board with a readable (plaintext) doc. */
export async function assetIdsUsedElsewhere(excludeBoardId: string): Promise<Set<string>> {
  const db = await getDb();
  const records = await db.getAll('boards');
  const used = new Set<string>();
  for (const r of records) {
    if (r.id === excludeBoardId || !r.doc) continue;
    try {
      for (const id of collectAssetIds(r.doc as CanvasDocument)) used.add(id);
    } catch {
      /* unreadable doc — ignore */
    }
  }
  return used;
}

/**
 * Lock a (closed) board with a password: encrypt its document and every asset
 * no other readable board references. Throws if the board has no document.
 */
export async function lockBoard(boardId: string, password: string): Promise<void> {
  const salt = randomSalt();
  await lockBoardWithKey(boardId, await deriveLockKey(password, salt, CURRENT_KDF), salt);
}

/** Lock with a ready key (a folder lock shares one key + salt across its boards). */
export async function lockBoardWithKey(
  boardId: string,
  key: CryptoKey,
  salt: string,
  kdf: Kdf = CURRENT_KDF,
): Promise<void> {
  const db = await getDb();
  const record = await db.get('boards', boardId);
  if (!record?.doc) throw new Error('Board not found or already locked');
  const doc = validateDocument(migrateDocument(record.doc));

  // The board's media key: the one it had under an earlier lock, else new.
  const raw = record.mediaKey ? fromBase64(record.mediaKey) : randomKeyBytes();
  const mediaKey = await importAesKey(raw);
  const wrapped = toBase64(await encryptBytes(key, raw));

  // Encrypt this board's exclusive assets in place (same hash key). Their
  // server copies, if any, are written again in this form by the next push.
  const shared = await assetIdsUsedElsewhere(boardId);
  const sealed: string[] = [];
  for (const hash of new Set(collectAssetIds(doc))) {
    if (shared.has(hash)) continue;
    const asset = await db.get('assets', hash);
    if (!asset || asset.lock) continue; // missing, or owned by another locked board
    const packed = packAsset(asset.mime, new Uint8Array(await asset.blob.arrayBuffer()));
    const cipher = await encryptBytes(mediaKey, packed);
    await db.put('assets', {
      hash,
      blob: new Blob([cipher as BlobPart]),
      mime: 'application/octet-stream',
      bytes: asset.bytes,
      lock: { boardId },
    });
    sealed.push(hash);
  }
  await queueReplacement(sealed);

  scheduleDirectoryPublish();
  await db.put('boards', {
    id: record.id,
    doc: null,
    name: record.name,
    updatedAt: record.updatedAt,
    ...(record.size !== undefined ? { size: record.size } : {}),
    lock: {
      salt,
      kdf,
      key: wrapped,
      doc: await encryptDoc(mediaKey, doc),
      assets: [...new Set(collectAssetIds(doc))],
    },
  });
  dropSessionLock(boardId);
}

/** A locked board's raw record — everything sync needs, nothing readable. */
export interface LockedRecord {
  id: string;
  name: string;
  updatedAt: string;
  salt: string;
  /** Absent on locks made before the version travelled with them (PBKDF2). */
  kdf?: Kdf | undefined;
  /** The media key wrapped under the password key; absent on locks from
   *  before media keys (the password key sealed everything itself). */
  key?: string | undefined;
  doc: string;
  assets: string[];
}

export async function getLockedRecord(boardId: string): Promise<LockedRecord | null> {
  const db = await getDb();
  const record = await db.get('boards', boardId);
  if (!record?.lock) return null;
  let assets = record.lock.assets;
  if (!assets) {
    // Pre-list locked boards: at least the exclusive (marked) assets.
    assets = (await db.getAll('assets'))
      .filter((a) => a.lock?.boardId === boardId)
      .map((a) => a.hash);
  }
  return {
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
    salt: record.lock.salt,
    ...(record.lock.kdf ? { kdf: record.lock.kdf } : {}),
    ...(record.lock.key ? { key: record.lock.key } : {}),
    doc: record.lock.doc,
    assets,
  };
}

/** Store a locked record pulled from sync (no password involved). */
export async function saveLockedRecordFromSync(payload: LockedRecord): Promise<void> {
  const db = await getDb();
  const existing = await db.get('boards', payload.id);
  scheduleDirectoryPublish();
  await db.put('boards', {
    id: payload.id,
    doc: null,
    name: payload.name,
    updatedAt: payload.updatedAt,
    ...(existing?.size !== undefined ? { size: existing.size } : {}),
    lock: {
      salt: payload.salt,
      ...(payload.kdf ? { kdf: payload.kdf } : {}),
      ...(payload.key ? { key: payload.key } : {}),
      doc: payload.doc,
      assets: payload.assets,
    },
  });
}

/** The media key an open board keeps from an earlier lock (base64 raw), if any. */
export async function getBoardMediaKey(boardId: string): Promise<string | null> {
  const db = await getDb();
  return (await db.get('boards', boardId))?.mediaKey ?? null;
}

/** Keep a media key that arrived with an open board (sync, file import). */
export async function setBoardMediaKey(boardId: string, mediaKey: string): Promise<void> {
  const db = await getDb();
  const record = await db.get('boards', boardId);
  if (!record || record.lock || record.mediaKey === mediaKey) return;
  await db.put('boards', { ...record, mediaKey });
}

/**
 * Decrypt a locked board's document with its password. Returns the document
 * and stores the session key so saves/assets keep working while it's open.
 * Returns null for a wrong password.
 */
export async function unlockForSession(
  boardId: string,
  password: string,
): Promise<CanvasDocument | null> {
  const db = await getDb();
  const record = await db.get('boards', boardId);
  if (!record?.lock) return null;
  return unlockForSessionWithKey(
    boardId,
    await deriveLockKey(password, record.lock.salt, record.lock.kdf),
  );
}

/** Same, with a ready key (the folder's). */
export async function unlockForSessionWithKey(
  boardId: string,
  key: CryptoKey,
): Promise<CanvasDocument | null> {
  const db = await getDb();
  const record = await db.get('boards', boardId);
  if (!record?.lock) return null;
  try {
    const media = await openMediaKey(key, record.lock.key);
    const doc = await decryptDoc(media.key, record.lock.doc);
    sessions.set(boardId, {
      key: media.key,
      salt: record.lock.salt,
      kdf: record.lock.kdf ?? 'pbkdf2-v1',
      ...(record.lock.key ? { wrapped: record.lock.key } : {}),
    });
    // Library renames only touch the record while locked — record.name wins.
    return { ...doc, name: record.name };
  } catch {
    return null; // GCM auth failure — wrong password
  }
}

/**
 * Permanently remove a board's lock: restore the plaintext document and
 * decrypt its assets back in place. Returns false for a wrong password.
 */
export async function removeLock(boardId: string, password: string): Promise<boolean> {
  const db = await getDb();
  const record = await db.get('boards', boardId);
  if (!record?.lock) return false;
  return removeLockWithKey(
    boardId,
    await deriveLockKey(password, record.lock.salt, record.lock.kdf),
  );
}

/** Same, with a ready key (the folder's). */
export async function removeLockWithKey(boardId: string, key: CryptoKey): Promise<boolean> {
  const db = await getDb();
  const record = await db.get('boards', boardId);
  if (!record?.lock) return false;
  let doc: CanvasDocument;
  let media: { key: CryptoKey; raw: Uint8Array<ArrayBuffer> };
  try {
    media = await openMediaKey(key, record.lock.key);
    doc = await decryptDoc(media.key, record.lock.doc);
  } catch {
    return false;
  }
  doc = { ...doc, name: record.name };

  const assets = await db.getAll('assets');
  const opened: string[] = [];
  for (const asset of assets) {
    if (asset.lock?.boardId !== boardId) continue;
    try {
      const packed = new Uint8Array(await asset.blob.arrayBuffer());
      const { mime, bytes } = unpackAsset(await decryptBytes(media.key, packed));
      await db.put('assets', {
        hash: asset.hash,
        blob: new Blob([bytes as BlobPart], { type: mime }),
        mime,
        bytes: asset.bytes,
      });
      opened.push(asset.hash);
    } catch {
      /* leave undecryptable entries untouched */
    }
  }
  // The server copies carry the lock's layer: the next push writes them plain.
  await queueReplacement(opened);

  scheduleDirectoryPublish();
  // The media key stays with the open board: the next lock wraps it again,
  // so copies sealed under this lock keep opening.
  await db.put('boards', {
    id: record.id,
    doc: JSON.parse(JSON.stringify(doc)) as unknown,
    name: doc.name,
    updatedAt: record.updatedAt,
    ...(record.size !== undefined ? { size: record.size } : {}),
    mediaKey: toBase64(media.raw),
  });
  dropSessionLock(boardId);
  return true;
}

/** Decrypt a locked asset's bytes with its owner board's session key. */
export async function decryptLockedAsset(
  ownerBoardId: string,
  cipher: Blob,
): Promise<Blob | undefined> {
  const data = new Uint8Array(await cipher.arrayBuffer());
  // Try the owner's session first, then any other open session — "keep both"
  // imports duplicate a board whose shared ciphertext assets still carry the
  // original owner id; AES-GCM safely rejects wrong keys.
  const owner = sessions.get(ownerBoardId);
  const candidates = owner
    ? [owner, ...[...sessions.values()].filter((s) => s !== owner)]
    : [...sessions.values()];
  for (const session of candidates) {
    try {
      const packed = await decryptBytes(session.key, data);
      const { mime, bytes } = unpackAsset(packed);
      return new Blob([bytes as BlobPart], { type: mime });
    } catch {
      /* wrong key — try the next open session */
    }
  }
  return undefined;
}

/** Encrypt fresh asset bytes for a locked board (import while unlocked). */
export async function encryptAssetForBoard(boardId: string, blob: Blob): Promise<Blob | null> {
  const session = sessions.get(boardId);
  if (!session) return null;
  const packed = packAsset(blob.type, new Uint8Array(await blob.arrayBuffer()));
  return new Blob([(await encryptBytes(session.key, packed)) as BlobPart]);
}
