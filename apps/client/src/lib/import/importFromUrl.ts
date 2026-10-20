import { textFromHtml } from '../text/safeUrl';
import { hasSyncServer } from '../sync/apiBase';
import { clientToCanvas } from '../canvas/canvasDom';
import type { Point } from '../canvas/coords';
import { createLinkItem, createTextFromString } from './createItems';
import { updateItems } from '../../state/commands';
import { createVideoEmbed } from './importVideos';
import { hasMediaFiles, importMediaFiles } from './importMedia';
import { platform } from '../platform';
import { importBoardFromFile } from '../board/transfer';
import { parseVideoUrl } from '../media/videoEmbed';

/**
 * Core "import from URL": downloads a file and routes it through the SAME
 * pipeline as a canvas file drop, so everything droppable is URL-importable —
 * images (incl. HEIC/SVG/GIF), video, audio, PDFs, fonts, plain text /
 * Markdown, .boardcache boards — plus YouTube/Vimeo page URLs, which become
 * embed items without downloading anything. A URL that resolves to a webpage
 * rather than a file becomes a link button labelled with the page title.
 *
 * Fetching tries the browser first (works for CORS-friendly hosts and needs
 * no server), then falls back to the sync server's guarded relay.
 */

/** Extension → mime for servers that answer with octet-stream. */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
};

class UrlImportError extends Error {
  override name = 'UrlImportError';
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new UrlImportError('Enter a URL.');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function filenameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    return last || 'download';
  } catch {
    return 'download';
  }
}

async function fetchViaProxy(url: string): Promise<{ blob: Blob; filename: string }> {
  const res = await platform.urlFetch({
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new UrlImportError(body?.error ?? `Download failed (${res.status}).`);
  }
  const blob = await res.blob();
  const encoded = res.headers.get('x-filename');
  return { blob, filename: encoded ? decodeURIComponent(encoded) : filenameFromUrl(url) };
}

async function download(url: string): Promise<File> {
  let blob: Blob | null = null;
  let filename = filenameFromUrl(url);
  // Browser-direct first: free, private, and works on CORS-friendly hosts.
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) blob = await res.blob();
  } catch {
    /* CORS or network — try the relay */
  }
  if (!blob) {
    if (!hasSyncServer()) {
      throw new UrlImportError(
        "That host doesn't allow direct downloads, and there's no sync server to relay through.",
      );
    }
    ({ blob, filename } = await fetchViaProxy(url));
  }
  // Octet-stream answers get their type from the file extension.
  let mime = blob.type.split(';')[0] ?? '';
  if (!mime || mime === 'application/octet-stream') {
    const ext = /\.(\w{2,5})$/.exec(filename.toLowerCase())?.[1] ?? '';
    mime = EXT_MIME[ext] ?? mime;
  }
  return new File([blob], filename, { type: mime });
}

export interface UrlImportResult {
  kind: 'embed' | 'board' | 'text' | 'media' | 'link';
  ids: string[];
}

/** A webpage (not a file) → a link button labelled with the page title. */
function createLinkButton(url: string, html: string, at: Point): string {
  const rawTitle = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  // Titles arrive entity-encoded (&amp; etc.) — decode in an inert document.
  const label = textFromHtml(rawTitle ?? '').trim() || new URL(url).hostname;
  const id = createLinkItem(at);
  updateItems([id], 'Import link', (d) => {
    if (d.type !== 'link') return;
    d.url = url;
    d.label = label;
  });
  return id;
}

/** Import whatever lives at `url` onto the canvas (at `point` or view center). */
export async function importFromUrl(rawUrl: string, point?: Point): Promise<UrlImportResult> {
  const url = normalizeUrl(rawUrl);
  const at = point ?? clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);

  // Video PAGE urls (YouTube/Vimeo) become embeds — no download involved.
  const embed = parseVideoUrl(url);
  if (embed) {
    return { kind: 'embed', ids: [createVideoEmbed(embed, at)] };
  }

  const file = await download(url);
  const lower = file.name.toLowerCase();

  if (/\.(boardcache|refboard)(\.enc)?$/.test(lower)) {
    if (!(await importBoardFromFile(file))) {
      throw new UrlImportError('That board file could not be imported.');
    }
    return { kind: 'board', ids: [] };
  }
  if (file.type === 'text/html' || file.type === 'application/xhtml+xml') {
    return { kind: 'link', ids: [createLinkButton(url, await file.text(), at)] };
  }
  if (file.type === 'text/plain' || file.type === 'text/markdown') {
    return { kind: 'text', ids: [createTextFromString(at, await file.text(), 'Import from URL')] };
  }
  if (hasMediaFiles([file])) {
    const ids = await importMediaFiles([file], at);
    if (!ids.length) throw new UrlImportError('The file could not be imported.');
    return { kind: 'media', ids };
  }
  throw new UrlImportError(
    `Unsupported type (${file.type || 'unknown'}). Supported: images, video, audio, PDF, fonts, text/Markdown, .boardcache boards, webpages (as link buttons), and YouTube/Vimeo links.`,
  );
}

export interface UrlLineResult {
  url: string;
  ok: boolean;
  kind?: UrlImportResult['kind'];
  error?: string;
}

/**
 * Import several URLs sequentially (one per line in the dialog), cascading
 * placement so items don't stack. Failures don't stop the batch — each line
 * gets its own result.
 */
export async function importUrlList(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<UrlLineResult[]> {
  const center = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const results: UrlLineResult[] = [];
  for (const [i, url] of urls.entries()) {
    try {
      const { kind } = await importFromUrl(url, { x: center.x + i * 48, y: center.y + i * 48 });
      results.push({ url, ok: true, kind });
    } catch (err) {
      results.push({
        url,
        ok: false,
        error: err instanceof Error ? err.message : 'Import failed.',
      });
    }
    onProgress?.(i + 1, urls.length);
  }
  return results;
}
