import type { CanvasDocument } from '@boardcache/schema';
import {
  collectAssetIds,
  createDocument,
  migrateDocument,
  newId,
  validateDocument,
} from '@boardcache/schema';
import { assetTotalBytes } from './assetStore';
import { scheduleDirectoryPublish } from '../sync/boardDirectory';
import {
  dropSessionLock,
  encryptDoc,
  getSessionLock,
  unlockForSession,
  unlockForSessionWithKey,
} from './boardLock';
import { estimateBoardBytes } from './boardSize';
import { getDb } from '../db';
import { syncedBoardIds } from '../sync/syncMetaStore';
import { renderThumbnails } from '../media/thumbnail';
import { useDocumentStore } from '../../state/documentStore';
import { stripTeamOnly } from '../sync/teamOnly';
import { useHistoryStore } from '../../state/history';
import { useSessionStore } from '../../state/sessionStore';
import { collabActive } from '../../state/collabStore';

const LAST_BOARD_KEY = 'boardcache:lastBoard';

export interface BoardSummary {
  id: string;
  name: string;
  updatedAt: string;
  thumbnailUrl: string | null; // legacy single preview; caller revokes via revokeSummaries
  thumbnailLightUrl: string | null;
  thumbnailDarkUrl: string | null;
  /** Opted into cloud sync. */
  synced: boolean;
  /** Estimated on-disk size in bytes (document + referenced assets). */
  size: number | null;
  /** Password-locked (document + exclusive assets encrypted at rest). */
  locked: boolean;
  /** The lock's salt; a folder lock's boards all carry the folder's. */
  lockSalt: string | null;
  /** Known from the account's meta envelope only — not downloaded yet. */
  remote: boolean;
  /** Personal template (settings.isTemplate) — picker, not the grid. */
  isTemplate: boolean;
}

export function rememberLastBoard(id: string): void {
  try {
    localStorage.setItem(LAST_BOARD_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

export function lastBoardId(): string | null {
  try {
    return localStorage.getItem(LAST_BOARD_KEY);
  } catch {
    return null;
  }
}

/** Persist a document (optionally with a fresh thumbnail). */
export async function saveBoardRecord(doc: CanvasDocument, withThumbnail = false): Promise<void> {
  const db = await getDb();
  const existing = await db.get('boards', doc.id);
  const json = JSON.stringify(doc);
  const size =
    new TextEncoder().encode(json).byteLength + (await assetTotalBytes(collectAssetIds(doc)));

  // A board opened with its password saves back ENCRYPTED — no plaintext doc,
  // no thumbnail (it would leak content on the library index).
  const session = getSessionLock(doc.id);
  if (session) {
    await db.put('boards', {
      id: doc.id,
      doc: null,
      name: doc.name,
      updatedAt: doc.updatedAt,
      size,
      lock: {
        salt: session.salt,
        doc: await encryptDoc(session.key, doc),
        assets: [...new Set(collectAssetIds(doc))],
      },
    });
    scheduleDirectoryPublish();
    return;
  }

  const record = {
    id: doc.id,
    doc: JSON.parse(json) as unknown,
    name: doc.name,
    updatedAt: doc.updatedAt,
    size,
    ...(existing?.thumbnail ? { thumbnail: existing.thumbnail } : {}),
    ...(existing?.thumbnailLight ? { thumbnailLight: existing.thumbnailLight } : {}),
    ...(existing?.thumbnailDark ? { thumbnailDark: existing.thumbnailDark } : {}),
  };
  if (withThumbnail) {
    try {
      const thumbs = await renderThumbnails(doc);
      record.thumbnailLight = thumbs.light;
      record.thumbnailDark = thumbs.dark;
      delete record.thumbnail; // superseded by the theme pair
    } catch {
      /* thumbnail is cosmetic — never block a save on it */
    }
  }
  await db.put('boards', record);
  scheduleDirectoryPublish();
}

export async function loadBoardRecord(id: string): Promise<CanvasDocument | null> {
  const db = await getDb();
  const record = await db.get('boards', id);
  if (!record || record.lock) return null; // locked boards need openLockedBoard
  try {
    return validateDocument(migrateDocument(record.doc));
  } catch (err) {
    console.error(`boardCache: board ${id} failed validation`, err);
    return null;
  }
}

export async function listBoards(): Promise<BoardSummary[]> {
  const db = await getDb();
  const [records, synced] = await Promise.all([db.getAll('boards'), syncedBoardIds()]);
  const sorted = records.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return Promise.all(
    sorted.map(async (r) => ({
      id: r.id,
      name: r.name,
      updatedAt: r.updatedAt,
      thumbnailUrl: r.thumbnail ? URL.createObjectURL(r.thumbnail) : null,
      thumbnailLightUrl: r.thumbnailLight ? URL.createObjectURL(r.thumbnailLight) : null,
      thumbnailDarkUrl: r.thumbnailDark ? URL.createObjectURL(r.thumbnailDark) : null,
      synced: synced.has(r.id) || r.remote === true,
      isTemplate:
        (r.doc as CanvasDocument | null)?.settings?.isTemplate === true ||
        r.remoteTemplate === true,
      locked: r.lock !== undefined || r.remoteLocked === true,
      lockSalt: r.lock?.salt ?? null,
      remote: r.remote === true,
      // Stored at save time; fall back for boards saved before sizes existed.
      size:
        typeof r.size === 'number'
          ? r.size
          : r.doc
            ? await estimateBoardBytes(r.doc as CanvasDocument).catch(() => null)
            : null,
    })),
  );
}

export function revokeSummaries(summaries: BoardSummary[]): void {
  for (const s of summaries) {
    for (const url of [s.thumbnailUrl, s.thumbnailLightUrl, s.thumbnailDarkUrl]) {
      if (url) URL.revokeObjectURL(url);
    }
  }
}

/**
 * The doc as of the last thumbnail-bearing save (or as loaded — a fresh open
 * matches its stored record and thumbnail). Docs are immutable, so an
 * identity check is an exact "anything changed?" test.
 */
let lastThumbnailDoc: CanvasDocument | null = null;

/** True when leaving the open board actually has something to persist. */
export function boardNeedsFlush(): boolean {
  // A board is only OPEN on the canvas/gallery or a plugin's full-screen
  // view (Projects). On the index, community, or 404 views the in-memory
  // doc is a throwaway blank (cold boot) or the fresh blank closeBoard swaps
  // in — flushing it would mint phantom empty boards (e.g. one per community
  // clone).
  const view = useSessionStore.getState().view;
  if (view !== 'canvas' && view !== 'gallery' && view !== 'plugin') return false;
  // Team boards persist on the server through their room, never locally.
  if (collabActive()) return false;
  return useDocumentStore.getState().doc !== lastThumbnailDoc;
}

/** Snapshot the open board (with thumbnail) — call before leaving it. */
export async function flushCurrentBoard(): Promise<void> {
  if (!boardNeedsFlush()) return;
  const { doc } = useDocumentStore.getState();
  await saveBoardRecord(doc, true);
  lastThumbnailDoc = doc;
  useHistoryStore.getState().markSaved();
}

/**
 * Fully close the open board: save it, switch to the index, and replace the
 * document with a fresh blank so no real board stays loaded in the background.
 * A backgrounded board would otherwise keep autosaving / syncing and could
 * create conflicted copies when the same board is open on another device.
 */
export async function closeBoard(): Promise<void> {
  void import('../sync/editLease').then(({ stopLease }) => stopLease());
  // Team boards persist through their room; the LOCAL flush/share path below
  // must never run for them (it would copy the team doc into this device's
  // library) — decide before the session is torn down.
  const wasCollab = collabActive();
  if (wasCollab) {
    const { closeCollab } = await import('../sync/collab');
    const { useCollabStore } = await import('../../state/collabStore');
    const { boardId, role } = useCollabStore.getState();
    const doc = useDocumentStore.getState().doc;
    closeCollab();
    // Members leave a fresh library thumbnail behind (fire-and-forget;
    // guests have no session to authenticate the upload with).
    if (boardId && role && role !== 'guest') {
      void (async () => {
        try {
          const { renderThumbnails } = await import('../media/thumbnail');
          const { apiFetch } = await import('../sync/apiBase');
          const thumbs = await renderThumbnails(doc);
          const b64 = async (blob: Blob) => {
            const buf = new Uint8Array(await blob.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i += 0x8000) {
              bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
            }
            return btoa(bin);
          };
          await apiFetch(`/api/team/${boardId}/thumbnail`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ light: await b64(thumbs.light), dark: await b64(thumbs.dark) }),
          });
        } catch {
          /* thumbnail is decorative — never block leaving */
        }
      })();
    }
  }
  const closingId = useDocumentStore.getState().doc.id;
  // Saving can take a moment (thumbnails re-render every asset) — say so
  // immediately instead of leaving the ✕ click seemingly ignored.
  const { setExportBusy } = useSessionStore.getState();
  if (!wasCollab) {
    // Untouched since open (or last save)? Close instantly — no overlay, no
    // thumbnail re-render.
    if (boardNeedsFlush()) {
      setExportBusy('Saving board');
      await new Promise((r) => requestAnimationFrame(() => r(null))); // let it paint
      try {
        await flushCurrentBoard(); // saves while a board is still "open" (view != library)
      } finally {
        setExportBusy(null);
      }
    }
    // A link-mode public share follows the board: republish silently on close
    // (fire-and-forget — closing must never wait on the network; it self-skips
    // when the share already has this doc version). VIEWER-guarded so the
    // offline viewer's single-file IIFE build never has to emit a chunk for
    // this dynamic import (boards don't close there).
    if (!import.meta.env.VIEWER) {
      const closingDoc = useDocumentStore.getState().doc;
      void import('../sync/share').then((m) => m.autoUpdateShare(closingDoc));
    }
  }
  // Forget a locked board's key — reopening it needs the password again.
  dropSessionLock(closingId);
  const session = useSessionStore.getState();
  session.clearSelection();
  session.setEditingItemId(null);
  session.setGesture(null);
  session.resetBoardUi();
  session.setView('library');
  // Swap in a throwaway blank — autosave is skipped while on the index.
  useDocumentStore.getState().replaceDoc(createDocument({ name: 'Untitled board' }));
  const history = useHistoryStore.getState();
  history.clear();
  history.markSaved();
}

/** Make `doc` the open board: swap stores, reset history, remember it. */
function activate(doc: CanvasDocument): void {
  const session = useSessionStore.getState();
  session.clearSelection();
  session.setEditingItemId(null);
  session.setGesture(null);
  session.resetBoardUi();
  useDocumentStore.getState().replaceDoc(doc);
  // replaceDoc stores this exact object, so a no-change close is a no-op.
  lastThumbnailDoc = doc;
  const history = useHistoryStore.getState();
  history.clear();
  history.markSaved();
  rememberLastBoard(doc.id);
  // Single-editor lease for synced boards: declining a takeover closes the
  // board again (fire-and-forget — presence never blocks opening).
  void import('../sync/editLease').then(({ acquireEditLease }) =>
    acquireEditLease(doc.id, doc.name).then((ok) => {
      if (!ok && useDocumentStore.getState().doc.id === doc.id) void closeBoard();
    }),
  );
}

async function openBoardInternal(id: string, flush: boolean): Promise<boolean> {
  if (flush) await flushCurrentBoard();
  // A remote stub downloads on first open (doc + media), then opens normally.
  const record = await (await getDb()).get('boards', id);
  if (record?.remote) {
    const { setExportBusy, setExportProgress } = useSessionStore.getState();
    setExportBusy('Downloading board');
    try {
      const { downloadBoard } = await import('../sync/boardSync');
      if (!(await downloadBoard(id, setExportProgress))) return false;
    } finally {
      setExportBusy(null);
    }
  }
  const doc = await loadBoardRecord(id);
  if (!doc) return false;
  activate(doc);
  useSessionStore.getState().setView('canvas');
  return true;
}

export const openBoard = (id: string): Promise<boolean> => openBoardInternal(id, true);

/** Open a password-locked board. Returns false for a wrong password. */
export async function openLockedBoard(id: string, password: string): Promise<boolean> {
  await flushCurrentBoard();
  return activateUnlocked(id, await unlockForSession(id, password));
}

/** Open a board locked with its folder, using the folder's session key. */
export async function openLockedBoardWithKey(id: string, key: CryptoKey): Promise<boolean> {
  await flushCurrentBoard();
  return activateUnlocked(id, await unlockForSessionWithKey(id, key));
}

async function activateUnlocked(id: string, doc: CanvasDocument | null): Promise<boolean> {
  if (!doc) return false;
  activate(doc);
  useSessionStore.getState().setView('canvas');
  // Anything queued for this board while it was locked lands now.
  const { deliverInbox } = await import('../sync/boardInbox');
  void deliverInbox(id);
  return true;
}

/** Open a board WITHOUT saving the current one — used on first load / deep links,
 * where the current doc is the throwaway default we don't want to persist. */
export const openBoardNoFlush = (id: string): Promise<boolean> => openBoardInternal(id, false);

export async function createBoard(name = 'Untitled board'): Promise<string> {
  await flushCurrentBoard();
  const doc = createDocument({ name });
  // With thumbnail (cheap for a blank doc): an untouched board closes
  // without a flush, so this is its one chance to get a library thumbnail.
  await saveBoardRecord(doc, true);
  activate(doc);
  useSessionStore.getState().setView('canvas');
  return doc.id;
}

export async function duplicateBoard(id: string): Promise<string | null> {
  const source = await loadBoardRecord(id);
  if (!source) return null;
  const now = new Date().toISOString();
  const copy: CanvasDocument = {
    ...source,
    id: newId(),
    name: `${source.name} copy`,
    createdAt: now,
    updatedAt: now,
  };
  await saveBoardRecord(copy, true);
  return copy.id;
}

/** Duplicate a personal template (works on synced stubs — downloads first).
 *  The copy syncs like a freshly saved template so it roams the same way. */
export async function duplicateTemplate(id: string): Promise<string | null> {
  let source = await loadBoardRecord(id);
  if (!source) {
    const { downloadBoard } = await import('../sync/boardSync');
    if (await downloadBoard(id)) source = await loadBoardRecord(id);
  }
  if (!source) return null;
  const now = new Date().toISOString();
  const copy: CanvasDocument = {
    ...source,
    id: newId(),
    name: `${source.name} copy`,
    createdAt: now,
    updatedAt: now,
  };
  await saveBoardRecord(copy, true);
  const { useSyncStore } = await import('../../state/syncStore');
  if (useSyncStore.getState().status === 'signedIn') {
    const { enableBoardSync, markBoardDirty } = await import('../sync/boardSync');
    await enableBoardSync(copy.id);
    await markBoardDirty(copy.id);
  }
  return copy.id;
}

/** Snapshot the OPEN board as a personal template (new hidden record).
 *  Inherits the source board's sync opt-in so it roams the same way. */
export async function saveOpenBoardAsTemplate(name: string): Promise<string> {
  const doc = useDocumentStore.getState().doc;
  const now = new Date().toISOString();
  const snapshot: CanvasDocument = {
    ...structuredClone(doc),
    id: newId(),
    name,
    settings: { ...doc.settings, isTemplate: true },
    createdAt: now,
    updatedAt: now,
  };
  await saveBoardRecord(snapshot, true);
  // Signed in → templates sync automatically, so they roam across devices.
  const { useSyncStore } = await import('../../state/syncStore');
  if (useSyncStore.getState().status === 'signedIn') {
    const { enableBoardSync, markBoardDirty } = await import('../sync/boardSync');
    await enableBoardSync(snapshot.id);
    await markBoardDirty(snapshot.id);
  }
  return snapshot.id;
}

/** Create and open a fresh board from a personal template. */
export async function createBoardFromUserTemplate(
  templateId: string,
  name: string,
): Promise<string | null> {
  let source = await loadBoardRecord(templateId);
  if (!source) {
    // A synced template stub — pull the real document first.
    const { downloadBoard } = await import('../sync/boardSync');
    if (await downloadBoard(templateId)) source = await loadBoardRecord(templateId);
  }
  if (!source) return null;
  await flushCurrentBoard();
  const now = new Date().toISOString();
  const copy: CanvasDocument = {
    ...structuredClone(source),
    id: newId(),
    name,
    settings: { ...source.settings, isTemplate: false },
    createdAt: now,
    updatedAt: now,
  };
  await saveBoardRecord(copy, true);
  activate(copy);
  useSessionStore.getState().setView('canvas');
  return copy.id;
}

/**
 * Copy a live team board into a plain local board on this device — the
 * document snapshot plus every referenced asset from the room's shared
 * store. The copy is a normal local board (not synced, not collaborative).
 */
/** Fetch + validate a team board's document from its room. */
export async function fetchTeamDoc(
  teamId: string,
): Promise<{ name: string; doc: CanvasDocument } | null> {
  const { apiFetch } = await import('../sync/apiBase');
  const res = await apiFetch(`/api/team/${teamId}`, { credentials: 'include' }).catch(() => null);
  if (!res?.ok) return null;
  const { board } = (await res.json()) as { board: { name: string; doc: unknown } };
  try {
    return { name: board.name, doc: validateDocument(migrateDocument(board.doc)) };
  } catch (err) {
    console.error(`boardCache: team board ${teamId} failed validation`, err);
    return null;
  }
}

export async function duplicateTeamBoardAsLocal(teamId: string): Promise<string | null> {
  const { apiFetch } = await import('../sync/apiBase');
  const fetched = await fetchTeamDoc(teamId);
  if (!fetched) return null;
  const { doc } = fetched;
  const board = { name: fetched.name };
  const now = new Date().toISOString();
  const copy: CanvasDocument = stripTeamOnly({
    ...doc,
    id: newId(),
    name: `${board.name} copy`,
    createdAt: now,
    updatedAt: now,
  });
  // Pull the room's assets into the local store (skip ones we already have —
  // content addressing makes this a cheap existence check). A missing asset
  // degrades to a placeholder box, never a failed duplicate.
  const db = await getDb();
  for (const assetId of new Set(collectAssetIds(copy))) {
    if ((await db.getKey('assets', assetId)) !== undefined) continue;
    const r = await apiFetch(`/api/team/${teamId}/assets/${assetId}`, {
      credentials: 'include',
    }).catch(() => null);
    if (!r?.ok) continue;
    const blob = await r.blob();
    await db.put('assets', {
      hash: assetId,
      blob,
      mime: blob.type || 'application/octet-stream',
      bytes: blob.size,
    });
  }
  await saveBoardRecord(copy, true);
  return copy.id;
}

export async function deleteBoard(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('boards', id);
  dropSessionLock(id);
  scheduleDirectoryPublish();
  // A locked board's encrypted assets belong to it exclusively — remove them.
  for (const asset of await db.getAll('assets')) {
    if (asset.lock?.boardId === id) await db.delete('assets', asset.hash);
  }
  // Deleting the open board: move to whatever exists, or a fresh board.
  if (useDocumentStore.getState().doc.id === id) {
    const remaining = await db.getAll('boards');
    const next = remaining.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    const doc = next ? await loadBoardRecord(next.id) : null;
    activate(doc ?? createDocument());
  }
}

export async function renameBoardRecord(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const db = await getDb();
  const record = await db.get('boards', id);
  if (!record) return;
  // While locked, only the visible record name changes; the encrypted doc's
  // name is overridden from the record on the next unlock.
  if (record.doc) (record.doc as { name?: unknown }).name = trimmed;
  await db.put('boards', { ...record, name: trimmed });
  scheduleDirectoryPublish();
  // Keep the open board in sync (direct rename, not an undo step — renaming
  // from the library is a library operation, not a canvas edit).
  const { doc: current, replaceDoc } = useDocumentStore.getState();
  if (current.id === id) replaceDoc({ ...current, name: trimmed });
}
