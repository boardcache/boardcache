import { apiFetch } from './apiBase';
import { useSyncStore } from '../../state/syncStore';
import { showNotice } from '../notices';
import { systemNotify } from '../systemNotify';
import { isNativeShell } from '../mobile';
import { openPath } from '../router';

/**
 * Account events (added to a team board, @mentioned, follows) for clients
 * that are not phones: polled from GET /api/notices, the same events the
 * server pushes through APNs/FCM. Away from the window they become a system
 * notification (Notification Centre on the desktop app, the web Notification
 * where a browser has permission); in the window, the notice strip. A first
 * poll only learns the cursor, so sign-in never replays a week of history.
 */

interface Notice {
  id: number;
  title: string;
  body: string | null;
  path: string | null;
}

const POLL_MS = 30_000;
const cursorKey = (accountId: string) => `boardcache.notices.cursor.${accountId}`;

const readCursor = (accountId: string): string | null => {
  try {
    return localStorage.getItem(cursorKey(accountId));
  } catch {
    return null;
  }
};
const writeCursor = (accountId: string, cursor: number): void => {
  try {
    localStorage.setItem(cursorKey(accountId), String(cursor));
  } catch {
    /* private mode: every poll then starts from "now", which only loses nothing */
  }
};

function deliver(n: Notice): void {
  const away = document.visibilityState !== 'visible' || !document.hasFocus();
  // Phones get the push itself; the web view only ever runs in the foreground.
  if (away && !isNativeShell()) {
    const path = n.path;
    const shown = systemNotify(n.title, {
      ...(n.body ? { body: n.body } : {}),
      tag: `notice-${n.id}`,
      ...(path ? { onClick: () => openPath(path) } : {}),
    });
    if (shown) return;
  }
  showNotice(n.body ? `${n.title}. ${n.body}` : n.title, {
    kind: 'info',
    timeoutMs: 12_000,
    ...(n.path ? { action: { label: 'Open', path: n.path } } : {}),
  });
}

let inFlight = false;
/** One poll; exported for the dev tools so a test need not wait 30s. */
export async function pollUserNotices(): Promise<void> {
  const s = useSyncStore.getState();
  if (s.status !== 'signedIn' || !s.account || inFlight || !navigator.onLine) return;
  inFlight = true;
  try {
    const after = readCursor(s.account.id);
    const res = await apiFetch(`/api/notices${after === null ? '' : `?after=${after}`}`);
    if (!res.ok) return;
    const data = (await res.json()) as { notices: Notice[]; cursor: number };
    writeCursor(s.account.id, data.cursor);
    for (const n of data.notices) deliver(n);
  } catch {
    /* offline or unreachable: the next tick tries again */
  } finally {
    inFlight = false;
  }
}

let started = false;
export function startUserNoticePoll(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const tick = () => void pollUserNotices();
  setInterval(tick, POLL_MS);
  window.addEventListener('online', tick);
  window.addEventListener('focus', tick);
  useSyncStore.subscribe((s, prev) => {
    if (s.status === 'signedIn' && prev.status !== 'signedIn') tick();
  });
  tick();
}
