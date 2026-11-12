import type { KanbanItem } from '@boardcache/schema';
import { ContainerCard } from './containerCard';
import { defineItemType } from './registry';
import {
  KANBAN_COL_HEAD,
  KANBAN_HEADER,
  KANBAN_TITLE_H,
  kanbanBoxes,
  kanbanColumnWidth,
  kanbanZoom,
} from '../lib/structure/kanbanAttach';
import { KanbanContent, KanbanStage } from '../components/items/KanbanContent';
import type { StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { mediaMeta } from '../lib/mediaItems';

function KanbanCard({ item }: { item: KanbanItem }) {
  return <ContainerCard item={item} testId="gallery-kanban-thumb" label="Kanban" />;
}

function Stage({ item }: StageProps<KanbanItem>) {
  return (
    <div className="lightbox-kanban" onClick={(e) => e.stopPropagation()}>
      <KanbanStage item={item} />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: KanbanItem, p: PaintContext): void {
  const { ctx } = p;
  const k = kanbanZoom(item);
  const W = item.width / k;
  const H = item.height / k;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(k, k);
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = p.card.text;
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  if (item.description) {
    ctx.fillText(item.title, 14, KANBAN_HEADER / 2 - 7, W - 28);
    ctx.fillStyle = p.card.sub;
    ctx.font = '400 10.5px Inter, system-ui, sans-serif';
    ctx.fillText(item.description, 14, KANBAN_HEADER / 2 + 9, W - 28);
  } else {
    ctx.fillText(item.title, 14, KANBAN_HEADER / 2, W - 28);
  }
  ctx.strokeStyle = 'rgba(127,127,127,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, KANBAN_HEADER);
  ctx.lineTo(W, KANBAN_HEADER);
  ctx.stroke();
  const colW = kanbanColumnWidth({ columns: item.columns, width: item.width }, k);
  item.columns.forEach((column, i) => {
    const x = 8 + i * (colW + 10);
    const top = KANBAN_HEADER + 8;
    const h = H - top - 8;
    ctx.fillStyle = 'rgba(127,127,127,0.10)';
    ctx.fillRect(x, top, colW, h);
    ctx.fillStyle = column.color;
    ctx.beginPath();
    ctx.arc(x + 14, top + KANBAN_COL_HEAD / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.card.text;
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.fillText(column.label, x + 24, top + KANBAN_COL_HEAD / 2, colW - 32);
  });
  if (item.showTitles && p.itemsById) {
    ctx.fillStyle = p.card.sub;
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const [id, b] of kanbanBoxes(item, p.itemsById).boxes) {
      const it = p.itemsById[id];
      if (!it) continue;
      ctx.fillText(
        mediaMeta(it).title,
        (b.x - item.x + b.width / 2) / k,
        (b.y + b.height - item.y) / k + KANBAN_TITLE_H / 2,
        b.width / k,
      );
    }
  }
  ctx.restore();
}

/** What the board search index sees. */
function searchText(item: KanbanItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.title,
    body: join(...item.columns.map((c) => c.label), baseText(item)),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: KanbanItem, p: PopoutContext): string {
  const { doc } = p;
  const columns = item.columns
    .map((c) => {
      const names = c.itemIds
        .map((id) => {
          const it = doc.items[id];
          return it ? `<li>${escapeHtml(mediaMeta(it).title)}</li>` : '';
        })
        .join('');
      return (
        `<div class="kbcol"><h2><span class="kbdot" style="background:${escapeHtml(c.color)}"></span>${escapeHtml(c.label)}</h2>` +
        `<ul>${names || '<li><i>—</i></li>'}</ul></div>`
      );
    })
    .join('');
  return (
    `<div class="kbpop"><h1>${escapeHtml(item.name ?? item.title)}</h1>` +
    `<style>.kbcols{display:flex;gap:16px;align-items:flex-start}.kbcol{flex:1;min-width:0;background:rgba(127,127,127,.12);border-radius:8px;padding:10px}.kbcol h2{font-size:14px;margin:0 0 8px;display:flex;align-items:center;gap:8px}.kbdot{width:10px;height:10px;border-radius:50%;display:inline-block}.kbcol ul{margin:0;padding-left:18px}</style>` +
    `<div class="kbcols">${columns}</div></div>`
  );
}

export const kanbanType = defineItemType('kanban', {
  popout,
  edit: { kind: 'event', event: 'boardcache:edit-kanban' },
  pdfCategory: 'image',
  meta: null,
  label: 'Kanban',
  searchText,
  thumbnail: paint,
  render: KanbanContent,
  card: KanbanCard,
  stage: Stage,
  cardAspect: () => 0.7, // a wide board of columns
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
