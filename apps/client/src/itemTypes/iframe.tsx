import { GlobeIcon } from '../components/icons';
import { defineItemType } from './registry';
import type { IframeItem } from '@boardcache/schema';
import { IframeContent } from '../components/items/IframeContent';
import { memo, blobToCanvas } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { getAssetBlob } from '../lib/board/assetStore';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import type { MetaOverride } from './registry';

/** A tidy host label for a webpage embed (drops the leading www.). */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function WebpageCard() {
  return (
    <span className="gallery-audio gallery-webpage">
      <GlobeIcon />
    </span>
  );
}

/** Live webpage embed in the lightbox — the same component as the canvas, bound
 *  to the same item, so navigating here updates the frame on the canvas too. */
function IframeStage({ item }: { item: IframeItem }) {
  return (
    <div className="lightbox-iframe" onClick={(e) => e.stopPropagation()}>
      <IframeContent item={item} lightbox />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
async function paint(item: IframeItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  // The server-rendered page screenshot, cover-fit into the box.
  if (item.posterAssetId) {
    const bm = await memo(p.cache, `blob:${item.posterAssetId}`, async () => {
      const blob = await getAssetBlob(item.posterAssetId!);
      return blob ? blobToCanvas(blob) : null;
    });
    if (bm) {
      const fit = Math.max(item.width / bm.width, item.height / bm.height);
      const dw = bm.width * fit;
      const dh = bm.height * fit;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, item.width, item.height);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, item.width, item.height);
      ctx.drawImage(bm, x + (item.width - dw) / 2, y, dw, dh);
      ctx.restore();
      return;
    }
  }
  // Placeholder: a tinted card with a globe glyph and the host.
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const cx = x + item.width / 2;
  const cy = y + item.height * 0.42;
  const r = Math.min(item.width, item.height) * 0.16;
  ctx.strokeStyle = p.card.glyph;
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.ellipse(cx, cy, r * 0.5, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  let host = item.url;
  try {
    host = new URL(item.url).hostname.replace(/^www\./, '');
  } catch {
    /* keep raw */
  }
  ctx.fillStyle = p.card.text;
  ctx.font = `600 ${Math.max(11, Math.min(item.width, item.height) * 0.1)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(host, cx, y + item.height * 0.66, item.width - 16);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: IframeItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title, body: join(item.url, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: IframeItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.name ?? item.url ?? 'Webpage';
  out.detail = item.url || null;
  return out;
}

export const iframeType = defineItemType('iframe', {
  popout: null,
  edit: { kind: 'lightbox' },
  pdfCategory: 'webpage',
  meta,
  label: 'Embed',
  searchText,
  thumbnail: paint,
  render: IframeContent,
  card: WebpageCard,
  stage: IframeStage,
  cardAspect: null,
  cardAsset: (item) => item.posterAssetId,
  cardCaption: (item) => (item.name?.trim() ?? '') || hostLabel(item.url),
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
