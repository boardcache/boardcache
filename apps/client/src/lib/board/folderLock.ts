import type { LibraryFolder, LibraryMeta } from './libraryMeta';
import { setFolderLock } from './libraryMeta';
import { decryptBytes, encryptBytes, fromBase64, randomSalt, toBase64 } from '@boardcache/e2ee';
import { deriveLockKey, lockBoardWithKey, removeLockWithKey } from './boardLock';

/**
 * Folder locks. One password per folder; every board inside is a normal
 * locked board (see boardLock) whose key and salt are the folder's, so a
 * single derivation opens the lot. The folder's key lives here, in memory,
 * only while the folder is unlocked for the session; the library hides a
 * folder's contents whenever no key is held.
 */
const CHECK = 'boardcache-folder';
const sessions = new Map<string, CryptoKey>();

/** The folder's key, if it has been unlocked this session. */
export function folderSessionKey(folderId: string): CryptoKey | null {
  return sessions.get(folderId) ?? null;
}

/** Re-lock for the session: forget the key; nothing on disk changes. */
export function relockFolder(folderId: string): void {
  sessions.delete(folderId);
}

/** Verify the password against the folder's check value and keep the key. */
export async function unlockFolder(folder: LibraryFolder, password: string): Promise<boolean> {
  if (!folder.lock) return false;
  const key = await deriveLockKey(password, folder.lock.salt);
  try {
    const plain = await decryptBytes(key, fromBase64(folder.lock.check));
    if (new TextDecoder().decode(plain) !== CHECK) return false;
  } catch {
    return false;
  }
  sessions.set(folder.id, key);
  return true;
}

/**
 * Lock a folder: derive a key with a fresh salt, encrypt every board listed
 * (the caller has checked none is locked already) and record the lock on
 * the folder. The folder starts out sealed, as the user expects after
 * locking it.
 */
export async function lockFolder(
  meta: LibraryMeta,
  folderId: string,
  password: string,
  boardIds: string[],
): Promise<LibraryMeta> {
  const salt = randomSalt();
  const key = await deriveLockKey(password, salt);
  const check = toBase64(await encryptBytes(key, new TextEncoder().encode(CHECK)));
  for (const id of boardIds) await lockBoardWithKey(id, key, salt);
  sessions.delete(folderId);
  return setFolderLock(meta, folderId, { salt, check });
}

/** Remove a folder's lock for good: decrypt its boards, drop the record. Null = wrong password. */
export async function removeFolderLock(
  meta: LibraryMeta,
  folder: LibraryFolder,
  password: string,
  boardIds: string[],
): Promise<LibraryMeta | null> {
  if (!(await unlockFolder(folder, password))) return null;
  const key = sessions.get(folder.id)!;
  for (const id of boardIds) await removeLockWithKey(id, key);
  sessions.delete(folder.id);
  return setFolderLock(meta, folder.id, null);
}

/** Encrypt a board that has arrived in an unlocked folder (moved in, imported). */
export async function lockIntoFolder(folder: LibraryFolder, boardId: string): Promise<boolean> {
  const key = sessions.get(folder.id);
  if (!key || !folder.lock) return false;
  await lockBoardWithKey(boardId, key, folder.lock.salt);
  return true;
}

/** Decrypt a board that has left a folder whose key is held. */
export async function releaseFromFolder(folder: LibraryFolder, boardId: string): Promise<boolean> {
  const key = sessions.get(folder.id);
  if (!key) return false;
  return removeLockWithKey(boardId, key);
}
