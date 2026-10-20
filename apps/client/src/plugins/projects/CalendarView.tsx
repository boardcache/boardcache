import { useEffect, useState } from 'react';
import type { ProjectEvent, ProjectItem, ProjectMilestone, ProjectTask } from '@boardcache/schema';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  PlusIcon,
  RssIcon,
} from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { apiFetch } from '../../lib/sync/apiBase';
import { collabActive, useCollabStore } from '../../state/collabStore';
import {
  MILESTONE_STATUS_LABEL,
  eventSpanOn,
  formatDate,
  formatTime,
  isOverdue,
  milestonesOf,
  updateTask,
} from '../../lib/structure/projects';
import { dateKey, parseDate, startPointerDrag } from './dnd';
import { TaskRow } from './ProjectsView';
import { isPhoneViewport } from '../../lib/mobile';
import { useProjectsUi } from './store';

/**
 * Calendar: a month grid. Tasks sit on their due date, milestones on their
 * end date; anything spanning several days is a bar across the week rows.
 * Drag a task chip to another day to re-due it; click to edit.
 * On phones the cells show dots and tapping a day lists it under the grid.
 */
export function CalendarView({ project }: { project: ProjectItem }) {
  const milestones = milestonesOf(project);
  const month = useProjectsUi((s) => s.calendarMonth);
  const setMonth = useProjectsUi((s) => s.setCalendarMonth);
  const scope = useProjectsUi((s) => s.calendarScope);
  const anchor = useProjectsUi((s) => s.calendarDate);
  const setAnchor = useProjectsUi((s) => s.setCalendarDate);
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => dateKey(new Date()));
  const [subscribe, setSubscribe] = useState(false);

  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(y, m - 1, 1);
  // Monday-first grid (ISO week); pad to full weeks.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(y, m - 1, 1 - lead);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++)
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  // Drop the trailing week if it is entirely next month.
  const monthCells = days[35]!.getMonth() === first.getMonth() ? days : days.slice(0, 35);
  // Week / Day scopes anchor on a date: the week is its Monday–Sunday.
  const anchorDate = parseDate(anchor) ?? new Date();
  const weekStart = new Date(
    anchorDate.getFullYear(),
    anchorDate.getMonth(),
    anchorDate.getDate() - ((anchorDate.getDay() + 6) % 7),
  );
  const weekCells = Array.from(
    { length: 7 },
    (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i),
  );
  const cells = scope === 'month' ? monthCells : scope === 'week' ? weekCells : [anchorDate];

  const tasksByDay = new Map<string, ProjectTask[]>();
  for (const t of project.tasks) {
    const d = parseDate(t.due);
    if (!d) continue;
    const k = dateKey(d);
    tasksByDay.set(k, [...(tasksByDay.get(k) ?? []), t]);
  }
  const msByDay = new Map<string, ProjectMilestone[]>();
  for (const ms of milestones) {
    const d = parseDate(ms.endDate);
    if (!d) continue;
    const k = dateKey(d);
    msByDay.set(k, [...(msByDay.get(k) ?? []), ms]);
  }
  // The selected day's list: what is due that day AND what spans it.
  const covers = (s: string | null | undefined, e: string | null | undefined, day: string) =>
    !!s && !!e && s <= day && day <= e;
  const listedTasks = (day: string) =>
    project.tasks.filter((t) => t.due === day || covers(t.start, t.end ?? t.due, day));
  const listedMilestones = (day: string) =>
    milestones.filter((m) => m.endDate === day || covers(m.startDate, m.endDate, day));
  const evByDay = new Map<string, ProjectEvent[]>();
  for (const ev of project.events) {
    const k = ev.start.slice(0, 10);
    evByDay.set(
      k,
      [...(evByDay.get(k) ?? []), ev].sort((a, b) => a.start.localeCompare(b.start)),
    );
  }
  const todayKey = dateKey(new Date());
  // Multi-day entries (a task with start → end/due, a milestone with start →
  // end) become bars laid across the week rows; they leave the day chips.
  const spanning = new Set<string>();
  const weeks: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  type Span = {
    key: string;
    kind: 'ms' | 'task';
    status: string;
    title: string;
    col: number;
    len: number;
    lane: number;
    open: () => void;
  };
  const spansByWeek: Span[][] = weeks.map(() => []);
  const spanLanes: number[] = weeks.map(() => 0);
  const place = (
    key: string,
    kind: 'ms' | 'task',
    status: string,
    title: string,
    s: Date,
    e: Date,
    open: () => void,
  ) => {
    weeks.forEach((week, wi) => {
      const first = week[0]!;
      const last = week[week.length - 1]!;
      if (e < first || s > last) return;
      const from = s < first ? first : s;
      const to = e > last ? last : e;
      const col = (from.getDay() + 6) % 7;
      const len = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
      const taken = spansByWeek[wi]!;
      let lane = 0;
      while (taken.some((x) => x.lane === lane && x.col < col + len && col < x.col + x.len)) lane++;
      taken.push({ key: `${key}-${wi}`, kind, status, title, col, len, lane, open });
      spanLanes[wi] = Math.max(spanLanes[wi]!, lane + 1);
    });
  };
  for (const ms of milestones) {
    const s = parseDate(ms.startDate);
    const e = parseDate(ms.endDate);
    if (s && e && e > s) {
      spanning.add(`m-${ms.id}`);
      place(`m-${ms.id}`, 'ms', ms.status, ms.title, s, e, () =>
        useProjectsUi.getState().openMilestone(project.id, ms.id),
      );
    }
  }
  for (const t of project.tasks) {
    const s = parseDate(t.start);
    const e = parseDate(t.end) ?? parseDate(t.due);
    if (s && e && e > s) {
      spanning.add(`t-${t.id}`);
      place(`t-${t.id}`, 'task', t.status, t.title, s, e, () =>
        useProjectsUi.getState().openTask(project.id, t.id),
      );
    }
  }
  /** Desktop chips open their detail; on a phone the tap falls through to the day cell, which lists the day below. */
  const openOnDesktop = (e: React.MouseEvent, open: () => void) => {
    if (isPhoneViewport()) return;
    e.stopPropagation();
    open();
  };
  const title =
    scope === 'month'
      ? first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : scope === 'week'
        ? `${weekCells[0]!.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekCells[6]!.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
        : anchorDate.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          });
  const shift = (delta: number) => {
    if (scope === 'month') {
      const d = new Date(y, m - 1 + delta, 1);
      setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      return;
    }
    const d = new Date(
      anchorDate.getFullYear(),
      anchorDate.getMonth(),
      anchorDate.getDate() + delta * (scope === 'week' ? 7 : 1),
    );
    setAnchor(dateKey(d));
  };

  const beginDrag = (e: React.PointerEvent, task: ProjectTask) => {
    startPointerDrag(e, {
      dropSelector: '[data-cal-day]',
      onStart: () => setDragging({ id: task.id, x: 0, y: 0 }),
      onMove: (ev, dx, dy) => {
        setDragging({ id: task.id, x: dx, y: dy });
        const day = document
          .elementsFromPoint(ev.clientX, ev.clientY)
          .map((el) => (el as HTMLElement).closest?.('[data-cal-day]') as HTMLElement | null)
          .find(Boolean);
        setOverDay(day?.dataset.calDay ?? null);
      },
      onDrop: (_ev, target) => {
        const day = target?.dataset.calDay;
        setDragging(null);
        setOverDay(null);
        if (day && day !== task.due) {
          updateTask(project.id, task.id, 'Reschedule task', (t) => {
            t.due = day;
          });
        }
      },
      // Desktop opens the task; a phone lists its day below the grid instead.
      onClick: () =>
        isPhoneViewport()
          ? setSelected(task.due ?? null)
          : useProjectsUi.getState().openTask(project.id, task.id),
    });
  };

  return (
    <div className={`calendar scope-${scope}`} data-testid="projects-calendar">
      <header className="calendar-head">
        <button
          type="button"
          className="projects-section-edit"
          aria-label="Previous month"
          data-testid="calendar-prev"
          onClick={() => shift(-1)}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <h3 data-testid="calendar-title">{title}</h3>
        <button
          type="button"
          className="projects-section-edit"
          aria-label="Next month"
          data-testid="calendar-next"
          onClick={() => shift(1)}
        >
          <ChevronRightIcon size={16} />
        </button>
        <div
          className="library-view-switch calendar-scopes"
          role="group"
          aria-label="Calendar scope"
        >
          {(['month', 'week', 'day'] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              className={scope === sc ? 'active' : ''}
              aria-pressed={scope === sc}
              data-testid={`calendar-scope-${sc}`}
              onClick={() => useProjectsUi.getState().setCalendarScope(sc)}
            >
              {sc === 'month' ? 'Month' : sc === 'week' ? 'Week' : 'Day'}
            </button>
          ))}
        </div>
        <span className="pj-spacer" />
        <button
          type="button"
          className="gallery-action-btn"
          data-testid="calendar-new-event"
          onClick={() =>
            useProjectsUi
              .getState()
              .openNewEvent(project.id, scope === 'month' ? (selected ?? anchor) : anchor)
          }
        >
          <PlusIcon size={14} /> <span className="pj-label">New event</span>
        </button>
        {collabActive() && (
          <button
            type="button"
            className="gallery-action-btn"
            data-testid="calendar-subscribe"
            onClick={() => setSubscribe(true)}
          >
            <RssIcon size={14} /> <span className="pj-label">Subscribe</span>
          </button>
        )}
        <button
          type="button"
          className="gallery-action-btn"
          data-testid="calendar-today"
          onClick={() => {
            setAnchor(todayKey);
            setSelected(todayKey);
          }}
        >
          Today
        </button>
      </header>
      {subscribe && <SubscribeDialog onClose={() => setSubscribe(false)} />}
      {scope !== 'day' && (
        <div className="calendar-weekdays">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      )}
      {scope !== 'day' && (
        <div className="calendar-grid">
          {weeks.map((week, wi) => (
            <div
              key={wi}
              className="calendar-week"
              style={{ ['--span-lanes' as string]: spanLanes[wi] }}
            >
              <div className="calendar-spans" aria-hidden={false}>
                {(spansByWeek[wi] ?? []).map((sp) => (
                  <button
                    key={sp.key}
                    type="button"
                    className={`calendar-span ${sp.kind} status-${sp.status}`}
                    style={{
                      left: `${(sp.col / 7) * 100}%`,
                      width: `${(sp.len / 7) * 100}%`,
                      top: sp.lane * 20,
                    }}
                    title={sp.title}
                    data-testid={
                      sp.kind === 'ms' ? 'calendar-span-milestone' : 'calendar-span-task'
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isPhoneViewport()) {
                        sp.open();
                        return;
                      }
                      // Phones list the day under the pointer, from the bar's position within its week.
                      const row = (
                        e.currentTarget.parentElement as HTMLElement
                      ).getBoundingClientRect();
                      const col = Math.min(
                        6,
                        Math.max(0, Math.floor(((e.clientX - row.left) / row.width) * 7)),
                      );
                      const d = week[col];
                      if (d) {
                        setSelected(dateKey(d));
                        useProjectsUi.getState().setCalendarFocus(dateKey(d));
                      }
                    }}
                  >
                    {sp.kind === 'ms' && <i className="calendar-diamond" aria-hidden />}
                    <span className="calendar-span-title">{sp.title}</span>
                  </button>
                ))}
              </div>
              {week.map((d) => {
                const k = dateKey(d);
                const outside = scope === 'month' && d.getMonth() !== first.getMonth();
                const ts = tasksByDay.get(k) ?? [];
                const ms = msByDay.get(k) ?? [];
                const evs = evByDay.get(k) ?? [];
                const shown = [
                  ...ms
                    .filter((x) => !spanning.has(`m-${x.id}`))
                    .map((x) => ({ kind: 'ms' as const, ms: x })),
                  ...evs.map((ev) => ({ kind: 'ev' as const, ev })),
                  ...ts
                    .filter((t) => !spanning.has(`t-${t.id}`))
                    .map((t) => ({ kind: 'task' as const, t })),
                ];
                const cap = scope === 'month' ? 4 : 99;
                const extra = Math.max(0, shown.length - cap);
                return (
                  <div
                    key={k}
                    className={`calendar-day${outside ? ' outside' : ''}${k === todayKey ? ' today' : ''}${selected === k ? ' selected' : ''}${overDay === k ? ' drop-over' : ''}`}
                    data-cal-day={k}
                    data-testid={`calendar-day-${k}`}
                    onClick={() => {
                      setSelected(k);
                      useProjectsUi.getState().setCalendarFocus(k); // Day / Week follow the tapped day
                    }}
                  >
                    <span className="calendar-date">{d.getDate()}</span>
                    <div className="calendar-entries">
                      {shown.slice(0, cap).map((entry) =>
                        entry.kind === 'ev' ? (
                          <button
                            key={`e-${entry.ev.id}`}
                            type="button"
                            className="calendar-chip calendar-event"
                            data-testid="calendar-event"
                            onClick={(e) =>
                              openOnDesktop(e, () =>
                                useProjectsUi.getState().openEvent(project.id, entry.ev.id),
                              )
                            }
                          >
                            <span className="calendar-event-time">
                              {formatTime(entry.ev.start)}
                            </span>{' '}
                            {entry.ev.title}
                          </button>
                        ) : entry.kind === 'ms' ? (
                          <button
                            key={`m-${entry.ms.id}`}
                            type="button"
                            className={`calendar-chip calendar-ms status-${entry.ms.status}`}
                            data-testid="calendar-milestone"
                            onClick={(e) =>
                              openOnDesktop(e, () =>
                                useProjectsUi.getState().openMilestone(project.id, entry.ms.id),
                              )
                            }
                          >
                            <i className="calendar-diamond" aria-hidden /> {entry.ms.title}
                          </button>
                        ) : (
                          <div
                            key={entry.t.id}
                            className={`calendar-chip status-${entry.t.status}${dragging?.id === entry.t.id ? ' dragging' : ''}`}
                            data-testid="calendar-task"
                            style={
                              dragging?.id === entry.t.id
                                ? { transform: `translate(${dragging.x}px, ${dragging.y}px)` }
                                : undefined
                            }
                            onPointerDown={(e) => beginDrag(e, entry.t)}
                          >
                            {entry.t.title}
                          </div>
                        ),
                      )}
                      {extra > 0 && <span className="calendar-more">+{extra}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {scope === 'day' ? (
        <DayView
          project={project}
          day={anchor}
          tasks={listedTasks(anchor)}
          milestones={listedMilestones(anchor)}
        />
      ) : (
        selected &&
        cells.some((d) => dateKey(d) === selected) && (
          <Agenda
            project={project}
            day={selected}
            tasks={listedTasks(selected)}
            milestones={listedMilestones(selected)}
            events={evByDay.get(selected) ?? []}
          />
        )
      )}
    </div>
  );
}

/** The selected day's items, listed under the grid (phones). */
function Agenda({
  project,
  day,
  tasks,
  milestones,
  events = [],
}: {
  project: ProjectItem;
  day: string;
  tasks: ProjectTask[];
  milestones: ProjectMilestone[];
  events?: ProjectEvent[];
}) {
  const label =
    parseDate(day)?.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }) ?? day;
  const count = tasks.length + milestones.length + events.length;
  return (
    <section className="projects-section calendar-agenda" data-testid="calendar-agenda">
      <div className="projects-section-head">
        <h3>{label}</h3>
        {count > 0 && <span className="projects-section-count">{count}</span>}
      </div>
      <div className="projects-tasks">
        {milestones.map((ms) => (
          <button
            key={ms.id}
            type="button"
            className={`projects-task projects-task-main calendar-agenda-ms status-${ms.status}`}
            data-testid="calendar-agenda-milestone"
            onClick={() => useProjectsUi.getState().openMilestone(project.id, ms.id)}
          >
            <i className="calendar-diamond lg" aria-hidden />
            <span className="projects-task-title">{ms.title}</span>
            <span className={`project-status status-${ms.status}`}>
              {MILESTONE_STATUS_LABEL[ms.status]}
            </span>
            <span className="pj-spacer" />
            {ms.endDate && (
              <span
                className={`projects-task-due${isOverdue(ms.endDate, ms.status === 'done') ? ' overdue' : ''}`}
              >
                {formatDate(ms.endDate)}
              </span>
            )}
          </button>
        ))}
        {events.map((ev) => (
          <EventRow key={ev.id} project={project} event={ev} />
        ))}
        {tasks.map((t) => (
          <TaskRow key={t.id} project={project} task={t} />
        ))}
        {count === 0 && <div className="calendar-agenda-empty">Nothing due</div>}
      </div>
    </section>
  );
}

/**
 * Calendar subscription (team boards): the board's schedule as an iCalendar
 * feed with a secret link — add it to Apple Calendar, Google Calendar (From
 * URL) or Outlook. Regenerating the link revokes the old one.
 */
function SubscribeDialog({ onClose }: { onClose: () => void }) {
  const boardId = useCollabStore((s) => s.boardId);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = async (rotate: boolean) => {
    if (!boardId) return;
    try {
      let r = rotate
        ? await apiFetch(`/api/team/${boardId}/calendar-token`, {
            method: 'POST',
            credentials: 'include',
          })
        : await apiFetch(`/api/team/${boardId}/calendar-token`, { credentials: 'include' });
      let data = (await r.json()) as { url: string | null };
      if (!rotate && r.ok && !data.url) {
        r = await apiFetch(`/api/team/${boardId}/calendar-token`, {
          method: 'POST',
          credentials: 'include',
        });
        data = (await r.json()) as { url: string | null };
      }
      if (!r.ok || !data.url) throw new Error('Could not create the calendar link.');
      setError(null);
      setUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the calendar link.');
    }
  };
  useEffect(() => {
    const id = setTimeout(() => void load(false), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);
  const webcal = url ? url.replace(/^https?:/, 'webcal:') : null;
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <UiDialog
      title="Subscribe to this calendar"
      onClose={onClose}
      className="tier-sheet"
      testId="calendar-subscribe-dialog"
    >
      <div className="plugin-settings">
        <p className="pj-hint">
          Milestones and dated tasks from every project on this board, as a calendar feed. Add the
          address to Apple Calendar, Google Calendar (“From URL”) or Outlook; it updates as the
          board changes.
        </p>
        <label className="settings-row settings-row-top">
          <span>Address</span>
          <div className="pj-subscribe">
            <input
              className="tag-input"
              readOnly
              value={url ?? error ?? 'Creating link'}
              data-testid="calendar-subscribe-url"
              onFocus={(e) => e.target.select()}
            />
            <div className="pj-subscribe-actions">
              <button
                type="button"
                className="suggest-conn-btn"
                disabled={!url}
                data-testid="calendar-subscribe-copy"
                onClick={() => void copy()}
              >
                <CopyIcon size={13} /> {copied ? 'Copied' : 'Copy'}
              </button>
              {webcal && (
                <a
                  className="suggest-conn-btn"
                  href={webcal}
                  data-testid="calendar-subscribe-webcal"
                >
                  Open in calendar app
                </a>
              )}
            </div>
          </div>
        </label>
        <p className="pj-hint">
          Anyone with the address can read this board’s schedule. Regenerating it revokes the old
          address.
        </p>
        <div className="pj-dialog-actions">
          <button
            type="button"
            className="suggest-conn-btn pj-danger"
            disabled={!boardId}
            data-testid="calendar-subscribe-rotate"
            onClick={() => void load(true)}
          >
            Regenerate address
          </button>
          <span className="pj-spacer" />
          <button type="button" className="suggest-conn-btn pj-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

/** An event as a list row (the agenda): time, title. */
function EventRow({ project, event }: { project: ProjectItem; event: ProjectEvent }) {
  return (
    <button
      type="button"
      className="projects-task projects-task-main calendar-agenda-ms calendar-agenda-event"
      data-testid="calendar-agenda-event"
      onClick={() => useProjectsUi.getState().openEvent(project.id, event.id)}
    >
      <ClockIcon size={14} />
      <span className="projects-task-title">{event.title}</span>
      <span className="pj-spacer" />
      <span className="projects-task-due">
        {formatTime(event.start)} – {formatTime(event.end)}
      </span>
    </button>
  );
}

const HOUR_H = 48;

/**
 * Day scope: an all-day band (milestones and tasks — dated, not timed) over
 * an hour grid where events sit by their times. Click an empty hour to add
 * an event there.
 */
function DayView({
  project,
  day,
  tasks,
  milestones,
}: {
  project: ProjectItem;
  day: string;
  tasks: ProjectTask[];
  milestones: ProjectMilestone[];
}) {
  const now = new Date();
  const isToday = dateKey(now) === day;
  const blocks = project.events
    .map((ev) => ({ ev, span: eventSpanOn(ev, day) }))
    .filter((b): b is { ev: ProjectEvent; span: { from: number; to: number } } => b.span !== null)
    .sort((a, b) => a.span.from - b.span.from);
  // Overlapping events share the width: greedy lanes.
  const lanes: { from: number; to: number }[][] = [];
  const placed = blocks.map((b) => {
    let lane = lanes.findIndex((l) => l.every((x) => x.to <= b.span.from || x.from >= b.span.to));
    if (lane === -1) {
      lanes.push([]);
      lane = lanes.length - 1;
    }
    lanes[lane]!.push(b.span);
    return { ...b, lane };
  });
  const laneCount = Math.max(1, lanes.length);
  const allDay = milestones.length + tasks.length;
  return (
    <div className="calendar-dayview" data-testid="calendar-dayview">
      <div className="calendar-allday">
        <div className="calendar-allday-label">All day</div>
        <div className="calendar-allday-items">
          {allDay === 0 && (
            <span className="calendar-agenda-empty">No tasks or milestones due</span>
          )}
          {milestones.map((ms) => (
            <button
              key={ms.id}
              type="button"
              className={`calendar-chip calendar-ms status-${ms.status}`}
              data-testid="calendar-day-milestone"
              onClick={() => useProjectsUi.getState().openMilestone(project.id, ms.id)}
            >
              <i className="calendar-diamond" aria-hidden /> {ms.title}
            </button>
          ))}
          {tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`calendar-chip status-${t.status}`}
              data-testid="calendar-day-task"
              onClick={() => useProjectsUi.getState().openTask(project.id, t.id)}
            >
              {t.title}
            </button>
          ))}
        </div>
      </div>
      <div className="calendar-hours" style={{ height: 24 * HOUR_H }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            className="calendar-hour"
            style={{ top: h * HOUR_H, height: HOUR_H }}
            data-testid="calendar-hour"
            onClick={() => useProjectsUi.getState().openNewEvent(project.id, day)}
          >
            <span className="calendar-hour-label">
              {new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}
            </span>
          </div>
        ))}
        {isToday && (
          <div
            className="calendar-now"
            style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H }}
            aria-hidden
          />
        )}
        {placed.map(({ ev, span, lane }) => {
          const short = ((span.to - span.from) / 60) * HOUR_H < 40;
          return (
            <button
              key={ev.id}
              type="button"
              className={`calendar-block${short ? ' short' : ''}`}
              data-testid="calendar-block"
              style={{
                top: (span.from / 60) * HOUR_H,
                height: Math.max(22, ((span.to - span.from) / 60) * HOUR_H - 2),
                left: `calc(64px + ${(lane / laneCount) * 100}% - ${(lane / laneCount) * 64}px)`,
                width: `calc(${100 / laneCount}% - ${64 / laneCount}px - 8px)`,
              }}
              title={`${ev.title} · ${formatTime(ev.start)} – ${formatTime(ev.end)}`}
              onClick={(e) => {
                e.stopPropagation();
                useProjectsUi.getState().openEvent(project.id, ev.id);
              }}
            >
              <span className="calendar-block-time">
                {short ? formatTime(ev.start) : `${formatTime(ev.start)} – ${formatTime(ev.end)}`}
              </span>
              <span className="calendar-block-title">{ev.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
