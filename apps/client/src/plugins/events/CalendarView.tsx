import { useRef } from 'react';
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
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { boardEvents, downloadEventsIcs } from '../../lib/export/exportIcs';
import { importIcsFiles } from '../../lib/import/importIcs';
import {
  eventDays,
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
 * The board's calendar: every event card on a month grid, one week, or one
 * day with an hour grid; the picked day's list beneath the grids. Chips,
 * blocks and rows open the editor; the head adds, imports and exports. A
 * full-screen plugin view on the gallery chassis (View → Calendar).
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_H = 48;
const SCOPES: { id: CalendarScope; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'day', label: 'Day' },
];

const parseDay = (key: string) => new Date(`${key}T00:00:00`);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function CalendarView() {
  const events = useDocumentStore(useShallow((s) => sortEvents(boardEvents(s.doc))));
  const month = useEventsUi((s) => s.month);
  const selected = useEventsUi((s) => s.selectedDay);
  const scope = useEventsUi((s) => s.scope);
  const fileInput = useRef<HTMLInputElement>(null);

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
    scope === 'month'
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
    if (scope === 'month') {
      ui.setMonth(localDate(new Date(y, m - 1 + delta, 1)).slice(0, 7));
      return;
    }
    ui.setSelectedDay(localDate(addDays(anchor, delta * (scope === 'week' ? 7 : 1))));
  };
  const open = (ev: EventItem) => useEventsUi.getState().openEdit(ev);
  const back = () => useSessionStore.getState().setView('canvas');
  const listed = byDay.get(selected) ?? [];

  /** A chip's leading text: the start time, or nothing on a later day of a multi-day event. */
  const chipTime = (ev: EventItem, day: string) => {
    if (ev.allDay) return '';
    if (!isMultiDay(ev) || localDate(eventStart(ev)) === day) return formatClock(eventStart(ev));
    return '';
  };

  return (
    <div className="gallery-screen events-screen" data-testid="events-screen">
      <header className="gallery-header events-bar">
        <div className="gallery-header-left">
          <h1>Calendar</h1>
          <span className="events-count" data-testid="events-count">
            {events.length === 1 ? '1 event' : `${events.length} events`}
          </span>
        </div>
        <div className="gallery-actions">
          <button
            type="button"
            className="gallery-action-btn"
            data-testid="events-new"
            onClick={() => useEventsUi.getState().openNew(selected)}
          >
            <PlusIcon size={15} /> <span className="events-label">New event</span>
          </button>
          <button
            type="button"
            className="gallery-action-btn"
            data-testid="events-import"
            onClick={() => fileInput.current?.click()}
          >
            <FolderInputIcon size={15} /> <span className="events-label">Import</span>
          </button>
          <button
            type="button"
            className="gallery-action-btn"
            data-testid="events-export"
            disabled={events.length === 0}
            onClick={() => downloadEventsIcs(events, useDocumentStore.getState().doc)}
          >
            <DownloadIcon size={15} /> <span className="events-label">Export</span>
          </button>
          <ThemeToggle className="gallery-theme-toggle" testId="events-theme-toggle" />
          <button
            type="button"
            className="gallery-back"
            aria-label="Back to canvas"
            title="Back to the canvas"
            data-testid="events-back"
            onClick={back}
          >
            <BoardsIcon size={17} />
          </button>
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
            <h3 data-testid="events-month">{title}</h3>
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
              onClick={() => useEventsUi.getState().setSelectedDay(todayKey)}
            >
              Today
            </button>
          </header>
          {scope !== 'day' && (
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
        </div>
        {scope !== 'day' && (
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
