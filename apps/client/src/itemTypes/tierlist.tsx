import type { TierlistItem } from '@boardcache/schema';
import { ContainerCard } from './containerCard';
import { defineItemType } from './registry';
import { TierlistStage, TierlistContent } from '../components/items/TierlistContent';
import type { StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { mediaMeta } from '../lib/mediaItems';

function TierlistCard({ item }: { item: TierlistItem }) {
  return <ContainerCard item={item} testId="gallery-tierlist-thumb" label="Tier List" />;
}

function Stage({ item }: StageProps<TierlistItem>) {
  return (
    <div className="lightbox-tierlist" onClick={(e) => e.stopPropagation()}>
      <TierlistStage item={item} />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: TierlistItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  const HEADER = 40;
  const LABEL_W = 84;
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  ctx.fillStyle = p.card.text;
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  if (item.description) {
    ctx.fillText(item.title, x + 14, y + HEADER / 2 - 7, item.width - 28);
    ctx.fillStyle = p.card.sub;
    ctx.font = '400 10.5px Inter, system-ui, sans-serif';
    ctx.fillText(item.description, x + 14, y + HEADER / 2 + 9, item.width - 28);
  } else {
    ctx.fillText(item.title, x + 14, y + HEADER / 2, item.width - 28);
  }
  const rowH = item.rows.length ? (item.height - HEADER) / item.rows.length : 0;
  item.rows.forEach((row, i) => {
    const top = y + HEADER + i * rowH;
    ctx.fillStyle = row.color;
    ctx.fillRect(x, top, LABEL_W, rowH);
    ctx.fillStyle = 'rgba(127,127,127,0.10)';
    ctx.fillRect(x + LABEL_W, top, item.width - LABEL_W, rowH);
    ctx.strokeStyle = 'rgba(127,127,127,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, top, item.width, rowH);
    const h2 = row.color.replace('#', '');
    const lum =
      parseInt(h2.slice(0, 2), 16) * 0.299 +
      parseInt(h2.slice(2, 4), 16) * 0.587 +
      parseInt(h2.slice(4, 6), 16) * 0.114;
    ctx.fillStyle = lum > 150 ? '#26221c' : '#ffffff';
    ctx.font = `700 ${Math.min(26, rowH * 0.4)}px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(row.label).width;
    ctx.fillText(row.label, x + LABEL_W / 2 - w / 2, top + rowH / 2);
  });
}

/** What the board search index sees. */
function searchText(item: TierlistItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.title,
    body: join(...item.rows.map((r) => r.label), baseText(item)),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: TierlistItem, p: PopoutContext): string {
  const { doc } = p;
  const rows = item.rows
    .map((r) => {
      const names = r.itemIds
        .map((id) => {
          const it = doc.items[id];
          return it ? escapeHtml(mediaMeta(it).title) : '';
        })
        .filter(Boolean);
      return (
        `<div class="tierrow"><span class="tiercell" style="background:${escapeHtml(r.color)}">${escapeHtml(r.label)}</span>` +
        `<span class="tieritems">${names.join(' · ') || '<i>—</i>'}</span></div>`
      );
    })
    .join('');
  return (
    `<div class="tierpop"><h1>${escapeHtml(item.name ?? item.title)}</h1>` +
    `<style>.tierrow{display:flex;align-items:center;border-bottom:1px solid #ccc}.tiercell{flex:none;width:64px;text-align:center;font-weight:800;padding:14px 0}.tieritems{padding:0 12px}</style>` +
    `${rows}</div>`
  );
}

export const tierlistType = defineItemType('tierlist', {
  popout,
  edit: { kind: 'event', event: 'boardcache:edit-tierlist' },
  pdfCategory: 'image',
  meta: null,
  label: 'Tier List',
  searchText,
  thumbnail: paint,
  render: TierlistContent,
  card: TierlistCard,
  stage: Stage,
  cardAspect: () => 0.9, // tall ranking card
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
