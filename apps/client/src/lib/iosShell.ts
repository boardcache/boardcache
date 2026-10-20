import { isNativeShell, shellPlatform } from './mobile';
import { showNotice } from './notices';
import { useSyncStore } from '../state/syncStore';
import { useSessionStore } from '../state/sessionStore';
import { apiFetch } from './sync/apiBase';
import { openPath } from './router';
import { importBoardFile } from './board/boardcacheFile';
import { createBoard } from './board/boardLibrary';
import { importMediaFiles } from './import/importMedia';
import { clientToCanvas } from './canvas/canvasDom';

/**
 * Boot wiring for the iOS shell (Capacitor). Imported by
 * main.tsx only; outside the shell every call returns at once. What it
 * wires: items the Share Extension, App Intents or a file open left in the
 * App Group inbox; universal links; push registration and taps.
 */
interface SharedItem {
  id: string;
  kind: 'link' | 'text' | 'image' | 'file' | 'action';
  url?: string;
  title?: string;
  text?: string;
  mime?: string;
  file?: string;
  action?: string;
  name?: string;
  createdAt?: string;
}

interface Plugins {
  ShareInbox?: {
    list(): Promise<{ items: SharedItem[] }>;
    read(o: { id: string }): Promise<{ b64: string | null; mime?: string | null }>;
    remove(o: { id: string }): Promise<{ ok: boolean }>;
    addListener?(event: 'shared', fn: () => void): Promise<unknown>;
  };
  App?: {
    addListener(event: 'appUrlOpen', fn: (e: { url: string }) => void): Promise<unknown>;
    addListener(event: 'backButton', fn: (e: { canGoBack: boolean }) => void): Promise<unknown>;
    exitApp?(): Promise<void>;
  };
  PushNotifications?: {
    requestPermissions(): Promise<{ receive: string }>;
    register(): Promise<void>;
    addListener(
      event: 'registration' | 'pushNotificationActionPerformed',
      fn: (e: { value?: string; notification?: { data?: { path?: string } } }) => void,
    ): Promise<unknown>;
  };
  LocalNotifications?: {
    addListener(
      event: 'localNotificationActionPerformed',
      fn: (e: { notification?: { extra?: { path?: string } } }) => void,
    ): Promise<unknown>;
  };
}

function plugins(): Plugins {
  const cap = (window as { Capacitor?: { Plugins?: Plugins } }).Capacitor;
  return cap?.Plugins ?? {};
}

/** A shared item as a clips-inbox POST body (same shape the browser clipper sends). */
export function clipFromShared(
  item: SharedItem,
  b64: string | null,
): {
  kind: 'link' | 'text' | 'image';
  url?: string;
  title?: string;
  text?: string;
  image?: { b64: string; mime: string };
} | null {
  if (item.kind === 'link' && item.url) {
    return { kind: 'link', url: item.url, ...(item.title ? { title: item.title } : {}) };
  }
  if (item.kind === 'text' && item.text) return { kind: 'text', text: item.text };
  if (item.kind === 'image' && b64) {
    return {
      kind: 'image',
      ...(item.title ? { title: item.title } : {}),
      image: { b64, mime: item.mime ?? 'image/jpeg' },
    };
  }
  return null;
}

const toBlob = (b64: string, mime: string): Blob =>
  new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime });

/** Files and actions are handled here, in the app; links, text and images go to the inbox. */
async function handleLocally(item: SharedItem, bytes: string | null): Promise<'done' | 'wait'> {
  if (item.kind === 'action') {
    if (item.action === 'newBoard') {
      await createBoard((item.name ?? '').trim() || 'Untitled board');
      return 'done';
    }
    return 'done';
  }
  if (item.kind === 'file' && bytes) {
    const mime = item.mime ?? 'application/octet-stream';
    const name = (item.title ?? '').toLowerCase();
    if (name.endsWith('.boardcache') || name.endsWith('.refboard')) {
      await importBoardFile(toBlob(bytes, 'application/zip'));
      window.dispatchEvent(new Event('boardcache:library-refresh'));
      showNotice(`Imported “${item.title}”.`, { kind: 'info' });
      return 'done';
    }
    // Other files land on the open board; with none open they wait for one.
    if (useSessionStore.getState().view !== 'canvas') return 'wait';
    const file = new File([toBlob(bytes, mime)], item.title ?? 'shared', { type: mime });
    await importMediaFiles([file], clientToCanvas(window.innerWidth / 2, window.innerHeight / 2));
    return 'done';
  }
  return 'done';
}

let draining = false;
/** Work through everything the native side left for us. */
async function drainSharedItems(): Promise<void> {
  const inbox = plugins().ShareInbox;
  if (!isNativeShell() || !inbox || draining) return;
  draining = true;
  let posted = 0;
  try {
    const { items } = await inbox.list();
    const signedIn = useSyncStore.getState().status === 'signedIn';
    for (const item of items) {
      const bytes = item.file ? (await inbox.read({ id: item.id })).b64 : null;
      if (item.kind === 'file' || item.kind === 'action') {
        if ((await handleLocally(item, bytes)) === 'done') await inbox.remove({ id: item.id });
        continue;
      }
      const body = clipFromShared(item, bytes);
      if (!body) {
        await inbox.remove({ id: item.id });
        continue;
      }
      if (!signedIn) continue; // the inbox is an account feature; keep until then
      const res = await apiFetch('/api/clips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) break; // offline or refused: try again on the next resume
      await inbox.remove({ id: item.id });
      posted++;
    }
  } catch {
    /* next resume */
  } finally {
    draining = false;
  }
  if (posted > 0) {
    window.dispatchEvent(new Event('boardcache:clips-changed'));
    showNotice(
      posted === 1
        ? 'Shared item added to your inbox.'
        : `${posted} shared items added to your inbox.`,
      { kind: 'info' },
    );
  }
}

/** Register this device for push once signed in; taps open the note's path. */
async function initPush(): Promise<void> {
  const push = plugins().PushNotifications;
  if (!push) return;
  let token: string | null = null;
  const send = () => {
    if (!token || useSyncStore.getState().status !== 'signedIn') return;
    void apiFetch('/api/push/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, platform: shellPlatform() ?? 'ios' }),
    }).catch(() => undefined);
  };
  void push.addListener('registration', (e) => {
    token = e.value ?? null;
    send();
  });
  void push.addListener('pushNotificationActionPerformed', (e) => {
    const path = e.notification?.data?.path;
    if (typeof path === 'string' && path.startsWith('/')) openPath(path);
  });
  void plugins().LocalNotifications?.addListener('localNotificationActionPerformed', (e) => {
    const path = e.notification?.extra?.path;
    if (typeof path === 'string' && path.startsWith('/')) openPath(path);
  });
  const register = async () => {
    try {
      const p = await push.requestPermissions();
      if (p.receive === 'granted') await push.register();
    } catch {
      /* no push: everything else works */
    }
  };
  let was = useSyncStore.getState().status;
  useSyncStore.subscribe((s) => {
    if (s.status === was) return;
    was = s.status;
    if (s.status === 'signedIn') {
      if (token) send();
      else void register();
    }
    if (s.status === 'signedOut' && token) {
      void apiFetch('/api/push/register', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => undefined);
    }
  });
  if (was === 'signedIn') void register();
}

/** Wire the shell up once at boot. */
export function initIosShell(): void {
  if (!isNativeShell()) return;
  const p = plugins();
  const drain = () => void drainSharedItems();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') drain();
  });
  void p.ShareInbox?.addListener?.('shared', drain);
  let was = useSyncStore.getState().status;
  useSyncStore.subscribe((s) => {
    if (s.status !== was) {
      was = s.status;
      if (s.status === 'signedIn') drain();
    }
  });
  drain();
  // boardcache.com/… and app.boardcache.com/… open here: same paths as the web app.
  void p.App?.addListener('appUrlOpen', ({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'file:') return drain(); // a .boardcache handed over: the delegate inboxed it
      openPath(u.pathname + u.search);
    } catch {
      /* not a URL we understand */
    }
  });
  // Android's back gesture: step the app's own history; at the root, leave.
  void p.App?.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) history.back();
    else void p.App?.exitApp?.();
  });
  void initPush();
}
