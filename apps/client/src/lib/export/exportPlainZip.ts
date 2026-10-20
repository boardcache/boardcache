import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { Item } from '@boardcache/schema';
import { getDb } from '../db';
import { downloadBlob } from './download';
import { mediaMeta } from '../mediaItems';

/**
 * "Plain files" export: a zip of ordinary, readable files — one folder per
 * media type, no manifest or document JSON. Media ships as its stored bytes
 * with a proper extension; text-like items become .md/.txt/source files;
 * links become .url shortcuts; colors become small text files.
 */

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/flac': 'flac',
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'text/html': 'html',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
};

const CODE_EXT: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  jsx: 'jsx',
  tsx: 'tsx',
  python: 'py',
  html: 'html',
  css: 'css',
  json: 'json',
  bash: 'sh',
  shell: 'sh',
  sql: 'sql',
  rust: 'rs',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  ruby: 'rb',
  php: 'php',
  yaml: 'yml',
  markdown: 'md',
  swift: 'swift',
  kotlin: 'kt',
};

export function extFromMime(mime: string): string {
  const known = MIME_EXT[mime];
  if (known) return known;
  const subtype = mime.split('/')[1]?.replace(/\+.*$/, '');
  return subtype && /^[a-z0-9]+$/i.test(subtype) ? subtype : 'bin';
}

function safeName(name: string): string {
  return (
    name
      .replace(/[^\w.\- ]+/g, '_')
      .trim()
      .slice(0, 80) || 'item'
  );
}

const urlFile = (url: string) => `[InternetShortcut]\r\nURL=${url}\r\n`;

/** One planned zip entry: text content OR a stored asset id. */
export interface PlainEntry {
  folder: string;
  base: string;
  ext?: string; // known for text entries; asset entries derive from mime
  text?: string;
  assetId?: string;
}

/** The plain file(s) an item is made of (none for shapes, drawings, cards). */
export function planPlainEntries(item: Item): PlainEntry[] {
  const base = safeName(mediaMeta(item).title);
  switch (item.type) {
    case 'image':
      return [{ folder: 'images', base, assetId: item.assetId }];
    case 'video':
      return item.assetId
        ? [{ folder: 'videos', base, assetId: item.assetId }]
        : item.embed
          ? [{ folder: 'links', base, ext: 'url', text: urlFile(item.embed.url) }]
          : [];
    case 'audio':
      return item.assetId ? [{ folder: 'audio', base, assetId: item.assetId }] : [];
    case 'playlist':
      return item.tracks.map((t, i) => ({
        folder: 'audio',
        base: safeName(t.title ?? `${base} ${i + 1}`),
        assetId: t.assetId,
      }));
    case 'pdf':
      return [{ folder: 'documents', base, assetId: item.assetId }];
    case 'epub':
      return [{ folder: 'documents', base, assetId: item.assetId }];
    case 'htmlembed':
      return [{ folder: 'documents', base, assetId: item.htmlAssetId }];
    case 'font':
      return [{ folder: 'fonts', base: safeName(item.family), assetId: item.assetId }];
    case 'text':
      return [{ folder: 'text', base, ext: 'md', text: item.text }];
    case 'title':
      return [{ folder: 'text', base, ext: 'txt', text: item.text }];
    case 'code':
      return [{ folder: 'code', base, ext: CODE_EXT[item.language] ?? 'txt', text: item.code }];
    case 'link':
      return item.url ? [{ folder: 'links', base, ext: 'url', text: urlFile(item.url) }] : [];
    case 'iframe':
      return [{ folder: 'links', base, ext: 'url', text: urlFile(item.url) }];
    case 'rss':
      return [{ folder: 'links', base, ext: 'url', text: urlFile(item.url) }];
    case 'swatch':
      return [{ folder: 'colors', base, ext: 'txt', text: `${item.color}\n` }];
    case 'palette':
      return [
        {
          folder: 'colors',
          base,
          ext: 'txt',
          text: item.colors.map((c) => c.color).join('\n') + '\n',
        },
      ];
    default:
      return []; // shapes/drawings/QR have no plain-file form
  }
}

/** Export `items` as a plain-files zip named `<name>.zip`. */
export async function exportPlainZip(
  items: Item[],
  name: string,
  extras: PlainEntry[] = [],
): Promise<void> {
  const db = await getDb();

  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));
  const zip = new Zip((err, chunk, final) => {
    if (err) zipError = err;
    if (chunk) chunks.push(chunk);
    if (final || err) resolveDone();
  });

  const used = new Set<string>();
  const uniquePath = (folder: string, base: string, ext: string): string => {
    for (let n = 0; ; n++) {
      const candidate = `${folder}/${base}${n ? `-${n + 1}` : ''}.${ext}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
  };

  const entries = [...items.flatMap(planPlainEntries), ...extras];
  for (const entry of entries) {
    {
      if (entry.text !== undefined) {
        const file = new ZipDeflate(uniquePath(entry.folder, entry.base, entry.ext ?? 'txt'), {
          level: 6,
        });
        zip.add(file);
        file.push(new TextEncoder().encode(entry.text), true);
      } else if (entry.assetId) {
        const record = await db.get('assets', entry.assetId);
        if (!record) continue; // missing asset — skip rather than fail the zip
        const file = new ZipPassThrough(
          uniquePath(entry.folder, entry.base, entry.ext ?? extFromMime(record.mime)),
        );
        zip.add(file);
        const reader = record.blob.stream().getReader();
        for (;;) {
          const { done: eof, value } = await reader.read();
          if (eof) break;
          file.push(value);
        }
        file.push(new Uint8Array(0), true);
      }
    }
  }

  zip.end();
  await done;
  if (zipError) throw zipError;
  downloadBlob(new Blob(chunks as BlobPart[], { type: 'application/zip' }), `${name}.zip`);
}
