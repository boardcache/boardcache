import type { ImageItem, Item } from '@boardcache/schema';
import { getAssetBlob } from '../board/assetStore';
import { downloadBlob, exportFileName } from '../export/download';
import { filterCss, hasActiveFilters } from './imageFilters';

/** Items we can export to a file: images, file-backed videos, PDFs, QRs. */
export function isExportable(item: Item): boolean {
  if (item.type === 'image') return true;
  if (item.type === 'video') return !item.embed && !!item.assetId;
  if (item.type === 'pdf') return true;
  if (item.type === 'epub') return true;
  if (item.type === 'qr') return true;
  return false;
}

const EXT_BY_MIME: Record<string, string> = {
  'application/epub+zip': 'epub',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
};

function extFor(mime: string): string {
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime]!;
  if (mime.startsWith('video/')) return mime.split('/')[1]!.split(';')[0]!;
  return 'bin';
}

function fileName(item: Item, mime: string, suffix = ''): string {
  return exportFileName(item.name, item.type, extFor(mime), suffix);
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob((b) => res(b), mime));
}

/**
 * Render an image item to a blob, baking in its crop and flips. Filters are
 * only baked when `bakeFilters` is set (export); on-screen previews keep them
 * as a cheap CSS layer instead. When nothing needs baking the original asset
 * bytes are returned as-is, preserving the source format and quality.
 */
export async function renderImageBlob(
  item: ImageItem,
  { mime = 'image/png', bakeFilters = false }: { mime?: string; bakeFilters?: boolean } = {},
): Promise<Blob | null> {
  const src = await getAssetBlob(item.assetId);
  if (!src) return null;
  const filter =
    bakeFilters && hasActiveFilters(item.filters) ? filterCss(item.filters) : undefined;
  if (!item.crop && !item.flipH && !item.flipV && !filter) return src;

  const bitmap = await createImageBitmap(src);
  const c = item.crop;
  const sx = c ? c.x * bitmap.width : 0;
  const sy = c ? c.y * bitmap.height : 0;
  const sw = c ? c.width * bitmap.width : bitmap.width;
  const sh = c ? c.height * bitmap.height : bitmap.height;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext('2d')!;
  if (filter) ctx.filter = filter;
  // Mirror the pixels for flipped items so the export matches what's on screen.
  ctx.translate(item.flipH ? canvas.width : 0, item.flipV ? canvas.height : 0);
  ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return canvasToBlob(canvas, mime);
}

/** Download an item as a file (cropped/flipped for images, raw for videos). */
export async function exportItem(item: Item): Promise<void> {
  if (item.type === 'image') {
    const blob = await renderImageBlob(item, { bakeFilters: true });
    if (blob) downloadBlob(blob, fileName(item, blob.type, item.crop ? '-cropped' : ''));
    return;
  }
  if (item.type === 'video' && !item.embed && item.assetId) {
    const blob = await getAssetBlob(item.assetId);
    if (blob) downloadBlob(blob, fileName(item, blob.type));
    return;
  }
  if (item.type === 'pdf') {
    const blob = await getAssetBlob(item.assetId);
    if (blob) downloadBlob(blob, fileName(item, 'application/pdf'));
    return;
  }
  if (item.type === 'epub') {
    const blob = await getAssetBlob(item.assetId);
    if (blob) downloadBlob(blob, fileName(item, 'application/epub+zip'));
    return;
  }
  if (item.type === 'qr') {
    const { downloadQrSvg } = await import('./qr');
    downloadQrSvg(item);
  }
}
