import type { TimelineItem, Item } from '@boardcache/schema';
import { defineItemType } from './registry';
import { TimelineStage, TimelineContent } from '../components/items/TimelineContent';
import type { StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import { timelineSlots } from '../lib/structure/timelineLayout';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

function TimelineCard({ item }: { item: TimelineItem }) {
  return (
    <span className="gallery-timeline" data-testid="gallery-timeline-thumb">
      <span className="gallery-timeline-spine" style={{ background: item.style.lineColor }} />
      {item.points.slice(0, 5).map((p) => (
        <span className="gallery-timeline-pt" key={p.id}>
          <i style={{ background: p.color ?? item.style.pointColor }} />
          <em>{p.date || p.label}</em>
        </span>
      ))}
      {item.points.length === 0 && <span className="gallery-rss-line">No points yet</span>}
    </span>
  );
}

function Stage({ item }: StageProps<TimelineItem>) {
  return (
    <div className="lightbox-timeline" onClick={(e) => e.stopPropagation()}>
      <TimelineStage item={item} />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: TimelineItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const slots = timelineSlots(item, p.itemsById);
  // Shelf tints behind attached items (they draw later, above this).
  if (p.itemsById) {
    for (const { point } of slots) {
      const attached = point.itemIds
        .map((id) => p.itemsById![id])
        .filter((it): it is Item => it !== undefined);
      if (attached.length === 0) continue;
      // Attached items live in canvas space; the context is translated to
      // this card's centre, where the card's own corner is (x, y).
      const pad = 12;
      const minX = Math.min(...attached.map((it) => it.x)) - item.x + x - pad;
      const minY = Math.min(...attached.map((it) => it.y)) - item.y + y - pad;
      const maxX = Math.max(...attached.map((it) => it.x + it.width)) - item.x + x + pad;
      const maxY = Math.max(...attached.map((it) => it.y + it.height)) - item.y + y + pad;
      ctx.fillStyle = `${point.color ?? item.style.pointColor}14`;
      ctx.beginPath();
      ctx.roundRect(minX, minY, maxX - minX, maxY - minY, 14);
      ctx.fill();
    }
  }
  const horizontal = item.orientation === 'horizontal';
  const mid = horizontal ? item.height / 2 : item.width / 2;
  ctx.strokeStyle = item.style.lineColor;
  ctx.lineWidth = item.style.lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(x + 12, y + mid);
    ctx.lineTo(x + item.width - 12, y + mid);
  } else {
    ctx.moveTo(x + mid, y + 12);
    ctx.lineTo(x + mid, y + item.height - 12);
  }
  ctx.stroke();
  const fontSize = Math.max(10, Math.min(14.5, item.width * 0.03));
  for (const { point, along, before } of slots) {
    const px = horizontal ? x + along : x + mid;
    const py = horizontal ? y + mid : y + along;
    ctx.fillStyle = point.color ?? item.style.pointColor;
    ctx.beginPath();
    ctx.arc(px, py, item.style.pointSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.card.text;
    ctx.font = `600 ${fontSize}px sans-serif`;
    const gap = item.style.pointSize / 2 + 8;
    if (horizontal) {
      ctx.textAlign = 'center';
      ctx.textBaseline = before ? 'bottom' : 'top';
      ctx.fillText(point.label, px, before ? py - gap : py + gap, 140);
      if (point.date) {
        ctx.fillStyle = p.card.sub;
        ctx.font = `${Math.max(8, fontSize * 0.85)}px sans-serif`;
        ctx.fillText(
          point.date,
          px,
          before ? py - gap - fontSize - 2 : py + gap + fontSize + 2,
          140,
        );
      }
    } else {
      ctx.textAlign = before ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(point.label, before ? px - gap : px + gap, py, mid - gap - 8);
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: TimelineItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title,
    body: join(...item.points.map((p) => join(p.label, p.date, p.description)), baseText(item)),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: TimelineItem, _p: PopoutContext): string {
  const rows = item.points
    .map(
      (p) =>
        `<div class="tlrow"><span class="tldot" style="background:${escapeHtml(
          p.color ?? item.style.pointColor,
        )}"></span><div class="tlbody">` +
        (p.date ? `<span class="tldate">${escapeHtml(p.date)}</span>` : '') +
        `<span class="tllabel">${escapeHtml(p.label)}</span>` +
        (p.description ? `<p class="tldesc">${escapeHtml(p.description)}</p>` : '') +
        `</div></div>`,
    )
    .join('');
  return (
    `<div class="tlpop">` +
    (item.name ? `<h1>${escapeHtml(item.name)}</h1>` : '') +
    `<div class="tllist">${rows || '<p>No points yet.</p>'}</div></div>`
  );
}

export const timelineType = defineItemType('timeline', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: 'image',
  meta: null,
  label: 'Timeline',
  searchText,
  thumbnail: paint,
  render: TimelineContent,
  card: TimelineCard,
  stage: Stage,
  cardAspect: () => 0.55, // horizontal milestone strip
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
