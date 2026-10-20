import { applyPatches } from 'immer';
import type { Patch } from 'immer';
import type { CanvasDocument } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { showNotice } from '../notices';
import { apiFetch, apiUrl, crossOriginSync } from './apiBase';
import { clientToCanvas } from '../canvas/canvasDom';
import { useCollabStore } from '../../state/collabStore';
import type { ChatMessage, CollabPeer, RemoteBounds } from '../../state/collabStore';
import { useDocumentStore } from '../../state/documentStore';
import { useHistoryStore } from '../../state/history';
import { useSessionStore } from '../../state/sessionStore';
import { zoomToFit } from '../canvas/viewportActions';

/**
 * Team-board collaboration client. Commands apply locally first (optimistic)
 * and their immer patches mirror to the board's WebSocket room; the server
 * serializes batches and rebroadcasts. Remote batches apply here, then any
 * still-unacknowledged local batches re-apply on top (per-path last-write-
 * wins). Full-doc resyncs (init / reconnect / server rejection) preserve the
 * local viewport — where *you* look is never shared state.
 */

interface Session {
  /** Null until the ticket step (if any) finished and the socket was opened. */
  ws: WebSocket | null;
  boardId: string;
  /** Local batches sent but not yet echoed back by the server. */
  /** Batches sent (or queued) but not yet echoed back by the room. */
  pending: PendingBatch[];
  /** True while a server message is being applied (suppress re-mirroring). */
  applyingRemote: boolean;
  presenceTimer: ReturnType<typeof setTimeout> | null;
  lastPresence: string;
  closedByUs: boolean;
  guest: { slug: string; name: string } | null;
  unsubscribers: (() => void)[];
}

let session: Session | null = null;

const wsUrl = (path: string): string => {
  // Resolve against the configured sync server, not the page origin — a
  // foreign-hosted client's realtime rooms live on the sync server too.
  const url = new URL(apiUrl(path), window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

/**
 * Browsers can't set headers on a WebSocket, so nothing durable goes in the
 * URL: token clients and guests fetch a 30-second single-use ticket over a
 * normal request and the socket presents that. Same-origin cookie sessions
 * need nothing.
 */
async function socketTicket(boardId: string, guest: Session['guest']): Promise<string | null> {
  try {
    const res = guest
      ? await apiFetch(`/api/guest/${encodeURIComponent(guest.slug)}/ws-ticket`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: guest.name }),
        })
      : crossOriginSync()
        ? await apiFetch(`/api/team/${boardId}/ws-ticket`, { method: 'POST' })
        : null;
    if (!res) return null;
    if (!res.ok) return null;
    return ((await res.json()) as { ticket?: string }).ticket ?? null;
  } catch {
    return null;
  }
}

let connectSeq = 0;

interface PendingBatch {
  id: string;
  patches: Patch[];
}

/** Mirror a local command/undo/redo patch batch to the room. */
export function collabNotifyPatches(patches: Patch[]): void {
  if (!session || session.applyingRemote || patches.length === 0) return;
  const batch: PendingBatch = { id: newId(), patches };
  session.pending.push(batch);
  if (session.ws?.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({ t: 'patches', id: batch.id, patches }));
  }
  // Any asset the batch references must reach the room's shared store —
  // peers only receive ids, never bytes.
  void uploadAssetsIn(patches);
}

// --- shared room assets ------------------------------------------------------

const HASH_RE = /^[0-9a-f]{64}$/;
const uploadedAssets = new Set<string>();

/** Collect content-addressed asset ids from any *AssetId/assetId field. */
function collectAssetIds(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && /assetId$/i.test(key) && HASH_RE.test(v)) out.add(v);
    else if (v && typeof v === 'object') collectAssetIds(v, out);
  }
}

function teamAssetUrl(assetId: string): string {
  const guest = session?.guest;
  const query = guest ? `?guest=${encodeURIComponent(guest.slug)}` : '';
  return `/api/team/${session?.boardId}/assets/${assetId}${query}`;
}

async function uploadAssetsIn(patches: Patch[]): Promise<void> {
  if (!session) return;
  const ids = new Set<string>();
  for (const patch of patches) collectAssetIds({ v: patch.value }, ids);
  for (const id of ids) {
    if (uploadedAssets.has(id)) continue;
    uploadedAssets.add(id);
    const { getAssetBlob } = await import('../board/assetStore');
    const blob = await getAssetBlob(id);
    if (!blob) continue;
    try {
      const res = await apiFetch(teamAssetUrl(id), {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-asset-mime': blob.type || 'application/octet-stream',
        },
        credentials: 'include',
        body: blob,
      });
      if (!res.ok) uploadedAssets.delete(id); // retried on next reference
    } catch {
      uploadedAssets.delete(id);
    }
  }
}

/** Convert a LOCAL board into a team room: create the room seeded with the
 *  document, upload every referenced asset, then remove the local record.
 *  Fail-closed — any upload failure deletes the half-made room and leaves
 *  the local board untouched. */
export async function convertBoardToTeam(
  boardId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: true; teamId: string } | { ok: false; error: string }> {
  const { loadBoardRecord, deleteBoard } = await import('../board/boardLibrary');
  const doc = await loadBoardRecord(boardId);
  if (!doc) return { ok: false, error: 'This board is locked or not available locally.' };
  let res: Response;
  try {
    res = await apiFetch('/api/team', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: doc.name, doc }),
    });
  } catch {
    return { ok: false, error: 'Could not reach the sync server.' };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? 'Could not create the team board.' };
  }
  const { id: teamId } = (await res.json()) as { id: string };
  const [{ getAssetBlob }, schema] = await Promise.all([
    import('../board/assetStore'),
    import('@boardcache/schema'),
  ]);
  const hashes = [...new Set(schema.collectAssetIds(doc))];
  let done = 0;
  for (const hash of hashes) {
    const blob = await getAssetBlob(hash);
    done += 1;
    if (!blob) continue; // missing locally — same 404 behavior as any absent asset
    const up = await apiFetch(`/api/team/${teamId}/assets/${hash}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-asset-mime': blob.type || 'application/octet-stream',
      },
      credentials: 'include',
      body: blob,
    }).catch(() => null);
    if (!up || !up.ok) {
      await apiFetch(`/api/team/${teamId}`, { method: 'DELETE', credentials: 'include' }).catch(
        () => undefined,
      );
      return { ok: false, error: 'An asset failed to upload — the board was left untouched.' };
    }
    onProgress?.(done, hashes.length);
  }
  await deleteBoard(boardId);
  return { ok: true, teamId };
}

/** Pull a missing asset from the room, with patience for in-flight uploads. */
async function fetchTeamAsset(assetId: string): Promise<Blob | null> {
  useCollabStore.getState().setAssetFetching(assetId, true);
  try {
    return await fetchTeamAssetInner(assetId);
  } finally {
    useCollabStore.getState().setAssetFetching(assetId, false);
  }
}

async function fetchTeamAssetInner(assetId: string): Promise<Blob | null> {
  const delays = [0, 1500, 4000, 10_000];
  for (const delay of delays) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (!session) return null;
    try {
      const res = await apiFetch(teamAssetUrl(assetId), { credentials: 'include' });
      if (res.ok) {
        const blob = await res.blob();
        // Content-addressed: storing locally lands under the same id.
        const { putAsset } = await import('../board/assetStore');
        await putAsset(blob);
        uploadedAssets.add(assetId); // it's on the server already
        return blob;
      }
      if (res.status !== 404) return null; // auth/other — don't hammer
    } catch {
      /* offline blip — retry */
    }
  }
  return null;
}

function applyRemoteDoc(doc: CanvasDocument): void {
  const store = useDocumentStore.getState();
  // The room's first doc (guests never fetch one up front) lands framed on
  // its content; afterwards keep the local camera. Replay unacked local
  // work on top either way.
  const firstDoc = store.doc.id !== doc.id;
  let next: CanvasDocument = { ...doc, viewport: store.doc.viewport };
  for (const batch of session?.pending ?? []) {
    try {
      next = applyPatches(next, batch.patches);
    } catch {
      /* pending batch no longer applies (its target vanished) — drop it */
    }
  }
  session!.applyingRemote = true;
  store.replaceDoc(next);
  if (firstDoc) zoomToFit(null, 1);
  session!.applyingRemote = false;
}

function applyRemotePatches(patches: Patch[]): void {
  const store = useDocumentStore.getState();
  try {
    let next = applyPatches(store.doc, patches);
    for (const batch of session?.pending ?? []) {
      try {
        next = applyPatches(next, batch.patches);
      } catch {
        /* superseded */
      }
    }
    session!.applyingRemote = true;
    store.replaceDoc(next);
    session!.applyingRemote = false;
  } catch {
    session?.ws?.send(JSON.stringify({ t: 'resync' }));
  }
}

function sendPresence(cursor: { x: number; y: number } | null): void {
  if (!session?.ws || session.ws.readyState !== WebSocket.OPEN) return;
  const { selection, lightboxId, activePageId } = useSessionStore.getState();
  const payload = JSON.stringify({
    t: 'presence',
    cursor,
    selection,
    lightbox: lightboxId,
    page: activePageId,
  });
  if (payload === session.lastPresence) return;
  session.lastPresence = payload;
  session.ws.send(payload);
}

/** Stream live drag/resize previews at presence cadence (doc untouched). */
function startGestureStreaming(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSent = '';
  const send = () => {
    timer = null;
    if (!session?.ws || session.ws.readyState !== WebSocket.OPEN) return;
    const gesture = useSessionStore.getState().gesture;
    const overrides = gesture?.overrides ?? null;
    const payload = JSON.stringify({ t: 'gesture', overrides });
    if (payload === lastSent) return;
    lastSent = payload;
    session.ws.send(payload);
  };
  const unsub = useSessionStore.subscribe(
    (s) => s.gesture,
    (gesture) => {
      if (gesture === null) {
        // End of gesture: clear immediately so peers land on the committed
        // patch, not a stale preview.
        if (timer) clearTimeout(timer);
        timer = null;
        send();
        return;
      }
      if (!timer) timer = setTimeout(send, 80);
    },
  );
  session!.unsubscribers.push(() => {
    if (timer) clearTimeout(timer);
    unsub();
  });
}

function startPresenceTracking(): void {
  const onMove = (e: PointerEvent) => {
    if (!session || session.presenceTimer) return;
    session.presenceTimer = setTimeout(() => {
      if (session) session.presenceTimer = null;
      if (useSessionStore.getState().view !== 'canvas') return;
      sendPresence(clientToCanvas(e.clientX, e.clientY));
    }, 80);
  };
  window.addEventListener('pointermove', onMove);
  session!.unsubscribers.push(() => window.removeEventListener('pointermove', onMove));
  const unsub = useSessionStore.subscribe(
    (s) => s.selection,
    () => sendPresence(null),
  );
  session!.unsubscribers.push(unsub);
  // Page switches are presence too — peers see who moved to which sheet.
  const unsubPage = useSessionStore.subscribe(
    (s) => s.activePageId,
    () => sendPresence(null),
  );
  session!.unsubscribers.push(unsubPage);
  // Lightbox views are presence too — peers see who's on an item with them.
  const unsubLb = useSessionStore.subscribe(
    (s) => s.lightboxId,
    () => sendPresence(null),
  );
  session!.unsubscribers.push(unsubLb);
}

function connect(boardId: string, guest: Session['guest']): void {
  const seq = ++connectSeq;
  // The session record exists at once (presence/gesture tracking subscribe
  // to it right away); the socket arrives once the ticket step, if any, is done.
  session = {
    ws: null,
    boardId,
    // Unacked local work survives reconnects — it re-sends after `init`.
    pending: session?.pending ?? [],
    applyingRemote: false,
    presenceTimer: null,
    lastPresence: '',
    closedByUs: false,
    guest,
    unsubscribers: session?.unsubscribers ?? [],
  };
  const mine = session;
  void socketTicket(boardId, guest).then((ticket) => {
    // Closed or reconnected again while the ticket was in flight.
    if (seq !== connectSeq || session !== mine || mine.closedByUs) return;
    openSocket(mine, ticket ? `?ticket=${encodeURIComponent(ticket)}` : '');
  });
}

function openSocket(current: Session, params: string): void {
  const store = useCollabStore.getState();
  const boardId = current.boardId;
  const guest = current.guest;
  const ws = new WebSocket(wsUrl(`/api/team/${boardId}/ws${params}`));
  current.ws = ws;

  // Commands issued before the socket opened (or while reconnecting) queue
  // in `pending`; flush them the moment the connection is live.
  ws.onopen = () => {
    for (const batch of session?.pending ?? []) {
      ws.send(JSON.stringify({ t: 'patches', id: batch.id, patches: batch.patches }));
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data)) as {
      t: string;
      reason?: string;
      connId?: string;
      rev?: number;
      doc?: CanvasDocument;
      patches?: Patch[];
      from?: string;
      self?: CollabPeer;
      peer?: CollabPeer;
      peers?: CollabPeer[];
      id?: string;
      message?: string;
    };
    if (msg.t === 'init') {
      useCollabStore.getState().set({
        status: 'online',
        self: msg.self ?? null,
        peers: Object.fromEntries((msg.peers ?? []).map((p) => [p.id, p])),
      });
      useCollabStore
        .getState()
        .setChat(((msg as { chat?: ChatMessage[] }).chat ?? []) as ChatMessage[]);
      applyRemoteDoc(msg.doc!);
    } else if (msg.t === 'refused') {
      // The room would not take one of our batches (it broke the schema or
      // the size cap). Drop it — replaying it would only be refused again —
      // say so, and land on the room's doc with the rest still pending.
      if (session) session.pending = session.pending.filter((b) => b.id !== msg.id);
      showNotice(
        `A change could not be saved to the team board${msg.reason ? ` — ${msg.reason}` : ''}.`,
        { id: 'team-refused', timeoutMs: 12_000 },
      );
      if (msg.doc) applyRemoteDoc(msg.doc);
    } else if (msg.t === 'patches') {
      if (msg.from === useCollabStore.getState().self?.id) {
        // Our own echo = ack. Batches are acked by id; an echo without one
        // (an older server) acks the oldest.
        if (session) {
          session.pending = msg.id
            ? session.pending.filter((b) => b.id !== msg.id)
            : session.pending.slice(1);
        }
      } else if (msg.patches) {
        applyRemotePatches(msg.patches);
        // Their gesture/typing committed — drop any lingering live preview.
        if (msg.from) {
          useCollabStore.getState().setPeerGesture(msg.from, null);
          useCollabStore.getState().clearPeerDrafts(msg.from);
        }
      }
    } else if (msg.t === 'gesture' && msg.from) {
      useCollabStore
        .getState()
        .setPeerGesture(
          msg.from,
          (msg as { overrides?: Record<string, RemoteBounds> | null }).overrides ?? null,
        );
    } else if (msg.t === 'draft' && msg.from) {
      const d = msg as { from?: string; itemId?: string; text?: string | null };
      if (d.itemId) useCollabStore.getState().setPeerDraft(d.from!, d.itemId, d.text ?? null);
    } else if (msg.t === 'chat') {
      const chatMsg = (msg as { msg?: ChatMessage }).msg;
      if (chatMsg) useCollabStore.getState().appendChat(chatMsg);
    } else if (msg.t === 'doc') {
      applyRemoteDoc(msg.doc!);
    } else if (msg.t === 'peer' && msg.peer) {
      useCollabStore.getState().upsertPeer(msg.peer);
    } else if (msg.t === 'peer-left' && msg.id) {
      useCollabStore.getState().removePeer(msg.id);
      useCollabStore.getState().clearPeerDrafts(msg.id);
    } else if (msg.t === 'error') {
      console.warn('boardCache team:', msg.message);
    }
  };
  ws.onclose = () => {
    if (!session || session.closedByUs) return;
    useCollabStore.getState().set({ status: 'reconnecting', peers: {} });
    setTimeout(() => {
      if (session && !session.closedByUs) connect(boardId, guest);
    }, 1500);
  };
  store.set({ status: store.status === 'off' ? 'connecting' : store.status, boardId });
}

function activateTeamDoc(doc: CanvasDocument): void {
  useHistoryStore.getState().clear();
  useDocumentStore.getState().replaceDoc(doc);
  // The room's stored viewport is whoever last uploaded the whole doc — a
  // meaningless place to land. Frame the content instead (the canvas is not
  // mounted yet, so the fit measures the window; the room's init then keeps
  // this local camera, capped at 100% so a small board is not magnified).
  // Empty boards keep the stored viewport.
  zoomToFit(null, 1);
  useSessionStore.getState().setView('canvas');
}

/** Open a team board as a signed-in member. */
export async function openTeamBoard(id: string): Promise<boolean> {
  const res = await apiFetch(`/api/team/${id}`, { credentials: 'include' });
  if (!res.ok) return false;
  const data = (await res.json()) as {
    board: { id: string; name: string; doc: CanvasDocument; guestSlug: string | null };
    role: 'owner' | 'editor';
    members: { userId: string; username: string; role: string }[];
  };
  closeCollab();
  useCollabStore.getState().set({
    status: 'connecting',
    boardId: id,
    role: data.role,
    guestSlug: data.board.guestSlug,
    members: data.members,
  });
  activateTeamDoc(data.board.doc);
  connect(id, null);
  startPresenceTracking();
  startGestureStreaming();
  const { setAssetMissHandler } = await import('../board/assetStore');
  setAssetMissHandler(fetchTeamAsset);
  return true;
}

/** Join a team board anonymously via its guest link. */
export async function openGuestBoard(slug: string, name: string): Promise<boolean> {
  const res = await apiFetch(`/api/guest/${encodeURIComponent(slug)}`, {});
  if (!res.ok) return false;
  const data = (await res.json()) as { board: { id: string; name: string } };
  closeCollab();
  useCollabStore.getState().set({
    status: 'connecting',
    boardId: data.board.id,
    role: 'guest',
  });
  connect(data.board.id, { slug, name });
  startPresenceTracking();
  startGestureStreaming();
  const { setAssetMissHandler } = await import('../board/assetStore');
  setAssetMissHandler(fetchTeamAsset);
  // The doc arrives in `init`; show the canvas immediately with a blank doc
  // carrying the right name so the chrome isn't a lie while it loads.
  useSessionStore.getState().setView('canvas');
  return true;
}

/** Stream an in-progress text edit to peers (null = stopped editing). */
let draftTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDraft: { itemId: string; text: string | null } | null = null;
export function collabNotifyDraft(itemId: string, text: string | null): void {
  if (!session) return;
  pendingDraft = { itemId, text };
  if (text === null) {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = null;
    flushDraft();
    return;
  }
  if (!draftTimer) draftTimer = setTimeout(flushDraft, 150);
}
function flushDraft(): void {
  draftTimer = null;
  if (!session?.ws || !pendingDraft || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ t: 'draft', ...pendingDraft }));
  pendingDraft = null;
}

/** Send a chat line to the room (echoed back with the canonical stamp). */
export function sendTeamChat(text: string): void {
  const trimmed = text.trim();
  if (!trimmed || !session?.ws || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ t: 'chat', text: trimmed.slice(0, 2000) }));
}

/** Leave the room and return the app to normal (local-first) behavior. */
export function closeCollab(): void {
  if (!session) return;
  session.closedByUs = true;
  for (const unsub of session.unsubscribers) unsub();
  if (session.presenceTimer) clearTimeout(session.presenceTimer);
  try {
    session.ws?.close();
  } catch {
    /* already closed */
  }
  session = null;
  uploadedAssets.clear();
  void import('../board/assetStore').then((m) => m.setAssetMissHandler(null));
  useCollabStore.getState().reset();
}
