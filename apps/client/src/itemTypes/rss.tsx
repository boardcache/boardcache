import type { RssItem } from '@boardcache/schema';
import { RssIcon } from '../components/icons';
import { defineItemType } from './registry';
import { RssContent } from '../components/items/RssContent';
import type { StageProps, MetaOverride } from './registry';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

function RssCard({ item }: { item: RssItem }) {
  return (
    <span className="gallery-rss">
      <strong className="gallery-rss-title">
        <RssIcon size={12} /> {item.feedTitle ?? 'RSS Feed'}
      </strong>
      {item.entries.slice(0, 4).map((e) => (
        <span key={e.link} className="gallery-rss-line">
          {e.title}
        </span>
      ))}
      {item.entries.length === 0 && <span className="gallery-rss-line">No entries yet</span>}
    </span>
  );
}

function Stage({ item }: StageProps<RssItem>) {
  return (
    <div className="lightbox-rss" onClick={(e) => e.stopPropagation()}>
      <RssContent item={item} />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: RssItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  // Reader card: feed title + a few entry lines.
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const pad = Math.max(8, item.width * 0.05);
  const titleSize = Math.max(11, item.width * 0.055);
  ctx.fillStyle = p.card.text;
  ctx.font = `700 ${titleSize}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(item.feedTitle ?? 'RSS feed', x + pad, y + pad, item.width - pad * 2);
  ctx.font = `${Math.max(9, titleSize * 0.78)}px sans-serif`;
  ctx.fillStyle = p.card.sub;
  const lineH = titleSize * 1.5;
  let ty = y + pad + lineH * 1.3;
  for (const entry of item.entries.slice(0, 6)) {
    if (ty + lineH > y + item.height - pad) break;
    ctx.fillText(`• ${entry.title}`, x + pad, ty, item.width - pad * 2);
    ty += lineH;
  }
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: RssItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || (item.feedTitle ?? ''),
    body: join(item.url, ...item.entries.map((e) => join(e.title, e.excerpt)), baseText(item)),
  };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: RssItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.feedTitle ?? item.name ?? 'RSS Feed';
  out.detail = item.entries.length ? `${item.entries.length} entries` : null;
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: RssItem, _p: PopoutContext): string {
  const rows = item.entries
    .map(
      (e) =>
        `<a class="rrow" href="${escapeHtml(e.link)}" target="_blank" rel="noreferrer noopener">` +
        (e.thumbnail ? `<img class="rthumb" src="${escapeHtml(e.thumbnail)}" alt="">` : '') +
        `<span class="rtext"><span class="rtitle">${escapeHtml(e.title)}</span>` +
        (e.excerpt ? `<span class="rex">${escapeHtml(e.excerpt)}</span>` : '') +
        `</span></a>`,
    )
    .join('');
  return `<div class="rss"><h1>${escapeHtml(item.feedTitle ?? 'RSS Feed')}</h1><div class="rlist">${rows || '<p class="msg">No entries.</p>'}</div></div>`;
}

export const rssType = defineItemType('rss', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: 'link',
  meta,
  label: 'RSS Feed',
  searchText,
  thumbnail: paint,
  render: RssContent,
  card: RssCard,
  stage: Stage,
  cardAspect: () => 0.8, // text preview card, not the full reader
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
