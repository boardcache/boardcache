import type { CanvasDocument } from '@boardcache/schema';
import {
  collectAssetIds,
  createDocument,
  migrateDocument,
  newId,
  parseDocument,
  serializeDocument,
  validateDocument,
} from '@boardcache/schema';
import type { BoardcacheDB } from '../db';
import { getDb, mediaRange } from '../db';
import { desktopVault, type VaultFile, type VaultScanBoard } from '../platform';
import {
  BOARDCACHE_FORMAT_VERSION,
  PLAIN_FORMAT_VERSION,
  type Manifest,
} from '../board/boardcacheFile';
import {
  deleteBoardMedia,
  putAsset,
  setLocalMediaSource,
  setMediaMirror,
  sha256Hex,
  type MediaRecord,
} from '../board/assetStore';
import { screenToCanvas } from '../canvas/coords';
import { showNotice } from '../notices';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import {
  LOCKED_DIR,
  STAGED_DIR,
  assetLocation,
  assetLocations,
  isMediaPath,
  mimeForName,
  planLayout,
  primaryAssetField,
  type LayoutMove,
} from './layout';
import { nameOf, rescanVault, useVaultStore, vaultBoard } from './vaultStore';

/**
 * Boards kept in the board folder ("Files"). A board folder holds
 * manifest.json, document.json (gone while the board is locked),
 * thumbnail.png and thumbnail-dark.png, and the board's media as readable
 * files: images/, videos/, audio/, documents/ and fonts/, each file named as
 * the item names it (lib/vault/layout). Copies the app made for itself (a
 * canvas rendition, a poster, a cover) sit under .boardcache/assets/ by
 * hash, and a locked board's ciphertext under assets/ by hash. The folder's
 * name is the board's name. Zip one and it is a board file.
 *
 * The media folders are also a way in: a file put there by other hands is
 * added to the board when the board is open (on open, and as it happens),
 * a file replaced in place updates the item that shows it, and a file taken
 * away leaves its item saying the media is missing. An item deleted on the
 * canvas takes its file with it when the board is closed.
 *
 * The folder is the board's one home. While a board is open the app keeps a
 * working copy of it in the same stores a library board uses — the boards
 * store, the media store — marked `vault`, so the canvas, autosave, locks and
 * thumbnails run unchanged: every save writes the document and manifest back
 * to the folder, every record the media store writes is mirrored into
 * assets/, and bytes the store does not hold are read from the folder as a
 * painter first asks for them. Closing the board drops the working copy and
 * the files its document no longer references.
 */

type BoardRecord = BoardcacheDB['boards']['value'];
type AssetMetas = Manifest['assets'];

interface OpenVault {
  id: string;
  /** The board folder, relative to the root. */
  path: string;
  manifest: Manifest;
  /** Writes to the folder, one after another. */
  chain: Promise<unknown>;
  /** Stamp of document.json as last read or written by this window. */
  docStamp: number | null;
}

/** The boards this window holds a working copy of. */
const open = new Map<string, OpenVault>();

const bridge = () => {
  const v = desktopVault();
  if (!v) throw new Error('The board folder is only reachable in the desktop app.');
  return v;
};

const encode = (text: string) => new TextEncoder().encode(text);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** One board folder's writes run in order; the failure of one is reported
 *  once and never stops the app (the working copy is still here). */
function queue<T>(entry: OpenVault, work: () => Promise<T>): Promise<T | undefined> {
  const run = entry.chain.then(work, work).catch((err) => {
    console.error(`boardCache: could not write the board folder ${entry.path}`, err);
    showNotice(
      `Changes to “${nameOf(entry.path)}” could not be written to its folder. Check that the folder is still there and writable.`,
      { id: `vault-write:${entry.id}`, kind: 'warn', sticky: true },
    );
    return undefined;
  });
  entry.chain = run;
  return run;
}

function manifestFor(record: BoardRecord, assets: Manifest['assets']): Manifest {
  return {
    formatVersion: record.lock ? BOARDCACHE_FORMAT_VERSION : PLAIN_FORMAT_VERSION,
    boardId: record.id,
    name: record.name,
    exportedAt: new Date().toISOString(),
    updatedAt: record.updatedAt,
    assets,
    ...(record.mediaKey ? { mediaKey: record.mediaKey } : {}),
    ...(record.lock
      ? {
          lock: {
            salt: record.lock.salt,
            doc: record.lock.doc,
            ...(record.lock.kdf ? { kdf: record.lock.kdf } : {}),
            ...(record.lock.key ? { key: record.lock.key } : {}),
          },
        }
      : {}),
  };
}

const manifestFile = (manifest: Manifest) => ({
  file: 'manifest.json' as const,
  bytes: encode(JSON.stringify(manifest, null, 2)),
});

/** The hash-named place a record's bytes go before the layout names them. */
const hashFile = (r: { hash: string; locked?: boolean }): VaultFile =>
  `${r.locked ? LOCKED_DIR : STAGED_DIR}/${r.hash}`;

/**
 * Give every asset the document shows a readable file. Assets of a folder
 * from before this layout sit under assets/ without a path: they go to the
 * hidden folder first (the shell skips a move already made), then the plan
 * names the ones the document shows. Writes the manifest when anything moved.
 */
async function layoutFolder(entry: OpenVault, doc: CanvasDocument): Promise<void> {
  const metas = entry.manifest.assets;
  const legacy: LayoutMove[] = [];
  for (const [hash, meta] of Object.entries(metas)) {
    if (!meta.locked && !meta.paths?.length) {
      legacy.push({ hash, from: `${LOCKED_DIR}/${hash}`, to: `${STAGED_DIR}/${hash}` });
    }
  }
  const moves = planLayout(metas, doc);
  if (!legacy.length && !moves.length) return;
  const res = await bridge().arrange(entry.path, [...legacy, ...moves] as {
    from: VaultFile;
    to: VaultFile;
  }[]);
  if (res.error !== undefined) throw new Error(res.error);
  const written = await bridge().write(entry.path, [manifestFile(entry.manifest)]);
  if (written.error !== undefined) throw new Error(written.error);
}

/** The document, thumbnail and manifest files a record writes to its folder. */
async function recordFiles(
  record: BoardRecord,
  manifest: Manifest,
): Promise<{ files: { file: VaultFile; bytes: Uint8Array }[]; remove: VaultFile[] }> {
  const files: { file: VaultFile; bytes: Uint8Array }[] = [];
  const remove: VaultFile[] = [];
  if (record.lock) {
    remove.push('document.json', 'thumbnail.png', 'thumbnail-dark.png');
  } else {
    const doc = validateDocument(migrateDocument(record.doc));
    files.push({ file: 'document.json', bytes: encode(serializeDocument(doc)) });
    const light = record.thumbnailLight ?? record.thumbnail;
    if (light) files.push({ file: 'thumbnail.png', bytes: await bytesOf(light) });
    if (record.thumbnailDark) {
      files.push({ file: 'thumbnail-dark.png', bytes: await bytesOf(record.thumbnailDark) });
    }
  }
  files.push(manifestFile(manifest));
  return { files, remove };
}

async function readManifest(path: string): Promise<Manifest> {
  const res = await bridge().read(path, 'manifest.json');
  if (res.error !== undefined) throw new Error(`Could not read the board's manifest: ${res.error}`);
  const manifest = JSON.parse(new TextDecoder().decode(res.bytes)) as Manifest;
  if (typeof manifest.boardId !== 'string') throw new Error('Not a board folder');
  if (!manifest.assets || typeof manifest.assets !== 'object') manifest.assets = {};
  return manifest;
}

// --- ids ---------------------------------------------------------------------

/**
 * Every board in the index has one id. A folder whose manifest names a
 * library board's id (the unzipped export of one), or the same id as another
 * folder (a copy made in the file manager), is a board of its own and gets a
 * fresh id written into its manifest — as an import gets one.
 */
export async function reconcileVaultIds(boards: VaultScanBoard[]): Promise<VaultScanBoard[]> {
  const db = await getDb();
  const taken = new Set<string>();
  for (const r of await db.getAll('boards')) if (!r.vault) taken.add(r.id);
  const out: VaultScanBoard[] = [];
  for (const board of boards) {
    if (!taken.has(board.id)) {
      taken.add(board.id);
      out.push(board);
      continue;
    }
    try {
      const manifest = await readManifest(board.path);
      const id = newId();
      manifest.boardId = id;
      const res = await bridge().write(board.path, [manifestFile(manifest)]);
      if (res.error !== undefined) throw new Error(res.error);
      console.info(
        `boardCache: board folder ${board.path} is a copy of ${board.id}; it is now ${id}`,
      );
      taken.add(id);
      out.push({ ...board, id });
    } catch (err) {
      console.warn(
        `boardCache: board folder ${board.path} shares an id and could not be relabelled`,
        err,
      );
    }
  }
  return out;
}

// --- the working copy --------------------------------------------------------

export const isVaultBoard = (id: string): boolean => open.has(id) || vaultBoard(id) !== null;

let ready: Promise<void> = Promise.resolve();

/**
 * Bring a board folder's document (or lock) into the working stores so the
 * board can be opened like any other. Media stays on disk until asked for.
 * True when the board is in the folder, false for a library board.
 */
export async function materializeVaultBoard(id: string): Promise<boolean> {
  if (open.has(id)) return true;
  await ready;
  const board = vaultBoard(id);
  if (!board) return false;
  const manifest = await readManifest(board.path);
  const db = await getDb();
  const base = {
    id,
    name: board.name,
    updatedAt: manifest.updatedAt ?? board.updatedAt,
    size: board.size,
    vault: true as const,
    ...(manifest.mediaKey ? { mediaKey: manifest.mediaKey } : {}),
  };
  let docStamp: number | null = null;
  if (manifest.lock) {
    await db.put('boards', {
      ...base,
      doc: null,
      lock: {
        salt: manifest.lock.salt,
        doc: manifest.lock.doc,
        ...(manifest.lock.kdf === 'argon2id-v1' || manifest.lock.kdf === 'pbkdf2-v1'
          ? { kdf: manifest.lock.kdf }
          : {}),
        ...(typeof manifest.lock.key === 'string' ? { key: manifest.lock.key } : {}),
        assets: Object.keys(manifest.assets),
      },
    });
  } else {
    const res = await bridge().read(board.path, 'document.json');
    if (res.error !== undefined) throw new Error(`Could not read the board: ${res.error}`);
    docStamp = res.mtime;
    let doc = parseDocument(new TextDecoder().decode(res.bytes));
    // The folder is the board: its name and id are the board's.
    doc = { ...doc, id, name: board.name };
    await db.put('boards', { ...base, doc: JSON.parse(serializeDocument(doc)) as unknown });
    const entry: OpenVault = { id, path: board.path, manifest, chain: Promise.resolve(), docStamp };
    open.set(id, entry);
    // A folder from before the readable layout takes it on first open.
    await queue(entry, () => layoutFolder(entry, doc));
    return true;
  }
  open.set(id, { id, path: board.path, manifest, chain: Promise.resolve(), docStamp });
  return true;
}

/**
 * A board folder's document as the folder holds it (the working copy while
 * the board is open here), for the cross-board search index. Null for a
 * locked board, a folder that is not a board, or a document that does not
 * parse.
 */
export async function readVaultDocument(id: string): Promise<CanvasDocument | null> {
  if (open.has(id)) {
    const { loadBoardRecord } = await import('../board/boardLibrary');
    return loadBoardRecord(id);
  }
  const board = vaultBoard(id);
  if (!board || board.locked) return null;
  const res = await bridge().read(board.path, 'document.json');
  if (res.error !== undefined) return null;
  try {
    const doc = parseDocument(new TextDecoder().decode(res.bytes));
    return { ...doc, id, name: board.name };
  } catch {
    return null;
  }
}

/** Every file of the board into the working stores (a lock, a move, a pack). */
async function materializeFully(id: string): Promise<OpenVault> {
  if (!(await materializeVaultBoard(id))) throw new Error('Not a board in the folder');
  const entry = open.get(id)!;
  const db = await getDb();
  for (const [hash, meta] of Object.entries(entry.manifest.assets)) {
    if ((await db.getKey('media', [id, hash])) !== undefined) continue;
    const found = await readFolderAsset(entry, hash, meta);
    if (found) await db.put('media', found);
  }
  return entry;
}

async function readFolderAsset(
  entry: OpenVault,
  hash: string,
  meta: Manifest['assets'][string],
): Promise<MediaRecord | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const res = await bridge().read(entry.path, assetLocation(hash, meta) as VaultFile);
  if (res.error !== undefined) return null;
  const blob = new Blob([res.bytes as BlobPart], {
    type: meta.locked ? 'application/octet-stream' : meta.mime,
  });
  return {
    board: entry.id,
    hash,
    blob,
    mime: meta.locked ? 'application/octet-stream' : meta.mime,
    bytes: meta.bytes,
    ...(meta.locked ? { locked: true as const } : {}),
  };
}

/** Write the working copy's record (document or lock, thumbnails, manifest). */
export async function writeVaultRecord(record: BoardRecord): Promise<void> {
  const entry = open.get(record.id);
  if (!entry) return;
  await queue(entry, async () => {
    entry.manifest = manifestFor(record, entry.manifest.assets);
    // Media the save brought in (a drop, a paste) gets its readable name
    // before the manifest that lists it is written.
    if (!record.lock && record.doc) {
      try {
        await layoutFolder(entry, validateDocument(migrateDocument(record.doc)));
      } catch (err) {
        console.warn('boardCache: the board folder could not be laid out', err);
      }
    }
    const { files, remove } = await recordFiles(record, entry.manifest);
    const res = await bridge().write(entry.path, files, remove);
    if (res.error !== undefined) throw new Error(res.error);
    entry.docStamp = record.lock ? null : (res.mtimes?.['document.json'] ?? entry.docStamp);
  });
}

/** The media store wrote a record: the folder gets the same bytes, by hash
 *  (the next save names the ones the document shows). A record the folder
 *  already holds, such as a file that arrived by the folder itself, is
 *  left where it is. */
async function mirror(record: MediaRecord): Promise<void> {
  const entry = open.get(record.board);
  if (!entry) return;
  const known = entry.manifest.assets[record.hash];
  if (known && !!known.locked === !!record.locked) return;
  await queue(entry, async () => {
    entry.manifest.assets[record.hash] = {
      mime: record.mime,
      bytes: record.bytes,
      ...(record.locked ? { locked: true } : {}),
    };
    const res = await bridge().write(entry.path, [
      { file: hashFile(record), bytes: await bytesOf(record.blob) },
      manifestFile(entry.manifest),
    ]);
    if (res.error !== undefined) throw new Error(res.error);
  });
}

/** The media store lacks a record: the folder may hold it. */
async function source(board: string, hash: string): Promise<MediaRecord | null> {
  const entry = open.get(board);
  if (!entry) return null;
  const meta = entry.manifest.assets[hash];
  if (!meta) return null;
  return readFolderAsset(entry, hash, meta);
}

/** Every media record of the working copy, written to the folder as it is
 *  now (after a lock or unlock rewrote the records in place): ciphertext by
 *  hash under assets/, with the readable files gone; plaintext by hash under
 *  the hidden folder, for the next save to name. */
async function writeBackMedia(entry: OpenVault): Promise<void> {
  const db = await getDb();
  const records = await db.getAll('media', mediaRange(entry.id));
  await queue(entry, async () => {
    const files: { file: VaultFile; bytes: Uint8Array }[] = [];
    const remove = new Set<VaultFile>();
    for (const r of records) {
      const before = entry.manifest.assets[r.hash];
      for (const where of assetLocations(r.hash, before ?? { mime: r.mime, bytes: r.bytes })) {
        remove.add(where as VaultFile);
      }
      entry.manifest.assets[r.hash] = {
        mime: r.mime,
        bytes: r.bytes,
        ...(r.locked ? { locked: true } : {}),
      };
      const file = hashFile(r);
      remove.delete(file);
      files.push({ file, bytes: await bytesOf(r.blob) });
    }
    files.push(manifestFile(entry.manifest));
    const res = await bridge().write(entry.path, files, [...remove]);
    if (res.error !== undefined) throw new Error(res.error);
  });
}

/**
 * Drop the working copy of a closed board: the folder keeps only the media
 * its document references (the history that could have brought the rest
 * back is gone with the close), then the stores forget the board.
 */
export async function evictVaultBoard(id: string): Promise<void> {
  const entry = open.get(id);
  if (!entry) return;
  if (useDocumentStore.getState().doc.id === id && useSessionStore.getState().view !== 'library') {
    return; // still open (a reload of the same board)
  }
  const db = await getDb();
  const record = await db.get('boards', id);
  let keep: Set<string> | null = null;
  let doc: CanvasDocument | null = null;
  if (record?.doc) {
    try {
      doc = validateDocument(migrateDocument(record.doc));
      keep = new Set(collectAssetIds(doc));
    } catch {
      keep = null;
    }
  } else if (record?.lock?.assets) keep = new Set(record.lock.assets);
  await queue(entry, async () => {
    if (!keep) return;
    // Media that arrived since the last save (items sent to this board)
    // gets its name before the folder is pruned to what the document shows.
    if (doc) await layoutFolder(entry, doc);
    const drop = Object.keys(entry.manifest.assets).filter((h) => !keep.has(h));
    if (!drop.length) return;
    const remove: VaultFile[] = [];
    for (const h of drop) {
      remove.push(...(assetLocations(h, entry.manifest.assets[h]!) as VaultFile[]));
      delete entry.manifest.assets[h];
    }
    const res = await bridge().write(entry.path, [manifestFile(entry.manifest)], remove);
    if (res.error !== undefined) throw new Error(res.error);
  });
  open.delete(id);
  await deleteBoardMedia(id);
  // The entry is the proof this record was the working copy, whatever the
  // record says: a lock rewrote it, and a copy left behind would read as a
  // library board.
  if (record) await db.delete('boards', id);
  void rescanVault();
}

// --- making, moving, renaming, deleting --------------------------------------

/** A new, empty board as a folder in `dir`; returns its id (open it next). */
export async function createVaultBoard(name: string, dir: string): Promise<string> {
  const doc = createDocument({ name: name.trim() || 'Untitled board' });
  const record: BoardRecord = {
    id: doc.id,
    doc: JSON.parse(serializeDocument(doc)) as unknown,
    name: doc.name,
    updatedAt: doc.updatedAt,
  };
  try {
    const { renderThumbnails } = await import('../media/thumbnail');
    const thumbs = await renderThumbnails(doc);
    record.thumbnailLight = thumbs.light;
    record.thumbnailDark = thumbs.dark;
  } catch {
    /* the preview is cosmetic */
  }
  const path = await writeNewFolder(dir, doc.name, record, []);
  await rescanVault();
  console.info(`boardCache: new board folder ${path}`);
  return doc.id;
}

/** A fresh board folder under `dir` from a record and its media; returns its path. */
async function writeNewFolder(
  dir: string,
  name: string,
  record: BoardRecord,
  media: MediaRecord[],
): Promise<string> {
  const v = bridge();
  const made = await v.mkdir(dir, name);
  if (made.error !== undefined) throw new Error(made.error);
  const assets: AssetMetas = {};
  for (const r of media) {
    assets[r.hash] = { mime: r.mime, bytes: r.bytes, ...(r.locked ? { locked: true } : {}) };
  }
  // Named straight away: the plan says where each file goes.
  if (!record.lock && record.doc) {
    try {
      planLayout(assets, validateDocument(migrateDocument(record.doc)));
    } catch {
      /* an unreadable document still gets its files, by hash */
    }
  }
  const files: { file: VaultFile; bytes: Uint8Array }[] = [];
  for (const r of media) {
    files.push({
      file: assetLocation(r.hash, assets[r.hash]!) as VaultFile,
      bytes: await bytesOf(r.blob),
    });
  }
  const manifest = manifestFor(record, assets);
  const own = await recordFiles(record, manifest);
  const res = await v.write(made.path, [...files, ...own.files]);
  if (res.error !== undefined) throw new Error(res.error);
  return made.path;
}

/**
 * Move a library board into the folder: its record and media become a
 * board folder in `dir`, then the library forgets it. A board that syncs
 * is refused (the caller turns sync off first), so nothing is tombstoned.
 */
export async function moveBoardToFiles(id: string, dir: string): Promise<string> {
  const db = await getDb();
  const record = await db.get('boards', id);
  if (!record || record.vault) throw new Error('Not a library board');
  if (record.remote) throw new Error('Download the board first');
  const { syncedBoardIds } = await import('../sync/syncMetaStore');
  if ((await syncedBoardIds()).has(id)) throw new Error('Turn off sync for the board first');
  const media = await db.getAll('media', mediaRange(id));
  const path = await writeNewFolder(dir, record.name, record, media);
  const { deleteBoard } = await import('../board/boardLibrary');
  await deleteBoard(id);
  await rescanVault();
  return path;
}

/** Move a board folder into the library: every file into the stores, then
 *  the folder goes to the trash. */
export async function moveBoardToLibrary(id: string): Promise<void> {
  const board = vaultBoard(id);
  if (!board) throw new Error('Not a board in the folder');
  if (open.has(id)) throw new Error('Close the board first');
  const entry = await materializeFully(id);
  const db = await getDb();
  const record = await db.get('boards', id);
  if (!record) throw new Error('The board could not be read');
  const { uniqueLibraryName } = await import('../board/boardNames');
  const name = await uniqueLibraryName(record.name, id);
  const thumbs: Partial<BoardRecord> = {};
  for (const [file, key] of [
    ['thumbnail.png', 'thumbnailLight'],
    ['thumbnail-dark.png', 'thumbnailDark'],
  ] as const) {
    const res = await bridge().read(entry.path, file);
    if (res.error === undefined)
      thumbs[key] = new Blob([res.bytes as BlobPart], { type: 'image/png' });
  }
  const { vault: _vault, ...rest } = record;
  void _vault;
  await db.put('boards', {
    ...rest,
    name,
    ...(rest.doc ? { doc: { ...(rest.doc as object), name } } : {}),
    ...thumbs,
  });
  open.delete(id);
  const res = await bridge().trash(entry.path);
  if (res.error !== undefined) console.warn(`boardCache: ${res.error}`);
  await rescanVault();
  const { scheduleDirectoryPublish } = await import('../sync/boardDirectory');
  scheduleDirectoryPublish();
}

/** The board as a .boardcache file (the folder, zipped). */
export async function packVaultBoard(id: string): Promise<{ blob: Blob; name: string }> {
  const wasOpen = open.has(id);
  const entry = await materializeFully(id);
  try {
    const db = await getDb();
    const record = await db.get('boards', id);
    if (!record) throw new Error('The board could not be read');
    const { exportBoardFile, exportLockedBoardFile } = await import('../board/boardcacheFile');
    if (record.lock) {
      return {
        name: nameOf(entry.path),
        blob: await exportLockedBoardFile({
          id,
          name: record.name,
          updatedAt: record.updatedAt,
          salt: record.lock.salt,
          kdf: record.lock.kdf,
          key: record.lock.key,
          doc: record.lock.doc,
          assets: record.lock.assets ?? Object.keys(entry.manifest.assets),
        }),
      };
    }
    const doc = validateDocument(migrateDocument(record.doc));
    return { name: nameOf(entry.path), blob: await exportBoardFile(doc) };
  } finally {
    if (!wasOpen) {
      open.delete(id);
      await deleteBoardMedia(id);
      await (await getDb()).delete('boards', id);
    }
  }
}

/** Rename a board folder; the open board follows. */
export async function renameVaultBoard(id: string, name: string): Promise<void> {
  const board = vaultBoard(id);
  if (!board || !name.trim()) return;
  const res = await bridge().rename(board.path, name.trim());
  if (res.error !== undefined) throw new Error(res.error);
  const entry = open.get(id);
  if (entry) {
    entry.path = res.path;
    entry.manifest.name = res.name;
    const db = await getDb();
    const record = await db.get('boards', id);
    if (record) {
      if (record.doc) (record.doc as { name?: unknown }).name = res.name;
      await db.put('boards', { ...record, name: res.name });
    }
    const { doc, replaceDoc } = useDocumentStore.getState();
    if (doc.id === id) replaceDoc({ ...doc, name: res.name });
    await writeVaultRecord({ ...(record ?? { id, doc: null, updatedAt: '' }), name: res.name });
  }
  await rescanVault();
}

/** Delete a board folder (to the trash where there is one). */
export async function deleteVaultBoard(id: string): Promise<void> {
  const board = vaultBoard(id);
  if (!board) return;
  const entry = open.get(id);
  if (entry) {
    open.delete(id);
    await deleteBoardMedia(id);
    await (await getDb()).delete('boards', id);
  }
  const res = await bridge().trash(board.path);
  if (res.error !== undefined) throw new Error(res.error);
  await rescanVault();
}

/** A copy of a board folder beside it (its manifest gets a fresh id on
 *  scan); returns the copy's id. */
export async function duplicateVaultBoard(id: string): Promise<string | null> {
  const board = vaultBoard(id);
  if (!board) return null;
  const res = await bridge().copy(board.path, `${board.name} copy`);
  if (res.error !== undefined) throw new Error(res.error);
  await rescanVault();
  return useVaultStore.getState().boards.find((b) => b.path === res.path)?.id ?? null;
}

/** Move a board folder or an organisational folder under another folder. */
export async function moveVaultEntry(path: string, dir: string): Promise<void> {
  const res = await bridge().move(path, dir);
  if (res.error !== undefined) throw new Error(res.error);
  for (const entry of open.values()) {
    if (entry.path === path) entry.path = res.path;
    else if (entry.path.startsWith(`${path}/`))
      entry.path = res.path + entry.path.slice(path.length);
  }
  await rescanVault();
}

export async function createVaultDir(dir: string, name: string): Promise<string> {
  const res = await bridge().mkdir(dir, name);
  if (res.error !== undefined) throw new Error(res.error);
  await rescanVault();
  return res.path;
}

export async function renameVaultDir(path: string, name: string): Promise<string> {
  const res = await bridge().rename(path, name);
  if (res.error !== undefined) throw new Error(res.error);
  for (const entry of open.values()) {
    if (entry.path.startsWith(`${path}/`)) entry.path = res.path + entry.path.slice(path.length);
  }
  await rescanVault();
  return res.path;
}

export async function deleteVaultDir(path: string): Promise<void> {
  for (const [id, entry] of open) {
    if (entry.path.startsWith(`${path}/`)) {
      open.delete(id);
      await deleteBoardMedia(id);
      await (await getDb()).delete('boards', id);
    }
  }
  const res = await bridge().trash(path);
  if (res.error !== undefined) throw new Error(res.error);
  await rescanVault();
}

export function revealVaultPath(path: string): void {
  void desktopVault()?.reveal(path);
}

// --- locks -------------------------------------------------------------------

/** Lock a closed board folder: the working copy is locked as a library
 *  board is, then written back sealed, then dropped. */
export async function lockVaultBoard(id: string, password: string): Promise<void> {
  const entry = await materializeFully(id);
  const { lockBoard } = await import('../board/boardLock');
  await lockBoard(id, password);
  await writeBackMedia(entry);
  const db = await getDb();
  const record = await db.get('boards', id);
  if (record) await writeVaultRecord(record);
  await evictVaultBoard(id);
}

/** Unlock a board folder with its password; false when the password is wrong. */
export async function unlockVaultBoard(id: string, password: string): Promise<boolean> {
  const entry = await materializeFully(id);
  const { removeLock } = await import('../board/boardLock');
  const ok = await removeLock(id, password);
  if (!ok) {
    await evictVaultBoard(id);
    return false;
  }
  await writeBackMedia(entry);
  // The document is plaintext again: the preview comes back with it.
  const { loadBoardRecord, saveBoardRecord } = await import('../board/boardLibrary');
  const doc = await loadBoardRecord(id);
  if (doc) await saveBoardRecord(doc, true);
  await evictVaultBoard(id);
  return true;
}

// --- files that arrive by the folder -----------------------------------------

/** The canvas point new items land at: the middle of the view. */
function viewCentre(): { x: number; y: number } {
  const { viewport } = useDocumentStore.getState().doc;
  return screenToCanvas({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, viewport);
}

/**
 * Bring in what other hands put in the open board's media folders: a file
 * the manifest does not know becomes an item (through the same import a
 * drop on the canvas takes), a known file whose bytes changed moves the
 * items showing it to the new content. `touched` narrows the look to the
 * paths the watcher named; without it, every file is considered (on open),
 * re-read only when its size or stamp says it may have changed.
 */
async function absorbFolderFiles(entry: OpenVault, touched?: string[]): Promise<void> {
  if (entry.manifest.lock) return;
  const { doc } = useDocumentStore.getState();
  if (doc.id !== entry.id || useSessionStore.getState().view === 'library') return;
  const listed = await bridge().list(entry.path);
  if (listed.error !== undefined) return;
  const known = new Map<string, string>();
  for (const [hash, meta] of Object.entries(entry.manifest.assets)) {
    for (const p of meta.paths ?? []) known.set(p, hash);
  }
  const since = Date.parse(entry.manifest.updatedAt ?? '') || 0;
  const touchedHere = touched?.map((p) => p.slice(entry.path.length + 1));
  const fresh: { file: VaultFile; blob: Blob; mime: string; hash: string }[] = [];
  const changed: { file: VaultFile; blob: Blob; was: string; hash: string }[] = [];
  for (const f of listed.files) {
    if (!isMediaPath(f.file)) continue;
    const was = known.get(f.file);
    const mime = mimeForName(f.file);
    if (!mime) continue;
    if (was) {
      const meta = entry.manifest.assets[was]!;
      const suspect = touchedHere
        ? touchedHere.includes(f.file)
        : f.bytes !== meta.bytes || f.mtime > since;
      if (!suspect) continue;
    } else if (touchedHere && !touchedHere.includes(f.file)) continue;
    const res = await bridge().read(entry.path, f.file);
    if (res.error !== undefined) continue;
    const blob = new Blob([res.bytes as BlobPart], { type: mime });
    const hash = await sha256Hex(blob);
    if (was) {
      if (hash !== was) changed.push({ file: f.file, blob, was, hash });
    } else fresh.push({ file: f.file, blob, mime, hash });
  }
  if (!fresh.length && !changed.length) return;

  // The folder holds these bytes already: the manifest learns them before
  // the import writes the records, so the mirror leaves the files alone.
  for (const f of fresh) {
    const meta = entry.manifest.assets[f.hash];
    if (meta) {
      if (!meta.paths?.includes(f.file)) meta.paths = [...(meta.paths ?? []), f.file];
    } else entry.manifest.assets[f.hash] = { mime: f.mime, bytes: f.blob.size, paths: [f.file] };
  }
  for (const c of changed) {
    const old = entry.manifest.assets[c.was];
    if (old?.paths) old.paths = old.paths.filter((p) => p !== c.file);
    const meta = entry.manifest.assets[c.hash];
    if (meta) {
      if (!meta.paths?.includes(c.file)) meta.paths = [...(meta.paths ?? []), c.file];
    } else {
      entry.manifest.assets[c.hash] = { mime: c.blob.type, bytes: c.blob.size, paths: [c.file] };
    }
  }
  await queue(entry, async () => {
    const res = await bridge().write(entry.path, [manifestFile(entry.manifest)]);
    if (res.error !== undefined) throw new Error(res.error);
  });

  if (fresh.length) {
    const { importMediaFiles } = await import('../import/importMedia');
    const files = fresh.map(
      (f) => new File([f.blob], f.file.slice(f.file.indexOf('/') + 1), { type: f.mime }),
    );
    await importMediaFiles(files, viewCentre());
  }
  for (const c of changed) {
    await putAsset(c.blob, { board: entry.id });
    let size: { width: number; height: number } | null = null;
    if (c.blob.type.startsWith('image/')) {
      try {
        const bmp = await createImageBitmap(c.blob);
        size = { width: bmp.width, height: bmp.height };
        bmp.close();
      } catch {
        /* the item keeps its recorded size */
      }
    }
    const { updateItems } = await import('../../state/commands');
    const current = useDocumentStore.getState().doc;
    const ids = Object.values(current.items)
      .filter((it) => {
        const field = primaryAssetField(it);
        return field !== null && (it as unknown as Record<string, unknown>)[field] === c.was;
      })
      .map((it) => it.id);
    if (!ids.length) continue;
    updateItems(ids, 'Replace media', (it) => {
      const field = primaryAssetField(it)!;
      (it as unknown as Record<string, unknown>)[field] = c.hash;
      if (it.type === 'image') {
        delete it.previewAssetId;
        if (size) {
          it.naturalWidth = size.width;
          it.naturalHeight = size.height;
        }
      }
    });
  }
  const n = fresh.length + changed.length;
  showNotice(
    n === 1
      ? `A file in “${nameOf(entry.path)}” was ${fresh.length ? 'added to the board' : 'updated on the board'}.`
      : `${n} files in “${nameOf(entry.path)}” were ${changed.length ? 'added or updated on the board' : 'added to the board'}.`,
    { id: `vault-absorb:${entry.id}`, kind: 'info' },
  );
}

// --- changes made outside the app --------------------------------------------

async function onExternalChange(paths: string[]): Promise<void> {
  await rescanVault();
  const { doc } = useDocumentStore.getState();
  const entry = open.get(doc.id);
  if (!entry || useSessionStore.getState().view === 'library') return;
  if (!paths.some((p) => p === entry.path || p.startsWith(`${entry.path}/`))) return;
  if (entry.manifest.lock) return;
  // Files put in, replaced or taken from the media folders.
  const media = paths.filter(
    (p) => p.startsWith(`${entry.path}/`) && isMediaPath(p.slice(entry.path.length + 1)),
  );
  if (media.length) {
    try {
      await absorbFolderFiles(entry, media);
    } catch (err) {
      console.warn('boardCache: a file in the board folder could not be added', err);
    }
  }
  // The open board's folder changed under it. Its document, when it is not
  // the one this window wrote, replaces the open one: the file is the board.
  const res = await bridge().read(entry.path, 'document.json');
  if (res.error !== undefined || res.mtime === entry.docStamp) return;
  try {
    const next = parseDocument(new TextDecoder().decode(res.bytes));
    entry.docStamp = res.mtime;
    useDocumentStore.getState().replaceDoc({ ...next, id: doc.id, name: nameOf(entry.path) });
    const { useHistoryStore } = await import('../../state/history');
    useHistoryStore.getState().clear();
    useHistoryStore.getState().markSaved();
    showNotice(`“${nameOf(entry.path)}” changed on disk and was reloaded.`, {
      id: `vault-reload:${doc.id}`,
      kind: 'info',
    });
  } catch (err) {
    console.warn('boardCache: the board folder changed but its document does not parse', err);
  }
}

// --- start -------------------------------------------------------------------

/**
 * Desktop: connect the folder to the stores, read it, and clear working
 * copies a crash left behind (one newer than its folder is written first).
 */
export function initVault(): void {
  const v = desktopVault();
  if (!v) return;
  setMediaMirror(mirror);
  setLocalMediaSource(source);
  v.onChanged((paths) => void onExternalChange(paths));
  // A board folder opened on the canvas looks at its media folders for
  // files that arrived while it was closed.
  useDocumentStore.subscribe((s, prev) => {
    if (s.doc.id === prev.doc.id) return;
    const entry = open.get(s.doc.id);
    if (!entry) return;
    void entry.chain.then(() =>
      absorbFolderFiles(entry).catch((err) =>
        console.warn('boardCache: files in the board folder could not be added', err),
      ),
    );
  });
  ready = (async () => {
    await rescanVault();
    const db = await getDb();
    for (const record of await db.getAll('boards')) {
      if (!record.vault) continue;
      const board = vaultBoard(record.id);
      if (board && record.updatedAt > board.updatedAt) {
        try {
          const manifest = await readManifest(board.path);
          const entry: OpenVault = {
            id: record.id,
            path: board.path,
            manifest,
            chain: Promise.resolve(),
            docStamp: null,
          };
          open.set(record.id, entry);
          await writeBackMedia(entry);
          await writeVaultRecord(record);
          open.delete(record.id);
          console.info(`boardCache: board folder ${board.path} caught up from the last session`);
        } catch (err) {
          console.warn(`boardCache: board folder ${board.path} could not catch up`, err);
        }
      }
      await deleteBoardMedia(record.id);
      await db.delete('boards', record.id);
    }
    await rescanVault();
  })();
  window.addEventListener('focus', () => void rescanVault());
}

/** Settings: choose, change or forget the board folder. */
export async function chooseVaultFolder(): Promise<boolean> {
  const res = await bridge().choose();
  if (res.cancelled) return false;
  useVaultStore.setState({ root: res.root, loaded: false, dirs: [], boards: [] });
  await rescanVault();
  return true;
}

export async function clearVaultFolder(): Promise<void> {
  for (const id of [...open.keys()]) await evictVaultBoard(id);
  await bridge().clear();
  useVaultStore.setState({ root: null, loaded: true, dirs: [], boards: [] });
}
