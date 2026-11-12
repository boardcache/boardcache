import type { CanvasDocument, Item } from '@boardcache/schema';

/**
 * The readable layout of a board folder. Every picture, video, audio track,
 * document and font an item shows is an ordinary file under a folder named
 * for its kind, with the name the item carries and the extension its type
 * wants, so the file manager, the OS search and other programs see them as
 * what they are. Copies the app makes for itself (a canvas rendition, a
 * video poster, a cover) stay under a hidden folder by their hash, and a
 * locked board keeps everything as ciphertext under `assets/` by hash: there
 * is nothing readable to show. The manifest records where each asset is
 * (`paths`, the first one canonical), so the document keeps referencing
 * assets by hash and a file's name is free to be anything.
 *
 * Pure: the shell moves the files, lib/vault decides; this module only says
 * what goes where.
 */

const MEDIA_FOLDERS = ['images', 'videos', 'audio', 'documents', 'fonts'] as const;
export type MediaFolder = (typeof MEDIA_FOLDERS)[number];

/** Copies the app made for itself, by hash (hidden). */
export const STAGED_DIR = '.boardcache/assets';
/** Ciphertext of a locked board, by hash (and the layout before this one). */
export const LOCKED_DIR = 'assets';

export interface AssetMeta {
  mime: string;
  bytes: number;
  locked?: boolean;
  /** Readable files holding this content, the first one canonical. */
  paths?: string[];
}

/** Extension → media type, for files that arrive by the folder. */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/opus',
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  ics: 'text/calendar',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  html: 'text/html',
  htm: 'text/html',
};

/** Media type → the extension its files get. */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/ogg': 'ogv',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/opus': 'opus',
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'text/calendar': 'ics',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'application/font-woff': 'woff',
  'application/x-font-ttf': 'ttf',
  'application/x-font-otf': 'otf',
  'text/html': 'html',
};

const baseMime = (mime: string): string => (mime.split(';')[0] ?? '').trim().toLowerCase();

/** The folder a media type's files belong under. */
export function folderFor(mime: string): MediaFolder {
  const m = baseMime(mime);
  if (m.startsWith('image/')) return 'images';
  if (m.startsWith('video/')) return 'videos';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('font/') || /font/.test(m)) return 'fonts';
  return 'documents';
}

/** The media type a file name says it holds, or null when the extension
 *  is not one the board takes. */
export function mimeForName(name: string): string | null {
  const ext = extensionOf(name);
  return ext ? (EXT_MIME[ext] ?? null) : null;
}

function extensionOf(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

/** A file name as the disk takes it (the shell applies the same rule). */
function cleanName(name: string): string {
  let s = String(name)
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is stripped
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)) s = `_${s}`;
  if (s === '') s = 'file';
  return s.slice(0, 120);
}

/**
 * The file name for an asset: the item's name when it has one, with the
 * extension its media type wants (a name that already says the right type
 * keeps its own), made unique among `taken` with a counter.
 */
export function fileNameFor(
  suggested: string | undefined,
  mime: string,
  hash: string,
  taken: ReadonlySet<string>,
): string {
  const ext = MIME_EXT[baseMime(mime)];
  let stem = cleanName(
    suggested?.trim() || `${folderFor(mime).replace(/s$/, '')}-${hash.slice(0, 8)}`,
  );
  const own = extensionOf(stem);
  // A type without an extension of its own keeps the name as it is.
  if (!ext) return unique(stem, '', taken);
  if (own) {
    // "IMG.jpeg" stays, as written; "clip.mov" holding MP4 bytes becomes clip.mp4.
    if (EXT_MIME[own] === baseMime(mime)) {
      return unique(stem.slice(0, -(own.length + 1)), stem.slice(-own.length), taken);
    }
    if (EXT_MIME[own]) stem = stem.slice(0, -(own.length + 1));
  }
  return unique(stem, ext, taken);
}

function unique(stem: string, ext: string, taken: ReadonlySet<string>): string {
  const tail = ext ? `.${ext}` : '';
  const base = stem.replace(/\s\(\d+\)$/, '') || 'file';
  let candidate = `${stem}${tail}`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${tail}`;
  return candidate;
}

/** Whether a relative path is a file in one of the media folders. */
export function isMediaPath(path: string): boolean {
  const slash = path.indexOf('/');
  if (slash < 0) return false;
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  return (
    (MEDIA_FOLDERS as readonly string[]).includes(folder) &&
    name.length > 0 &&
    !name.includes('/') &&
    cleanName(name) === name
  );
}

/** Where an asset's bytes are read from. */
export function assetLocation(hash: string, meta: AssetMeta): string {
  if (meta.paths?.[0]) return meta.paths[0];
  return `${meta.locked ? LOCKED_DIR : STAGED_DIR}/${hash}`;
}

/** Every place an asset's bytes may be, newest layout first, for archives
 *  from any version. */
export function assetLocations(hash: string, meta: AssetMeta): string[] {
  const out = [...(meta.paths ?? [])];
  for (const p of [`${STAGED_DIR}/${hash}`, `${LOCKED_DIR}/${hash}`])
    if (!out.includes(p)) out.push(p);
  return out;
}

/** The field of an item that names the asset it shows (not a copy made of it). */
export function primaryAssetField(item: Item): string | null {
  switch (item.type) {
    case 'image':
    case 'video':
    case 'audio':
    case 'pdf':
    case 'font':
    case 'epub':
    case 'file':
      return 'assetId';
    case 'htmlembed':
      return 'htmlAssetId';
    case 'recipe':
      return 'imageAssetId';
    case 'palette':
      return 'sourceAssetId';
    default:
      return null;
  }
}

/** The name an item offers for its file. */
function nameOf(item: Item): string | undefined {
  const it = item as { name?: unknown; title?: unknown; family?: unknown; fileName?: unknown };
  for (const v of [it.name, it.title, it.family, it.fileName])
    if (typeof v === 'string' && v.trim()) return v;
  return undefined;
}

/**
 * The assets a document shows directly (an item's own picture, video,
 * track, document or font; a playlist's tracks; a background), each with
 * the name the board offers for it. Copies the app made (renditions,
 * posters, covers) are not among them.
 */
export function primaryAssets(doc: CanvasDocument): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  const add = (id: unknown, name: string | undefined) => {
    if (typeof id === 'string' && id && !out.has(id)) out.set(id, name);
  };
  for (const item of Object.values(doc.items)) {
    const field = primaryAssetField(item);
    if (field) add((item as unknown as Record<string, unknown>)[field], nameOf(item));
    if (item.type === 'playlist') for (const t of item.tracks) add(t.assetId, t.title);
  }
  const backgrounds = [
    doc.settings.backgroundImage,
    ...doc.pages.map((p) => p.backgroundImage),
    ...Object.values(doc.groups).map((g) => g.backgroundImage),
  ];
  for (const bg of backgrounds) add(bg?.assetId, 'background');
  return out;
}

export interface LayoutMove {
  hash: string;
  from: string;
  to: string;
}

/**
 * The moves that give every unlocked asset the document shows a readable
 * file, from wherever it is now (`from` answers that per hash: the staging
 * folder, or `assets/` for a folder from before this layout). Assets already
 * placed, locked ones and copies the app made are left where they are. The
 * metas are updated in place with their new paths.
 */
export function planLayout(
  assets: Record<string, AssetMeta>,
  doc: CanvasDocument,
  from: (hash: string) => string = (hash) => `${STAGED_DIR}/${hash}`,
): LayoutMove[] {
  const taken = new Map<MediaFolder, Set<string>>();
  for (const meta of Object.values(assets)) {
    for (const p of meta.paths ?? []) {
      const slash = p.indexOf('/');
      const folder = p.slice(0, slash) as MediaFolder;
      (taken.get(folder) ?? taken.set(folder, new Set()).get(folder)!).add(
        p.slice(slash + 1).toLowerCase(),
      );
    }
  }
  const moves: LayoutMove[] = [];
  for (const [hash, name] of primaryAssets(doc)) {
    const meta = assets[hash];
    if (!meta || meta.locked || meta.paths?.length) continue;
    const folder = folderFor(meta.mime);
    const names = taken.get(folder) ?? taken.set(folder, new Set()).get(folder)!;
    const file = fileNameFor(name, meta.mime, hash, names);
    names.add(file.toLowerCase());
    const to = `${folder}/${file}`;
    meta.paths = [to];
    moves.push({ hash, from: from(hash), to });
  }
  return moves;
}
