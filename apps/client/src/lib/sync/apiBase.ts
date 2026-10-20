/**
 * Sync-server endpoint resolution. The client is a standalone artifact with
 * NO built-in server assumption: the sync server is declared per deployment
 * in a `config.json` served next to index.html, fetched once at boot
 * (loadDeployConfig, awaited in main.tsx before render).
 *
 *   { "syncServer": "same-origin" }              → /api on this host
 *   { "syncServer": "https://sync.example.com" } → that origin's /api
 *   missing file / no syncServer key             → no sync server at all;
 *     sync and the server-backed features gate off (lib/platform).
 *
 * Cross-origin servers must run with BOARDCACHE_CORS_ORIGINS set (which also
 * switches session cookies to SameSite=None; Secure).
 */
import { iosSecureTokenStore } from '../iosSecureStore';

/** '' = same-origin /api, 'https://…' = remote origin, null = no server. */
let syncServerBase: string | null = null;

/** Trim, drop trailing slashes and a trailing /api (paths already carry it). */
function normalizeServer(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/, '')
    .replace(/\/+$/, '');
}

/** Community origin: '' = same-origin, 'https://…' = remote. Defaults to the
 *  official server so ANY client build can browse/clone the community; our
 *  own deployments set "communityServer": "same-origin" in config.json. */
const OFFICIAL_COMMUNITY = 'https://api.boardcache.com';
let communityServerBase = OFFICIAL_COMMUNITY;
/** `"community": false` in config.json turns the Community section off for
 *  this build: no link, no screens, no requests to the community server. */
let communityOn = true;
export function communityEnabled(): boolean {
  return communityOn;
}

/** Fetch the deployment config. Never throws — no config means no server. */
export async function loadDeployConfig(): Promise<void> {
  try {
    const res = await fetch('/config.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const cfg = (await res.json()) as {
      syncServer?: unknown;
      communityServer?: unknown;
      community?: unknown;
    };
    if (cfg.community === false) communityOn = false;
    if (typeof cfg.communityServer === 'string') {
      if (cfg.communityServer === 'same-origin') communityServerBase = '';
      else if (/^https?:\/\//.test(cfg.communityServer)) {
        communityServerBase = normalizeServer(cfg.communityServer);
      }
    }
    if (typeof cfg.syncServer !== 'string') return;
    if (cfg.syncServer === 'same-origin') {
      syncServerBase = '';
    } else if (/^https?:\/\//.test(cfg.syncServer)) {
      syncServerBase = normalizeServer(cfg.syncServer);
    }
  } catch {
    /* unreadable config → no sync server */
  }
}

// ── bearer tokens (cross-origin clients: cookies can't travel, tokens can) ──

const TOKEN_KEY = 'boardcache:authToken';
const TOKEN_ID_KEY = 'boardcache:authTokenId';

/** The desktop shell keeps the token in the OS-backed store (Electron
 *  safeStorage) instead of the renderer's localStorage. */
interface SecureTokenStore {
  get: () => Promise<{ token: string; id: string | null } | null>;
  set: (token: string, id: string | null) => Promise<boolean>;
  clear: () => Promise<boolean>;
}
const secureStore: SecureTokenStore | null =
  typeof window !== 'undefined'
    ? ((window as unknown as { boardcacheDesktop?: { secureToken?: SecureTokenStore } })
        .boardcacheDesktop?.secureToken ??
      iosSecureTokenStore() ??
      null)
    : null;

let authToken: string | null = null;
let authTokenId: string | null = null;
const readLocal = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
if (!secureStore) {
  authToken = readLocal(TOKEN_KEY);
  authTokenId = readLocal(TOKEN_ID_KEY);
}

/** Requests wait for the stored token to be known (async in the desktop shell). */
const authTokenReady: Promise<void> = secureStore
  ? secureStore
      .get()
      .then(async (stored) => {
        if (stored) {
          authToken = stored.token;
          authTokenId = stored.id;
          return;
        }
        // A token written by an older build into localStorage moves over once.
        const legacy = readLocal(TOKEN_KEY);
        if (legacy) {
          authToken = legacy;
          authTokenId = readLocal(TOKEN_ID_KEY);
          await secureStore.set(legacy, authTokenId);
          try {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(TOKEN_ID_KEY);
          } catch {
            /* storage unavailable */
          }
        }
      })
      .catch(() => undefined)
  : Promise.resolve();

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(token: string | null, id?: string | null): void {
  authToken = token;
  authTokenId = id ?? (token ? authTokenId : null);
  if (secureStore) {
    void (token ? secureStore.set(token, authTokenId) : secureStore.clear()).catch(() => undefined);
    return;
  }
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (id) localStorage.setItem(TOKEN_ID_KEY, id);
    else if (!token) localStorage.removeItem(TOKEN_ID_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function getAuthTokenId(): string | null {
  return authTokenId;
}

/** The sync server lives on another origin than the page (cookies won't
 *  stick in browsers there → sign-in issues a bearer token instead). */
export function crossOriginSync(): boolean {
  return Boolean(syncServerBase) && syncServerBase !== window.location.origin;
}

/** Whether this deployment declared a sync server at all. */
export function hasSyncServer(): boolean {
  return syncServerBase !== null;
}

/** The sync server base ('' = same-origin, origin string, or null = none). */
export function syncServerBaseValue(): string | null {
  return syncServerBase;
}

/** Human-readable server label for UI ('' when same-origin or none). */
export function syncServerLabel(): string {
  return syncServerBase ? syncServerBase.replace(/^https?:\/\//, '') : '';
}

/** Absolute URL for an `/api/...` path on the configured sync server. */
export function apiUrl(path: string): string {
  return syncServerBase ? `${syncServerBase}${path}` : path;
}

/** Connectivity observer: every apiFetch outcome reports reachability
 *  (network failure = down, any HTTP response = up). Registered by
 *  lib/platform's connectivity monitor — a callback avoids an import cycle. */
let netObserver: ((up: boolean) => void) | null = null;
export function setNetObserver(cb: (up: boolean) => void): void {
  netObserver = cb;
}

/**
 * fetch() against a base origin with the right auth for that origin:
 *  - the user's own sync server + a bearer token → Authorization header,
 *    credentials omitted (wildcard-free reflected CORS, no cookies)
 *  - the user's own sync server, cookie mode → credentials included
 *    (same-origin, or an allow-listed shell origin)
 *  - any OTHER origin (e.g. the official community from a foreign host) →
 *    anonymous: no credentials, compatible with wildcard CORS
 */
/** The auth one request to `base` carries: a bearer token, or cookies. */
function authFor(base: string): { bearer: string | null; cookies: boolean } {
  const isSyncBase = syncServerBase !== null && base === syncServerBase;
  const bearer = isSyncBase ? authToken : null;
  // Cookies only travel where they can work: same-origin pages, or our
  // packaged shells (app://, capacitor:// — allow-listed server-side). An
  // http(s) page on a FOREIGN origin always omits them — before sign-in the
  // anonymous tier answers, after sign-in the bearer token does.
  const pageIsHttp = location.protocol === 'http:' || location.protocol === 'https:';
  const crossToBase = base !== '' && base !== window.location.origin;
  const cookiesWork = isSyncBase && !(pageIsHttp && crossToBase);
  return { bearer, cookies: bearer === null && cookiesWork };
}

/**
 * Auth for a sync-server request the caller sends ITSELF (an XMLHttpRequest
 * upload, for its progress events) — the same rule fetchFrom applies. Without
 * this an upload from a token-authenticated client (the desktop app, a
 * foreign-hosted build) goes out with no credentials at all and is refused.
 */
export async function syncRequestAuth(): Promise<{
  headers: Record<string, string>;
  withCredentials: boolean;
}> {
  await authTokenReady;
  const auth = authFor(syncServerBase ?? '');
  return {
    headers: auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {},
    withCredentials: auth.cookies,
  };
}

function fetchFrom(base: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth = authFor(base);
  if (auth.bearer && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${auth.bearer}`);
  }
  const credentials: RequestCredentials = auth.cookies ? 'include' : 'omit';
  const url = base ? `${base}${path}` : path;
  return fetch(url, { ...init, headers, credentials }).then(
    (res) => {
      netObserver?.(true);
      // The server refuses an unverified account with 403 + code; the app
      // routes that to the verification step instead of a dead error.
      if (res.status === 403 && unverifiedObserver) {
        void res
          .clone()
          .json()
          .then((d: { code?: string } | null) => d?.code === 'unverified' && unverifiedObserver?.())
          .catch(() => undefined);
      }
      return res;
    },
    (err: unknown) => {
      if (!(err instanceof DOMException && err.name === 'AbortError')) netObserver?.(false);
      throw err;
    },
  );
}

/**
 * The source an <img>/<video> can use for a URL on one of our origins. A
 * browser tag carries cookies but never a bearer token, so where the request
 * would be token-authenticated (the desktop and mobile shells, a build on a
 * foreign host) the bytes are fetched here with the token and handed back as
 * an object URL; everywhere else the URL itself is returned and the browser
 * cache does its work. Resolved sources are kept for the session.
 */
const mediaSrcCache = new Map<string, Promise<string | null>>();
export function resolveMediaSrc(url: string): Promise<string | null> {
  const cached = mediaSrcCache.get(url);
  if (cached) return cached;
  const p = authTokenReady.then(async () => {
    const base = [syncServerBase, communityServerBase].find((b) => b && url.startsWith(`${b}/`));
    if (!base || !authFor(base).bearer) return url;
    try {
      const res = await fetchFrom(base, url.slice(base.length));
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  });
  mediaSrcCache.set(url, p);
  return p;
}

/** Community origin base ('' = same origin) and URL helper. */
let unverifiedObserver: (() => void) | null = null;
/** Called whenever the server answers "verify your email first". */
export function setUnverifiedObserver(fn: (() => void) | null): void {
  unverifiedObserver = fn;
}

export function communityBase(): string {
  return communityServerBase;
}

export function communityUrl(path: string): string {
  return communityServerBase ? `${communityServerBase}${path}` : path;
}

/** fetch() against the community origin with matching auth (see fetchFrom). */
export function communityFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetchFrom(communityServerBase, path, init);
}

/** fetch() against the sync server — cookie or bearer, whichever applies. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (syncServerBase === null) {
    throw new Error('This deployment has no sync server configured.');
  }
  await authTokenReady;
  return fetchFrom(syncServerBase, path, init);
}
