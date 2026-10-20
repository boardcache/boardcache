import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { CanvasDocument, Item } from '@boardcache/schema';
import { collectAssetIds } from '@boardcache/schema';
import { getDb } from '../db';
import { downloadBlob, exportFileName } from './download';
import { viewerAssetUrl } from '../viewerMode';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Builds a self-contained, view-only export of a board: a zip with index.html,
 * the prebuilt viewer bundle (viewer.js/viewer.css), and an assets/ tree. It
 * opens straight from the filesystem (file://) — no server, no internet.
 */

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

function extFor(mime: string): string {
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime]!;
  if (mime.startsWith('video/') || mime.startsWith('audio/')) {
    return mime.split('/')[1]!.split(';')[0]!;
  }
  return 'bin';
}

function folderFor(mime: string): string {
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('video/')) return 'videos';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdfs';
  return 'files';
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'board';
}

/** Serialize for embedding inside a <script>: neutralize `</script>` etc. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );
}

// Same pre-paint theme bootstrap the app uses, inlined and dependency-free.
const THEME_SCRIPT =
  "(function(){var s=null;try{s=localStorage.getItem('boardcache:theme');}catch(e){}" +
  "var d=s==='dark'||((s===null||s==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);" +
  "document.documentElement.dataset.theme=d?'dark':'light';})();";

const README =
  '# boardCache — Offline Viewer\n\n' +
  'This is a self-contained, view-only export of a boardCache board.\n\n' +
  'Open **index.html** in any modern browser (Chrome, Edge, Firefox, Safari) —\n' +
  'just double-click it. No internet connection or web server is required.\n\n' +
  '## What you can do\n\n' +
  '- Pan and zoom the canvas and minimap\n' +
  '- Browse every item in the gallery (grid + masonry)\n' +
  '- Open items full-screen in the lightbox\n' +
  '- Toggle the grid and light/dark theme, and go fullscreen\n\n' +
  'Any edits you make (text, layout) are **not** saved.\n\n' +
  "## What's inside\n\n" +
  '- `index.html` — the board, embedded and ready to render\n' +
  '- `assets/` — every image, video, audio file, and PDF on the board\n' +
  '- `assets/viewer/` — the viewer app (JavaScript + CSS)\n';

function indexHtml(
  doc: CanvasDocument,
  assets: Record<string, { url: string; mime: string }>,
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>${escapeHtml(doc.name)} — boardCache</title>
    <script>${THEME_SCRIPT}</script>
    <link rel="stylesheet" href="assets/viewer/viewer.css" />
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.__BOARD__ = ${embedJson(doc)};
      window.__BOARD_ASSETS__ = ${embedJson(assets)};
    </script>
    <script src="assets/viewer/viewer.js"></script>
  </body>
</html>
`;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.text();
}

async function buildViewerZip(doc: CanvasDocument): Promise<Blob> {
  const assetIds = collectAssetIds(doc);
  const db = await getDb();

  const assetsMeta: Record<string, { url: string; mime: string }> = {};
  const assetBlobs: { path: string; blob: Blob }[] = [];
  for (const id of assetIds) {
    const rec = await db.get('assets', id);
    if (!rec) {
      console.warn(`Viewer export: asset ${id} missing from store; skipping`);
      continue;
    }
    const path = `assets/${folderFor(rec.mime)}/${id}.${extFor(rec.mime)}`;
    assetsMeta[id] = { url: path, mime: rec.mime };
    assetBlobs.push({ path, blob: rec.blob });
  }

  const base = import.meta.env.BASE_URL || '/';
  const [viewerJs, viewerCss] = await Promise.all([
    fetchText(`${base}viewer/viewer.js`),
    fetchText(`${base}viewer/viewer.css`),
  ]);

  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));
  const zip = new Zip((err, chunk, final) => {
    if (err) zipError = err;
    if (chunk) chunks.push(chunk);
    if (final || err) resolveDone();
  });
  const enc = new TextEncoder();
  const addDeflated = (name: string, data: Uint8Array) => {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(data, true);
  };

  addDeflated('index.html', enc.encode(indexHtml(doc, assetsMeta)));
  addDeflated('README.md', enc.encode(README));
  addDeflated('assets/viewer/viewer.js', enc.encode(viewerJs));
  addDeflated('assets/viewer/viewer.css', enc.encode(viewerCss));

  // Stream each blob through uncompressed (media is already compressed).
  for (const { path, blob } of assetBlobs) {
    const file = new ZipPassThrough(path);
    zip.add(file);
    const reader = blob.stream().getReader();
    for (;;) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      file.push(value);
    }
    file.push(new Uint8Array(0), true);
  }

  zip.end();
  await done;
  if (zipError) throw zipError;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

export async function exportCurrentAsViewer(): Promise<void> {
  const { doc } = useDocumentStore.getState();
  const blob = await buildViewerZip(doc);
  downloadBlob(blob, `${safeFilename(doc.name)}-viewer.zip`);
}

const GROUP_LABELS: Record<string, string> = {
  images: 'Images',
  videos: 'Videos',
  audio: 'Audio',
  pdfs: 'PDFs',
  files: 'Other files',
};

interface ViewerExportGroup {
  label: string;
  count: number;
  bytes: number;
}
export interface ViewerExportSummary {
  /** Asset groups (by media type) that will be bundled. */
  groups: ViewerExportGroup[];
  assetBytes: number;
  /** Approximate compressed size of the viewer app inside the zip. */
  appBytes: number;
  totalBytes: number;
}

/** Roughly how large the viewer bundle lands in the zip (deflated). */
async function viewerBundleBytes(): Promise<number> {
  const base = import.meta.env.BASE_URL || '/';
  try {
    const sizes = await Promise.all(
      ['viewer.js', 'viewer.css'].map(async (f) => {
        const res = await fetch(`${base}viewer/${f}`, { method: 'HEAD' });
        return Number(res.headers.get('content-length')) || 0;
      }),
    );
    // Text deflates to roughly a third; fall back to a sane default.
    const raw = sizes.reduce((a, b) => a + b, 0);
    return raw ? Math.round(raw * 0.32) : 550_000;
  } catch {
    return 550_000;
  }
}

/** Preview what an interactive export will contain + its rough size. */
export async function viewerExportSummary(doc: CanvasDocument): Promise<ViewerExportSummary> {
  const db = await getDb();
  const byGroup = new Map<string, { count: number; bytes: number }>();
  let assetBytes = 0;
  for (const id of collectAssetIds(doc)) {
    const rec = await db.get('assets', id);
    if (!rec) continue;
    const folder = folderFor(rec.mime);
    const g = byGroup.get(folder) ?? { count: 0, bytes: 0 };
    g.count += 1;
    g.bytes += rec.bytes;
    byGroup.set(folder, g);
    assetBytes += rec.bytes;
  }
  const order = ['images', 'videos', 'audio', 'pdfs', 'files'];
  const groups = order
    .filter((k) => byGroup.has(k))
    .map((k) => ({
      label: GROUP_LABELS[k] ?? k,
      count: byGroup.get(k)!.count,
      bytes: byGroup.get(k)!.bytes,
    }));
  const appBytes = await viewerBundleBytes();
  return { groups, assetBytes, appBytes, totalBytes: assetBytes + appBytes };
}

/** The asset id a downloadable item points at (image/video/audio/pdf). */
function primaryAssetId(item: Item): string | null {
  if (item.type === 'image' || item.type === 'pdf' || item.type === 'audio') return item.assetId;
  if (item.type === 'video') return item.assetId;
  return null;
}

/**
 * Download a single item's underlying file inside the offline viewer. Assets
 * are local files, so we just trigger an anchor download of the relative path
 * (the IndexedDB-backed exportItem path isn't available offline).
 */
export function downloadViewerAsset(item: Item): void {
  const id = primaryAssetId(item);
  const meta = id ? window.__BOARD_ASSETS__?.[id] : null;
  const url = id ? viewerAssetUrl(id) : null;
  if (!meta || !url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(item.name, item.type, extFor(meta.mime));
  document.body.appendChild(a);
  a.click();
  a.remove();
}
