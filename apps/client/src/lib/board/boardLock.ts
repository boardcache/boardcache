import type { CanvasDocument } from '@boardcache/schema';
import { scheduleDirectoryPublish } from '../sync/boardDirectory';
import { collectAssetIds, migrateDocument, validateDocument } from '@boardcache/schema';
import {
  CURRENT_KDF,
  decryptBytes,
  deriveKeys,
  encryptBytes,
  fromBase64,
  packAsset,
  randomSalt,
  toBase64,
  unpackAsset,
} from '@boardcache/e2ee';
import type { Kdf } from '@boardcache/e2ee';
import { getDb } from '../db';

/**
 * Per-board password locks. A locked board is encrypted AT REST: the document
 * (and every asset only that board references) is AES-GCM encrypted with a
 * key derived from the password (Argon2id for locks made since 2026-10,
 * PBKDF2 for older ones; the record says which). The key exists only in this
 * module's memory while the board is open and is dropped when it closes —
 * the password itself is never stored anywhere.
 *
 * Scope: this protects the local browser store from casual inspection
 * (another user of the machine, IndexedDB browsing). Assets shared with
 * other, unlocked boards stay in plaintext — they're visible through those
 * boards anyway.
 */

interface SessionLock {
  key: CryptoKey;
  salt: string;
  kdf: Kdf;
}

const sessions = new Map<string, SessionLock>();

const utf8 = new TextEncoder();

export async function deriveLockKey(
  password: string,
  salt: string,
  kdf: Kdf = 'pbkdf2-v1',
): Promise<CryptoKey> {
  // Reuse the sync E2EE derivation; the server-facing authKey is unused here.
  return (await deriveKeys(password, salt, kdf)).encKey;
}

/** The session key for a board, if it was opened with its password. */
export function getSessionLock(boardId: string): SessionLock | null {
  return sessions.get(boardId) ?? null;
}

export function dropSessionLock(boardId: string): void {
  sessions.delete(boardId);
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
async function assetIdsUsedElsewhere(excludeBoardId: string): Promise<Set<string>> {
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

  // Encrypt this board's exclusive assets in place (same hash key).
  const shared = await assetIdsUsedElsewhere(boardId);
  for (const hash of new Set(collectAssetIds(doc))) {
    if (shared.has(hash)) continue;
    const asset = await db.get('assets', hash);
    if (!asset || asset.lock) continue; // missing, or owned by another locked board
    const packed = packAsset(asset.mime, new Uint8Array(await asset.blob.arrayBuffer()));
    const cipher = await encryptBytes(key, packed);
    await db.put('assets', {
      hash,
      blob: new Blob([cipher as BlobPart]),
      mime: 'application/octet-stream',
      bytes: asset.bytes,
      lock: { boardId },
    });
  }

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
      doc: await encryptDoc(key, doc),
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
      doc: payload.doc,
      assets: payload.assets,
    },
  });
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
    const doc = await decryptDoc(key, record.lock.doc);
    sessions.set(boardId, { key, salt: record.lock.salt, kdf: record.lock.kdf ?? 'pbkdf2-v1' });
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
  try {
    doc = await decryptDoc(key, record.lock.doc);
  } catch {
    return false;
  }
  doc = { ...doc, name: record.name };

  const assets = await db.getAll('assets');
  for (const asset of assets) {
    if (asset.lock?.boardId !== boardId) continue;
    try {
      const packed = new Uint8Array(await asset.blob.arrayBuffer());
      const { mime, bytes } = unpackAsset(await decryptBytes(key, packed));
      await db.put('assets', {
        hash: asset.hash,
        blob: new Blob([bytes as BlobPart], { type: mime }),
        mime,
        bytes: asset.bytes,
      });
    } catch {
      /* leave undecryptable entries untouched */
    }
  }

  scheduleDirectoryPublish();
  await db.put('boards', {
    id: record.id,
    doc: JSON.parse(JSON.stringify(doc)) as unknown,
    name: doc.name,
    updatedAt: record.updatedAt,
    ...(record.size !== undefined ? { size: record.size } : {}),
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
