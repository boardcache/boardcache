import type { TasklistItem } from '@boardcache/schema';
import { readableTextColor } from '../lib/color/color';
import { defineItemType } from './registry';
import { TasklistContent } from '../components/items/TasklistContent';
import type { StageProps, MetaOverride } from './registry';
import { accentColor } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { formatDue } from '../lib/structure/tasklist';
import { cardZoom } from '../lib/canvas/cardZoom';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

function TasklistCard({ item }: { item: TasklistItem }) {
  const done = item.tasks.filter((t) => t.done).length;
  return (
    <span
      className="gallery-tasklist"
      data-testid="gallery-tasklist-thumb"
      style={{
        background: item.background ?? undefined,
        color: item.color ?? (item.background ? readableTextColor(item.background) : undefined),
      }}
    >
      <strong className="gallery-tasklist-title">{item.title}</strong>
      {item.tasks.length > 0 && (
        <span className="gallery-tasklist-progress">
          <i style={{ width: `${Math.round((done / item.tasks.length) * 100)}%` }} />
        </span>
      )}
      {item.tasks.slice(0, 6).map((t) => (
        <span key={t.id} className={`gallery-task${t.done ? ' done' : ''}`}>
          <i>{t.done ? '☑' : '☐'}</i> {t.label}
        </span>
      ))}
      {item.tasks.length === 0 && <span className="gallery-task">No tasks yet</span>}
    </span>
  );
}

function Stage({ item }: StageProps<TasklistItem>) {
  return (
    <div className="lightbox-tasklist" onClick={(e) => e.stopPropagation()}>
      <TasklistContent item={item} stage />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: TasklistItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  // Mirrors the DOM card 1:1 (at the intrinsic design width, uniformly
  // scaled): rounded bordered panel, centered title, checkbox rows with
  // note + due chip, dashed "+ Add task" footer.
  const bg = item.background ?? p.card.bg;
  const ink = item.color ?? (item.background ? readableTextColor(item.background) : p.card.text);
  const k = cardZoom(item);
  const W = item.width / Math.max(0.01, k); // the card fills its box at this zoom
  const H = item.height / Math.max(0.01, k);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, W - 1, H - 1, 12);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = p.dark ? 'rgba(230,232,236,0.26)' : 'rgba(35,39,46,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();

  ctx.fillStyle = ink;
  ctx.font = '750 16px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.title, W / 2, 22, W - 80);
  ctx.textAlign = 'left';

  const footerTop = H - 8;
  let top = 40;
  if (item.tasks.length > 0) {
    const doneN = item.tasks.filter((t) => t.done).length;
    const frac = doneN / item.tasks.length;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.roundRect(14, top, W - 28, 4, 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (frac > 0) {
      ctx.fillStyle = accentColor(p.dark);
      ctx.beginPath();
      ctx.roundRect(14, top, (W - 28) * frac, 4, 2);
      ctx.fill();
    }
    top += 12;
  }
  for (const t of item.tasks) {
    const rowH = 10 + 18 + (t.note ? 15 : 0);
    if (top + rowH > footerTop) break;
    ctx.globalAlpha = t.done ? 0.55 : 1;
    // checkbox (17px rounded square; filled check when done)
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(14, top + 6, 17, 17, 5);
    ctx.stroke();
    if (t.done) {
      ctx.beginPath();
      ctx.moveTo(18, top + 14.5);
      ctx.lineTo(21.5, top + 18);
      ctx.lineTo(27, top + 10);
      ctx.stroke();
    }
    // label (+ strikethrough when done)
    ctx.fillStyle = ink;
    ctx.font = '550 13.5px Inter, system-ui, sans-serif';
    const labelY = top + 14;
    const labelMax = W - 40 - (t.due ? 150 : 60);
    ctx.fillText(t.label, 40, labelY, labelMax);
    if (t.done) {
      const lw = Math.min(ctx.measureText(t.label).width, labelMax);
      ctx.beginPath();
      ctx.moveTo(40, labelY);
      ctx.lineTo(40 + lw, labelY);
      ctx.stroke();
    }
    if (t.note) {
      ctx.globalAlpha = (t.done ? 0.55 : 1) * 0.7;
      ctx.font = '400 11.5px Inter, system-ui, sans-serif';
      ctx.fillText(t.note, 40, top + 30, W - 40 - 32);
      ctx.globalAlpha = t.done ? 0.55 : 1;
    }
    // due chip, right-aligned (the hidden remove chip reserves 22px)
    if (t.due) {
      const overdue = !t.done && new Date(t.due).getTime() <= Date.now();
      ctx.font = '400 11px Inter, system-ui, sans-serif';
      const dueText = formatDue(t.due);
      const tw = ctx.measureText(dueText).width;
      const chipW = tw + 30;
      const chipX = W - 36 - chipW;
      ctx.fillStyle = overdue ? 'rgba(214,69,69,0.18)' : 'rgba(127,127,127,0.12)';
      ctx.beginPath();
      ctx.roundRect(chipX, top + 6, chipW, 17, 6);
      ctx.fill();
      const chipInk = overdue ? '#d64545' : ink;
      // tiny calendar glyph
      ctx.strokeStyle = chipInk;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.roundRect(chipX + 7, top + 10, 9, 9, 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(chipX + 7, top + 13);
      ctx.lineTo(chipX + 16, top + 13);
      ctx.stroke();
      ctx.fillStyle = chipInk;
      ctx.fillText(dueText, chipX + 20, top + 14.5);
    }
    ctx.globalAlpha = 1;
    top += rowH;
  }

  // Blank add-row under the last task (faint ghost checkbox).
  if (top + 28 <= footerTop) {
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(14, top + 6, 17, 17, 5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

/** What the board search index sees. */
function searchText(item: TasklistItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.title,
    body: join(...item.tasks.flatMap((t) => [t.label, t.note]), baseText(item)),
  };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: TasklistItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.name ?? item.title;
  const done = item.tasks.filter((t) => t.done).length;
  out.detail = item.tasks.length ? `${done}/${item.tasks.length} done` : null;
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: TasklistItem, _p: PopoutContext): string {
  const rows = item.tasks
    .map((t) => {
      const due = t.due
        ? `<span class="tkdue">${escapeHtml(
            new Date(t.due).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            }),
          )}</span>`
        : '';
      return (
        `<div class="tkrow${t.done ? ' tkdone' : ''}">` +
        `<span class="tkbox">${t.done ? '\u2611' : '\u2610'}</span>` +
        `<span class="tkmain"><span class="tklabel">${escapeHtml(t.label)}</span>` +
        (t.note ? `<span class="tknote">${escapeHtml(t.note)}</span>` : '') +
        `</span>${due}</div>`
      );
    })
    .join('');
  const tint = item.background
    ? ` style="background:${escapeHtml(item.background)};color:${escapeHtml(item.color ?? readableTextColor(item.background))}"`
    : '';
  return (
    `<style>.tasklistpop{padding:18px 22px;border-radius:12px}.tasklistpop h1{text-align:center;margin:0 0 14px;font-size:20px}.tkrow{display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid rgba(127,127,127,0.18)}.tkbox{flex:none}.tkmain{flex:1;min-width:0;display:flex;flex-direction:column}.tknote{font-size:12px;opacity:.7}.tkdue{font-size:12px;opacity:.8;white-space:nowrap}.tkdone .tklabel{text-decoration:line-through;opacity:.6}</style>` +
    `<div class="tasklistpop"${tint}><h1>${escapeHtml(item.title)}</h1>${rows}</div>`
  );
}

export const tasklistType = defineItemType('tasklist', {
  popout,
  edit: { kind: 'event', event: 'boardcache:edit-tasklist' },
  pdfCategory: 'image',
  meta,
  label: 'Task List',
  searchText,
  thumbnail: paint,
  render: TasklistContent,
  card: TasklistCard,
  stage: Stage,
  cardAspect: () => 0.95, // checklist card
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
