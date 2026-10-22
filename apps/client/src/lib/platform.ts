import { useEffect, useState } from 'react';
import { apiFetch, hasSyncServer, setNetObserver } from './sync/apiBase';
import { useSyncStore } from '../state/syncStore';
import { routerReady } from './routerReady';

/**
 * Platform seam. Features that can't run in a plain browser (CORS-blocked
 * fetches, webpage screenshots, UA-dependent font CSS) describe *what* they
 * need here; how it happens is per-platform. On the web everything routes
 * through the sync server's /api proxies. A desktop (Electron) build swaps
 * these implementations for native ones — feature code stays identical.
 *
 * Capabilities say whether each service is currently available, so UI can
 * gate honestly ("sign in to a sync server to use this") instead of letting
 * a fetch fail. On the web: rss + screenshot proxies require being signed
 * in; the AI and font-css proxies just need the server to exist.
 */

// --- desktop bridge ----------------------------------------------------------
// The Electron shell's preload exposes native implementations for the three
// CORS-blocked services. AI is deliberately NOT on the bridge: it stays
// gated to the sync server in every build (SaaS decision, 2026-08-17).

/** A .boardcache file the OS asked the desktop app to open. */
interface OpenedFile {
  name: string;
  bytes: Uint8Array;
}

/** A request the desktop makes on the renderer's behalf (lib/platform httpFetch). */
interface BridgeHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface DesktopBridge {
  rssFetch(url: string): Promise<{ status: number; body: string }>;
  /** Fetch from an allow-listed API host without the browser's cross-origin
   *  rules (the Research plugin's keyed providers). */
  httpFetch?(req: BridgeHttpRequest): Promise<{ status: number; body: string }>;
  fontCss(family: string): Promise<{ status: number; body: string }>;
  screenshot(opts: {
    url: string;
    width: number;
    height: number;
  }): Promise<{ status: number; bytes?: ArrayBuffer }>;
  openFiles?: {
    take(): Promise<OpenedFile[]>;
    onOpen(cb: (file: OpenedFile) => void): () => void;
  };
  menu?: {
    onAction(cb: (action: string) => void): () => void;
  };
  focusWindow?(): Promise<void>;
  /** Local files for the agent tools (import a file, export a board), as
   *  the user: an absolute path in, bytes out and back. `grant` is the id of
   *  the agent call being served; the shell refuses without a live one. */
  files?: {
    read(
      path: string,
      grant: string,
    ): Promise<{ name: string; bytes: ArrayBuffer | Uint8Array } | { error: string }>;
    write(
      path: string,
      bytes: Uint8Array,
      grant: string,
    ): Promise<{ path: string } | { error: string }>;
  };
  agent?: {
    onRequest(cb: (req: AgentRequest) => void): () => void;
    respond(res: AgentResponse): void;
    /** Tells the shell the bridge is listening (calls before this are refused). */
    ready(): void;
    info(): Promise<AgentInfo>;
    /** A new token: HTTP sessions end, agent.json is rewritten. */
    regenerate(): Promise<AgentInfo>;
  };
}

/** One request from the desktop's agent endpoint (see lib/agentBridge). */
export type AgentRequest =
  | { id: string; kind: 'tools' }
  | { id: string; kind: 'call'; name: string; args: unknown };
type AgentResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };
export interface AgentInfo {
  port: number | null;
  /** The MCP-over-HTTP endpoint, for clients that connect by URL. */
  url: string | null;
  token: string;
  configPath: string;
  launcherPath: string;
  /** Whether the HTTP transport is bundled in this build. */
  http: boolean;
}

/** The desktop shell's agent channel, when running inside it. */
export function desktopAgent(): NonNullable<DesktopBridge['agent']> | null {
  return desktop?.agent ?? null;
}

/** The desktop shell's file access, when running inside it. */
export function desktopFiles(): NonNullable<DesktopBridge['files']> | null {
  return desktop?.files ?? null;
}

const desktop: DesktopBridge | undefined = (globalThis as { boardcacheDesktop?: DesktopBridge })
  .boardcacheDesktop;

/**
 * Desktop: boards double-clicked in the file manager (or passed on the
 * command line) arrive here and import like a dropped file, one at a time.
 */
export function initDesktopFileOpen(): void {
  const files = desktop?.openFiles;
  if (!files) return;
  // Files queued before boot arrive before React mounts; opening then races
  // the router's initial route, which lands on top of the opened board (the
  // board was imported and even current, but the screen showed the start
  // view until a reload). Every open waits for the router first.
  let chain: Promise<void> = routerReady;
  const open = (file: OpenedFile) => {
    chain = chain.then(async () => {
      const { importBoardFromFile } = await import('./board/transfer');
      const { logDeviceEvent } = await import('./deviceLog');
      try {
        const ok = await importBoardFromFile(new File([file.bytes as BlobPart], file.name));
        window.dispatchEvent(new Event('boardcache:library-refresh'));
        logDeviceEvent('desktop-open-file', { name: file.name, bytes: file.bytes.byteLength, ok });
      } catch (err) {
        logDeviceEvent('desktop-open-file', {
          name: file.name,
          bytes: file.bytes.byteLength,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };
  files.onOpen(open);
  void files.take().then((queued) => {
    if (queued.length) {
      void import('./deviceLog').then(({ logDeviceEvent }) =>
        logDeviceEvent('desktop-open-file', { queued: queued.map((f) => f.name) }),
      );
    }
    queued.forEach(open);
  });
}

/**
 * Desktop: entries in the native application menu that act inside the app.
 * Each action runs through the same path as its in-app control; unknown
 * actions (a newer shell) are ignored.
 */
export function initDesktopMenu(): void {
  desktop?.menu?.onAction((action) => {
    void import('../state/sessionStore').then(({ useSessionStore }) => {
      if (action === 'settings') useSessionStore.getState().setSettingsOpen(true);
    });
  });
}

/** Bring the app forward (a clicked system notification). */
export function focusAppWindow(): void {
  if (desktop?.focusWindow) void desktop.focusWindow();
  else window.focus();
}

export interface PlatformCaps {
  /** Fetch + refresh RSS feed boxes. */
  rss: boolean;
  /** AI text generation (provider streaming proxy). */
  ai: boolean;
  /** Webpage-embed poster screenshots. */
  screenshot: boolean;
  /** TTF font CSS for PDF embedding (WOFF2 direct import works regardless). */
  fontTtf: boolean;
}

/** Transport for each platform-dependent service. Web: sync-server proxies. */
export const platform = {
  /** True when cross-origin API calls go through the desktop shell. */
  get hasHttpBridge(): boolean {
    return !!desktop?.httpFetch;
  },
  /** A plain HTTP request: through the desktop shell where there is one (no
   *  CORS), else the browser's own fetch. Returns status and body text. */
  async httpFetch(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<{ status: number; body: string }> {
    if (desktop?.httpFetch) {
      return desktop.httpFetch({
        url,
        ...(init.method ? { method: init.method } : {}),
        ...(init.headers ? { headers: init.headers } : {}),
        ...(init.body !== undefined ? { body: init.body } : {}),
      });
    }
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      ...(init.headers ? { headers: init.headers } : {}),
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    return { status: res.status, body: await res.text() };
  },
  rssFetch(url: string): Promise<Response> {
    if (desktop) {
      return desktop.rssFetch(url).then(
        (r) =>
          new Response(r.body, {
            status: r.status,
            headers: { 'content-type': 'application/xml; charset=utf-8' },
          }),
      );
    }
    return apiFetch(`/api/rss?url=${encodeURIComponent(url)}`);
  },
  aiChat(init: RequestInit): Promise<Response> {
    return apiFetch('/api/ai/chat', init);
  },
  aiAgent(init: RequestInit): Promise<Response> {
    return apiFetch('/api/ai/agent', init);
  },
  aiModels(init: RequestInit): Promise<Response> {
    return apiFetch('/api/ai/models', init);
  },
  aiImage(init: RequestInit): Promise<Response> {
    return apiFetch('/api/ai/image', init);
  },
  aiMediaModels(init: RequestInit): Promise<Response> {
    return apiFetch('/api/ai/media-models', init);
  },
  aiVideo(init: RequestInit): Promise<Response> {
    return apiFetch('/api/ai/video', init);
  },
  aiVideoStatus(init: RequestInit): Promise<Response> {
    return apiFetch('/api/ai/video/status', init);
  },
  aiVideoDownload(init: RequestInit): Promise<Response> {
    return apiFetch('/api/ai/video/download', init);
  },
  fontCss(family: string): Promise<Response> {
    if (desktop) {
      return desktop.fontCss(family).then(
        (r) =>
          new Response(r.body, {
            status: r.status,
            headers: { 'content-type': 'text/css; charset=utf-8' },
          }),
      );
    }
    return apiFetch(`/api/fontcss?family=${encodeURIComponent(family)}`);
  },
  ttsVoices(init: RequestInit): Promise<Response> {
    return apiFetch('/api/tts/voices', init);
  },
  ttsModels(init: RequestInit): Promise<Response> {
    return apiFetch('/api/tts/models', init);
  },
  ttsSpeak(init: RequestInit): Promise<Response> {
    return apiFetch('/api/tts/speak', init);
  },
  ttsClone(init: RequestInit): Promise<Response> {
    return apiFetch('/api/tts/clone', init);
  },
  comfyModels(init: RequestInit): Promise<Response> {
    return apiFetch('/api/comfy/models', init);
  },
  comfyPrompt(init: RequestInit): Promise<Response> {
    return apiFetch('/api/comfy/prompt', init);
  },
  comfyStatus(init: RequestInit): Promise<Response> {
    return apiFetch('/api/comfy/status', init);
  },
  comfyView(init: RequestInit): Promise<Response> {
    return apiFetch('/api/comfy/view', init);
  },
  comfyUpload(init: RequestInit): Promise<Response> {
    return apiFetch('/api/comfy/upload', init);
  },
  backupPut(init: RequestInit): Promise<Response> {
    return apiFetch('/api/backup/put', init);
  },
  backupList(init: RequestInit): Promise<Response> {
    return apiFetch('/api/backup/list', init);
  },
  backupGet(init: RequestInit): Promise<Response> {
    return apiFetch('/api/backup/get', init);
  },
  urlFetch(init: RequestInit): Promise<Response> {
    return apiFetch('/api/urlfetch', init);
  },
  sharePut(id: string, init: RequestInit): Promise<Response> {
    return apiFetch(`/api/share/${encodeURIComponent(id)}`, { ...init, method: 'PUT' });
  },
  shareDelete(id: string): Promise<Response> {
    return apiFetch(`/api/share/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  },
  shareList(): Promise<Response> {
    return apiFetch('/api/shares', { credentials: 'include' });
  },
  screenshot(init: RequestInit): Promise<Response> {
    if (desktop) {
      const opts = JSON.parse(String(init.body ?? '{}')) as {
        url?: string;
        width?: number;
        height?: number;
      };
      return desktop
        .screenshot({ url: opts.url ?? '', width: opts.width ?? 720, height: opts.height ?? 520 })
        .then(
          (r) =>
            new Response(r.bytes ?? null, {
              status: r.status,
              headers: { 'content-type': 'image/png' },
            }),
        );
    }
    return apiFetch('/api/screenshot', init);
  },
};

// --- connectivity ------------------------------------------------------------
// Two live signals, probed continuously (not once): `internetUp` (the
// browser's own network state) and `serverUp` (can we actually reach OUR
// sync server — the one that matters for the server-backed tier). Optimistic
// until known so gates never flash on normal deployments. Every apiFetch
// outcome feeds the state; while down, /api/health is re-probed with
// exponential backoff and on online/visibility events.

let serverUp: boolean | null = null;
let internetUp = typeof navigator === 'undefined' ? true : navigator.onLine;
let probe: Promise<boolean> | null = null;
const probeListeners = new Set<(up: boolean) => void>();
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 5000;

function emit(): void {
  probeListeners.forEach((l) => l(serverUp ?? true));
}

function setServerUp(up: boolean): void {
  if (serverUp === up) return;
  serverUp = up;
  emit();
  if (up) {
    backoffMs = 5000;
    if (backoffTimer) {
      clearTimeout(backoffTimer);
      backoffTimer = null;
    }
  } else {
    scheduleRetry();
  }
}

function scheduleRetry(): void {
  if (backoffTimer || !hasSyncServer()) return;
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    backoffMs = Math.min(60000, backoffMs * 2);
    void probeServer().then((up) => {
      if (!up) scheduleRetry();
    });
  }, backoffMs);
}

/** One health check (deduped while in flight); updates the live state. */
export function probeServer(): Promise<boolean> {
  if (!hasSyncServer()) return Promise.resolve(false);
  probe ??= (async () => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const res = await apiFetch('/api/health', { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  })().then((up) => {
    probe = null;
    setServerUp(up);
    return up;
  });
  return probe;
}

/** Start the live monitor: boot probe, browser events, fetch outcomes. */
export function initConnectivity(): void {
  if (typeof window === 'undefined' || !hasSyncServer()) return;
  void probeServer();
  window.addEventListener('online', () => {
    internetUp = true;
    emit();
    void probeServer();
  });
  window.addEventListener('offline', () => {
    internetUp = false;
    // No network interface → the server is certainly unreachable.
    setServerUp(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && serverUp === false) void probeServer();
  });
  // Every real API call is a free health signal (HTTP errors still count
  // as reachable — only network-level failures mark the server down).
  setNetObserver(setServerUp);
}

export interface Connectivity {
  /** null until the first probe lands (treated as up by optimistic gates). */
  serverReachable: boolean | null;
  internetUp: boolean;
}

/** Reactive connectivity — re-renders on any state change. */
export function useConnectivity(): Connectivity {
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    probeListeners.add(bump);
    return () => {
      probeListeners.delete(bump);
    };
  }, []);
  return { serverReachable: serverUp, internetUp };
}

/** Snapshot for non-React code paths. Optimistic before the probe lands. */
export function getPlatformCaps(): PlatformCaps {
  // Desktop: rss/screenshot/fontTtf are native (no server, no sign-in);
  // AI alone still requires a reachable sync server + account.
  if (desktop) {
    return {
      rss: true,
      screenshot: true,
      fontTtf: true,
      ai: hasSyncServer() && (serverUp ?? true),
    };
  }
  if (!hasSyncServer()) return { rss: false, screenshot: false, ai: false, fontTtf: false };
  const signedIn = useSyncStore.getState().status === 'signedIn';
  const up = serverUp ?? true;
  return { rss: signedIn && up, screenshot: signedIn && up, ai: up, fontTtf: up };
}

/** Reactive capabilities — re-renders on sign-in changes and probe results. */
export function usePlatformCaps(): PlatformCaps {
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const [up, setUp] = useState(serverUp ?? true);
  useEffect(() => {
    void probeServer();
    probeListeners.add(setUp);
    return () => {
      probeListeners.delete(setUp);
    };
  }, []);
  if (desktop) {
    return { rss: true, screenshot: true, fontTtf: true, ai: hasSyncServer() && up };
  }
  if (!hasSyncServer()) return { rss: false, screenshot: false, ai: false, fontTtf: false };
  return { rss: signedIn && up, screenshot: signedIn && up, ai: up, fontTtf: up };
}
