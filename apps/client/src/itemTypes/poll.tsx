import type { PollItem } from '@boardcache/schema';
import { defineItemType } from './registry';
import { PollContent } from '../components/items/PollContent';
import type { StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

function PollCard({ item }: { item: PollItem }) {
  const total = Object.values(item.votes).reduce((sum, v) => sum + v.optionIds.length, 0);
  return (
    <span className="gallery-poll" data-testid="gallery-poll-thumb">
      <strong className="gallery-poll-q">{item.question}</strong>
      {item.options.slice(0, 4).map((o) => {
        const n = Object.values(item.votes).filter((v) => v.optionIds.includes(o.id)).length;
        return (
          <span key={o.id} className="gallery-poll-row">
            <i style={{ width: `${total ? Math.round((n / total) * 100) : 0}%` }} />
            <em>{o.label}</em>
            <b>{n}</b>
          </span>
        );
      })}
    </span>
  );
}

function Stage({ item }: StageProps<PollItem>) {
  return (
    <div className="lightbox-poll" onClick={(e) => e.stopPropagation()}>
      <PollContent item={item} stage />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: PollItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const pad = Math.max(8, item.width * 0.05);
  const qSize = Math.max(11, item.width * 0.055);
  ctx.fillStyle = p.card.text;
  ctx.font = `700 ${qSize}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(item.question, x + pad, y + pad, item.width - pad * 2);
  // Result bars
  let total = 0;
  const counts = item.options.map((o) => {
    const n = Object.values(item.votes).filter((v) => v.optionIds.includes(o.id)).length;
    total += n;
    return n;
  });
  const rowH = qSize * 1.9;
  let ty = y + pad + qSize * 2;
  item.options.forEach((o, i) => {
    if (ty + rowH > y + item.height - pad) return;
    const frac = total ? counts[i]! / total : 0;
    ctx.fillStyle = 'rgba(127,127,127,0.18)';
    ctx.fillRect(x + pad, ty, item.width - pad * 2, rowH * 0.72);
    ctx.fillStyle = 'rgba(96,140,255,0.45)';
    ctx.fillRect(x + pad, ty, (item.width - pad * 2) * frac, rowH * 0.72);
    ctx.fillStyle = p.card.text;
    ctx.font = `${Math.max(9, qSize * 0.8)}px sans-serif`;
    ctx.fillText(o.label, x + pad + 6, ty + rowH * 0.16, item.width - pad * 2 - 30);
    ctx.textAlign = 'right';
    ctx.fillText(String(counts[i]), x + item.width - pad - 4, ty + rowH * 0.16);
    ctx.textAlign = 'left';
    ty += rowH;
  });
  ctx.fillStyle = p.card.sub;
  ctx.font = `${Math.max(9, qSize * 0.7)}px sans-serif`;
  ctx.fillText(
    `${total} vote${total === 1 ? '' : 's'}`,
    x + pad,
    Math.min(ty + 2, y + item.height - pad - qSize),
    item.width - pad * 2,
  );
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: PollItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.question,
    body: join(...item.options.map((o) => o.label), baseText(item)),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: PollItem, _p: PopoutContext): string {
  let total = 0;
  const counts = item.options.map((o) => {
    const n = Object.values(item.votes).filter((v) => v.optionIds.includes(o.id)).length;
    total += n;
    return n;
  });
  const rows = item.options
    .map((o, i) => {
      const pct = total ? Math.round((counts[i]! / total) * 100) : 0;
      return (
        `<div class="prow"><div class="pfill" style="width:${pct}%"></div>` +
        `<span class="plabel">${escapeHtml(o.label)}</span>` +
        `<span class="pcount">${pct}% \u00b7 ${counts[i]}</span></div>`
      );
    })
    .join('');
  return (
    `<div class="pollpop"><h1>${escapeHtml(item.question)}</h1>` +
    (item.closed ? '<p class="pclosed">Closed</p>' : '') +
    `<div class="plist">${rows}</div>` +
    `<p class="ptotal">${total} vote${total === 1 ? '' : 's'}</p></div>`
  );
}

export const pollType = defineItemType('poll', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: 'image',
  meta: null,
  label: 'Poll',
  searchText,
  thumbnail: paint,
  render: PollContent,
  card: PollCard,
  stage: Stage,
  cardAspect: () => 0.9, // question + option bars
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
