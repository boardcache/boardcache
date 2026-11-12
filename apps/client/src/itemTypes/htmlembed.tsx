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
  // No poster: a sheet of paper on the theme's card, the title set at its
  // head and a few ruled lines standing in for the text, so a document reads
  // as a document at any zoom, in either theme.
  const { width: w, height: h } = item;
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, w, h);
  const m = Math.max(6, Math.min(w, h) * 0.08);
  const px = x + m;
  const py = y + m;
  const pw = w - m * 2;
  const ph = h - m;
  ctx.fillStyle = p.dark ? '#2a2e37' : '#ffffff';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = p.card.glyph;
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  const inset = Math.max(8, pw * 0.1);
  const size = Math.max(10, Math.min(pw, ph) * 0.07);
  ctx.fillStyle = p.card.text;
  ctx.font = `600 ${size}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    (item.title ?? 'Document').replace(/\.[a-z0-9]+$/i, ''),
    px + inset,
    py + inset,
    pw - inset * 2,
  );
  // Ruled lines: the text, at a distance.
  ctx.strokeStyle = p.card.glyph;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = Math.max(1, size * 0.22);
  const gap = size * 1.1;
  const widths = [0.92, 0.78, 0.86, 0.64, 0.9, 0.7];
  let ly = py + inset + size * 2;
  for (let i = 0; ly + gap < py + ph - inset; i++) {
    const lw = (pw - inset * 2) * widths[i % widths.length]!;
    ctx.beginPath();
    ctx.moveTo(px + inset, ly);
    ctx.lineTo(px + inset + lw, ly);
    ctx.stroke();
    ly += gap;
  }
  ctx.globalAlpha = 1;
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
