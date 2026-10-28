import { useMemo, useState } from 'react';
import type { ProjectItem, ProjectMilestone, ProjectTask } from '@boardcache/schema';
import { ChevronDownIcon, ImageIcon, MilestoneIcon } from '../../components/icons';
import { importImageFiles } from '../../lib/import/importImages';
import { updateItems } from '../../state/commands';
import { renderGanttSnapshot } from './ganttSnapshot';
import {
  dropTaskInSection,
  milestonesOf,
  sortTasks,
  updateMilestone,
  updateTask,
} from '../../lib/structure/projects';
import { useDocumentStore } from '../../state/documentStore';
import { DropSlot, Grip, dateKey, parseDate, startPointerDrag, useTaskDrag } from './dnd';
import { useProjectsUi } from './store';

/**
 * Gantt: milestones as bars (start → end) with their tasks as sub-bars
 * (start → end/due, or a diamond on the due date), on a day-scaled axis with
 * week lines and a today marker. Dependency arrows come from each
 * milestone's `dependsOn` (the arrow runs predecessor → dependent). Drag a bar to move it, drag its right
 * edge to change the end date; edits are labeled undo entries. Task labels
 * drag up/down within their milestone group (manual order) or into another
 * group, with the chart rows reflowing alongside.
 */

/** Pixels per day at each scale: Days reads dates, Weeks is the default, Months surveys a year. */
const SCALE_PX = { days: 64, weeks: 26, months: 9 } as const;
const ROW_H = 34;
const DAY_MS = 86_400_000;

interface Row {
  kind: 'milestone' | 'task' | 'slot';
  id: string;
  /** Milestone id, '' for Tasks (no milestone). */
  group: string;
  label: string;
  start: Date | null;
  end: Date | null;
  /** Task with only a due date → a diamond. */
  point: Date | null;
  status: string;
  milestone?: ProjectMilestone;
  task?: ProjectTask;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export function GanttView({ project }: { project: ProjectItem }) {
  const milestones = milestonesOf(project);
  const [preview, setPreview] = useState<{ id: string; days: number; mode: 'move' | 'end' } | null>(
    null,
  );
  const sort = useProjectsUi((s) => s.sort);
  const scale = useProjectsUi((s) => s.ganttScale);
  const PX_PER_DAY = SCALE_PX[scale];
  const manual = sort === 'manual';
  const drag = useTaskDrag({
    manual,
    vertical: true,
    onDrop: (task, t) => {
      if (t)
        dropTaskInSection(
          project.id,
          task,
          t.key,
          t.beforeId,
          manual,
          milestones.map((m) => m.id),
        );
    },
    onClick: (task) => useProjectsUi.getState().openTask(project.id, task.id),
  });

  const allRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const taskRow = (t: ProjectTask, group: string): Row => {
      const start = parseDate(t.start);
      const end = parseDate(t.end) ?? (start ? parseDate(t.due) : null);
      const point = !start && !parseDate(t.end) ? parseDate(t.due) : null;
      return {
        kind: 'task',
        id: t.id,
        group,
        label: t.title,
        start,
        end,
        point,
        status: t.status,
        task: t,
      };
    };
    for (const m of milestones) {
      out.push({
        kind: 'milestone',
        id: m.id,
        group: m.id,
        label: m.title,
        start: parseDate(m.startDate),
        end: parseDate(m.endDate),
        point: null,
        status: m.status,
        milestone: m,
      });
      for (const t of sortTasks(
        project.tasks.filter((x) => x.milestoneId === m.id),
        sort,
      ))
        out.push(taskRow(t, m.id));
    }
    const backlog = project.tasks.filter(
      (t) => !t.milestoneId || !milestones.some((m) => m.id === t.milestoneId),
    );
    if (backlog.length) {
      out.push({
        kind: 'milestone',
        id: '__backlog',
        group: '',
        label: 'Tasks',
        start: null,
        end: null,
        point: null,
        status: 'planned',
      });
      for (const t of sortTasks(backlog, sort)) out.push(taskRow(t, ''));
    }
    return out;
  }, [project, milestones, sort]);

  // Folded milestones hide their task rows (labels and chart alike).
  const folded = useProjectsUi((s) => s.ganttFolded);
  const visibleRows = useMemo(
    () => allRows.filter((r) => r.kind !== 'task' || !folded.includes(r.group)),
    [allRows, folded],
  );
  // While a label drags, its row lifts out and (in manual order) a slot row
  // opens at the drop position — labels and chart reflow together.
  const dragRow = drag.draggingId
    ? (visibleRows.find((r) => r.kind === 'task' && r.id === drag.draggingId) ?? null)
    : null;
  const rows = useMemo<Row[]>(() => {
    if (!dragRow) return visibleRows;
    const out = visibleRows.filter((r) => r !== dragRow);
    const t = drag.target;
    if (drag.slot === null || !t) return out;
    let at = t.beforeId ? out.findIndex((r) => r.kind === 'task' && r.id === t.beforeId) : -1;
    if (at === -1) {
      let last = -1;
      out.forEach((r, i) => {
        if (r.group === t.key) last = i;
      });
      if (last === -1) return out;
      at = last + 1;
    }
    out.splice(at, 0, {
      kind: 'slot',
      id: '__slot',
      group: t.key,
      label: '',
      start: null,
      end: null,
      point: null,
      status: '',
    });
    return out;
  }, [visibleRows, dragRow, drag.target, drag.slot]);
  // Label groups (milestone + its tasks) are the drop containers.
  const groups = useMemo(() => {
    const out: { key: string; rows: Row[] }[] = [];
    for (const r of rows) {
      if (r.kind === 'milestone') out.push({ key: r.group, rows: [r] });
      else out[out.length - 1]?.rows.push(r);
    }
    return out;
  }, [rows]);

  // Axis range: everything dated, padded a week each side; at least 6 weeks.
  const today = new Date();
  const dated = rows.flatMap((r) => [r.start, r.end, r.point]).filter((d): d is Date => !!d);
  const pStart = parseDate(project.startDate);
  const pEnd = parseDate(project.endDate);
  if (pStart) dated.push(pStart);
  if (pEnd) dated.push(pEnd);
  dated.push(today);
  const maxRaw = new Date(Math.max(...dated.map((d) => d.getTime())));
  const minRaw = new Date(Math.min(...dated.map((d) => d.getTime())));
  const MAX_SPAN = 365;
  const minD = addDays(
    daysBetween(minRaw, maxRaw) > MAX_SPAN ? addDays(maxRaw, -MAX_SPAN) : minRaw,
    -7,
  );
  const maxD = addDays(maxRaw, Math.max(7, 42 - daysBetween(minD, maxRaw)));
  // Snap the axis start to a Monday.
  const axisStart = addDays(minD, -((minD.getDay() + 6) % 7));
  const totalDays = daysBetween(axisStart, maxD) + 1;
  const width = totalDays * PX_PER_DAY;
  const x = (d: Date) => Math.max(0, daysBetween(axisStart, d)) * PX_PER_DAY;

  // Tick columns follow the scale: every day, every week, or every month.
  const weeks: Date[] = [];
  if (scale === 'days') for (let d = axisStart; d < maxD; d = addDays(d, 1)) weeks.push(d);
  else if (scale === 'weeks') for (let d = axisStart; d < maxD; d = addDays(d, 7)) weeks.push(d);
  else
    for (
      let d = new Date(axisStart.getFullYear(), axisStart.getMonth(), 1);
      d < maxD;
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    )
      weeks.push(d < axisStart ? axisStart : d);
  const months: { label: string; x: number }[] = [];
  for (
    let d = new Date(axisStart.getFullYear(), axisStart.getMonth(), 1);
    d < maxD;
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  ) {
    months.push({
      label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
      x: Math.max(0, x(d)),
    });
  }
  // A label needs room: drop any month whose run to the next is narrower than
  // its text (a partial month at the axis start at the Months scale).
  const roomyMonths = months.filter((m, i) => {
    const next = months[i + 1];
    return !next || next.x - m.x >= 96;
  });

  // Dependency arrows between milestones of this project.
  const msIndex = new Map(
    rows.map((r, i) => [r.kind === 'milestone' ? r.id : `task:${r.id}`, i] as const),
  );
  const arrows = milestones
    .flatMap((m) => m.dependsOn.map((preId) => ({ id: `${preId}>${m.id}`, depId: m.id, preId })))
    .map((a) => {
      const dep = rows.find((r) => r.kind === 'milestone' && r.id === a.depId);
      const pre = rows.find((r) => r.kind === 'milestone' && r.id === a.preId);
      if (!dep || !pre || !pre.end || !dep.start) return null;
      const y1 = (msIndex.get(pre.id) ?? 0) * ROW_H + ROW_H / 2;
      const y2 = (msIndex.get(dep.id) ?? 0) * ROW_H + ROW_H / 2;
      const x1 = x(pre.end) + PX_PER_DAY;
      const x2 = x(dep.start);
      const mid = Math.max(x1 + 10, x2 - 10);
      return { id: a.id, d: `M${x1},${y1} H${mid} V${y2} H${x2 - 6}`, x2, y2 };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const shifted = (r: Row) => {
    if (!preview || preview.id !== r.id) return r;
    if (preview.mode === 'move') {
      return {
        ...r,
        start: r.start && addDays(r.start, preview.days),
        end: r.end && addDays(r.end, preview.days),
        point: r.point && addDays(r.point, preview.days),
      };
    }
    return { ...r, end: r.end && addDays(r.end, preview.days) };
  };

  const commit = (r: Row, days: number, mode: 'move' | 'end') => {
    if (days === 0) return;
    if (r.kind === 'milestone' && r.milestone) {
      updateMilestone(
        project.id,
        r.id,
        mode === 'move' ? 'Move milestone' : 'Milestone end',
        (m) => {
          if (mode === 'move' && m.startDate)
            m.startDate = dateKey(addDays(parseDate(m.startDate)!, days));
          if (m.endDate) m.endDate = dateKey(addDays(parseDate(m.endDate)!, days));
        },
      );
    } else if (r.task) {
      updateTask(project.id, r.id, mode === 'move' ? 'Move task' : 'Task end', (t) => {
        if (mode === 'move') {
          if (t.start) t.start = dateKey(addDays(parseDate(t.start)!, days));
          if (t.due) t.due = dateKey(addDays(parseDate(t.due)!, days));
          if (t.end) t.end = dateKey(addDays(parseDate(t.end)!, days));
        } else if (t.end) t.end = dateKey(addDays(parseDate(t.end)!, days));
        else if (t.due) t.due = dateKey(addDays(parseDate(t.due)!, days));
      });
    }
  };

  const beginBarDrag = (e: React.PointerEvent, r: Row, mode: 'move' | 'end') => {
    e.stopPropagation();
    let days = 0;
    startPointerDrag(e, {
      dropSelector: '.gantt-chart',
      onStart: () => setPreview({ id: r.id, days: 0, mode }),
      onMove: (_ev, dx) => {
        days = Math.round(dx / PX_PER_DAY);
        setPreview({ id: r.id, days, mode });
      },
      onDrop: () => {
        setPreview(null);
        commit(r, days, mode);
      },
      onClick: () => {
        if (r.kind === 'milestone' && r.milestone)
          useProjectsUi.getState().openMilestone(project.id, r.id);
        else if (r.task) useProjectsUi.getState().openTask(project.id, r.id);
      },
    });
  };

  const pin = async () => {
    const doc = useDocumentStore.getState().doc;
    const dark = document.documentElement.dataset.theme === 'dark';
    const accent =
      project.color ??
      (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4263eb');
    const snap = await renderGanttSnapshot(doc, project, { dark, accent, sort });
    if (!snap) return;
    const file = new File(
      [snap.blob],
      `timeline-${project.title.replace(/\s+/g, '-').toLowerCase()}.png`,
      { type: 'image/png' },
    );
    // Under the project card, at the chart's logical (CSS-pixel) size so it
    // reads on the wall; the PNG itself is 2× for crispness.
    const bottom = project.y + project.height;
    const [id] = await importImageFiles([file], {
      x: project.x + snap.width / 2,
      y: bottom + 40 + snap.height / 2,
    });
    if (id) {
      updateItems([id], 'Pin timeline', (d) => {
        d.name = `Timeline — ${project.title}`;
        d.x = project.x;
        d.y = bottom + 40;
        d.width = snap.width;
        d.height = snap.height;
      });
    }
  };

  return (
    <div className="gantt" data-testid="projects-gantt">
      <div className="gantt-toolbar">
        <div className="seg gantt-scales" role="group" aria-label="Timeline scale">
          {(['days', 'weeks', 'months'] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              className={scale === sc ? 'active' : ''}
              aria-pressed={scale === sc}
              data-testid={`gantt-scale-${sc}`}
              onClick={() => useProjectsUi.getState().setGanttScale(sc)}
            >
              {sc === 'days' ? 'Days' : sc === 'weeks' ? 'Weeks' : 'Months'}
            </button>
          ))}
        </div>
        <span className="pj-spacer" />
        <button
          type="button"
          className="gallery-action-btn"
          data-testid="gantt-pin"
          onClick={() => void pin()}
        >
          <ImageIcon size={14} /> Pin to board
        </button>
      </div>
      <div className="gantt-main">
        <div className="gantt-labels" style={{ width: 'var(--gantt-label-w)' }}>
          <div className="gantt-axis-spacer" />
          {groups.map((g) => (
            <div
              key={g.key || '__backlog'}
              className={`gantt-group${dragRow && drag.slot === null && drag.target?.key === g.key ? ' drop-over' : ''}`}
              data-drop-key={g.key}
            >
              {g.rows.map((r) =>
                r.kind === 'slot' ? (
                  <DropSlot key="slot" height={ROW_H} />
                ) : (
                  <div
                    key={`${r.kind}-${r.id}`}
                    className={`gantt-label ${r.kind}`}
                    style={{ height: ROW_H }}
                    data-task-id={r.kind === 'task' ? r.id : undefined}
                    data-testid={r.kind === 'task' ? 'gantt-label-task' : 'gantt-label-milestone'}
                    onPointerDown={r.task ? (e) => drag.beginDrag(e, r.task!) : undefined}
                  >
                    {r.kind === 'milestone' &&
                    allRows.some((t) => t.kind === 'task' && t.group === r.group) ? (
                      <button
                        type="button"
                        className={`gantt-fold${folded.includes(r.group) ? ' folded' : ''}`}
                        aria-label={
                          folded.includes(r.group) ? `Unfold ${r.label}` : `Fold ${r.label}`
                        }
                        aria-expanded={!folded.includes(r.group)}
                        data-testid="gantt-fold"
                        onClick={() => useProjectsUi.getState().toggleGanttFold(r.group)}
                      >
                        <ChevronDownIcon size={16} />
                      </button>
                    ) : (
                      r.kind === 'milestone' && <MilestoneIcon size={13} />
                    )}
                    {r.kind === 'task' && <Grip className="gantt-grip" />}
                    {r.kind === 'milestone' && r.milestone ? (
                      <button
                        type="button"
                        className="gantt-label-open"
                        data-testid="gantt-label-open"
                        onClick={() => useProjectsUi.getState().openMilestone(project.id, r.id)}
                      >
                        {r.label}
                      </button>
                    ) : (
                      <span>{r.label}</span>
                    )}
                  </div>
                ),
              )}
            </div>
          ))}
          {dragRow && (
            <div className="gantt-label task dragging" style={drag.ghost(dragRow.id)} aria-hidden>
              <span>{dragRow.label}</span>
            </div>
          )}
        </div>
        <div className="gantt-scroll">
          <div className="gantt-chart" style={{ width, height: rows.length * ROW_H + 40 }}>
            <div className="gantt-axis">
              {roomyMonths.map((m) => (
                <span key={m.label} className="gantt-month" style={{ left: m.x }}>
                  {m.label}
                </span>
              ))}
              {scale !== 'months' &&
                weeks.map((w) => (
                  <span
                    key={dateKey(w)}
                    className={`gantt-week${scale === 'days' && (w.getDay() === 0 || w.getDay() === 6) ? ' weekend' : ''}`}
                    style={{ left: x(w) }}
                    data-testid="gantt-tick"
                  >
                    {scale === 'days'
                      ? `${w.toLocaleDateString(undefined, { weekday: 'narrow' })} ${w.getDate()}`
                      : w.getDate()}
                  </span>
                ))}
            </div>
            {weeks.map((w) => (
              <i key={`l-${dateKey(w)}`} className="gantt-gridline" style={{ left: x(w) }} />
            ))}
            <i
              className="gantt-today"
              style={{ left: x(today) + PX_PER_DAY / 2 }}
              data-testid="gantt-today"
            />
            <svg
              className="gantt-arrows"
              width={width}
              height={rows.length * ROW_H}
              style={{ top: 40 }}
              aria-hidden
            >
              <defs>
                <marker
                  id="gantt-arrowhead"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
                </marker>
              </defs>
              {arrows.map((a) => (
                <path
                  key={a.id}
                  d={a.d}
                  markerEnd="url(#gantt-arrowhead)"
                  data-testid="gantt-arrow"
                />
              ))}
            </svg>
            <div className="gantt-rows" style={{ top: 40 }}>
              {rows.map((raw) => {
                if (raw.kind === 'slot')
                  return (
                    <div
                      key="slot"
                      className="gantt-row gantt-row-slot"
                      style={{ height: ROW_H }}
                    />
                  );
                const r = shifted(raw);
                const dragging = preview?.id === r.id;
                if (r.point) {
                  return (
                    <div key={`${r.kind}-${r.id}`} className="gantt-row" style={{ height: ROW_H }}>
                      <button
                        type="button"
                        className={`gantt-diamond status-${r.status}${dragging ? ' dragging' : ''}`}
                        style={{ left: x(r.point) + PX_PER_DAY / 2 }}
                        title={`${r.label} · due ${dateKey(r.point)}`}
                        data-testid="gantt-diamond"
                        onPointerDown={(e) => beginBarDrag(e, raw, 'move')}
                      />
                    </div>
                  );
                }
                if (!r.start && !r.end) {
                  return (
                    <div key={`${r.kind}-${r.id}`} className="gantt-row" style={{ height: ROW_H }}>
                      {r.id !== '__backlog' && (
                        <button
                          type="button"
                          className="gantt-undated"
                          data-testid="gantt-undated"
                          onClick={() => {
                            if (r.kind === 'milestone')
                              useProjectsUi.getState().openMilestone(project.id, r.id);
                            else useProjectsUi.getState().openTask(project.id, r.id);
                          }}
                        >
                          Set dates
                        </button>
                      )}
                    </div>
                  );
                }
                const s = r.start ?? r.end!;
                const en = r.end ?? r.start!;
                const left = x(s);
                const w = Math.max(PX_PER_DAY, (daysBetween(s, en) + 1) * PX_PER_DAY);
                return (
                  <div key={`${r.kind}-${r.id}`} className="gantt-row" style={{ height: ROW_H }}>
                    <div
                      className={`gantt-bar ${r.kind} status-${r.status}${dragging ? ' dragging' : ''}`}
                      style={{ left, width: w }}
                      title={`${r.label} · ${dateKey(s)} → ${dateKey(en)}`}
                      data-testid={
                        r.kind === 'milestone' ? 'gantt-milestone-bar' : 'gantt-task-bar'
                      }
                      onPointerDown={(e) => beginBarDrag(e, raw, 'move')}
                    >
                      <span className="gantt-bar-label">{r.label}</span>
                      <span
                        className="gantt-bar-handle"
                        data-testid="gantt-bar-end"
                        onPointerDown={(e) => beginBarDrag(e, raw, 'end')}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
