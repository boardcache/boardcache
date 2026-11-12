const { contextBridge, ipcRenderer } = require('electron');

/**
 * Desktop bridge: the native implementations behind lib/platform.ts. Only
 * the three CORS-blocked services go native — AI deliberately has NO
 * bridge entry (it stays gated to the sync server in every build).
 */
contextBridge.exposeInMainWorld('boardcacheDesktop', {
  // 'win32' | 'darwin' | 'linux': what the shell can and cannot capture.
  os: process.platform,
  rssFetch: (url) => ipcRenderer.invoke('bc:rss', url),
  // Keyed research APIs (allow-listed hosts) without the browser's CORS rules.
  httpFetch: (req) => ipcRenderer.invoke('bc:http', req),
  fontCss: (family) => ipcRenderer.invoke('bc:fontcss', family),
  screenshot: (opts) => ipcRenderer.invoke('bc:screenshot', opts),
  // The sync bearer token lives in the OS keychain-backed store (Electron
  // safeStorage), never in the renderer's localStorage.
  secureToken: {
    get: () => ipcRenderer.invoke('bc:token:get'),
    set: (token, id) => ipcRenderer.invoke('bc:token:set', { token, id }),
    clear: () => ipcRenderer.invoke('bc:token:clear'),
  },
  // .boardcache files the OS asked us to open (double-click, Open With, a
  // second launch with a path). `take` drains what arrived before the app
  // was listening; `onOpen` hears the rest.
  // A clicked system notification brings the window forward.
  focusWindow: () => ipcRenderer.invoke('bc:focus'),
  // Interface size: one zoom factor for every window of the app, kept by
  // the shell (Settings → General → Interface, the View menu, Cmd/Ctrl+=).
  ui: {
    getZoom: () => ipcRenderer.invoke('bc:ui:zoom:get'),
    setZoom: (zoom) => ipcRenderer.invoke('bc:ui:zoom:set', zoom),
    onZoom: (cb) => {
      const listener = (_e, zoom) => cb(zoom);
      ipcRenderer.on('bc:ui:zoom', listener);
      return () => ipcRenderer.removeListener('bc:ui:zoom', listener);
    },
  },
  // Application-menu entries that act inside the app (Settings…).
  menu: {
    onAction: (cb) => {
      const listener = (_e, action) => cb(action);
      ipcRenderer.on('bc:menu', listener);
      return () => ipcRenderer.removeListener('bc:menu', listener);
    },
  },
  // Agent endpoint (MCP): requests forwarded from the loopback server, and
  // where the stdio launcher lives (for the Settings snippet).
  agent: {
    onRequest: (cb) => {
      const listener = (_e, req) => cb(req);
      ipcRenderer.on('bc:agent:request', listener);
      return () => ipcRenderer.removeListener('bc:agent:request', listener);
    },
    respond: (res) => ipcRenderer.send('bc:agent:response', res),
    ready: () => ipcRenderer.send('bc:agent:ready'),
    info: () => ipcRenderer.invoke('bc:agent:info'),
    regenerate: () => ipcRenderer.invoke('bc:agent:regenerate'),
    /** Keep running in the tray after the last window closes (read, or set). */
    background: (value) => ipcRenderer.invoke('bc:agent:background', value),
    /** Open the user's terminal with Claude Code connected to this app. */
    launch: (req) => ipcRenderer.invoke('bc:agent:launch', req ?? {}),
  },
  // The browser clipper's local inbox: clips it sent to this computer, the
  // code it is paired with, and a ping when a new clip arrives.
  clips: {
    list: () => ipcRenderer.invoke('bc:clips:list'),
    media: (id) => ipcRenderer.invoke('bc:clips:media', id),
    remove: (id) => ipcRenderer.invoke('bc:clips:remove', id),
    pairing: () => ipcRenderer.invoke('bc:clips:pairing'),
    regenerate: () => ipcRenderer.invoke('bc:clips:regenerate'),
    onChanged: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('bc:clips:changed', listener);
      return () => ipcRenderer.removeListener('bc:clips:changed', listener);
    },
  },
  // Local files for the agent tools: import a file onto a board, export a
  // board to a path. Plain user-level access, same as the agent itself has,
  // and only on behalf of an agent call in flight (`grant` is its id).
  files: {
    read: (path, grant) => ipcRenderer.invoke('bc:file:read', { path, grant }),
    write: (path, bytes, grant) => ipcRenderer.invoke('bc:file:write', { path, bytes, grant }),
  },
  // The OS clipboard, read natively: a copied image in any format, or
  // media files copied in a file manager.
  clipboard: {
    files: () => ipcRenderer.invoke('bc:clipboard:files'),
  },
  // The board folder: boards kept as folders on disk (lib/vault). Paths are
  // relative to the chosen root; the shell refuses anything outside it.
  vault: {
    get: () => ipcRenderer.invoke('bc:vault:get'),
    choose: () => ipcRenderer.invoke('bc:vault:choose'),
    clear: () => ipcRenderer.invoke('bc:vault:clear'),
    scan: () => ipcRenderer.invoke('bc:vault:scan'),
    read: (path, file) => ipcRenderer.invoke('bc:vault:read', { path, file }),
    write: (path, files, remove) => ipcRenderer.invoke('bc:vault:write', { path, files, remove }),
    arrange: (path, moves) => ipcRenderer.invoke('bc:vault:arrange', { path, moves }),
    list: (path) => ipcRenderer.invoke('bc:vault:list', { path }),
    spotlight: () => ipcRenderer.invoke('bc:vault:spotlight:get'),
    excludeFromSpotlight: () => ipcRenderer.invoke('bc:vault:spotlight:exclude'),
    mkdir: (path, name) => ipcRenderer.invoke('bc:vault:mkdir', { path, name }),
    rename: (path, name) => ipcRenderer.invoke('bc:vault:rename', { path, name }),
    move: (path, dir) => ipcRenderer.invoke('bc:vault:move', { path, dir }),
    copy: (path, name) => ipcRenderer.invoke('bc:vault:copy', { path, name }),
    trash: (path) => ipcRenderer.invoke('bc:vault:trash', { path }),
    reveal: (path) => ipcRenderer.invoke('bc:vault:reveal', { path }),
    onChanged: (cb) => {
      const listener = (_e, paths) => cb(paths);
      ipcRenderer.on('bc:vault:changed', listener);
      return () => ipcRenderer.removeListener('bc:vault:changed', listener);
    },
  },
  // Portable mode: where the data lives, and the folder beside the app that
  // would make it travel with the app.
  portable: {
    get: () => ipcRenderer.invoke('bc:portable:get'),
    create: () => ipcRenderer.invoke('bc:portable:create'),
    restart: () => ipcRenderer.invoke('bc:portable:restart'),
  },
  openFiles: {
    take: () => ipcRenderer.invoke('bc:openfiles:take'),
    onOpen: (cb) => {
      const listener = (_e, file) => cb(file);
      ipcRenderer.on('bc:open-file', listener);
      return () => ipcRenderer.removeListener('bc:open-file', listener);
    },
  },
});
