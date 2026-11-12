const fs = require('node:fs');
const path = require('node:path');

/**
 * The board folder ("Files"): a directory of the user's choosing where boards
 * live as folders instead of in the app's database. A board folder holds
 * manifest.json, document.json (absent while the board is locked),
 * thumbnail.png (+ thumbnail-dark.png), the media the board shows as
 * ordinary files under images/, videos/, audio/, documents/ and fonts/,
 * copies the app made for itself under .boardcache/assets/<sha256>, and a
 * locked board's ciphertext under assets/<sha256> — and any other directory
 * is an organisational folder, nested as deep as the person likes. The
 * renderer owns the format (lib/vault); this module owns the disk: every
 * path it takes is relative to the root and checked to stay inside it, every
 * file name it writes is one of the format's, writes are atomic (temporary
 * file + rename), and a watcher reports changes made by anything else (a
 * sync tool, the file manager) while filtering out the app's own.
 */

const FIXED_FILES = new Set([
  'manifest.json',
  'document.json',
  'thumbnail.png',
  'thumbnail-dark.png',
]);
/** The folders a board's readable media files live in (lib/vault/layout). */
const MEDIA_FOLDERS = new Set(['images', 'videos', 'audio', 'documents', 'fonts']);
/** Spotlight leaves a volume alone when this file sits at its root. */
const NEVER_INDEX = '.metadata_never_index';
const MAX_DEPTH = 32;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 512 * 1024 * 1024;
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const WATCH_DEBOUNCE_MS = 400;
/** A file the app wrote within this window is its own write, whatever the watcher says. */
const OWN_WRITE_GRACE_MS = 3000;

/** A folder or file name as the disk takes it: no separators, no control
 *  characters, no reserved names, no leading dots, no trailing dots or
 *  spaces (Windows). The same rule as lib/vault/layout's cleanName, so a
 *  name the renderer makes is one this module accepts. */
function cleanSegment(name, fallback = 'Untitled') {
  let s = String(name)
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is stripped
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)) s = `_${s}`;
  if (s === '') s = fallback;
  return s.slice(0, 120);
}

/** The volume a path sits on, where volumes have a root of their own
 *  (macOS mounts them under /Volumes); null on the system volume. */
function volumeOf(abs, platform = process.platform) {
  if (platform !== 'darwin' || !abs) return null;
  const m = /^\/Volumes\/([^/]+)/.exec(abs);
  return m ? `/Volumes/${m[1]}` : null;
}

function createVault({ settingsFile, onChange, log }) {
  let root = null;
  let watcher = null;
  let pending = new Set();
  let pendingTimer = null;
  /** Absolute path → when the app last wrote it (ms). */
  const ownWrites = new Map();

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (typeof raw.root === 'string' && raw.root) setRoot(raw.root, false);
    } catch {
      /* no folder chosen */
    }
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify({ root }));
    } catch (err) {
      log(`could not write the board folder setting: ${err.message}`);
    }
  }

  function setRoot(dir, persist = true) {
    stopWatching();
    root = dir ? path.resolve(dir) : null;
    if (root) {
      try {
        fs.mkdirSync(root, { recursive: true });
      } catch (err) {
        log(`board folder ${root} cannot be created: ${err.message}`);
        root = null;
      }
    }
    if (persist) save();
    if (root) startWatching();
    return root;
  }

  /** The absolute path of a relative one, or null when it leaves the root. */
  function resolve(rel) {
    if (!root) return null;
    if (typeof rel !== 'string' || rel.includes('\0')) return null;
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    return abs;
  }

  function relative(abs) {
    return path.relative(root, abs).split(path.sep).join('/');
  }

  /** The absolute path of one of a board folder's files, or null: a fixed
   *  file, a hash-named one under assets/ or .boardcache/assets/, or a
   *  readable media file directly under one of the media folders. */
  function fileIn(boardRel, file) {
    const dir = resolve(boardRel);
    if (!dir) return null;
    if (typeof file !== 'string') return null;
    if (FIXED_FILES.has(file)) return path.join(dir, file);
    let m = file.match(/^assets\/([0-9a-f]{64})$/);
    if (m) return path.join(dir, 'assets', m[1]);
    m = file.match(/^\.boardcache\/assets\/([0-9a-f]{64})$/);
    if (m) return path.join(dir, '.boardcache', 'assets', m[1]);
    m = file.match(/^([a-z]+)\/([^/]+)$/);
    if (m && MEDIA_FOLDERS.has(m[1]) && cleanSegment(m[2], '') === m[2]) {
      return path.join(dir, m[1], m[2]);
    }
    return null;
  }

  function readManifest(dir) {
    try {
      const stat = fs.statSync(path.join(dir, 'manifest.json'));
      if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return null;
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      if (!raw || typeof raw !== 'object' || typeof raw.boardId !== 'string') return null;
      return raw;
    } catch {
      return null;
    }
  }

  function statMs(file) {
    try {
      return Math.round(fs.statSync(file).mtimeMs);
    } catch {
      return null;
    }
  }

  /**
   * Everything under the root: organisational folders and board folders,
   * each board with what the index shows (name, when, size, locked) and the
   * stamps of its thumbnails, so the renderer only re-reads one that changed.
   */
  function scan() {
    if (!root) return { root: null, dirs: [], boards: [] };
    const dirs = [];
    const boards = [];
    const walk = (dir, depth) => {
      if (depth > MAX_DEPTH) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const abs = path.join(dir, entry.name);
        const manifest = readManifest(abs);
        if (manifest) {
          let size = 0;
          const assets =
            manifest.assets && typeof manifest.assets === 'object' ? manifest.assets : {};
          for (const meta of Object.values(assets)) {
            if (meta && typeof meta.bytes === 'number') size += meta.bytes;
          }
          try {
            size += fs.statSync(path.join(abs, 'document.json')).size;
          } catch {
            /* locked, or not written yet */
          }
          boards.push({
            path: relative(abs),
            id: manifest.boardId,
            name: entry.name,
            updatedAt:
              typeof manifest.updatedAt === 'string'
                ? manifest.updatedAt
                : new Date(statMs(path.join(abs, 'manifest.json')) ?? Date.now()).toISOString(),
            locked: !!manifest.lock,
            size,
            thumb: statMs(path.join(abs, 'thumbnail.png')),
            thumbDark: statMs(path.join(abs, 'thumbnail-dark.png')),
          });
          continue;
        }
        dirs.push(relative(abs));
        walk(abs, depth + 1);
      }
    };
    walk(root, 0);
    return { root, dirs, boards };
  }

  function read(boardRel, file) {
    const abs = fileIn(boardRel, file);
    if (!abs) return { error: 'Not a board file' };
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) return { error: 'Not a file' };
      const cap =
        file === 'document.json'
          ? MAX_DOCUMENT_BYTES
          : FIXED_FILES.has(file)
            ? MAX_MANIFEST_BYTES
            : MAX_ASSET_BYTES;
      if (stat.size > cap) return { error: 'File is too large' };
      return { bytes: fs.readFileSync(abs), mtime: Math.round(stat.mtimeMs) };
    } catch (err) {
      return { error: err.code === 'ENOENT' ? 'Missing' : err.message };
    }
  }

  function noteOwn(abs) {
    ownWrites.set(abs, Date.now());
  }

  function writeAtomic(abs, bytes) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = path.join(
      path.dirname(abs),
      `.${path.basename(abs)}.${process.pid}.${Date.now().toString(36)}.tmp`,
    );
    noteOwn(abs);
    noteOwn(tmp);
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, abs);
    noteOwn(abs);
  }

  /** Write (and remove) files of one board folder; creates the folder. */
  function write(boardRel, files, remove) {
    const dir = resolve(boardRel);
    if (!dir) return { error: 'Not inside the board folder' };
    const mtimes = {};
    try {
      noteOwn(dir);
      fs.mkdirSync(dir, { recursive: true });
      for (const { file, bytes } of files ?? []) {
        const abs = fileIn(boardRel, file);
        if (!abs) return { error: `Not a board file: ${file}` };
        if (!(bytes instanceof Uint8Array)) return { error: `Bytes required for ${file}` };
        writeAtomic(abs, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        mtimes[file] = statMs(abs);
      }
      for (const file of remove ?? []) {
        const abs = fileIn(boardRel, file);
        if (!abs) continue;
        noteOwn(abs);
        fs.rmSync(abs, { force: true });
      }
      return { path: boardRel, mtimes };
    } catch (err) {
      return { error: err.message };
    }
  }

  /** Move files within one board folder (the layout giving an asset its
   *  readable name). A source already gone whose target exists counts as
   *  done; anything else missing is reported, not fatal. */
  function arrange(boardRel, moves) {
    if (!resolve(boardRel)) return { error: 'Not inside the board folder' };
    let moved = 0;
    const missing = [];
    try {
      for (const { from, to } of moves ?? []) {
        const src = fileIn(boardRel, from);
        const dest = fileIn(boardRel, to);
        if (!src || !dest) return { error: `Not a board file: ${from} → ${to}` };
        if (!fs.existsSync(src)) {
          if (!fs.existsSync(dest)) missing.push(from);
          continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        noteOwn(src);
        noteOwn(dest);
        fs.renameSync(src, dest);
        moved++;
      }
      return { moved, missing };
    } catch (err) {
      return { error: err.message };
    }
  }

  /** The readable media files of a board folder (name, size, stamp), so the
   *  renderer can tell what arrived or changed by other hands. */
  function list(boardRel) {
    const dir = resolve(boardRel);
    if (!dir) return { error: 'Not inside the board folder' };
    const files = [];
    for (const folder of MEDIA_FOLDERS) {
      let entries;
      try {
        entries = fs.readdirSync(path.join(dir, folder), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || cleanSegment(entry.name, '') !== entry.name) continue;
        try {
          const stat = fs.statSync(path.join(dir, folder, entry.name));
          files.push({
            file: `${folder}/${entry.name}`,
            bytes: stat.size,
            mtime: Math.round(stat.mtimeMs),
          });
        } catch {
          /* gone between the listing and the stat */
        }
      }
    }
    return { files };
  }

  /** Whether the root sits on a volume Spotlight would index, and whether
   *  that volume carries the file that keeps Spotlight off it. */
  function spotlight(platform = process.platform) {
    const volume = volumeOf(root, platform);
    if (!volume) return { offered: false, volume: null, excluded: false };
    return { offered: true, volume, excluded: fs.existsSync(path.join(volume, NEVER_INDEX)) };
  }

  /** Keep Spotlight off the root's volume: the marker file at its root. */
  function excludeFromSpotlight(platform = process.platform) {
    const volume = volumeOf(root, platform);
    if (!volume) return { excluded: false, error: 'The folder is not on a separate volume' };
    try {
      fs.writeFileSync(path.join(volume, NEVER_INDEX), '');
      return { excluded: true };
    } catch (err) {
      return { excluded: false, error: err.message };
    }
  }

  /** A new organisational folder; returns its relative path. */
  function mkdir(parentRel, name) {
    const parent = resolve(parentRel);
    if (!parent) return { error: 'Not inside the board folder' };
    const abs = path.join(parent, cleanSegment(name));
    if (fs.existsSync(abs)) return { error: 'A folder with that name is already there' };
    try {
      noteOwn(abs);
      fs.mkdirSync(abs, { recursive: true });
      return { path: relative(abs) };
    } catch (err) {
      return { error: err.message };
    }
  }

  /** The free name for `name` inside `parent`: as is, else with a counter. */
  function freeName(parent, name, except) {
    const wanted = cleanSegment(name);
    const taken = (candidate) => {
      const abs = path.join(parent, candidate);
      return abs !== except && fs.existsSync(abs);
    };
    if (!taken(wanted)) return wanted;
    const base = wanted.replace(/\s\(\d+\)$/, '');
    for (let n = 1; ; n++) {
      const candidate = `${base} (${n})`;
      if (!taken(candidate)) return candidate;
    }
  }

  /** Rename a folder (board or organisational) in place. */
  function rename(rel, name) {
    const abs = resolve(rel);
    if (!abs || abs === root) return { error: 'Not a folder inside the board folder' };
    const next = path.join(path.dirname(abs), freeName(path.dirname(abs), name, abs));
    if (next === abs) return { path: rel, name: path.basename(abs) };
    try {
      noteOwn(abs);
      noteOwn(next);
      fs.renameSync(abs, next);
      return { path: relative(next), name: path.basename(next) };
    } catch (err) {
      return { error: err.message };
    }
  }

  /** Move a folder under another organisational folder (or the root). */
  function move(rel, dirRel) {
    const abs = resolve(rel);
    const dest = resolve(dirRel);
    if (!abs || abs === root || !dest) return { error: 'Not inside the board folder' };
    if (dest === abs || dest.startsWith(abs + path.sep)) {
      return { error: 'A folder cannot be moved into itself' };
    }
    const next = path.join(dest, freeName(dest, path.basename(abs), abs));
    if (next === abs) return { path: rel };
    try {
      noteOwn(abs);
      noteOwn(next);
      fs.renameSync(abs, next);
      return { path: relative(next) };
    } catch (err) {
      return { error: err.message };
    }
  }

  /** Copy a board folder beside itself under a new name (Duplicate). */
  function copy(rel, name) {
    const abs = resolve(rel);
    if (!abs || abs === root) return { error: 'Not inside the board folder' };
    const next = path.join(path.dirname(abs), freeName(path.dirname(abs), name, null));
    try {
      noteOwn(next);
      fs.cpSync(abs, next, { recursive: true });
      return { path: relative(next), name: path.basename(next) };
    } catch (err) {
      return { error: err.message };
    }
  }

  /** Remove a folder: to the system trash when it offers one, else outright. */
  async function trash(rel, trashItem) {
    const abs = resolve(rel);
    if (!abs || abs === root) return { error: 'Not a folder inside the board folder' };
    noteOwn(abs);
    try {
      await trashItem(abs);
      return { path: rel, trashed: true };
    } catch {
      try {
        fs.rmSync(abs, { recursive: true, force: true });
        return { path: rel, trashed: false };
      } catch (err) {
        return { error: err.message };
      }
    }
  }

  /** Whether a change at `abs` was the app's own doing, by its write log. */
  function isOwn(abs) {
    const now = Date.now();
    for (const [file, at] of ownWrites) {
      if (now - at > OWN_WRITE_GRACE_MS) ownWrites.delete(file);
    }
    for (const [file, at] of ownWrites) {
      if (now - at > OWN_WRITE_GRACE_MS) continue;
      if (abs === file || abs.startsWith(file + path.sep)) return true;
    }
    return false;
  }

  function startWatching() {
    if (!root || watcher) return;
    try {
      watcher = fs.watch(root, { recursive: true, persistent: false }, (_event, name) => {
        if (typeof name !== 'string') return;
        const abs = path.join(root, name);
        if (path.basename(abs).startsWith('.')) return; // temp files, dotfiles
        if (isOwn(abs)) return;
        pending.add(relative(abs));
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(flush, WATCH_DEBOUNCE_MS);
      });
      watcher.on('error', (err) => {
        log(`board folder watcher stopped: ${err.message}`);
        stopWatching();
      });
    } catch (err) {
      log(`board folder cannot be watched: ${err.message}`);
      watcher = null;
    }
  }

  function flush() {
    const paths = [...pending];
    pending = new Set();
    pendingTimer = null;
    if (paths.length) onChange(paths);
  }

  function stopWatching() {
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
      watcher = null;
    }
    clearTimeout(pendingTimer);
    pendingTimer = null;
    pending = new Set();
  }

  return {
    load,
    get root() {
      return root;
    },
    setRoot,
    resolve,
    scan,
    read,
    write,
    arrange,
    list,
    spotlight,
    excludeFromSpotlight,
    mkdir,
    rename,
    move,
    copy,
    trash,
    stop: stopWatching,
    cleanSegment,
  };
}

module.exports = { createVault, cleanSegment };
