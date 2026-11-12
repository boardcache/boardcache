import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

type WorkboxPluginLike = NonNullable<
  ConstructorParameters<typeof CacheFirst>[0]
>['plugins'] extends (infer P)[] | undefined
  ? P
  : never;
import { notificationsFor, type PushMessage, isAppPath } from './lib/push/pushPayload';

/**
 * The service worker: the app shell's precache and the lazy-chunk cache
 * (what vite-plugin-pwa generated before this file existed), plus Web Push.
 * A push from the sync server is a notice the server wrote (a team board
 * share, a mention) or reminders the client sealed under the account's push
 * key; the key is read from the app's IndexedDB, so the text is opened here
 * and never seen by the server. With the app focused the message goes to
 * the page instead, which shows it its own way.
 */

// The worker's globals, as far as this file needs them. (The DOM lib the app
// compiles against has no ServiceWorkerGlobalScope.)
interface WindowClientLike {
  url: string;
  focused: boolean;
  visibilityState: string;
  focus(): Promise<WindowClientLike>;
  navigate(url: string): Promise<WindowClientLike | null>;
  postMessage(message: unknown): void;
}
interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface PushEventLike extends ExtendableEventLike {
  data: { json(): unknown } | null;
}
interface NotificationEventLike extends ExtendableEventLike {
  notification: Notification & { data?: { path?: string } };
}
interface MessageEventLike extends Event {
  data?: { type?: string };
}
declare const self: {
  addEventListener(type: 'push', cb: (e: PushEventLike) => void): void;
  addEventListener(type: 'notificationclick', cb: (e: NotificationEventLike) => void): void;
  addEventListener(type: 'message', cb: (e: MessageEventLike) => void): void;
  skipWaiting(): Promise<void>;
  registration: ServiceWorkerRegistration;
  clients: {
    matchAll(opts?: {
      type?: 'window';
      includeUncontrolled?: boolean;
    }): Promise<WindowClientLike[]>;
    openWindow(url: string): Promise<WindowClientLike | null>;
  };
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0];
};

// --- the app shell -----------------------------------------------------------

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigations fall back to the shell, but never the sync API, the
// community pages (server-rendered, incl. the preview frame), the DMCA
// page, the marketing site or the docs: for those the server's page is
// the page.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/u(\/|$)/, /^\/dmca$/, /^\/site(\/|$)/, /^\/docs(\/|$)/],
  }),
);

// Content-hashed chunks outside the precache: cached on first use so they
// work offline afterwards. CacheFirst is safe: a changed file has a new URL.
registerRoute(
  /\/assets\/.*\.(?:js|css)$/,
  new CacheFirst({
    cacheName: 'lazy-chunks',
    // The plugin's optional callbacks are typed without `undefined`; the
    // strategy accepts the object as workbox builds it.
    plugins: [new ExpirationPlugin({ maxEntries: 80 }) as unknown as WorkboxPluginLike],
  }),
);

// 'prompt' updates: the page asks the waiting worker to take over.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// --- push --------------------------------------------------------------------

/** The account's push key from the app's IndexedDB (null before sign-in, or
 *  on a device signed in before the key existed). */
function readPushKey(): Promise<CryptoKey | null> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('boardcache');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        try {
          const req = db.transaction('keys', 'readonly').objectStore('keys').get('pushKey');
          req.onsuccess = () => {
            db.close();
            resolve(req.result instanceof CryptoKey ? req.result : null);
          };
          req.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

async function focusedClient(): Promise<WindowClientLike | null> {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return all.find((c) => c.focused && c.visibilityState === 'visible') ?? null;
}

self.addEventListener('push', (e) => {
  e.waitUntil(
    (async () => {
      const msg = ((): PushMessage | null => {
        try {
          return (e.data?.json() ?? null) as PushMessage | null;
        } catch {
          return null;
        }
      })();
      if (!msg) return;
      const shown = await notificationsFor(msg, await readPushKey());
      if (!shown.length) return;
      // The app is in front: it shows the reminder its own way.
      const page = await focusedClient();
      if (page) {
        page.postMessage({ type: 'boardcache:push', notifications: shown });
        return;
      }
      for (const n of shown) {
        await self.registration.showNotification(n.title, {
          ...(n.body ? { body: n.body } : {}),
          tag: n.tag,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          data: { path: n.path ?? '/' },
        });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const raw = e.notification.data?.path;
  const path = isAppPath(raw) ? raw : '/';
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = all[0];
      if (client) {
        await client.focus();
        client.postMessage({ type: 'boardcache:open', path });
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
