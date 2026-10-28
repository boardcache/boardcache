import type { CanvasDocument } from '@boardcache/schema';
import type { Kdf } from '@boardcache/e2ee';
import {
  collectAssetIds,
  itemAssetIds,
  newId,
  parseDocument,
  serializeDocument,
} from '@boardcache/schema';
import { apiFetch } from './apiBase';
import {
  lastAssetPushError,
  lastAssetPushStatus,
  missingOnServer,
  pullAssets,
  pushAssets,
} from './assetSync';
import type { PushReport } from './assetSync';
import { deleteBoard, loadBoardRecord, saveBoardRecord } from '../board/boardLibrary';
import { getLockedRecord, saveLockedRecordFromSync } from '../board/boardLock';
import type { LockedRecord } from '../board/boardLock';
import { SyncError } from './syncApi';
import { formatMb, oversizeAssets, syncAssetLimitBytes } from '../limits';
import { showNotice } from '../notices';
import { logDeviceEvent } from '../deviceLog';
import { decryptBytes, encryptBytes, fromBase64, toBase64 } from '@boardcache/e2ee';
import { getDb } from '../db';
import { allSyncMeta, deleteSyncMeta, getSyncMeta, setSyncMeta } from './syncMetaStore';
import { useDocumentStore } from '../../state/documentStore';
import { isDirty as boardIsDirty, useHistoryStore } from '../../state/history';
import { useSessionStore } from '../../state/sessionStore';
import { requireAdk, useSyncStore } from '../../state/syncStore';
import { relabelAssetsIfNeeded } from './assetIds';
import { create } from 'zustand';

/**
 * Per-board sync activity for the library cards ("Syncing" while a board's
 * push/pull is actually in flight — the global top-bar state can't say WHICH
 * board is moving).
 */
export const useBoardSyncActivity = create<{ syncing: Record<string, true> }>(() => ({
  syncing: {},
}));

function boardSyncStart(id: string): void {
  useBoardSyncActivity.setState((s) => ({ syncing: { ...s.syncing, [id]: true } }));
}

function boardSyncEnd(id: string): void {
  useBoardSyncActivity.setState((s) => {
    const syncing = { ...s.syncing };
    delete syncing[id];
    return { syncing };
  });
}
import type { SyncActivity } from '../../state/syncStore';

/**
 * Per-board cloud sync. A board is local until the user opts it in; once synced,
 * its document is end-to-end encrypted and pushed/pulled by revision. Conflicts
 * (the same board edited on two devices) resolve as whole-board last-write-wins
 * with a local "conflicted copy" so nothing is ever lost.
 */

const utf8 = new TextEncoder();
const SYNC_DEBOUNCE_MS = 1500;
const POLL_MS = 30_000;

const signedIn = (): boolean => {
  const s = useSyncStore.getState();
  return s.status === 'signedIn' && s.adk !== null;
};

interface SyncUpdate {
  activity?: SyncActivity;
  detail?: string | null;
  lastSyncedAt?: number | null;
  progress?: number | null;
}
const setSync = (update: SyncUpdate): void => useSyncStore.setState(update);

// --- server API -------------------------------------------------------------

interface ServerMeta {
  id: string;
  rev: number;
  updatedAt: string;
  deleted: boolean;
}
interface ServerBoard {
  id: string;
  rev: number;
  ciphertext: string | null;
  deleted: boolean;
}

const api = (path: string, init?: RequestInit) =>
  apiFetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

async function listServer(): Promise<ServerMeta[]> {
  const res = await api('/boards');
  if (!res.ok) throw new Error('list failed');
  return ((await res.json()) as { boards: ServerMeta[] }).boards;
}

async function getServer(id: string): Promise<ServerBoard | null> {
  const res = await api(`/boards/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('get failed');
  return (await res.json()) as ServerBoard;
}

async function putServer(
  id: string,
  baseRev: number,
  ciphertext: string,
  metaCiphertext?: string | null,
): Promise<{ rev: number } | { conflict: true }> {
  const res = await api(`/boards/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ baseRev, ciphertext, ...(metaCiphertext ? { metaCiphertext } : {}) }),
  });
  if (res.status === 409) return { conflict: true };
  if (!res.ok) {
    // Surface the server's own reason (quota gates write good messages).
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new SyncError(
      body?.error ??
        (res.status === 413 ? 'This board’s document is too large to sync.' : 'put failed'),
    );
  }
  return { rev: ((await res.json()) as { rev: number }).rev };
}

async function getServerMetaEnvelope(id: string): Promise<string | null> {
  const res = await api(`/boards/${id}/meta`);
  if (!res.ok) return null;
  return ((await res.json()) as { metaCiphertext: string | null }).metaCiphertext;
}

async function deleteServer(id: string, baseRev: number): Promise<void> {
  await api(`/boards/${id}`, { method: 'DELETE', body: JSON.stringify({ baseRev }) });
}

// --- document encryption ----------------------------------------------------

async function encryptDoc(doc: CanvasDocument): Promise<string> {
  const bytes = new Uint8Array(utf8.encode(serializeDocument(doc)));
  return toBase64(await encryptBytes(requireAdk(), bytes));
}

/** Locked boards sync as an envelope holding the LOCK ciphertext — the
 *  password layer survives transport end to end; the server (and this
 *  pipeline) never see the document. */
interface LockedEnvelope {
  __bcLocked: 1;
  salt: string;
  /** The lock's key derivation; absent = PBKDF2 (older locks). */
  kdf?: Kdf | undefined;
  doc: string;
  name: string;
  updatedAt: string;
  assets: string[];
}

async function encryptLocked(record: LockedRecord): Promise<string> {
  const envelope: LockedEnvelope = {
    __bcLocked: 1,
    salt: record.salt,
    ...(record.kdf ? { kdf: record.kdf } : {}),
    doc: record.doc,
    name: record.name,
    updatedAt: record.updatedAt,
    assets: record.assets,
  };
  const bytes = new Uint8Array(utf8.encode(JSON.stringify(envelope)));
  return toBase64(await encryptBytes(requireAdk(), bytes));
}

type SyncPayload =
  | { kind: 'doc'; doc: CanvasDocument }
  | { kind: 'locked'; locked: LockedEnvelope };

/**
 * Lazy sync: a tiny E2E-encrypted envelope (name + thumbnails) pushed beside
 * every board so OTHER devices can list it without downloading the document
 * or its media. Boards known only by meta are stored locally as "remote"
 * stubs; opening (or an explicit Download) pulls the real thing.
 */
interface SyncBoardMeta {
  __bcMeta: 1;
  name: string;
  updatedAt: string;
  locked?: boolean;
  /** Personal template — other devices stub it into My Templates. */
  isTemplate?: boolean;
  thumbLight?: string | undefined; // base64 webp
  thumbDark?: string | undefined;
}

async function buildMetaCiphertext(id: string): Promise<string | null> {
  try {
    const db = await getDb();
    const record = await db.get('boards', id);
    if (!record) return null;
    const b64 = async (blob?: Blob) =>
      blob ? toBase64(new Uint8Array(await blob.arrayBuffer())) : undefined;
    const meta: SyncBoardMeta = {
      __bcMeta: 1,
      name: record.name,
      updatedAt: record.updatedAt,
      ...(record.lock ? { locked: true } : {}),
      ...((record.doc as { settings?: { isTemplate?: boolean } } | null)?.settings?.isTemplate
        ? { isTemplate: true }
        : {}),
      thumbLight: await b64(record.thumbnailLight ?? record.thumbnail),
      thumbDark: await b64(record.thumbnailDark ?? record.thumbnail),
    };
    const bytes = new Uint8Array(utf8.encode(JSON.stringify(meta)));
    return toBase64(await encryptBytes(requireAdk(), bytes));
  } catch {
    return null; // meta is best-effort; the push itself must not fail on it
  }
}

/** Create/refresh a lightweight stub from the server's meta envelope.
 *  Returns false when the board has no meta (older pushes) — the caller
 *  falls back to a full pull. */
/** Re-home a local record under a fresh id (doc id included) so the server
 *  version can land on the original id without destroying local work. */
async function preserveLocalCopy(record: {
  id: string;
  name: string;
  doc: unknown;
}): Promise<void> {
  const { newId } = await import('@boardcache/schema');
  const db = await getDb();
  const id = newId();
  const doc =
    record.doc && typeof record.doc === 'object'
      ? { ...(record.doc as Record<string, unknown>), id, name: `${record.name} (local copy)` }
      : record.doc;
  await db.put('boards', {
    ...(record as object),
    id,
    name: `${record.name} (local copy)`,
    doc,
  } as never);
  await db.delete('boards', record.id);
}

async function stubBoard(id: string, rev: number): Promise<boolean> {
  const envelope = await getServerMetaEnvelope(id);
  if (!envelope) return false;
  let meta: SyncBoardMeta;
  try {
    const bytes = await decryptBytes(requireAdk(), fromBase64(envelope));
    meta = JSON.parse(new TextDecoder().decode(bytes)) as SyncBoardMeta;
    if (meta.__bcMeta !== 1) return false;
  } catch {
    return false;
  }
  const blob = (b64?: string) =>
    b64 ? new Blob([fromBase64(b64)], { type: 'image/webp' }) : undefined;
  const db = await getDb();
  const light = blob(meta.thumbLight);
  const dark = blob(meta.thumbDark);
  await db.put('boards', {
    id,
    doc: null,
    name: meta.name,
    updatedAt: meta.updatedAt,
    remote: true,
    ...(meta.locked ? { remoteLocked: true } : {}),
    ...(meta.isTemplate ? { remoteTemplate: true } : {}),
    ...(light ? { thumbnailLight: light } : {}),
    ...(dark ? { thumbnailDark: dark } : {}),
  });
  // A synced template arriving on a device that seeded its own local copy of
  // the same example: drop the unsynced local twin (identical starter
  // content) rather than showing duplicates.
  if (meta.isTemplate) {
    for (const r of await db.getAll('boards')) {
      if (
        r.id !== id &&
        !r.remote &&
        r.name === meta.name &&
        (r.doc as { settings?: { isTemplate?: boolean } } | null)?.settings?.isTemplate === true &&
        !(await getSyncMeta(r.id))
      ) {
        await db.delete('boards', r.id);
      }
    }
  }
  await setSyncMeta({ id, rev, dirty: false });
  return true;
}

/** Explicitly download boards that are stubs (opening one does this too).
 *  `onProgress` gets the media-pull fraction (0..1) for a progress bar. */
export async function downloadBoard(
  id: string,
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  try {
    await pullBoard(id, onProgress);
    const db = await getDb();
    const record = await db.get('boards', id);
    return Boolean(record && !record.remote);
  } catch {
    return false;
  } finally {
    setSync({ detail: null });
  }
}

async function decryptPayload(ciphertext: string): Promise<SyncPayload> {
  const bytes = await decryptBytes(requireAdk(), fromBase64(ciphertext));
  const text = new TextDecoder().decode(bytes);
  try {
    const parsed = JSON.parse(text) as { __bcLocked?: number };
    if (parsed.__bcLocked === 1) return { kind: 'locked', locked: parsed as LockedEnvelope };
  } catch {
    /* fall through to document parsing */
  }
  return { kind: 'doc', doc: parseDocument(text) };
}

/** If the adopted board is the one on screen (and unedited), swap it in live. */
function adoptIntoOpenBoard(doc: CanvasDocument): void {
  // Never adopt into a board that's only loaded in the background (on the index).
  if (useSessionStore.getState().view === 'library') return;
  if (useDocumentStore.getState().doc.id !== doc.id || boardIsDirty()) return;
  useDocumentStore.getState().replaceDoc(doc);
  const history = useHistoryStore.getState();
  history.clear();
  history.markSaved();
}

/**
 * A failed pass: the pill turns red with the reason in its tooltip, but a
 * phone has no hover — so the reason is also a notice, and a device-log
 * line so the failure can be read from the server afterwards.
 */
function reportSyncError(detail: string | null): void {
  setSync({ activity: 'error', detail, progress: null });
  showNotice(detail ? `Sync failed — ${detail}` : 'Sync failed — will retry.', {
    id: 'sync-failed',
    timeoutMs: 15_000,
  });
  logDeviceEvent('sync-error', { detail: (detail ?? '').slice(0, 300) });
}

/** Why an upload from THIS device did not land, as specifically as known. */
async function uploadFailureMessage(ids: string[], report: PushReport): Promise<string> {
  const over = await oversizeAssets(ids);
  if (over.length > 0) {
    return `A ${formatMb(Math.max(...over.map((o) => o.bytes)))} file exceeds the ${formatMb(syncAssetLimitBytes())} sync limit — remove it from the board to finish syncing.`;
  }
  if (lastAssetPushError) return lastAssetPushError;
  const n = report.failed.length;
  const files = n === 1 ? 'A media file' : `${n} media files`;
  if (lastAssetPushStatus === 0) return `${files} failed to upload — the connection dropped.`;
  if (lastAssetPushStatus) return `${files} failed to upload (HTTP ${lastAssetPushStatus}).`;
  return `${files} failed to upload.`;
}

/**
 * The board references media that neither this device nor the server has —
 * added on another device that has not synced since. Say which items, and
 * leave a device-log line, instead of failing every pass.
 */
function noteAbsentMedia(boardId: string, doc: CanvasDocument, hashes: string[]): void {
  const missing = new Set(hashes);
  const items = Object.values(doc.items).filter((it) =>
    itemAssetIds(it).some((h) => missing.has(h)),
  );
  const named = items.map((it) => it.name ?? it.type);
  const examples = named.slice(0, 3).join(', ') + (named.length > 3 ? ', …' : '');
  const n = hashes.length;
  showNotice(
    `“${doc.name}”: ${n} media file${n === 1 ? '' : 's'} (${examples || 'unknown items'}) exist only on another device — they will sync when that device does.`,
    { id: `absent-media-${boardId}`, kind: 'info', timeoutMs: 12_000 },
  );
  logDeviceEvent('absent-media', {
    board: boardId,
    hashes: hashes.slice(0, 10),
    items: items.slice(0, 10).map((it) => ({ type: it.type, name: it.name ?? null })),
  });
}

// --- push / pull / conflict -------------------------------------------------

async function pushBoard(id: string): Promise<void> {
  const meta = await getSyncMeta(id);
  if (!meta) return;
  boardSyncStart(id);
  try {
    const [doc, locked] = await Promise.all([loadBoardRecord(id), getLockedRecord(id)]);
    const ids = doc ? collectAssetIds(doc) : (locked?.assets ?? []);
    if (!doc && !locked) return;
    const report = await pushAssets(ids, (f) =>
      setSync({ detail: `Uploading media ${Math.round(f * 100)}%` }),
    );
    // Never mark a board synced while media THIS device holds is still
    // missing on the server. Media this device never had is another
    // device's to upload: the document still syncs, and the board says so.
    const stillMissing = await missingOnServer(ids);
    if (stillMissing.length > 0) {
      const absent = new Set(report.absent);
      const failed = stillMissing.filter((h) => !absent.has(h));
      if (failed.length > 0) throw new SyncError(await uploadFailureMessage(ids, report));
      if (doc) noteAbsentMedia(id, doc, stillMissing);
    }
    setSync({ detail: 'Saving board' });
    const ciphertext = doc ? await encryptDoc(doc) : await encryptLocked(locked!);
    const res = await putServer(id, meta.rev, ciphertext, await buildMetaCiphertext(id));
    if ('conflict' in res) await resolveConflict(id);
    else await setSyncMeta({ id, rev: res.rev, dirty: false });
  } finally {
    boardSyncEnd(id);
  }
}

async function pullBoard(id: string, onProgress?: (fraction: number) => void): Promise<void> {
  const server = await getServer(id);
  if (!server || server.deleted || !server.ciphertext) return;
  boardSyncStart(id);
  try {
    setSync({ detail: 'Downloading' });
    onProgress?.(0);
    const payload = await decryptPayload(server.ciphertext);
    if (payload.kind === 'locked') {
      // A locked board lands locked: ciphertext record + ciphertext assets.
      await pullAssets(payload.locked.assets, onProgress);
      await saveLockedRecordFromSync({ id, ...payload.locked });
      await setSyncMeta({ id, rev: server.rev, dirty: false });
      onProgress?.(1);
      return;
    }
    const doc = payload.doc;
    await pullAssets(collectAssetIds(doc), onProgress);
    onProgress?.(1);
    // Render the thumbnail now (assets are local) so the board index shows a
    // preview immediately, without waiting for the board to be opened.
    await saveBoardRecord(doc, true);
    await setSyncMeta({ id, rev: server.rev, dirty: false });
    adoptIntoOpenBoard(doc);
  } finally {
    boardSyncEnd(id);
  }
}

async function resolveConflict(id: string): Promise<void> {
  const [server, localDoc, localLocked] = await Promise.all([
    getServer(id),
    loadBoardRecord(id),
    getLockedRecord(id),
  ]);
  if (!localDoc && localLocked) {
    // A locked board can't be merged without its password: whole-board
    // last-write-wins with the local lock ciphertext at the server's rev
    // (mirrors the undecryptable-server-copy rule below).
    const rev = server && !server.deleted ? server.rev : (server?.rev ?? 0);
    const res = await putServer(
      id,
      rev,
      await encryptLocked(localLocked),
      await buildMetaCiphertext(id),
    );
    if (!('conflict' in res)) await setSyncMeta({ id, rev: res.rev, dirty: false });
    return;
  }
  if (!localDoc) return; // gone locally; the tombstone path handles deletion
  if (!server) {
    // The server row vanished (e.g. account data reset): the board is new
    // again — re-create it rather than 409ing forever against nothing.
    await setSyncMeta({ id, rev: 0, dirty: true });
    await pushBoard(id);
    return;
  }
  if (server.deleted || !server.ciphertext) {
    // Remote tombstone vs local edits: the edits win and resurrect the board.
    const res = await putServer(
      id,
      server.rev,
      await encryptDoc(localDoc),
      await buildMetaCiphertext(id),
    );
    if (!('conflict' in res)) await setSyncMeta({ id, rev: res.rev, dirty: false });
    return; // conflicted again → retried next pass with a fresher rev
  }
  let serverDoc: CanvasDocument;
  try {
    const payload = await decryptPayload(server.ciphertext);
    if (payload.kind === 'locked') {
      // Server has a locked version, local is plaintext-dirty: fork the local
      // edits, adopt the locked server copy at the original id.
      const now = new Date().toISOString();
      const fork: CanvasDocument = {
        ...localDoc,
        id: newId(),
        name: `${localDoc.name} (conflicted copy)`,
        createdAt: now,
        updatedAt: now,
      };
      await saveBoardRecord(fork, true); // fresh id → render its own thumbnail
      await pullAssets(payload.locked.assets);
      await saveLockedRecordFromSync({ id, ...payload.locked });
      await setSyncMeta({ id, rev: server.rev, dirty: false });
      return;
    }
    serverDoc = payload.doc;
  } catch {
    // Undecryptable server copy (encrypted under another account key era).
    // It's useless to this account — local wins at the server's current rev.
    const res = await putServer(
      id,
      server.rev,
      await encryptDoc(localDoc),
      await buildMetaCiphertext(id),
    );
    if (!('conflict' in res)) await setSyncMeta({ id, rev: res.rev, dirty: false });
    return;
  }
  // Fork the local edits into a fresh, un-synced board so nothing is lost.
  const now = new Date().toISOString();
  const copy: CanvasDocument = {
    ...localDoc,
    id: newId(),
    name: `${localDoc.name} (conflicted copy)`,
    createdAt: now,
    updatedAt: now,
  };
  await saveBoardRecord(copy, true); // fresh id → render its own thumbnail
  // Adopt the server version into the original id.
  await pullAssets(collectAssetIds(serverDoc));
  await saveBoardRecord(serverDoc, true);
  await setSyncMeta({ id, rev: server.rev, dirty: false });
  adoptIntoOpenBoard(serverDoc);
}

// --- reconcile (one full pass) ----------------------------------------------

let running = false;
let queued = false;

export async function reconcile(): Promise<void> {
  if (!signedIn()) return;
  // Assets go by private names on the server; an account from before that
  // scheme is relabelled first, or this pass would look for every asset
  // under a name the server does not have yet.
  if (!(await relabelAssetsIfNeeded())) {
    setSync({ activity: 'offline', detail: null });
    return;
  }
  // The server refuses an unverified account; wait for the code rather
  // than report every push as a failure. (The profile says whether this
  // server verifies at all.)
  if (!useSyncStore.getState().profile) await useSyncStore.getState().refreshProfile();
  const profile = useSyncStore.getState().profile;
  if (profile?.verifyEnabled && !profile.emailVerified) {
    setSync({ activity: 'idle', detail: null });
    return;
  }
  if (running) {
    queued = true;
    return;
  }
  running = true;
  setSync({ activity: 'syncing', detail: null });
  let hadError = false;
  let lastErrorDetail: string | null = null;
  try {
    let server: ServerMeta[];
    try {
      server = await listServer();
    } catch {
      setSync({ activity: 'offline', detail: null }); // unreachable — try again later
      return;
    }

    // Push local changes and deletions first (so conflicts surface here).
    for (const meta of await allSyncMeta()) {
      try {
        if (meta.deleted) {
          await deleteServer(meta.id, meta.rev);
          await deleteSyncMeta(meta.id);
        } else if (meta.dirty) {
          await pushBoard(meta.id);
        }
      } catch (err) {
        hadError = true; // leave dirty; retry next pass
        if (err instanceof Error && err.message) lastErrorDetail = err.message;
      }
    }

    // Pull boards that are new or newer on the server (and clean locally).
    // Runs a small pool (stubs are one request each — serial was the whole
    // "Downloading" wait on a fresh device), reports x/y progress on the
    // chip, and pings the library every few hundred ms so boards appear AS
    // they land instead of popping in at the end.
    const total = server.length;
    let done = 0;
    let lastPing = 0;
    const ping = (force = false) => {
      if (typeof window === 'undefined') return;
      const now = Date.now();
      if (!force && now - lastPing < 400) return;
      lastPing = now;
      window.dispatchEvent(new Event('boardcache:library-refresh'));
    };
    const pullOne = async (s: ServerMeta) => {
      try {
        const meta = await getSyncMeta(s.id);
        if (s.deleted) {
          if (meta && !meta.dirty) {
            await deleteBoard(s.id);
            await deleteSyncMeta(s.id);
          }
        } else if (!meta) {
          // A LOCAL board with the same id (kept across a sign-out, or an
          // imported twin) must not be clobbered by the server version —
          // keep it as "<name> (local copy)" under a fresh id first.
          const existing = await (await getDb()).get('boards', s.id);
          if (existing && !existing.remote) {
            await preserveLocalCopy(existing);
          }
          // New to this device: list it as a lightweight stub (name +
          // thumbnail only). Boards pushed before meta existed still pull
          // fully — the old behavior is the fallback, never a gap.
          if (!(await stubBoard(s.id, s.rev))) await pullBoard(s.id);
        } else if (s.rev > meta.rev && !meta.dirty) {
          const record = await (await getDb()).get('boards', s.id);
          if (record?.remote) {
            if (!(await stubBoard(s.id, s.rev))) await pullBoard(s.id);
          } else {
            await pullBoard(s.id);
          }
        }
      } catch {
        hadError = true;
      }
      done += 1;
      if (total > 3) {
        setSync({
          activity: 'syncing',
          detail: `Downloading boards ${done}/${total}…`,
          progress: done / total,
        });
      }
      ping();
    };
    const queue = [...server];
    await Promise.all(
      Array.from({ length: Math.min(5, Math.max(1, queue.length)) }, async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          await pullOne(next);
        }
      }),
    );
    ping(true);

    // Up to date only if nothing is still pending a push/tombstone.
    const pending = (await allSyncMeta()).some((m) => m.dirty || m.deleted);
    // The pill's tooltip carries WHY (oversize file, quota, …), not just "failed".
    if (hadError) reportSyncError(lastErrorDetail);
    else if (pending) setSync({ activity: 'syncing', detail: null, progress: null });
    else setSync({ activity: 'synced', detail: null, lastSyncedAt: Date.now(), progress: null });
  } catch (err) {
    reportSyncError(err instanceof Error && err.message ? err.message : null);
  } finally {
    running = false;
    // Pulls/tombstones may have changed which boards are synced.
    void useSyncStore.getState().refreshSyncedBoards();
    if (queued) {
      queued = false;
      void reconcile();
    }
  }
}

// --- background poll --------------------------------------------------------

let pollStarted = false;

/** Periodically pull remote changes while signed in, online, and visible. */
export function startSyncPoll(): void {
  if (pollStarted || typeof window === 'undefined') return;
  pollStarted = true;
  const maybeSync = () => {
    if (signedIn() && navigator.onLine && document.visibilityState === 'visible') void reconcile();
  };
  setInterval(maybeSync, POLL_MS);
  window.addEventListener('online', maybeSync);
  window.addEventListener('focus', maybeSync);
  document.addEventListener('visibilitychange', maybeSync);
}

// --- triggers ---------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced reconcile after local activity. */
function scheduleSync(): void {
  if (!signedIn()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void reconcile();
  }, SYNC_DEBOUNCE_MS);
}

/** Mark a synced board as changed and schedule a push. */
export async function markBoardDirty(id: string): Promise<void> {
  const meta = await getSyncMeta(id);
  if (!meta || meta.deleted) return;
  if (!meta.dirty) await setSyncMeta({ ...meta, dirty: true });
  scheduleSync();
}

/** Record that a synced board was deleted locally; it'll be tombstoned on the server. */
export async function onBoardDeleted(id: string): Promise<void> {
  const meta = await getSyncMeta(id);
  if (!meta) return;
  await setSyncMeta({ ...meta, deleted: true, dirty: true });
  scheduleSync();
}

/** Opt a board into cloud sync and push it now. */
export async function enableBoardSync(id: string): Promise<void> {
  // Capture any unsaved edits to the open board before the first push.
  const current = useDocumentStore.getState().doc;
  if (current.id === id) await saveBoardRecord(current);
  // Boundary awareness: syncing still turns on (removing the file fixes it),
  // but say up front why it won't complete.
  const doc = current.id === id ? current : await loadBoardRecord(id);
  if (doc) {
    const over = await oversizeAssets(collectAssetIds(doc));
    if (over.length > 0) {
      showNotice(
        `This board has ${over.length === 1 ? 'a file' : `${over.length} files`} over ${formatMb(syncAssetLimitBytes())} (largest ${formatMb(Math.max(...over.map((o) => o.bytes)))}) — it can’t finish syncing until ${over.length === 1 ? 'it’s' : 'they’re'} removed.`,
        { id: `oversize-${id}`, sticky: true },
      );
    }
  }
  await setSyncMeta({ id, rev: 0, dirty: true });
  await useSyncStore.getState().refreshSyncedBoards();
  await reconcile();
}

/** Stop syncing a board: remove it from the account (the local copy stays). */
export async function disableBoardSync(id: string): Promise<void> {
  const meta = await getSyncMeta(id);
  if (!meta) return;
  try {
    await deleteServer(id, meta.rev);
  } catch {
    /* best effort */
  }
  await deleteSyncMeta(id);
  await useSyncStore.getState().refreshSyncedBoards();
}

/** Test helper: push a remote edit at the server's current rev (a second device). */
export async function devSimulateRemoteEdit(id: string, label = ' [remote]'): Promise<void> {
  const [server, doc] = await Promise.all([getServer(id), loadBoardRecord(id)]);
  if (!server || !doc) return;
  const remote: CanvasDocument = { ...doc, name: doc.name + label };
  await putServer(id, server.rev, await encryptDoc(remote));
}
