import type { ProjectItem } from '@boardcache/schema';
import { defineItemType } from './registry';
import { ProjectContent } from '../components/items/ProjectContent';
import type { StageProps, MetaOverride } from './registry';
import { accentColor } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { cardZoom } from '../lib/canvas/cardZoom';
import { PROJECT_STATUS_LABEL } from '../lib/structure/projects';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

function ProjectCard({ item }: { item: ProjectItem }) {
  const done = item.tasks.filter((t) => t.status === 'done').length;
  return (
    <span className="gallery-project" data-testid="gallery-project-thumb">
      <strong className="gallery-project-title">{item.title}</strong>
      <span className="gallery-project-sub">{`${done}/${item.tasks.length} tasks`}</span>
      {item.tasks.length > 0 && (
        <span className="gallery-tasklist-progress">
          <i style={{ width: `${Math.round((done / item.tasks.length) * 100)}%` }} />
        </span>
      )}
    </span>
  );
}

function Stage({ item }: StageProps<ProjectItem>) {
  return (
    <div className="lightbox-project" onClick={(e) => e.stopPropagation()}>
      <ProjectContent item={item} stage />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: ProjectItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  // The project card, mirrored 1:1 at its design width (uniform zoom):
  // title + status pill, dates box, big counters, progress, then each
  // milestone with its tasks and the unscheduled tasks.
  const accent = item.color || accentColor(p.dark);
  const pad = 14;
  const k = cardZoom(item);
  const W = item.width / Math.max(0.01, k); // the card fills its box at this zoom
  const H = item.height / Math.max(0.01, k);
  const font = 'Inter, system-ui, sans-serif';
  const tint = p.dark ? 'rgba(230,232,236,0.09)' : 'rgba(35,39,46,0.06)';
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, W - 1, H - 1, 12);
  ctx.fillStyle = p.card.bg;
  ctx.fill();
  ctx.strokeStyle = p.dark ? 'rgba(230,232,236,0.26)' : 'rgba(35,39,46,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 4, H);
  const left = pad + 4;
  const innerW = W - pad * 2 - 4;
  let top = pad + 2;
  ctx.textBaseline = 'top';
  // Title, status pill right-aligned.
  const status = PROJECT_STATUS_LABEL[item.status];
  ctx.font = `600 10.5px ${font}`;
  const sw = ctx.measureText(status).width + 16;
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.roundRect(W - pad - sw, top + 1, sw, 17, 9);
  ctx.fill();
  ctx.fillStyle = p.card.sub;
  ctx.fillText(status, W - pad - sw + 8, top + 4);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(left + 5, top + 9, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.card.text;
  ctx.font = `750 15px ${font}`;
  ctx.fillText(item.title, left + 18, top, innerW - sw - 26);
  top += 28;
  // Description (first line), then the dates box.
  if (item.description) {
    ctx.fillStyle = p.card.sub;
    ctx.font = `500 12px ${font}`;
    ctx.fillText(item.description.split('\n')[0] ?? '', left, top + 4, innerW);
    top += 26;
  }
  if (item.startDate || item.endDate) {
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.roundRect(left, top, innerW, 28, 8);
    ctx.fill();
    ctx.fillStyle = p.card.text;
    ctx.font = `600 12px ${font}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${item.startDate ?? '…'}  →  ${item.endDate ?? '…'}`, left + innerW / 2, top + 8);
    ctx.textAlign = 'left';
    top += 36;
  }
  const total = item.tasks.length;
  const done = item.tasks.filter((t) => t.status === 'done').length;
  // Counters.
  const statW = (innerW - 8) / 2;
  const stat = (big: string, small: string, sx: number) => {
    ctx.strokeStyle = p.dark ? 'rgba(230,232,236,0.13)' : 'rgba(35,39,46,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(sx + 0.5, top + 0.5, statW - 1, 43, 9);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = p.card.text;
    ctx.font = `700 18px ${font}`;
    ctx.fillText(big, sx + statW / 2, top + 6);
    ctx.fillStyle = p.card.sub;
    ctx.font = `500 11px ${font}`;
    ctx.fillText(small, sx + statW / 2, top + 27);
    ctx.textAlign = 'left';
  };
  stat(`${done}/${total}`, 'tasks done', left);
  stat(
    String(item.milestones.length),
    item.milestones.length === 1 ? 'milestone' : 'milestones',
    left + statW + 8,
  );
  top += 52;
  // Progress, equal air above and below.
  top += 10;
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = p.card.text;
  ctx.beginPath();
  ctx.roundRect(left, top, innerW, 4, 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (total > 0 && done > 0) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(left, top, innerW * (done / total), 4, 2);
    ctx.fill();
  }
  top += 4 + 10;
  // Milestones with their tasks, then the unscheduled tasks.
  const ms = [...item.milestones].sort((a, b) =>
    (a.endDate ?? '~').localeCompare(b.endDate ?? '~'),
  );
  const groups: {
    title: string;
    date: string | null;
    tasks: typeof item.tasks;
    diamond: boolean;
  }[] = ms.map((m) => ({
    title: m.title,
    date: m.endDate,
    tasks: item.tasks.filter((t) => t.milestoneId === m.id),
    diamond: true,
  }));
  const backlog = item.tasks.filter(
    (t) => !t.milestoneId || !ms.some((m) => m.id === t.milestoneId),
  );
  if (backlog.length) groups.push({ title: 'Tasks', date: null, tasks: backlog, diamond: false });
  const bottom = H - pad;
  for (const g of groups) {
    if (top + 16 > bottom) break;
    ctx.fillStyle = p.card.text;
    ctx.font = `700 12px ${font}`;
    if (g.diamond) {
      ctx.save();
      ctx.translate(left + 6, top + 8);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = accent;
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();
      ctx.fillStyle = p.card.text;
    }
    ctx.fillText(g.title, left + (g.diamond ? 18 : 0), top + 1, innerW - 70);
    if (g.date) {
      ctx.fillStyle = p.card.sub;
      ctx.font = `500 11px ${font}`;
      ctx.textAlign = 'right';
      ctx.fillText(g.date, left + innerW, top + 2);
      ctx.textAlign = 'left';
    }
    top += 18;
    for (const t of g.tasks) {
      if (top + 14 > bottom) break;
      const isDone = t.status === 'done';
      ctx.strokeStyle = isDone ? accent : p.dark ? 'rgba(230,232,236,0.4)' : 'rgba(35,39,46,0.35)';
      ctx.fillStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(left + 10, top + 2, 11, 11, 3);
      if (isDone) ctx.fill();
      else ctx.stroke();
      ctx.fillStyle = isDone ? p.card.sub : p.card.text;
      ctx.font = `500 11.5px ${font}`;
      ctx.fillText(t.title, left + 28, top + 1, innerW - 28 - (t.due ? 46 : 0));
      if (t.due) {
        ctx.fillStyle = p.card.sub;
        ctx.font = `500 10.5px ${font}`;
        ctx.textAlign = 'right';
        ctx.fillText(t.due.slice(5), left + innerW, top + 2);
        ctx.textAlign = 'left';
      }
      top += 16;
    }
    top += 4;
  }
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
  ctx.restore();
}

/** What the board search index sees. */
function searchText(item: ProjectItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.title,
    body: join(
      item.description,
      item.status,
      ...item.tasks.flatMap((t) => [t.title, t.description, ...t.subtasks.map((st) => st.label)]),
      baseText(item),
    ),
  };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: ProjectItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.name ?? item.title;
  const done = item.tasks.filter((t) => t.status === 'done').length;
  out.detail = item.tasks.length ? `${done}/${item.tasks.length} tasks done` : item.status;
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: ProjectItem, _p: PopoutContext): string {
  // Read-only summary: title, status, dates, description, then tasks.
  const tasks = item.tasks;
  const rows = tasks
    .map(
      (t) =>
        `<div class="tkrow${t.status === 'done' ? ' tkdone' : ''}">` +
        `<span class="tkbox">${t.status === 'done' ? '\u2611' : '\u2610'}</span>` +
        `<span class="tkmain"><span class="tklabel">${escapeHtml(t.title)}</span></span>` +
        (t.due ? `<span class="tkdue">${escapeHtml(t.due)}</span>` : '') +
        `</div>`,
    )
    .join('');
  const dates = [item.startDate, item.endDate].some(Boolean)
    ? `<div class="pjdates">${escapeHtml(item.startDate ?? '…')} → ${escapeHtml(item.endDate ?? '…')}</div>`
    : '';
  const desc = item.description ? `<p class="pjdesc">${escapeHtml(item.description)}</p>` : '';
  return (
    `<style>.pjpop{padding:18px 22px;border-radius:12px}.pjpop h1{margin:0 0 6px;font-size:20px}.pjstatus{font-size:12px;opacity:.7;text-transform:capitalize}.pjdates{font-size:13px;opacity:.75;margin:6px 0}.pjdesc{white-space:pre-wrap;opacity:.85}.tkrow{display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid rgba(127,127,127,0.18)}.tkbox{flex:none}.tkmain{flex:1;min-width:0}.tkdue{font-size:12px;opacity:.8;white-space:nowrap}.tkdone .tklabel{text-decoration:line-through;opacity:.6}</style>` +
    `<div class="pjpop"><h1>${escapeHtml(item.title)}</h1><div class="pjstatus">${escapeHtml(item.status)}</div>${dates}${desc}${rows}</div>`
  );
}

export const projectType = defineItemType('project', {
  popout,
  edit: { kind: 'event', event: 'boardcache:edit-project' },
  pdfCategory: 'image',
  meta,
  label: 'Project',
  searchText,
  thumbnail: paint,
  render: ProjectContent,
  card: ProjectCard,
  stage: Stage,
  cardAspect: () => 0.7, // project card
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
