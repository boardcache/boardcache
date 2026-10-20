import type { HtmlEmbedItem } from '@boardcache/schema';
import { useAssetText } from '../hooks/useAssetUrl';
import { defineItemType } from './registry';
import { HtmlEmbedContent } from '../components/items/HtmlEmbedContent';
import type { StageProps } from './registry';
import { memo, blobToCanvas } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { getAssetBlob } from '../lib/board/assetStore';
import type { Extracted } from '../lib/search/extract';
import { baseText } from '../lib/search/extract';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

/** Office/HTML documents without a poster: a scaled-down live render. */
function HtmlCard({ item }: { item: HtmlEmbedItem }) {
  const html = useAssetText(item.htmlAssetId);
  if (html === null) return <span className="gallery-generic">Document</span>;
  return (
    <span className="gallery-html" data-testid="gallery-html-thumb">
      <iframe srcDoc={html} sandbox="" title="Document preview" tabIndex={-1} />
    </span>
  );
}

function Stage({ item }: StageProps<HtmlEmbedItem>) {
  return (
    <div className="lightbox-iframe" onClick={(e) => e.stopPropagation()}>
      <HtmlEmbedContent item={item} lightbox />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
async function paint(item: HtmlEmbedItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  const poster = item.posterAssetId
    ? await memo(p.cache, `blob:${item.posterAssetId}`, async () => {
        const blob = await getAssetBlob(item.posterAssetId!);
        return blob ? blobToCanvas(blob) : null;
      })
    : null;
  if (poster) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, item.width, item.height);
    const fit = Math.max(item.width / poster.width, item.height / poster.height);
    const dw = poster.width * fit;
    const dh = poster.height * fit;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, item.width, item.height);
    ctx.clip();
    ctx.drawImage(poster, x + (item.width - dw) / 2, y, dw, dh);
    ctx.restore();
    return;
  }
  // No poster: a tinted card with a document glyph + title.
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const cx = x + item.width / 2;
  const gy = y + item.height * 0.4;
  const gw = Math.min(item.width, item.height) * 0.22;
  ctx.strokeStyle = p.card.glyph;
  ctx.lineWidth = Math.max(1.5, gw * 0.1);
  ctx.strokeRect(cx - gw / 2, gy - gw * 0.65, gw, gw * 1.3);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    ctx.moveTo(cx - gw * 0.3, gy - gw * 0.2 + i * gw * 0.35);
    ctx.lineTo(cx + gw * 0.3, gy - gw * 0.2 + i * gw * 0.35);
  }
  ctx.stroke();
  ctx.fillStyle = p.card.text;
  ctx.font = `600 ${Math.max(11, Math.min(item.width, item.height) * 0.1)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(item.title ?? 'Document', cx, y + item.height * 0.66, item.width - 16);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: HtmlEmbedItem): Extracted {
  const title = item.name?.trim() ?? '';
  // Visual types index their base metadata; PDF and htmlembed get deep
  // text through the async extractors below.
  return {
    title: title || ('title' in item ? ((item as { title?: string }).title ?? '') : ''),
    body: baseText(item),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
async function popout(item: HtmlEmbedItem, p: PopoutContext): Promise<string> {
  const { mintUrl } = p;
  const blob = await getAssetBlob(item.htmlAssetId);
  if (!blob) return `<div class="msg">Document unavailable</div>`;
  return `<iframe src="${mintUrl(blob)}" sandbox="" style="width:100%;height:100%;border:0;background:#fff"></iframe>`;
}

export const htmlembedType = defineItemType('htmlembed', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: null,
  meta: null,
  label: 'Document',
  searchText,
  thumbnail: paint,
  render: HtmlEmbedContent,
  card: HtmlCard,
  stage: Stage,
  cardAspect: null,
  cardAsset: (item) => item.posterAssetId,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
