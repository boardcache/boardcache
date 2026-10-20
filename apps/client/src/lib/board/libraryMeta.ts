import { newId } from '@boardcache/schema';
import { getDb } from '../db';

/**
 * Library organization — folders, per-board tags, and the manual sort order.
 * Lives in the idb `meta` store (key 'library'), separate from the board
 * documents themselves: organizing the library is not a board edit.
 */
export interface LibraryFolder {
  id: string;
  name: string;
  /** Parent folder; absent or null = a top-level folder in Home. */
  parentId?: string | null;
  /**
   * Folder lock: every board inside is encrypted with one key derived from
   * the folder's password and this salt; `check` is a known value under that
   * key, so a password can be verified without touching a board. The key is
   * held in memory only while the folder is unlocked (lib/board/folderLock).
   */
  lock?: { salt: string; check: string };
}

export interface LibraryMeta {
  folders: LibraryFolder[];
  /** boardId → folder id. Absent = not in a folder. */
  boardFolders: Record<string, string>;
  /** boardId → tags. */
  boardTags: Record<string, string[]>;
  /** Manual sort order (board ids; unknown boards sort after, by recency). */
  boardOrder: string[];
}

const KEY = 'library';

export function emptyLibraryMeta(): LibraryMeta {
  return { folders: [], boardFolders: {}, boardTags: {}, boardOrder: [] };
}

/** A loosely-typed record (idb, or a synced blob) as a well-formed meta. */
export function normalizeLibraryMeta(raw: Partial<LibraryMeta> | null | undefined): LibraryMeta {
  const folders = Array.isArray(raw?.folders)
    ? raw.folders
        .filter((f): f is LibraryFolder => Boolean(f) && typeof f.id === 'string')
        .map((f) => ({
          id: f.id,
          name: typeof f.name === 'string' ? f.name : 'Folder',
          parentId: typeof f.parentId === 'string' ? f.parentId : null,
          ...(f.lock && typeof f.lock.salt === 'string' && typeof f.lock.check === 'string'
            ? { lock: { salt: f.lock.salt, check: f.lock.check } }
            : {}),
        }))
    : [];
  return {
    folders,
    boardFolders: raw?.boardFolders && typeof raw.boardFolders === 'object' ? raw.boardFolders : {},
    boardTags: raw?.boardTags && typeof raw.boardTags === 'object' ? raw.boardTags : {},
    boardOrder: Array.isArray(raw?.boardOrder) ? raw.boardOrder : [],
  };
}

export async function loadLibraryMeta(): Promise<LibraryMeta> {
  const db = await getDb();
  const raw = (await db.get('meta', KEY)) as Partial<LibraryMeta> | undefined;
  return normalizeLibraryMeta(raw);
}

/** Where a change came from: this device (push it) or the account (show it). */
export type LibraryMetaSource = 'local' | 'remote';
const listeners = new Set<(source: LibraryMetaSource) => void>();

/** Subscribe to saves; returns the unsubscribe. */
export function onLibraryMetaChanged(fn: (source: LibraryMetaSource) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function saveLibraryMeta(meta: LibraryMeta): Promise<void> {
  const db = await getDb();
  await db.put('meta', meta, KEY);
  for (const fn of listeners) fn('local');
}

/** The account's copy arrived (settings sync): store it and let the index re-read. */
export async function replaceLibraryMeta(meta: LibraryMeta): Promise<void> {
  const db = await getDb();
  await db.put('meta', normalizeLibraryMeta(meta), KEY);
  for (const fn of listeners) fn('remote');
}

// ── Pure helpers (return a new meta; caller saves) ──

export function createFolder(
  meta: LibraryMeta,
  name: string,
  parentId: string | null = null,
): { meta: LibraryMeta; id: string } {
  const id = newId();
  const trimmed = name.trim() || 'New folder';
  const parent = parentId && meta.folders.some((f) => f.id === parentId) ? parentId : null;
  return {
    meta: { ...meta, folders: [...meta.folders, { id, name: trimmed, parentId: parent }] },
    id,
  };
}

/** The folder itself, or null for Home / an unknown id. */
export function folderById(meta: LibraryMeta, id: string | null): LibraryFolder | null {
  return id ? (meta.folders.find((f) => f.id === id) ?? null) : null;
}

/** Direct child folders of `parentId` (null = Home), by name. */
export function childFolders(meta: LibraryMeta, parentId: string | null): LibraryFolder[] {
  return meta.folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Home → … → the folder, as folder records (empty for Home or an unknown id). */
export function folderPath(meta: LibraryMeta, id: string | null): LibraryFolder[] {
  const path: LibraryFolder[] = [];
  const seen = new Set<string>();
  let cur = folderById(meta, id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = folderById(meta, cur.parentId ?? null);
  }
  return path;
}

/** True when `id` is `ancestorId` or sits anywhere below it. */
export function isWithinFolder(meta: LibraryMeta, id: string | null, ancestorId: string): boolean {
  return folderPath(meta, id).some((f) => f.id === ancestorId);
}

/** Re-parent a folder (null = Home). A folder can't move into itself or its own subtree. */
export function moveFolder(meta: LibraryMeta, id: string, parentId: string | null): LibraryMeta {
  if (!folderById(meta, id)) return meta;
  if (parentId && (parentId === id || isWithinFolder(meta, parentId, id))) return meta;
  if (parentId && !folderById(meta, parentId)) return meta;
  return {
    ...meta,
    folders: meta.folders.map((f) => (f.id === id ? { ...f, parentId } : f)),
  };
}

export function renameFolder(meta: LibraryMeta, id: string, name: string): LibraryMeta {
  const trimmed = name.trim();
  if (!trimmed) return meta;
  return {
    ...meta,
    folders: meta.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
  };
}

/** The folder and every folder below it. */
export function subtreeFolderIds(meta: LibraryMeta, id: string): string[] {
  return meta.folders.filter((f) => isWithinFolder(meta, f.id, id)).map((f) => f.id);
}

/** Board ids filed anywhere inside a folder (deep). */
export function boardsInFolderTree(meta: LibraryMeta, id: string): string[] {
  const inside = new Set(subtreeFolderIds(meta, id));
  return Object.entries(meta.boardFolders)
    .filter(([, folderId]) => inside.has(folderId))
    .map(([boardId]) => boardId);
}

/**
 * Delete a folder and everything below it (user decision 2026-09-20: a
 * folder takes its contents with it). Returns the new meta and the boards
 * that were inside — the caller deletes those boards themselves.
 */
export function deleteFolderTree(
  meta: LibraryMeta,
  id: string,
): { meta: LibraryMeta; boardIds: string[] } {
  const inside = new Set(subtreeFolderIds(meta, id));
  const boardIds = boardsInFolderTree(meta, id);
  const boardFolders = Object.fromEntries(
    Object.entries(meta.boardFolders).filter(([, folderId]) => !inside.has(folderId)),
  );
  return {
    meta: { ...meta, folders: meta.folders.filter((f) => !inside.has(f.id)), boardFolders },
    boardIds,
  };
}

/** Move boards into a folder (or to the root when folderId is null). */
/** The nearest locked folder on the way up from `folderId` (itself included), or null. */
export function lockedAncestor(meta: LibraryMeta, folderId: string | null): LibraryFolder | null {
  const path = folderPath(meta, folderId);
  for (let i = path.length - 1; i >= 0; i--) if (path[i]!.lock) return path[i]!;
  return null;
}

/** Set or clear a folder's lock record. */
export function setFolderLock(
  meta: LibraryMeta,
  id: string,
  lock: { salt: string; check: string } | null,
): LibraryMeta {
  return {
    ...meta,
    folders: meta.folders.map((f) => {
      if (f.id !== id) return f;
      const { lock: _old, ...rest } = f;
      return lock ? { ...rest, lock } : rest;
    }),
  };
}

export function moveBoards(
  meta: LibraryMeta,
  boardIds: string[],
  folderId: string | null,
): LibraryMeta {
  const boardFolders = { ...meta.boardFolders };
  for (const id of boardIds) {
    if (folderId) boardFolders[id] = folderId;
    else delete boardFolders[id];
  }
  return { ...meta, boardFolders };
}

/** Set (replace) a board's tags. */
function setBoardTags(meta: LibraryMeta, boardId: string, tags: string[]): LibraryMeta {
  const boardTags = { ...meta.boardTags };
  if (tags.length) boardTags[boardId] = tags;
  else delete boardTags[boardId];
  return { ...meta, boardTags };
}

/** Normalize a tag: trim, collapse whitespace, drop a leading #. */
function normalizeBoardTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();
}

/** Add a tag to every given board (case-insensitive de-dupe per board). */
export function addTagToBoards(meta: LibraryMeta, boardIds: string[], rawTag: string): LibraryMeta {
  const tag = normalizeBoardTag(rawTag);
  if (!tag) return meta;
  let next = meta;
  for (const id of boardIds) {
    const tags = next.boardTags[id] ?? [];
    if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      next = setBoardTags(next, id, [...tags, tag]);
    }
  }
  return next;
}

/** Remove a tag (case-insensitive) from every given board. */
export function removeTagFromBoards(
  meta: LibraryMeta,
  boardIds: string[],
  tag: string,
): LibraryMeta {
  let next = meta;
  for (const id of boardIds) {
    const tags = (next.boardTags[id] ?? []).filter((t) => t.toLowerCase() !== tag.toLowerCase());
    next = setBoardTags(next, id, tags);
  }
  return next;
}

/** Replace the manual order. */
export function setBoardOrder(meta: LibraryMeta, boardOrder: string[]): LibraryMeta {
  return { ...meta, boardOrder };
}

/** Drop metadata for boards that no longer exist. */
export function pruneBoards(meta: LibraryMeta, liveIds: Set<string>): LibraryMeta {
  return {
    ...meta,
    boardFolders: Object.fromEntries(
      Object.entries(meta.boardFolders).filter(([id]) => liveIds.has(id)),
    ),
    boardTags: Object.fromEntries(Object.entries(meta.boardTags).filter(([id]) => liveIds.has(id))),
    boardOrder: meta.boardOrder.filter((id) => liveIds.has(id)),
  };
}
