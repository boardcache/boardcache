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
  /**
   * When each entry last changed on any device (ms): `f:<folder id>` for a
   * folder record, `b:<board id>` for its folder, `t:<board id>` for its
   * tags, `order` for the manual order. An entry that is absent but stamped
   * was removed then. Two devices' copies merge entry by entry on these
   * (mergeLibraryMeta), so organising on one never undoes the other.
   */
  stamps: Record<string, number>;
}

const KEY = 'library';

export function emptyLibraryMeta(): LibraryMeta {
  return { folders: [], boardFolders: {}, boardTags: {}, boardOrder: [], stamps: {} };
}

/** Mark entries changed now (strictly after whatever stamp they carry). */
function touch(meta: LibraryMeta, keys: string[]): LibraryMeta {
  if (!keys.length) return meta;
  const now = Date.now();
  const stamps = { ...meta.stamps };
  for (const key of keys) stamps[key] = Math.max(now, (stamps[key] ?? 0) + 1);
  return { ...meta, stamps };
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
    stamps:
      raw?.stamps && typeof raw.stamps === 'object'
        ? Object.fromEntries(
            Object.entries(raw.stamps).filter(
              (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]),
            ),
          )
        : {},
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
async function replaceLibraryMeta(meta: LibraryMeta): Promise<void> {
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
    meta: touch({ ...meta, folders: [...meta.folders, { id, name: trimmed, parentId: parent }] }, [
      `f:${id}`,
    ]),
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
  return touch(
    { ...meta, folders: meta.folders.map((f) => (f.id === id ? { ...f, parentId } : f)) },
    [`f:${id}`],
  );
}

export function renameFolder(meta: LibraryMeta, id: string, name: string): LibraryMeta {
  const trimmed = name.trim();
  if (!trimmed) return meta;
  return touch(
    { ...meta, folders: meta.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)) },
    [`f:${id}`],
  );
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
    meta: touch({ ...meta, folders: meta.folders.filter((f) => !inside.has(f.id)), boardFolders }, [
      ...[...inside].map((f) => `f:${f}`),
      ...boardIds.map((b) => `b:${b}`),
    ]),
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
  return touch(
    {
      ...meta,
      folders: meta.folders.map((f) => {
        if (f.id !== id) return f;
        const { lock: _old, ...rest } = f;
        return lock ? { ...rest, lock } : rest;
      }),
    },
    [`f:${id}`],
  );
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
  return touch(
    { ...meta, boardFolders },
    boardIds.map((id) => `b:${id}`),
  );
}

/** Set (replace) a board's tags. */
export function setBoardTags(meta: LibraryMeta, boardId: string, tags: string[]): LibraryMeta {
  const boardTags = { ...meta.boardTags };
  if (tags.length) boardTags[boardId] = tags;
  else delete boardTags[boardId];
  return touch({ ...meta, boardTags }, [`t:${boardId}`]);
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
  return touch({ ...meta, boardOrder }, ['order']);
}

/** Drop a deleted board's folder, tags and place in the manual order. */
export function forgetBoard(meta: LibraryMeta, id: string): LibraryMeta {
  if (!(id in meta.boardFolders) && !(id in meta.boardTags) && !meta.boardOrder.includes(id)) {
    return meta;
  }
  const boardFolders = { ...meta.boardFolders };
  const boardTags = { ...meta.boardTags };
  delete boardFolders[id];
  delete boardTags[id];
  const keys = [`b:${id}`, `t:${id}`, ...(meta.boardOrder.includes(id) ? ['order'] : [])];
  return touch(
    { ...meta, boardFolders, boardTags, boardOrder: meta.boardOrder.filter((b) => b !== id) },
    keys,
  );
}

// ── Merging two devices' copies ──

type Entry = unknown; // a folder record, a folder id, a tag list, the order, or undefined (absent)

const same = (a: Entry, b: Entry) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Both copies, entry by entry: the newer stamp wins; on a tie an entry that
 * is present beats one that is absent (copies from before stamps existed
 * carry none, so their entries add up rather than cancel), and otherwise
 * the account's copy stands. Afterwards a folder whose parent is gone moves
 * to Home and a board whose folder is gone leaves it, so the result is
 * always well-formed whatever the two sides did.
 */
export function mergeLibraryMeta(local: LibraryMeta, remote: LibraryMeta): LibraryMeta {
  const lf = new Map(local.folders.map((f) => [f.id, f]));
  const rf = new Map(remote.folders.map((f) => [f.id, f]));
  const valueOf = (side: LibraryMeta, folders: Map<string, LibraryFolder>, key: string): Entry => {
    if (key === 'order') return side.boardOrder.length ? side.boardOrder : undefined;
    const id = key.slice(2);
    if (key.startsWith('f:')) return folders.get(id);
    if (key.startsWith('b:')) return side.boardFolders[id];
    if (key.startsWith('t:')) return side.boardTags[id];
    return undefined;
  };
  const keys = new Set<string>(['order']);
  for (const side of [local, remote]) {
    for (const f of side.folders) keys.add(`f:${f.id}`);
    for (const id of Object.keys(side.boardFolders)) keys.add(`b:${id}`);
    for (const id of Object.keys(side.boardTags)) keys.add(`t:${id}`);
    for (const key of Object.keys(side.stamps)) keys.add(key);
  }
  const out: LibraryMeta = { ...emptyLibraryMeta() };
  const folders: LibraryFolder[] = [];
  for (const key of keys) {
    const ls = local.stamps[key] ?? 0;
    const rs = remote.stamps[key] ?? 0;
    const lv = valueOf(local, lf, key);
    const rv = valueOf(remote, rf, key);
    let pick: Entry;
    if (ls > rs) pick = lv;
    else if (rs > ls) pick = rv;
    else if (same(lv, rv)) pick = rv;
    else if (lv === undefined || rv === undefined) pick = lv ?? rv;
    else pick = rv;
    const stamp = Math.max(ls, rs);
    if (stamp) out.stamps[key] = stamp;
    if (pick === undefined) continue;
    if (key === 'order') out.boardOrder = pick as string[];
    else if (key.startsWith('f:')) folders.push(pick as LibraryFolder);
    else if (key.startsWith('b:')) out.boardFolders[key.slice(2)] = pick as string;
    else if (key.startsWith('t:')) out.boardTags[key.slice(2)] = pick as string[];
  }
  // Keep the account's folder order where it has one, then local-only ones.
  const rank = new Map([...remote.folders, ...local.folders].map((f, i) => [f.id, i]));
  folders.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const live = new Set(folders.map((f) => f.id));
  out.folders = folders.map((f) =>
    f.parentId && !live.has(f.parentId) ? { ...f, parentId: null } : f,
  );
  for (const [id, folderId] of Object.entries(out.boardFolders)) {
    if (!live.has(folderId)) delete out.boardFolders[id];
  }
  return out;
}

/**
 * The account's copy arrived: merge it into this device's, store that, and
 * say whether the result differs from what arrived (then the account should
 * get the merged copy back).
 */
export async function mergeRemoteLibraryMeta(remote: LibraryMeta): Promise<{ differs: boolean }> {
  const incoming = normalizeLibraryMeta(remote);
  const merged = mergeLibraryMeta(await loadLibraryMeta(), incoming);
  await replaceLibraryMeta(merged);
  return { differs: !same(merged, incoming) };
}

/** Called by deleteBoard: the organisation of a board that is gone goes with it. */
export async function forgetDeletedBoard(id: string): Promise<void> {
  const meta = await loadLibraryMeta();
  const next = forgetBoard(meta, id);
  if (next !== meta) await saveLibraryMeta(next);
}
