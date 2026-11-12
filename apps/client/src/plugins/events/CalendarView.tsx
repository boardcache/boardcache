import { useRef } from 'react';
import { ViewBarButton } from '../../components/chrome/ViewBarButton';
import { useShallow } from 'zustand/react/shallow';
import type { EventItem } from '@boardcache/schema';
import {
  BoardsIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FolderInputIcon,
  PlusIcon,
} from '../../components/icons';
import { ThemeToggle } from '../../components/chrome/ThemeToggle';
import { PopOutViewButton } from '../../components/chrome/PopOutViewButton';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { boardEvents, downloadEventsIcs } from '../../lib/export/exportIcs';
import { importIcsFiles } from '../../lib/import/importIcs';
import {
  eventDays,
  eventEnd,
  eventSpanOn,
  eventStart,
  eventTimeLine,
  formatClock,
  isMultiDay,
  localDate,
  sortEvents,
} from '../../lib/structure/events';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useEventsUi } from './store';
import type { CalendarScope } from './store';

/**
 * The board's calendar: every event card on a month grid, one week, one
 * day with an hour grid, or all of them as a list by month; the picked
 * day's list beneath the grids. Chips, blocks and rows open the editor; the
 * bar adds, imports and exports. A full-screen plugin view on the gallery
 * chassis (View → Calendar), with the shared view bar.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_H = 48;
const SCOPES: { id: CalendarScope; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'day', label: 'Day' },
  { id: 'list', label: 'List' },
];

const parseDay = (key: string) => new Date(`${key}T00:00:00`);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function CalendarView() {
  const events = useDocumentStore(useShallow((s) => sortEvents(boardEvents(s.doc))));
  const month = useEventsUi((s) => s.month);
  const selected = useEventsUi((s) => s.selectedDay);
  const scope = useEventsUi((s) => s.scope);
  const fileInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const monthStart = new Date(y, m - 1, 1 - lead);
  const monthCells: Date[] = [];
  for (let i = 0; i < 42; i++) monthCells.push(addDays(monthStart, i));
  // Drop the trailing week when it is entirely next month.
  const monthDays =
    monthCells[35]!.getMonth() === first.getMonth() ? monthCells : monthCells.slice(0, 35);
  const anchor = parseDay(selected);
  const weekStart = addDays(anchor, -((anchor.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const cells = scope === 'month' ? monthDays : weekDays;

  const byDay = new Map<string, EventItem[]>();
  for (const ev of events) {
    for (const day of eventDays(ev)) byDay.set(day, [...(byDay.get(day) ?? []), ev]);
  }
  const todayKey = localDate(new Date());
  const title =
    scope === 'list'
      ? 'All events'
      : scope === 'month'
        ? first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : scope === 'week'
          ? `${weekDays[0]!.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekDays[6]!.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
          : anchor.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            });
  const shift = (delta: number) => {
    const ui = useEventsUi.getState();
    if (scope === 'list') return;
    if (scope === 'month') {
      ui.setMonth(localDate(new Date(y, m - 1 + delta, 1)).slice(0, 7));
      return;
    }
    ui.setSelectedDay(localDate(addDays(anchor, delta * (scope === 'week' ? 7 : 1))));
  };
  const open = (ev: EventItem) => useEventsUi.getState().openEdit(ev);
  const back = () => useSessionStore.getState().setView('canvas');
  const listed = byDay.get(selected) ?? [];
  /** Today: the day picked; in the list, the first event from today scrolled into view. */
  const today = () => {
    useEventsUi.getState().setSelectedDay(todayKey);
    listRef.current
      ?.querySelector('.ev-list-next')
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  /** A chip's leading text: the start time, or nothing on a later day of a multi-day event. */
  const chipTime = (ev: EventItem, day: string) => {
    if (ev.allDay) return '';
    if (!isMultiDay(ev) || localDate(eventStart(ev)) === day) return formatClock(eventStart(ev));
    return '';
  };

  return (
    <div className="gallery-screen events-screen" data-testid="events-screen">
      <header className="gallery-header view-bar events-bar">
        <div className="gallery-header-left">
          <ViewBarButton
            label="Back to canvas"
            icon={<BoardsIcon size={16} />}
            testId="events-back"
            onClick={back}
          />
          <h1>Calendar</h1>
          <span className="view-bar-count" data-testid="events-count">
            {events.length === 1 ? '1 event' : `${events.length} events`}
          </span>
        </div>
        <div className="gallery-actions">
          <ViewBarButton
            label="New event"
            icon={<PlusIcon size={16} />}
            testId="events-new"
            onClick={() => useEventsUi.getState().openNew(selected)}
          />
          <ViewBarButton
            label="Import an .ics file"
            icon={<FolderInputIcon size={16} />}
            testId="events-import"
            onClick={() => fileInput.current?.click()}
          />
          <ViewBarButton
            label="Export the events as .ics"
            icon={<DownloadIcon size={16} />}
            testId="events-export"
            disabled={events.length === 0}
            onClick={() => downloadEventsIcs(events, useDocumentStore.getState().doc)}
          />
          <PopOutViewButton testId="events-popout" />
          <ThemeToggle className="view-icon-btn" testId="events-theme-toggle" />
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept=".ics,text/calendar"
        multiple
        hidden
        data-testid="events-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length)
            void importIcsFiles(
              files,
              clientToCanvas(window.innerWidth / 2, window.innerHeight / 2),
            );
        }}
      />
      <div className="events-body">
        <div className={`ev-cal scope-${scope}`} data-testid="events-calendar">
          <header className="ev-cal-head">
            {scope !== 'list' && (
              <button
                type="button"
                className="ev-cal-nav"
                aria-label={
                  scope === 'month'
                    ? 'Previous month'
                    : scope === 'week'
                      ? 'Previous week'
                      : 'Previous day'
                }
                data-testid="events-prev"
                onClick={() => shift(-1)}
              >
                <ChevronLeftIcon size={16} />
              </button>
            )}
            <h3 data-testid="events-month">{title}</h3>
            {scope !== 'list' && (
              <button
                type="button"
                className="ev-cal-nav"
                aria-label={
                  scope === 'month' ? 'Next month' : scope === 'week' ? 'Next week' : 'Next day'
                }
                data-testid="events-next"
                onClick={() => shift(1)}
              >
                <ChevronRightIcon size={16} />
              </button>
            )}
            <div className="seg ev-cal-scopes" role="group" aria-label="Calendar scope">
              {SCOPES.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  className={scope === sc.id ? 'active' : ''}
                  aria-pressed={scope === sc.id}
                  data-testid={`events-scope-${sc.id}`}
                  onClick={() => useEventsUi.getState().setScope(sc.id)}
                >
                  {sc.label}
                </button>
              ))}
            </div>
            <span className="events-spacer" />
            <button
              type="button"
              className="gallery-action-btn"
              data-testid="events-today"
              onClick={today}
            >
              Today
            </button>
          </header>
          {(scope === 'month' || scope === 'week') && (
            <>
              <div className="ev-cal-weekdays">
                {WEEKDAYS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="ev-cal-grid">
                {cells.map((d) => {
                  const k = localDate(d);
                  const outside = scope === 'month' && d.getMonth() !== first.getMonth();
                  const here = byDay.get(k) ?? [];
                  const cap = scope === 'month' ? 4 : 99;
                  const extra = Math.max(0, here.length - cap);
                  return (
                    <div
                      key={k}
                      className={`ev-cal-day${outside ? ' outside' : ''}${k === todayKey ? ' today' : ''}${selected === k ? ' selected' : ''}`}
                      data-testid={`events-day-${k}`}
                      onClick={() => useEventsUi.getState().setSelectedDay(k)}
                      onDoubleClick={(e) => {
                        // A double-click on the day starts an event on it (a chip's
                        // own click already opened its editor).
                        if ((e.target as HTMLElement).closest('.ev-cal-chip')) return;
                        useEventsUi.getState().openNew(k);
                      }}
                    >
                      <span className="ev-cal-date">
                        {scope === 'week'
                          ? d.toLocaleDateString(undefined, { day: 'numeric' })
                          : d.getDate()}
                      </span>
                      <div className="ev-cal-entries">
                        {here.slice(0, cap).map((ev) => (
                          <button
                            key={ev.id}
                            type="button"
                            className={`ev-cal-chip${ev.allDay || isMultiDay(ev) ? ' ev-cal-chip-band' : ''}`}
                            title={ev.title}
                            data-testid="events-chip"
                            onClick={(e) => {
                              e.stopPropagation();
                              open(ev);
                            }}
                          >
                            {chipTime(ev, k) && (
                              <span className="ev-cal-chip-time">{chipTime(ev, k)}</span>
                            )}
                            <span className="ev-cal-chip-title">{ev.title}</span>
                          </button>
                        ))}
                        {extra > 0 && <span className="ev-cal-more">+{extra} more</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {scope === 'day' && <DayView day={selected} events={listed} />}
          {scope === 'list' && (
            <ListView events={events} today={todayKey} open={open} listRef={listRef} />
          )}
        </div>
        {(scope === 'month' || scope === 'week') && (
          <section className="ev-agenda" data-testid="events-agenda">
            <h3>
              {anchor.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </h3>
            {listed.length === 0 ? (
              <p className="ev-agenda-empty">
                {events.length === 0 ? 'No events on this board yet.' : 'Nothing on this day.'}
              </p>
            ) : (
              <ul className="ev-agenda-list">
                {listed.map((ev) => (
                  <li key={ev.id}>
                    <button
                      type="button"
                      className="ev-agenda-row"
                      data-testid="events-agenda-row"
                      onClick={() => open(ev)}
                    >
                      <span className="ev-agenda-time">{eventTimeLine(ev)}</span>
                      <span className="ev-agenda-title">{ev.title}</span>
                      {ev.location && <span className="ev-agenda-where">{ev.location}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** Every event on the board, by month, past ones softened; the first one
 *  still to come carries `ev-list-next`, where Today scrolls to. */
function ListView({
  events,
  today,
  open,
  listRef,
}: {
  events: EventItem[];
  today: string;
  open: (ev: EventItem) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}) {
  const now = new Date();
  const next = events.find((ev) => eventEnd(ev) > now)?.id ?? null;
  const months: { key: string; label: string; events: EventItem[] }[] = [];
  for (const ev of events) {
    const start = eventStart(ev);
    const key = localDate(start).slice(0, 7);
    let group = months.find((g) => g.key === key);
    if (!group) {
      group = {
        key,
        label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        events: [],
      };
      months.push(group);
    }
    group.events.push(ev);
  }
  const dayLabel = (ev: EventItem) => {
    const s = eventStart(ev);
    if (!isMultiDay(ev))
      return s.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
    const last = new Date(eventEnd(ev).getTime() - 1);
    return `${s.toLocaleDateString(undefined, { day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  };
  return (
    <div className="ev-list" data-testid="events-list" ref={listRef}>
      {months.length === 0 && <p className="ev-agenda-empty">No events on this board yet.</p>}
      {months.map((g) => (
        <section key={g.key} className="ev-list-month" data-testid="events-list-month">
          <h4>{g.label}</h4>
          <ul className="ev-agenda-list">
            {g.events.map((ev) => {
              const past = eventEnd(ev) <= now;
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    className={`ev-agenda-row ev-list-row${past ? ' past' : ''}${ev.id === next ? ' ev-list-next' : ''}${eventDays(ev).includes(today) ? ' today' : ''}`}
                    data-testid="events-list-row"
                    onClick={() => open(ev)}
                  >
                    <span className="ev-list-day">{dayLabel(ev)}</span>
                    <span className="ev-agenda-time">
                      {isMultiDay(ev) && ev.allDay ? 'All day' : eventTimeLine(ev)}
                    </span>
                    <span className="ev-agenda-title">{ev.title}</span>
                    {ev.location && <span className="ev-agenda-where">{ev.location}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One day: an all-day band, then the hours with timed events as blocks
 *  (overlapping ones share the width). Clicking an hour starts a new event. */
function DayView({ day, events }: { day: string; events: EventItem[] }) {
  const now = new Date();
  const isToday = localDate(now) === day;
  const band = events.filter((ev) => ev.allDay);
  const blocks = events
    .map((ev) => ({ ev, span: eventSpanOn(ev, day) }))
    .filter((b): b is { ev: EventItem; span: { from: number; to: number } } => b.span !== null)
    .sort((a, b) => a.span.from - b.span.from);
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
  const open = (ev: EventItem) => useEventsUi.getState().openEdit(ev);
  return (
    <div className="ev-dayview" data-testid="events-dayview">
      <div className="ev-allday">
        <div className="ev-allday-label">All day</div>
        <div className="ev-allday-items">
          {band.length === 0 && <span className="ev-agenda-empty">No all-day events</span>}
          {band.map((ev) => (
            <button
              key={ev.id}
              type="button"
              className="ev-cal-chip ev-cal-chip-band"
              data-testid="events-allday"
              onClick={() => open(ev)}
            >
              <span className="ev-cal-chip-title">{ev.title}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="ev-hours" style={{ height: 24 * HOUR_H }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            className="ev-hour"
            style={{ top: h * HOUR_H, height: HOUR_H }}
            data-testid="events-hour"
            onClick={() => useEventsUi.getState().openNew(day, h)}
          >
            <span className="ev-hour-label">
              {new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}
            </span>
          </div>
        ))}
        {isToday && (
          <div
            className="ev-now"
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
              className={`ev-block${short ? ' short' : ''}`}
              data-testid="events-block"
              style={{
                top: (span.from / 60) * HOUR_H,
                height: Math.max(22, ((span.to - span.from) / 60) * HOUR_H - 2),
                left: `calc(64px + ${(lane / laneCount) * 100}% - ${(lane / laneCount) * 64}px)`,
                width: `calc(${100 / laneCount}% - ${64 / laneCount}px - 8px)`,
              }}
              title={`${ev.title} · ${eventTimeLine(ev)}`}
              onClick={(e) => {
                e.stopPropagation();
                open(ev);
              }}
            >
              <span className="ev-block-time">
                {short ? formatClock(eventStart(ev)) : eventTimeLine(ev)}
              </span>
              <span className="ev-block-title">{ev.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
