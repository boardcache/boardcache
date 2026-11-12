import { useSyncStore } from '../../state/syncStore';
import { apiFetch, crossOriginSync, hasSyncServer, wsUrl } from './apiBase';

/**
 * The account's sync channel: a WebSocket the server speaks down when a
 * board of the account changes elsewhere, so this device pulls at once
 * rather than on its next poll. It carries nothing but "changed" and
 * board ids; the pull is the ordinary sync pass. Reconnects back off with
 * jitter (a restarted server is not hit by every device at once), and a
 * reconnect pulls once to catch up on what was missed.
 */
const SIGNAL_DEBOUNCE_MS = 1000;
const BACKOFF_MIN_MS = 2000;
const BACKOFF_MAX_MS = 60_000;
/** A socket open this long counts as settled: the backoff starts over. */
const SETTLED_MS = 10_000;

let socket: WebSocket | null = null;
let wanted = false;
let live = false;
let attempt = 0;
let seq = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let signalTimer: ReturnType<typeof setTimeout> | null = null;
let openedAt = 0;
let onChanged: (() => void) | null = null;

/** Whether the channel is open right now (the poll may then rest). */
export function syncEventsLive(): boolean {
  return live;
}

function signal(): void {
  if (signalTimer) clearTimeout(signalTimer);
  signalTimer = setTimeout(() => {
    signalTimer = null;
    onChanged?.();
  }, SIGNAL_DEBOUNCE_MS);
}

async function ticketParams(): Promise<string> {
  if (!crossOriginSync()) return '';
  try {
    const res = await apiFetch('/api/sync/ws-ticket', { method: 'POST' });
    if (!res.ok) return '';
    const { ticket } = (await res.json()) as { ticket?: string };
    return ticket ? `?ticket=${encodeURIComponent(ticket)}` : '';
  } catch {
    return '';
  }
}

function scheduleReconnect(): void {
  if (!wanted || reconnectTimer) return;
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  const delay = base + Math.random() * base * 0.5;
  attempt = Math.min(attempt + 1, 8);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

async function connect(): Promise<void> {
  if (!wanted || socket) return;
  const mine = ++seq;
  const params = await ticketParams();
  if (!wanted || mine !== seq || socket) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(`/api/sync/ws${params}`));
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;
  const reconnected = attempt > 0;
  ws.onopen = () => {
    if (socket !== ws) return;
    live = true;
    openedAt = Date.now();
    // Whatever changed while the channel was down.
    if (reconnected) signal();
  };
  ws.onmessage = (event) => {
    if (socket !== ws) return;
    let msg: { t?: string };
    try {
      msg = JSON.parse(String(event.data)) as { t?: string };
    } catch {
      return;
    }
    if (msg.t === 'changed') signal();
    // The clip inbox changed: whoever polls it looks now.
    if (msg.t === 'clips') window.dispatchEvent(new Event('boardcache:clips-changed'));
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    live = false;
    if (openedAt && Date.now() - openedAt > SETTLED_MS) attempt = 0;
    openedAt = 0;
    scheduleReconnect();
  };
  ws.onerror = () => {
    /* the close that follows schedules the retry */
  };
}

function disconnect(): void {
  wanted = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  attempt = 0;
  const ws = socket;
  socket = null;
  live = false;
  openedAt = 0;
  ws?.close();
}

let started = false;

/**
 * Hold the channel open while signed in; `changed` runs (debounced) when
 * the account's boards changed elsewhere.
 */
export function startSyncEvents(changed: () => void): void {
  if (started || typeof window === 'undefined' || !hasSyncServer()) return;
  started = true;
  onChanged = changed;
  const follow = (signedIn: boolean) => {
    if (signedIn && !wanted) {
      wanted = true;
      void connect();
    } else if (!signedIn && wanted) disconnect();
  };
  follow(useSyncStore.getState().status === 'signedIn');
  useSyncStore.subscribe((s) => follow(s.status === 'signedIn'));
  // Coming back online: try at once rather than after the backoff.
  window.addEventListener('online', () => {
    if (wanted && !socket) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      void connect();
    }
  });
}
