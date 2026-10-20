import type { CanvasDocument, ProjectItem } from '@boardcache/schema';
import { milestonesOf, sortTasks, type TaskSort } from '../../lib/structure/projects';
import { parseDate } from './dnd';

/**
 * Paint a project's timeline to a PNG blob (render-from-data, like the
 * thumbnail painter — never the DOM) so it can be pinned to the board as an
 * image item. Layout mirrors GanttView: labels column, day-scaled axis with
 * week lines and month labels, milestone bars with task sub-bars/diamonds,
 * dependency arrows from each milestone's dependsOn, today marker.
 */

const DAY_MS = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

export interface GanttSnapshotOptions {
  dark: boolean;
  accent: string;
  /** Device pixel ratio for crispness on the canvas. */
  scale?: number;
  /** Task order within each milestone (the view's Sort menu). */
  sort?: TaskSort;
}

export async function renderGanttSnapshot(
  doc: CanvasDocument,
  project: ProjectItem,
  opts: GanttSnapshotOptions,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const PX_PER_DAY = 22;
  const ROW_H = 30;
  const LABEL_W = 180;
  const AXIS_H = 40;
  const PAD = 16;
  const sort = opts.sort ?? 'manual';
  const milestones = milestonesOf(project);

  interface Row {
    kind: 'milestone' | 'task';
    id: string;
    label: string;
    start: Date | null;
    end: Date | null;
    point: Date | null;
    done: boolean;
  }
  const rows: Row[] = [];
  const taskRow = (t: ProjectItem['tasks'][number]): Row => {
    const start = parseDate(t.start);
    const end = parseDate(t.end) ?? (start ? parseDate(t.due) : null);
    const point = !start && !parseDate(t.end) ? parseDate(t.due) : null;
    return { kind: 'task', id: t.id, label: t.title, start, end, point, done: t.status === 'done' };
  };
  for (const m of milestones) {
    rows.push({
      kind: 'milestone',
      id: m.id,
      label: m.title,
      start: parseDate(m.startDate),
      end: parseDate(m.endDate),
      point: null,
      done: m.status === 'done',
    });
    for (const t of sortTasks(
      project.tasks.filter((x) => x.milestoneId === m.id),
      sort,
    ))
      rows.push(taskRow(t));
  }
  const backlog = project.tasks.filter(
    (t) => !t.milestoneId || !milestones.some((m) => m.id === t.milestoneId),
  );
  if (backlog.length) {
    rows.push({
      kind: 'milestone',
      id: '__backlog',
      label: 'Tasks',
      start: null,
      end: null,
      point: null,
      done: false,
    });
    for (const t of sortTasks(backlog, sort)) rows.push(taskRow(t));
  }
  if (rows.length === 0) return null;

  const today = new Date();
  const dated = rows.flatMap((r) => [r.start, r.end, r.point]).filter((d): d is Date => !!d);
  for (const d of [parseDate(project.startDate), parseDate(project.endDate), today])
    if (d) dated.push(d);
  const maxRaw = new Date(Math.max(...dated.map((d) => d.getTime())));
  const minRaw = new Date(Math.min(...dated.map((d) => d.getTime())));
  const MAX_SPAN = 365; // a year ending at the latest date; older outliers clamp
  const minD = addDays(
    daysBetween(minRaw, maxRaw) > MAX_SPAN ? addDays(maxRaw, -MAX_SPAN) : minRaw,
    -3,
  );
  const maxD = addDays(maxRaw, Math.max(3, 28 - daysBetween(minD, maxRaw)));
  const axisStart = addDays(minD, -((minD.getDay() + 6) % 7));
  const totalDays = daysBetween(axisStart, maxD) + 1;
  const chartW = totalDays * PX_PER_DAY;
  const x = (d: Date) => LABEL_W + Math.max(0, daysBetween(axisStart, d)) * PX_PER_DAY;

  const width = LABEL_W + chartW + PAD;
  const height = AXIS_H + rows.length * ROW_H + PAD;
  const canvas = document.createElement('canvas');
  // Browsers cap canvas dimensions (~16k px); a long timeline drops to 1×.
  const scale = width * (opts.scale ?? 2) > 15000 ? 1 : (opts.scale ?? 2);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);

  const bg = opts.dark ? '#1c1f26' : '#ffffff';
  const ink = opts.dark ? '#e6e8ec' : '#23272e';
  const sub = opts.dark ? '#9aa2ad' : '#6b7480';
  const line = opts.dark ? 'rgba(230,232,236,0.12)' : 'rgba(35,39,46,0.12)';
  const accent = opts.accent;
  const font = 'Inter, system-ui, sans-serif';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Axis: month labels + week ticks/lines.
  ctx.textBaseline = 'top';
  ctx.fillStyle = sub;
  ctx.font = `600 10px ${font}`;
  for (
    let d = new Date(axisStart.getFullYear(), axisStart.getMonth(), 1);
    d < maxD;
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  ) {
    ctx.fillText(
      d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }).toUpperCase(),
      Math.max(LABEL_W + 4, x(d) + 4),
      6,
    );
  }
  ctx.font = `500 10px ${font}`;
  for (let d = axisStart; d < maxD; d = addDays(d, 7)) {
    ctx.fillStyle = sub;
    ctx.fillText(String(d.getDate()), x(d) + 4, 22);
    ctx.fillStyle = line;
    ctx.fillRect(x(d), AXIS_H, 1, height - AXIS_H - PAD);
  }
  ctx.fillStyle = line;
  ctx.fillRect(0, AXIS_H - 1, width, 1);
  ctx.fillRect(LABEL_W - 1, 0, 1, height - PAD);

  // Rows.
  rows.forEach((r, i) => {
    const top = AXIS_H + i * ROW_H;
    ctx.fillStyle = line;
    ctx.fillRect(0, top + ROW_H - 1, width, 1);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = r.kind === 'milestone' ? ink : sub;
    ctx.font = `${r.kind === 'milestone' ? 700 : 500} 11px ${font}`;
    ctx.fillText(r.label, r.kind === 'milestone' ? 12 : 26, top + ROW_H / 2, LABEL_W - 36);
    if (r.point) {
      const cx = x(r.point) + PX_PER_DAY / 2;
      ctx.save();
      ctx.translate(cx, top + ROW_H / 2);
      ctx.rotate(Math.PI / 4);
      ctx.globalAlpha = r.done ? 0.55 : 1;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(-5, -5, 10, 10, 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (!r.start && !r.end) return;
    const s = r.start ?? r.end!;
    const e = r.end ?? r.start!;
    const left = x(s);
    const w = Math.max(PX_PER_DAY, (daysBetween(s, e) + 1) * PX_PER_DAY);
    ctx.globalAlpha = r.done ? 0.55 : 1;
    ctx.beginPath();
    ctx.roundRect(left, top + 6, w, ROW_H - 12, 5);
    if (r.kind === 'milestone') {
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.fillStyle = opts.dark ? '#1c1f26' : '#ffffff';
      ctx.font = `600 10.5px ${font}`;
    } else {
      ctx.fillStyle = opts.dark ? 'rgba(230,232,236,0.14)' : 'rgba(35,39,46,0.1)';
      ctx.fill();
      ctx.strokeStyle = opts.dark ? 'rgba(230,232,236,0.3)' : 'rgba(35,39,46,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.font = `500 10.5px ${font}`;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(left + 4, top, w - 8, ROW_H);
    ctx.clip();
    ctx.fillText(r.label, left + 7, top + ROW_H / 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  });

  // Dependency arrows between milestones.
  const rowIndex = new Map(rows.map((r, i) => [`${r.kind}:${r.id}`, i]));
  ctx.strokeStyle = sub;
  ctx.fillStyle = sub;
  ctx.lineWidth = 1.5;
  for (const [depId, preId] of milestones.flatMap((m) =>
    m.dependsOn.map((d) => [m.id, d] as const),
  )) {
    const dep = rows.find((r) => r.kind === 'milestone' && r.id === depId);
    const pre = rows.find((r) => r.kind === 'milestone' && r.id === preId);
    if (!dep?.start || !pre?.end) continue;
    const y1 = AXIS_H + (rowIndex.get(`milestone:${pre.id}`) ?? 0) * ROW_H + ROW_H / 2;
    const y2 = AXIS_H + (rowIndex.get(`milestone:${dep.id}`) ?? 0) * ROW_H + ROW_H / 2;
    const x1 = x(pre.end) + PX_PER_DAY;
    const x2 = x(dep.start);
    const mid = Math.max(x1 + 8, x2 - 8);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(mid, y1);
    ctx.lineTo(mid, y2);
    ctx.lineTo(x2 - 5, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2 - 6, y2 - 4);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - 6, y2 + 4);
    ctx.closePath();
    ctx.fill();
  }

  // Today.
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(x(today) + PX_PER_DAY / 2, 0, 2, height - PAD);
  ctx.globalAlpha = 1;

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), 'image/png'));
  return blob ? { blob, width, height } : null;
}
