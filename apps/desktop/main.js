const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  shell,
  session,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * boardCache desktop shell. The client bundle (apps/client/dist) is served
 * from a custom app:// scheme with SPA fallback — file:// would break the
 * history-API router and fetch semantics. The bundled config points the
 * client at the SaaS sync server; the local tier (canvas, boards, assets)
 * works with no connection at all, and lib/platform's connectivity monitor
 * surfaces the rest. AI stays server-gated by design — the desktop build
 * carries no provider keys. (CJS on purpose: Electron's ESM loader trips
 * over pnpm's symlinked node_modules.)
 */

/** Packaged: extraResources/client-dist. Dev: the sibling workspace build. */
const DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'client-dist')
  : path.join(__dirname, '../client/dist');

/** The deployment the app syncs against: app-config.json, written into the
 *  package by the build from build.json (+ build.local.json) at the repo
 *  root. Dev reads those files directly. */
const APP_CONFIG = app.isPackaged
  ? require('./app-config.json')
  : require('../../scripts/build-config.cjs')();

const APP_ORIGIN = 'app://boardcache';

// Menus, the Dock and "About" read the app name at runtime; without this
// they show the workspace package name ("@boardcache/desktop").
app.setName('boardCache');
// Windows attributes toast notifications (and taskbar grouping) to this id;
// without it reminders show as coming from "electron.app…" or not at all.
if (process.platform === 'win32') app.setAppUserModelId('com.boardcache.app');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/** A readable failure instead of a white window when the bundle is absent. */
function missingBundlePage() {
  const html = `<!doctype html><meta charset="utf-8"><title>boardCache</title>
<body style="font:15px/1.5 -apple-system,system-ui,sans-serif;padding:40px;color:#222;background:#f5f5f7">
<h1 style="font-size:20px">The app bundle is missing</h1>
<p>This build has no client files at:</p><pre style="white-space:pre-wrap">${DIST}</pre>
<p>Build the client first (<code>pnpm --filter @boardcache/client build</code>), then package again.</p>
</body>`;
  return new Response(html, { status: 500, headers: { 'content-type': 'text/html' } });
}

function serveBundle(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`boardCache: client bundle not found at ${DIST}`);
    return missingBundlePage();
  }
  // The desktop shell owns the deployment config: point at the SaaS server.
  if (pathname === '/config.json') {
    return new Response(JSON.stringify(APP_CONFIG), {
      headers: { 'content-type': 'application/json' },
    });
  }
  let file = path.normalize(path.join(DIST, pathname));
  if (!file.startsWith(DIST)) file = path.join(DIST, 'index.html'); // traversal guard
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html'); // SPA fallback (/b/:id, /community…)
  }
  return net.fetch(pathToFileURL(file).toString());
}

// --- native platform services (lib/platform.ts desktop bridge) --------------
// Mirrors the sync server's /api/rss, /api/fontcss and /api/screenshot
// behavior, minus the sign-in gates: native fetches have no CORS and only
// touch the local user's own network. AI has no native path on purpose.

function parseHttpUrl(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

// ── sync token at rest: safeStorage (Keychain / DPAPI / libsecret) ─────────
const TOKEN_FILE = () => path.join(app.getPath('userData'), 'session.bin');
ipcMain.handle('bc:token:get', async () => {
  try {
    if (!fs.existsSync(TOKEN_FILE()) || !safeStorage.isEncryptionAvailable()) return null;
    const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(TOKEN_FILE())));
    return parsed && typeof parsed.token === 'string' ? parsed : null;
  } catch {
    return null;
  }
});
ipcMain.handle('bc:token:set', async (_e, value) => {
  if (!value || typeof value.token !== 'string' || !safeStorage.isEncryptionAvailable())
    return false;
  fs.writeFileSync(
    TOKEN_FILE(),
    safeStorage.encryptString(JSON.stringify({ token: value.token, id: value.id ?? null })),
    { mode: 0o600 },
  );
  return true;
});
ipcMain.handle('bc:token:clear', async () => {
  try {
    fs.rmSync(TOKEN_FILE(), { force: true });
  } catch {
    /* nothing to clear */
  }
  return true;
});

ipcMain.handle('bc:rss', async (_e, raw) => {
  const url = parseHttpUrl(raw);
  if (!url) return { status: 400, body: '' };
  try {
    const res = await net.fetch(url.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) return { status: 502, body: '' };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 3 * 1024 * 1024) return { status: 413, body: '' };
    return { status: 200, body: Buffer.from(buf).toString('utf8') };
  } catch {
    return { status: 502, body: '' };
  }
});

/** Research plugin providers: the renderer may call these hosts through the
 *  shell (their APIs refuse browser cross-origin calls, or need a header the
 *  browser will not send). Anything else is refused: this is not a proxy. */
const HTTP_HOSTS = new Set([
  'api.search.brave.com',
  'api.tavily.com',
  'api.perplexity.ai',
  'content.guardianapis.com',
  'api.nytimes.com',
  'api.gdeltproject.org',
  'api.openalex.org',
  'api.semanticscholar.org',
  'api.crossref.org',
  'export.arxiv.org',
  'eutils.ncbi.nlm.nih.gov',
  'api.si.edu',
  'api.europeana.eu',
  'collectionapi.metmuseum.org',
  'www.loc.gov',
  'api.trove.nla.gov.au',
  'www.googleapis.com',
  'archive.org',
  'openlibrary.org',
  'api.x.com',
  'public.api.bsky.app',
  'www.reddit.com',
]);
ipcMain.handle('bc:http', async (_e, req) => {
  const url = parseHttpUrl(req && req.url);
  if (!url || !HTTP_HOSTS.has(url.hostname)) return { status: 400, body: '' };
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET';
  if (method !== 'GET' && method !== 'POST') return { status: 400, body: '' };
  const headers = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (typeof v === 'string' && /^[\w-]{1,64}$/.test(k)) headers[k] = v;
  }
  try {
    const res = await net.fetch(url.href, {
      method,
      headers,
      ...(method === 'POST' && typeof req.body === 'string' ? { body: req.body } : {}),
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 6 * 1024 * 1024) return { status: 413, body: '' };
    return { status: res.status, body: Buffer.from(buf).toString('utf8') };
  } catch (err) {
    return { status: 502, body: err instanceof Error ? err.message : '' };
  }
});

ipcMain.handle('bc:fontcss', async (_e, family) => {
  if (!/^[\w \-+.,()]{1,80}$/.test(String(family))) return { status: 400, body: '' };
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(String(family)).replace(/%20/g, '+')}:wght@400&display=swap`;
  try {
    // Non-browser UA → Google serves TrueType URLs (embeddable in PDFs).
    const res = await net.fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'curl/8', accept: 'text/css,*/*' },
    });
    if (!res.ok) return { status: res.status === 400 ? 404 : 502, body: '' };
    return { status: 200, body: await res.text() };
  } catch {
    return { status: 502, body: '' };
  }
});

let shotsInFlight = 0;

ipcMain.handle('bc:screenshot', async (_e, opts) => {
  const url = parseHttpUrl(opts?.url);
  if (!url) return { status: 400 };
  if (shotsInFlight >= 2) return { status: 503 };
  const width = Math.min(1600, Math.max(320, Math.round(Number(opts?.width) || 720)));
  const height = Math.min(1600, Math.max(240, Math.round(Number(opts?.height) || 520)));
  shotsInFlight++;
  let win = null;
  try {
    win = new BrowserWindow({
      width,
      height,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
      },
    });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await Promise.race([
      win.loadURL(url.href),
      new Promise((_r, reject) => setTimeout(() => reject(new Error('timeout')), 20_000)),
    ]);
    await new Promise((r) => setTimeout(r, 1200)); // let the page settle
    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    return {
      status: 200,
      bytes: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    };
  } catch {
    return { status: 502 };
  } finally {
    shotsInFlight--;
    if (win && !win.isDestroyed()) win.destroy();
  }
});

let smokeTarget = null;
for (const arg of process.argv) {
  if (arg.startsWith('--smoke=')) smokeTarget = arg.slice('--smoke='.length);
}

// ── .boardcache files handed to us by the OS ────────────────────────────────
// macOS sends `open-file` (possibly before `ready`); Windows and Linux put
// the path in argv — of THIS process on first launch, of a second instance
// afterwards (which we fold into the running window via the single-instance
// lock). The bytes go to the renderer, which imports them exactly like a
// dropped file and opens the board.
const MAX_OPEN_BYTES = 2 * 1024 * 1024 * 1024;
const pendingFiles = [];
let rendererListening = false;
let mainWindow = null;

// ── Agent endpoint (MCP) ────────────────────────────────────────────────────
// Outside agents reach the board tool registry through a loopback HTTP
// endpoint that only this process knows the port and token of: both are
// written to agent.json in userData (mode 600), where the stdio MCP launcher
// (mcp/boardcache-mcp.cjs) reads them. Every request is forwarded to the
// renderer, where the document is decrypted and the schema enforced; the
// main process never interprets a board.
const http = require('node:http');
const nodeCrypto = require('node:crypto');
const AGENT_FILE = () => path.join(app.getPath('userData'), 'agent.json');
/** Port and token persist across launches so clients configured by URL
 *  (the HTTP transport) keep working; the token changes only on demand. */
const AGENT_SETTINGS_FILE = () => path.join(app.getPath('userData'), 'agent-settings.json');
const agentPending = new Map(); // request id → { resolve, timer }
let agentServer = null;
let agentToken = '';
let mcpHttp = null; // the bundled Streamable HTTP transport, when present
/** The renderer's bridge said hello (lib/agentBridge); cleared on a real navigation. */
let agentReady = false;
ipcMain.on('bc:agent:ready', () => {
  agentReady = true;
});

function agentRequest(kind, payload) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed() || !agentReady) {
      resolve({ ok: false, error: 'boardCache is starting up; try again in a moment.' });
      return;
    }
    const id = nodeCrypto.randomUUID();
    const timer = setTimeout(() => {
      agentPending.delete(id);
      resolve({ ok: false, error: 'The app did not answer within 60 seconds.' });
    }, 60_000);
    agentPending.set(id, { resolve, timer });
    mainWindow.webContents.send('bc:agent:request', { id, kind, ...payload });
  });
}

ipcMain.on('bc:agent:response', (_e, res) => {
  const pending = agentPending.get(res.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  agentPending.delete(res.id);
  pending.resolve(res.ok ? { ok: true, result: res.result } : { ok: false, error: res.error });
});

function mcpDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp')
    : path.join(__dirname, 'mcp', 'dist');
}
function launcherPath() {
  return path.join(mcpDir(), 'boardcache-mcp.cjs');
}

function readAgentSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(AGENT_SETTINGS_FILE(), 'utf8'));
    return {
      port: Number.isInteger(raw.port) ? raw.port : 0,
      token: typeof raw.token === 'string' && raw.token.length >= 24 ? raw.token : '',
    };
  } catch {
    return { port: 0, token: '' };
  }
}

function writeAgentFiles(port) {
  const payload = {
    port,
    token: agentToken,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(AGENT_FILE(), JSON.stringify(payload), { mode: 0o600 });
    fs.writeFileSync(AGENT_SETTINGS_FILE(), JSON.stringify({ port, token: agentToken }), {
      mode: 0o600,
    });
  } catch (err) {
    console.error('boardCache: could not write agent files', err);
  }
}

function agentInfo() {
  const port = agentServer?.address()?.port ?? null;
  return {
    port,
    url: port ? `http://127.0.0.1:${port}/mcp` : null,
    token: agentToken,
    configPath: AGENT_FILE(),
    launcherPath: launcherPath(),
    http: !!mcpHttp,
  };
}

ipcMain.handle('bc:agent:info', async () => agentInfo());

/** A new token: every existing HTTP session ends, agent.json is rewritten,
 *  and clients configured with the old token get 401 until updated. */
ipcMain.handle('bc:agent:regenerate', async () => {
  agentToken = nodeCrypto.randomBytes(24).toString('base64url');
  if (mcpHttp) await mcpHttp.closeAll();
  const port = agentServer?.address()?.port;
  if (port) writeAgentFiles(port);
  return agentInfo();
});

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 16 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function startAgentServer() {
  const saved = readAgentSettings();
  agentToken = saved.token || nodeCrypto.randomBytes(24).toString('base64url');
  // The HTTP MCP transport is a separate bundle (mcp/dist/mcp-http.cjs);
  // without it the endpoint still serves /tools and /call for the launcher.
  try {
    const { createMcpHttp } = require(path.join(mcpDir(), 'mcp-http.cjs'));
    mcpHttp = createMcpHttp({
      listTools: async () => {
        const r = await agentRequest('tools', {});
        if (!r.ok) throw new Error(r.error);
        return r.result.tools;
      },
      callTool: async (name, args) => {
        const r = await agentRequest('call', { name, args });
        if (!r.ok) throw new Error(r.error);
        return r.result;
      },
    });
  } catch (err) {
    console.warn('boardCache: MCP over HTTP unavailable', err instanceof Error ? err.message : err);
  }
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  agentServer = http.createServer(async (req, res) => {
    // Loopback only, and the token is the whole access control: a browser
    // page cannot read agent.json, so it cannot talk to this.
    if (req.headers.authorization !== `Bearer ${agentToken}`) {
      return send(res, 401, { error: 'Unauthorized' });
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (url.pathname === '/mcp') {
        if (!mcpHttp) return send(res, 404, { error: 'MCP over HTTP is not bundled' });
        const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
        await mcpHttp.handle(req, res, body);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/tools')
        return send(res, 200, await agentRequest('tools', {}));
      if (req.method === 'POST' && url.pathname === '/call') {
        const body = await readJsonBody(req);
        if (typeof body.name !== 'string')
          return send(res, 400, { ok: false, error: 'name is required' });
        return send(
          res,
          200,
          await agentRequest('call', { name: body.name, args: body.args ?? {} }),
        );
      }
      if (req.method === 'GET' && url.pathname === '/health')
        return send(res, 200, { ok: true, app: 'boardCache' });
      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      return send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  // The saved port first (URL-configured clients rely on it). A quick quit
  // and reopen can find the old process still letting go of it, so it is
  // retried for a moment; only then does any free port do, and the settings
  // follow.
  let busyRetries = 5;
  agentServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && saved.port) {
      if (busyRetries-- > 0) {
        setTimeout(() => agentServer?.listen(saved.port, '127.0.0.1'), 400);
        return;
      }
      console.warn(`boardCache: agent port ${saved.port} is busy; picking another`);
      saved.port = 0;
      agentServer.listen(0, '127.0.0.1');
    } else console.error('boardCache: agent endpoint failed', err);
  });
  agentServer.listen(saved.port, '127.0.0.1', () => {
    const port = agentServer.address().port;
    writeAgentFiles(port);
    console.log(`boardCache: agent endpoint on 127.0.0.1:${port}`);
  });
}

function stopAgentServer() {
  try {
    fs.unlinkSync(AGENT_FILE());
  } catch {
    /* already gone */
  }
  void mcpHttp?.closeAll();
  agentServer?.closeAllConnections();
  agentServer?.close();
  agentServer = null;
}

function boardFilesIn(argv) {
  return argv.filter((a) => /\.boardcache(\.enc)?$/i.test(a) && !a.startsWith('--'));
}

function readBoardFile(file) {
  try {
    const abs = path.resolve(file);
    const size = fs.statSync(abs).size;
    if (size === 0 || size > MAX_OPEN_BYTES) return null;
    const bytes = fs.readFileSync(abs);
    return { name: path.basename(abs), bytes };
  } catch {
    return null;
  }
}

function openBoardFile(file) {
  const payload = readBoardFile(file);
  console.log(
    `boardCache: open ${file} → ${payload ? `${payload.bytes.length} bytes` : 'unreadable'}`,
  );
  if (!payload) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  if (rendererListening && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bc:open-file', payload);
  } else {
    pendingFiles.push(payload);
  }
}

/** Agent file tools: read a local file for import, write an export. Both act
 *  as the user on absolute paths; the renderer decides what to do with the
 *  bytes. Reads are capped so a stray path cannot swallow memory. */
const FILE_READ_MAX = 512 * 1024 * 1024;
ipcMain.handle('bc:file:read', async (_e, raw) => {
  try {
    const p = path.resolve(String(raw));
    const stat = await fs.promises.stat(p);
    if (!stat.isFile()) return { error: 'Not a file' };
    if (stat.size > FILE_READ_MAX) return { error: 'File is larger than 512 MB' };
    const bytes = await fs.promises.readFile(p);
    return { name: path.basename(p), bytes };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});
ipcMain.handle('bc:file:write', async (_e, { path: raw, bytes }) => {
  try {
    const p = path.resolve(String(raw));
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, Buffer.from(bytes));
    return { path: p };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('bc:focus', async () => {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
});

ipcMain.handle('bc:openfiles:take', async () => {
  rendererListening = true;
  return pendingFiles.splice(0, pendingFiles.length);
});

// ── application menu ────────────────────────────────────────────────────────
// Standard roles plus the app's own entries. An entry with an `action` is
// forwarded to the renderer (lib/platform.ts initDesktopMenu), which runs it
// through the same paths as the in-app UI. To add one: give it an id, call
// `send('<action>')`, and handle that action in the client.
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (action) => () => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send('bc:menu', action);
  };
  const settings = {
    id: 'settings',
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: send('settings'),
  };
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: isMac ? [{ role: 'close' }] : [settings, { type: 'separator' }, { role: 'quit' }],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('open-file', (event, file) => {
  event.preventDefault();
  console.log(`boardCache: open-file event ${file} (window ${mainWindow ? 'up' : 'not yet'})`);
  openBoardFile(file);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    for (const file of boardFilesIn(argv)) openBoardFile(file);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: smokeTarget === null,
    backgroundColor: '#f5f5f7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Loading failures go to the terminal instead of a silent white window;
  // BOARDCACHE_DEVTOOLS=1 opens the inspector for the renderer side.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`boardCache: failed to load ${url}: ${desc} (${code})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`boardCache: renderer gone: ${details.reason} (exit ${details.exitCode})`);
  });
  win.webContents.on('preload-error', (_e, preloadPath, err) => {
    console.error(`boardCache: preload failed (${preloadPath}): ${err.message}`);
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error(`boardCache renderer: ${message}`);
  });
  if (process.env.BOARDCACHE_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });

  // Target=_blank / window.open → the system browser, never a child window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      e.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    rendererListening = false;
  });
  // A reload starts a fresh renderer that must drain the queue again. Only
  // a REAL navigation counts: the router's pushState also fires
  // did-start-loading, and resetting on that silently parked every later
  // file open and agent call behind "starting up".
  win.webContents.on('did-navigate', () => {
    rendererListening = false;
    agentReady = false;
  });

  try {
    await win.loadURL(`${APP_ORIGIN}/`);
  } catch (err) {
    console.error(
      `boardCache: could not load the app: ${err instanceof Error ? err.message : err}`,
    );
    if (smokeTarget) app.exit(1);
  }

  if (smokeTarget) {
    // Headless verification: let the app boot, snapshot, exit 0.
    await new Promise((r) => setTimeout(r, 4000));
    const image = await win.webContents.capturePage();
    fs.mkdirSync(path.dirname(smokeTarget), { recursive: true });
    fs.writeFileSync(smokeTarget, image.toPNG());
    // Bridge self-test: native fontcss + a real offscreen page screenshot.
    const bridge = await win.webContents.executeJavaScript(`(async () => {
      const d = window.boardcacheDesktop;
      if (!d) return { bridge: false };
      const font = await d.fontCss('Inter');
      const shot = await d.screenshot({ url: 'https://example.com', width: 640, height: 480 });
      return {
        bridge: true,
        fontStatus: font.status,
        fontTtf: font.body.includes('truetype'),
        shotStatus: shot.status,
        shotBytes: shot.bytes ? shot.bytes.byteLength : 0,
      };
    })()`);
    console.log('smoke bridge:', JSON.stringify(bridge));
    // A .boardcache on the command line: by now it must be the open board.
    const fileState = await win.webContents.executeJavaScript(`(() => {
      const b = window.__boardcache;
      const doc = b && b.getDoc ? b.getDoc() : null;
      return { url: location.href, doc: doc ? doc.name : null, items: doc ? Object.keys(doc.items).length : 0 };
    })()`);
    console.log('smoke file:', JSON.stringify(fileState));
    // Menu → renderer: the Settings entry must open the settings dialog.
    Menu.getApplicationMenu()?.getMenuItemById('settings')?.click();
    await new Promise((r) => setTimeout(r, 1500));
    const settingsOpened = await win.webContents.executeJavaScript(
      `!!document.querySelector('[data-testid="settings-dialog"]')`,
    );
    console.log(`smoke menu: name=${app.name} settingsOpened=${settingsOpened}`);
    if (!settingsOpened || app.name !== 'boardCache') app.exit(1);
    // Reminders use the web Notification API, which the shell delivers
    // natively: it must be permitted without a prompt.
    const notifications = await win.webContents.executeJavaScript(
      `typeof Notification === 'undefined' ? 'unsupported' : Notification.permission`,
    );
    console.log(`smoke notifications: ${notifications}`);
    if (notifications !== 'granted') app.exit(1);
    // A .boardcache path on the command line must have opened as a board.
    // Judged on the URL captured BEFORE Settings opened (its route replaces the board's).
    const expectFile = boardFilesIn(process.argv).length > 0;
    const openedFile = !expectFile || /\/b\/[A-Za-z0-9_-]+/.test(fileState.url);
    console.log(
      `smoke: wrote ${smokeTarget} (${win.webContents.getURL()}) openedFile=${openedFile}`,
    );
    app.exit(
      bridge.bridge && bridge.fontStatus === 200 && bridge.shotStatus === 200 && openedFile ? 0 : 1,
    );
  }
}

/**
 * The community preview frames pages from the sync server inside this
 * window, and that server (or the proxy in front of it) answers every page
 * with X-Frame-Options: SAMEORIGIN, which an app:// window can never
 * satisfy. For sub-frames of our own server only, drop that header and the
 * frame-ancestors directive of an enforced CSP; every other response and
 * every other site keep theirs.
 */
function allowShellFraming() {
  let serverOrigin = '';
  try {
    serverOrigin = new URL(String(APP_CONFIG.syncServer || '')).origin;
  } catch {
    return;
  }
  if (!serverOrigin) return;
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://*/*', 'http://*/*'], types: ['subFrame'] },
    (details, callback) => {
      let origin = '';
      try {
        origin = new URL(details.url).origin;
      } catch {
        /* leave as is */
      }
      if (origin !== serverOrigin) return callback({});
      const headers = {};
      for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
        const key = name.toLowerCase();
        if (key === 'x-frame-options') continue;
        if (key === 'content-security-policy') {
          headers[name] = (Array.isArray(value) ? value : [value]).map((v) =>
            String(v)
              .split(';')
              .filter((d) => !/^\s*frame-ancestors\b/i.test(d))
              .join(';'),
          );
          continue;
        }
        headers[name] = value;
      }
      callback({ responseHeaders: headers });
    },
  );
}

app.whenReady().then(() => {
  protocol.handle('app', serveBundle);
  allowShellFraming();
  buildMenu();
  startAgentServer();
  for (const file of boardFilesIn(process.argv.slice(1))) openBoardFile(file);
  void createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', stopAgentServer);
