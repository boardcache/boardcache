const { contextBridge, ipcRenderer } = require('electron');

/**
 * Desktop bridge: the native implementations behind lib/platform.ts. Only
 * the three CORS-blocked services go native — AI deliberately has NO
 * bridge entry (it stays gated to the sync server in every build).
 */
contextBridge.exposeInMainWorld('boardcacheDesktop', {
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
  },
  // Local files for the agent tools: import a file onto a board, export a
  // board to a path. Plain user-level access, same as the agent itself has,
  // and only on behalf of an agent call in flight (`grant` is its id).
  files: {
    read: (path, grant) => ipcRenderer.invoke('bc:file:read', { path, grant }),
    write: (path, bytes, grant) => ipcRenderer.invoke('bc:file:write', { path, bytes, grant }),
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
