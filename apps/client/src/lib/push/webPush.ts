import { apiFetch, hasSyncServer } from '../sync/apiBase';
import { loadPushKey } from '../sync/keyStore';
import { useSyncStore } from '../../state/syncStore';
import { notifyPrefs, useNotifyPrefs } from '../notifyPrefs';
import { isNativeShell } from '../mobile';
import { desktopUi } from '../platform';
import { showNotice } from '../notices';
import { systemNotify } from '../systemNotify';
import { openPath } from '../router';
import type { ShownNotification } from './pushPayload';

/**
 * Web Push for this browser (or home-screen web app): reminders and account
 * events reach the device while the app is closed. The browser's push
 * subscription goes to the sync server; what a reminder says is sealed
 * under the account's push key (lib/push/pushPayload) before the server
 * learns when it is due, and the service worker (src/sw.ts) opens it.
 *
 * Not for the shells: the desktop app shows notifications while it runs
 * and has no push service; the phone apps register with APNs/FCM.
 */

export type WebPushState =
  | 'unsupported'
  | 'signed-out'
  | 'no-server'
  | 'no-key'
  | 'blocked'
  | 'off'
  | 'on';

export function webPushSupported(): boolean {
  if (typeof window === 'undefined' || !hasSyncServer()) return false;
  if (desktopUi() || isNativeShell()) return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // The app registers its worker at start (lib/appUpdate); in development
    // there is none, and `ready` would wait forever.
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);
    return reg;
  } catch {
    return null;
  }
}

async function serverKey(): Promise<string | null> {
  try {
    const res = await apiFetch('/api/push/web');
    if (!res.ok) return null;
    const data = (await res.json()) as { enabled: boolean; publicKey?: string };
    return data.enabled && data.publicKey ? data.publicKey : null;
  } catch {
    return null;
  }
}

const keyBytes = (b64url: string): Uint8Array => {
  const padded = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Where this browser stands, for Settings. */
export async function webPushState(): Promise<WebPushState> {
  if (!webPushSupported()) return 'unsupported';
  if (useSyncStore.getState().status !== 'signedIn') return 'signed-out';
  if (Notification.permission === 'denied') return 'blocked';
  if (!(await loadPushKey())) return 'no-key';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (sub) return 'on';
  return (await serverKey()) ? 'off' : 'no-server';
}

/** Subscribe this browser and tell the server. */
export async function enableWebPush(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!webPushSupported()) return { ok: false, error: 'This browser cannot receive push.' };
  if (useSyncStore.getState().status !== 'signedIn')
    return { ok: false, error: 'Sign in to your account first.' };
  if (!(await loadPushKey()))
    return {
      ok: false,
      error: 'Sign in again on this device: the key push needs is made at sign-in.',
    };
  const reg = await registration();
  if (!reg) return { ok: false, error: 'The app is not installed as a service worker here yet.' };
  const key = await serverKey();
  if (!key) return { ok: false, error: 'This server has no push keys configured.' };
  if ((await Notification.requestPermission()) !== 'granted')
    return { ok: false, error: 'Notifications are blocked for this site in the browser.' };
  let sub: PushSubscription;
  try {
    sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key) as BufferSource,
      }));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not subscribe.' };
  }
  const res = await apiFetch('/api/push/web', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  }).catch(() => null);
  if (!res?.ok) {
    await sub.unsubscribe().catch(() => undefined);
    return { ok: false, error: 'The server did not take the subscription. Try again later.' };
  }
  useNotifyPrefs.getState().set({ push: true });
  return { ok: true };
}

/** Unsubscribe this browser and forget it on the server. */
export async function disableWebPush(): Promise<void> {
  useNotifyPrefs.getState().set({ push: false });
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (sub) {
    await apiFetch('/api/push/web', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
}

/** A message the worker handed to the focused page (the app is in front). */
function deliverHere(notifications: ShownNotification[]): void {
  const prefs = notifyPrefs();
  for (const n of notifications) {
    const away = document.visibilityState !== 'visible' || !document.hasFocus();
    const path = n.path;
    if (away && prefs.enabled) {
      const shown = systemNotify(n.title, {
        ...(n.body ? { body: n.body } : {}),
        tag: n.tag,
        ...(path ? { onClick: () => openPath(path) } : {}),
      });
      if (shown) continue;
    }
    showNotice(n.body ? `${n.title}. ${n.body}` : n.title, {
      kind: 'info',
      timeoutMs: 12_000,
      ...(path ? { action: { label: 'Open', path } } : {}),
    });
  }
}

let started = false;
/** Mount once: messages from the worker, and the subscription following sign-in. */
export function initWebPush(): void {
  if (started || !webPushSupported()) return;
  started = true;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as
      | { type?: string; notifications?: ShownNotification[]; path?: string }
      | undefined;
    if (data?.type === 'boardcache:push' && Array.isArray(data.notifications))
      deliverHere(data.notifications);
    else if (data?.type === 'boardcache:open' && typeof data.path === 'string') openPath(data.path);
  });
  // Signed in with push wanted: the subscription is told to the server again
  // (it may have been renewed by the browser). Signed out: it is let go.
  let was = useSyncStore.getState().status;
  const follow = (status: typeof was) => {
    if (status === 'signedIn' && notifyPrefs().push) void enableWebPush();
    else if (status === 'signedOut' && notifyPrefs().push) void disableWebPush();
  };
  useSyncStore.subscribe((s) => {
    if (s.status === was) return;
    was = s.status;
    follow(s.status);
  });
  follow(was);
}
