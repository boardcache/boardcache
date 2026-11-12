import type { FileItem } from '@boardcache/schema';
import { defineItemType } from './registry';
import type { MetaOverride } from './registry';
import { FileCard, FileContent, fileDetail, fileTitle } from '../components/items/FileContent';
import { LightboxFile } from '../components/lightbox/LightboxFile';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { fileKind, formatFileSize } from '../lib/files/fileKind';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { getAssetBlob } from '../lib/board/assetStore';

/** Board thumbnail / snapshot painter: a page glyph with the extension, the name and the size. */
function paint(item: FileItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  const { width: w, height: h } = item;
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, w, h);
  // The page: a rectangle with its corner folded, sized to the card's height.
  const ph = Math.min(h * 0.6, w * 0.3);
  const pw = ph * 0.78;
  const px = x + Math.min(16, w * 0.05);
  const py = y + (h - ph) / 2;
  const fold = pw * 0.3;
  ctx.strokeStyle = p.card.glyph;
  ctx.lineWidth = Math.max(1.5, ph * 0.04);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + pw - fold, py);
  ctx.lineTo(px + pw, py + fold);
  ctx.lineTo(px + pw, py + ph);
  ctx.lineTo(px, py + ph);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px + pw - fold, py);
  ctx.lineTo(px + pw - fold, py + fold);
  ctx.lineTo(px + pw, py + fold);
  ctx.stroke();
  const kind = fileKind(item.fileName, item.mime);
  ctx.fillStyle = p.card.glyph;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (kind.ext) {
    ctx.font = `bold ${Math.max(8, ph * 0.2)}px sans-serif`;
    ctx.fillText(kind.ext.toUpperCase().slice(0, 5), px + pw / 2, py + ph * 0.66, pw - 4);
  }
  // Name and detail beside it.
  const tx = px + pw + Math.max(10, w * 0.03);
  const room = x + w - tx - 12;
  ctx.textAlign = 'left';
  ctx.fillStyle = p.card.text;
  ctx.font = `600 ${Math.max(10, Math.min(h * 0.16, 20))}px sans-serif`;
  ctx.fillText(fileTitle(item), tx, y + h * 0.42, room);
  ctx.fillStyle = p.card.sub;
  ctx.font = `${Math.max(9, Math.min(h * 0.12, 14))}px sans-serif`;
  ctx.fillText(fileDetail(item), tx, y + h * 0.62, room);
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: FileItem): Extracted {
  return {
    title: fileTitle(item),
    body: join(item.fileName, fileKind(item.fileName, item.mime).label, baseText(item)),
  };
}

/** Lightbox-panel / caption metadata: the file's name and what it is. */
function meta(item: FileItem): MetaOverride {
  return { title: fileTitle(item), detail: fileDetail(item) };
}

/** The item's own window (File → Pop Out): the details and a download link. */
async function popout(item: FileItem, p: PopoutContext): Promise<string> {
  const blob = await getAssetBlob(item.assetId);
  const kind = fileKind(item.fileName, item.mime);
  const link = blob
    ? `<p><a class="btn" href="${p.mintUrl(blob)}" download="${escapeHtml(item.fileName)}">Download</a></p>`
    : `<p class="msg">The file is not on this device yet.</p>`;
  return (
    `<div class="filecard"><h1>${escapeHtml(fileTitle(item))}</h1>` +
    `<p>${escapeHtml(item.fileName)} · ${escapeHtml(kind.label)} · ${formatFileSize(item.size)}</p>${link}</div>`
  );
}

export const fileType = defineItemType('file', {
  popout,
  // Nothing to edit but the name, which Rename covers.
  edit: null,
  pdfCategory: 'file',
  meta,
  label: 'File',
  searchText,
  thumbnail: paint,
  render: FileContent,
  card: FileCard,
  stage: LightboxFile,
  // The card is a fixed row; the gallery derives its height from the box.
  cardAspect: null,
  // No picture of its own.
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
