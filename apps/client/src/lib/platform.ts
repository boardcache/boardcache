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

/** One board folder as the shell's scan lists it. */
export interface VaultScanBoard {
  /** Relative path of the board folder (its name is the last segment). */
  path: string;
  id: string;
  name: string;
  updatedAt: string;
  locked: boolean;
  size: number;
  /** Modification stamps of the thumbnails (ms), null when absent. */
  thumb: number | null;
  thumbDark: number | null;
}
interface VaultScan {
  root: string | null;
  /** Relative paths of the organisational folders. */
  dirs: string[];
  boards: VaultScanBoard[];
}
export type VaultFile =
  | 'manifest.json'
  | 'document.json'
  | 'thumbnail.png'
  | 'thumbnail-dark.png'
  | `assets/${string}`
  | `.boardcache/assets/${string}`
  | `images/${string}`
  | `videos/${string}`
  | `audio/${string}`
  | `documents/${string}`
  | `fonts/${string}`;
/** One readable media file of a board folder, as the shell lists it. */
interface VaultListedFile {
  file: VaultFile;
  bytes: number;
  mtime: number;
}
/** Whether the board folder's volume can be kept out of the OS index. */
export interface VaultSpotlight {
  offered: boolean;
  volume: string | null;
  excluded: boolean;
}
type VaultResult<T> = (T & { error?: undefined }) | { error: string };
export interface DesktopVault {
  get(): Promise<{ root: string | null }>;
  /** The native folder dialog; the root stays as it was when cancelled. */
  choose(): Promise<{ root: string | null; cancelled?: boolean }>;
  clear(): Promise<{ root: string | null }>;
  scan(): Promise<VaultScan>;
  read(path: string, file: VaultFile): Promise<VaultResult<{ bytes: Uint8Array; mtime: number }>>;
  write(
    path: string,
    files: { file: VaultFile; bytes: Uint8Array }[],
    remove?: VaultFile[],
  ): Promise<VaultResult<{ path: string; mtimes?: Partial<Record<VaultFile, number | null>> }>>;
  /** Move files within one board folder (giving assets their readable names). */
  arrange(
    path: string,
    moves: { from: VaultFile; to: VaultFile }[],
  ): Promise<VaultResult<{ moved: number; missing: VaultFile[] }>>;
  /** The readable media files of a board folder. */
  list(path: string): Promise<VaultResult<{ files: VaultListedFile[] }>>;
  spotlight(): Promise<VaultSpotlight>;
  excludeFromSpotlight(): Promise<{ excluded: boolean; error?: string }>;
  mkdir(path: string, name: string): Promise<VaultResult<{ path: string }>>;
  rename(path: string, name: string): Promise<VaultResult<{ path: string; name: string }>>;
  move(path: string, dir: string): Promise<VaultResult<{ path: string }>>;
  copy(path: string, name: string): Promise<VaultResult<{ path: string; name: string }>>;
  trash(path: string): Promise<VaultResult<{ path: string; trashed: boolean }>>;
  reveal(path: string): Promise<void>;
  /** Changes made outside the app, as relative paths, debounced. */
  onChanged(cb: (paths: string[]) => void): () => void;
}

export interface PortableState {
  portable: boolean;
  /** Where the data is kept now. */
  dataDir: string;
  /** The folder beside the app that turns portable mode on; null where the
   *  app has no "beside" (a macOS bundle, a development run). */
  portableDir: string | null;
}

/** A request the desktop makes on the renderer's behalf (lib/platform httpFetch). */
interface BridgeHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface DesktopBridge {
  /** The shell's operating system: 'win32', 'darwin' or 'linux'. */
  os?: string;
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
  /** The board folder: boards kept as folders on disk (lib/vault). Paths
   *  are relative to the chosen root; the shell refuses anything outside. */
  vault?: DesktopVault;
  /** Portable mode: where the app's data lives, and the folder beside the
   *  app that makes the data travel with it. */
  portable?: {
    get(): Promise<PortableState>;
    create(): Promise<PortableState | { error: string }>;
    /** Start the app again (after the data folder was made). */
    restart(): Promise<void>;
  };
  menu?: {
    onAction(cb: (action: string) => void): () => void;
  };
  /** Interface size: one zoom factor for every window, kept by the shell. */
  ui?: {
    getZoom(): Promise<number>;
    setZoom(zoom: number): Promise<number>;
    onZoom(cb: (zoom: number) => void): () => void;
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
  /** The OS clipboard read by the shell: an image in any format, or files
   *  copied in a file manager, with no prompt (the web API hands over PNG
   *  only, and on Linux often nothing for a copied image). */
  clipboard?: {
    files(): Promise<{ files: { name: string; bytes: ArrayBuffer | Uint8Array; mime: string }[] }>;
  };
  /** The browser clipper's local inbox (clips sent to this computer). */
  clips?: {
    list(): Promise<DesktopClip[]>;
    media(id: string): Promise<{ bytes: Uint8Array; mime: string | null } | null>;
    remove(id: string): Promise<void>;
    /** The code a browser pastes to pair with this app. */
    pairing(): Promise<ClipPairing>;
    /** A new code: browsers paired with the old one stop reaching the app. */
    regenerate(): Promise<ClipPairing>;
    onChanged(cb: () => void): () => void;
  };
  agent?: {
    onRequest(cb: (req: AgentRequest) => void): () => void;
    respond(res: AgentResponse): void;
    /** Tells the shell the bridge is listening (calls before this are refused). */
    ready(): void;
    info(): Promise<AgentInfo>;
    /** A new token: HTTP sessions end, agent.json is rewritten. */
    regenerate(): Promise<AgentInfo>;
    /** Keep running in the tray after the last window closes: read, or set. */
    background(value?: boolean): Promise<boolean>;
    /** Open the user's terminal with Claude Code connected to this app, in
     *  the board folder `dir` (relative to the Files root) when given. */
    launch(req: { dir?: string }): Promise<AgentLaunchResult>;
  };
}

/** One request from the desktop's agent endpoint (see lib/agentBridge). */
export type AgentRequest =
  | { id: string; kind: 'tools' }
  | { id: string; kind: 'boards' }
  | { id: string; kind: 'recipes' }
  | { id: string; kind: 'call'; name: string; args: unknown };

/** A clip the browser clipper sent to the desktop app (apps/desktop/clips.cjs). */
interface DesktopClip {
  id: string;
  kind: 'link' | 'text' | 'image' | 'embed' | 'video';
  url: string | null;
  title: string | null;
  body: string | null;
  imageMime: string | null;
  boardId: string | null;
  createdAt: string;
}

export interface ClipPairing {
  port: number | null;
  /** `bcl.<port>.<token>`, or null while the endpoint is not up. */
  code: string | null;
}
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
  /** The MCP client configuration for this app, as Claude Code reads it. */
  mcpConfigPath: string;
  /** Whether the HTTP transport is bundled in this build. */
  http: boolean;
  /** The app stays in the tray after the last window closes. */
  background: boolean;
}

type AgentLaunchResult = { ok: true; cwd: string; terminal: string } | { ok: false; error: string };

/** The desktop shell's agent channel, when running inside it. */
/** The desktop shell's operating system, or null in a browser. */
export function desktopOs(): 'win32' | 'darwin' | 'linux' | null {
  const os = desktop?.os;
  return os === 'win32' || os === 'darwin' || os === 'linux' ? os : null;
}

export function desktopAgent(): NonNullable<DesktopBridge['agent']> | null {
  return desktop?.agent ?? null;
}

/** The desktop shell's local clip inbox, when running inside it. */
export function desktopClips(): NonNullable<DesktopBridge['clips']> | null {
  return desktop?.clips ?? null;
}

/** The desktop shell's interface-size control, when running inside it. */
export function desktopUi(): NonNullable<DesktopBridge['ui']> | null {
  return desktop?.ui ?? null;
}

/** The desktop shell's file access, when running inside it. */
export function desktopFiles(): NonNullable<DesktopBridge['files']> | null {
  return desktop?.files ?? null;
}

/** The desktop shell's clipboard reader, when running inside it. */
export function desktopClipboard(): NonNullable<DesktopBridge['clipboard']> | null {
  return desktop?.clipboard ?? null;
}

/** The desktop shell's board folder, when running inside it. */
export function desktopVault(): DesktopVault | null {
  return desktop?.vault ?? null;
}

/** The desktop shell's portable-mode state, when running inside it. */
export function desktopPortable(): NonNullable<DesktopBridge['portable']> | null {
  return desktop?.portable ?? null;
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
  let localNetworkTold = false;
  desktop?.menu?.onAction((action) => {
    if (action === 'local-network-blocked') {
      // macOS refused the shell's request to a server on the local network:
      // the Local Network permission is off for the app. Once a session.
      if (localNetworkTold) return;
      localNetworkTold = true;
      void import('./notices').then(({ showNotice }) =>
        showNotice(
          'macOS is keeping boardCache off your local network, so your sync server cannot be reached. Allow boardCache under System Settings → Privacy & Security → Local Network, then click the sync pill to retry.',
          { id: 'local-network', kind: 'warn' },
        ),
      );
      return;
    }
    if (action === 'ui-zoom-in' || action === 'ui-zoom-out' || action === 'ui-zoom-reset') {
      void import('./uiZoom').then(({ stepUiZoom }) =>
        stepUiZoom(action === 'ui-zoom-in' ? 1 : action === 'ui-zoom-out' ? -1 : 0),
      );
      return;
    }
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
  /** Mail accounts (IMAP/SMTP through the sync server's mail proxy). */
  mail: boolean;
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
  /** One call to the sync server's mail proxy (the account travels in the body). */
  mailRequest(op: string, body: unknown): Promise<Response> {
    return apiFetch(`/api/mail/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
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
  shareAssetPut(id: string, hash: string, body: Blob): Promise<Response> {
    return apiFetch(`/api/share/${encodeURIComponent(id)}/assets/${hash}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    });
  },
  shareCoverPut(id: string, body: Blob): Promise<Response> {
    return apiFetch(`/api/share/${encodeURIComponent(id)}/cover`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    });
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
  // Mail accounts reach their servers through the sync server everywhere.
  const mailOk = hasSyncServer() && useSyncStore.getState().status === 'signedIn';
  if (desktop) {
    return {
      rss: true,
      screenshot: true,
      fontTtf: true,
      ai: hasSyncServer() && (serverUp ?? true),
      mail: mailOk && (serverUp ?? true),
    };
  }
  if (!hasSyncServer())
    return { rss: false, screenshot: false, ai: false, fontTtf: false, mail: false };
  const signedIn = useSyncStore.getState().status === 'signedIn';
  const up = serverUp ?? true;
  return {
    rss: signedIn && up,
    screenshot: signedIn && up,
    ai: up,
    fontTtf: up,
    mail: signedIn && up,
  };
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
  const mail = hasSyncServer() && signedIn && up;
  if (desktop) {
    return { rss: true, screenshot: true, fontTtf: true, ai: hasSyncServer() && up, mail };
  }
  if (!hasSyncServer())
    return { rss: false, screenshot: false, ai: false, fontTtf: false, mail: false };
  return { rss: signedIn && up, screenshot: signedIn && up, ai: up, fontTtf: up, mail };
}
