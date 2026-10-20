import { defineItemType } from './registry';
import { EpubReader } from '../components/lightbox/EpubReader';
import { EpubContent } from '../components/items/EpubContent';
import { memo, decodeImageCanvas } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { getAssetBlob } from '../lib/board/assetStore';
import type { EpubItem } from '@boardcache/schema';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import type { MetaOverride } from './registry';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

/** ePub books: the cover image when one was extracted, else the type label. */
/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
async function paint(item: EpubItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  const size = Math.max(item.width, item.height) * 2;
  const cover = item.coverAssetId
    ? await memo(p.cache, `img:${item.coverAssetId}@${Math.round(size)}`, async () => {
        const blob = await getAssetBlob(item.coverAssetId!);
        return blob ? decodeImageCanvas(blob, size) : null;
      })
    : null;
  if (cover) {
    // Cover-fit crop, like the canvas card renders it.
    const scale = Math.max(item.width / cover.width, item.height / cover.height);
    const sw = item.width / scale;
    const sh = item.height / scale;
    ctx.drawImage(
      cover,
      (cover.width - sw) / 2,
      (cover.height - sh) / 2,
      sw,
      sh,
      x,
      y,
      item.width,
      item.height,
    );
  } else {
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(x, y, item.width, item.height);
    ctx.strokeStyle = 'rgba(127,127,127,0.5)';
    ctx.strokeRect(x, y, item.width, item.height);
  }
}

/** What the board search index sees. */
function searchText(item: EpubItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title: title || (item.bookTitle ?? ''), body: join(item.author, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: EpubItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.name ?? item.bookTitle ?? 'ePub';
  if (item.bookTitle && !item.name) out.title = item.bookTitle;
  out.detail = item.author ?? 'ePub';
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
async function popout(item: EpubItem, p: PopoutContext): Promise<string> {
  const { mintUrl } = p;
  // The full reader lives in the lightbox; the pop-out shows the cover
  // card (self-contained — no epubjs in a popup document).
  const cover = item.coverAssetId ? await getAssetBlob(item.coverAssetId) : null;
  const img = cover
    ? `<img src="${mintUrl(cover)}" style="max-width:70vw;max-height:70vh;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.35)"/>`
    : '';
  return `<div class="msg" style="display:flex;flex-direction:column;align-items:center;gap:14px">${img}<div><b>${escapeHtml(item.bookTitle ?? item.name ?? 'ePub')}</b>${item.author ? `<div>${escapeHtml(item.author)}</div>` : ''}</div><div>Open the lightbox to read.</div></div>`;
}

export const epubType = defineItemType('epub', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: 'pdf',
  meta,
  label: 'ePub',
  searchText,
  thumbnail: paint,
  render: EpubContent,
  card: null,
  stage: EpubReader,
  cardAspect: null,
  cardAsset: (item) => item.coverAssetId,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
