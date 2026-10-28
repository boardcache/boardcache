import type { EventItem } from '@boardcache/schema';

/**
 * Calendar events: the dates they carry and the words the card shows.
 * Times are local wall-clock strings (`YYYY-MM-DDTHH:mm`) and all-day
 * events hold plain dates (`YYYY-MM-DD`) with an inclusive end, so the
 * same card reads the same on every device. Shared by the canvas card,
 * the thumbnail painter, the calendar view and the iCalendar bridge.
 */

export const EVENT_CARD_W = 240;
export const EVENT_CARD_H = 300;

/** Reminder choices, in menu order (minutes before the start). */
export const REMIND_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'None' },
  { value: 0, label: 'At the start' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
  { value: 10080, label: '1 week before' },
];

export function remindLabel(minutes: number | null): string {
  const hit = REMIND_OPTIONS.find((o) => o.value === minutes);
  if (hit) return hit.label;
  if (minutes === null) return 'None';
  if (minutes % 1440 === 0) return `${minutes / 1440} days before`;
  if (minutes % 60 === 0) return `${minutes / 60} hours before`;
  return `${minutes} minutes before`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of a Date, in local time. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DDTHH:mm` of a Date, in local time. */
export function localDateTime(d: Date): string {
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The Date a local wall-clock string names (today 09:00 when unreadable). */
function parseLocal(value: string): Date {
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (!Number.isNaN(d.getTime())) return d;
  const fallback = new Date();
  fallback.setHours(9, 0, 0, 0);
  return fallback;
}

/** When the event begins, as an instant on this device. */
export function eventStart(ev: Pick<EventItem, 'start' | 'allDay'>): Date {
  return parseLocal(ev.allDay ? ev.start.slice(0, 10) : ev.start);
}

/** When the event is over: all-day ends are inclusive, so midnight after. */
export function eventEnd(ev: Pick<EventItem, 'end' | 'allDay'>): Date {
  const d = parseLocal(ev.allDay ? ev.end.slice(0, 10) : ev.end);
  if (ev.allDay) d.setDate(d.getDate() + 1);
  return d;
}

/** Every local date (`YYYY-MM-DD`) the event touches, in order. */
export function eventDays(ev: Pick<EventItem, 'start' | 'end' | 'allDay'>): string[] {
  const first = eventStart(ev);
  const last = new Date(eventEnd(ev).getTime() - 1);
  const out: string[] = [];
  const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  while (cursor <= last && out.length < 366) {
    out.push(localDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out.length ? out : [localDate(first)];
}

export function isMultiDay(ev: Pick<EventItem, 'start' | 'end' | 'allDay'>): boolean {
  return eventDays(ev).length > 1;
}

/** Over and done: the event ended before now. */
export function isPastEvent(ev: Pick<EventItem, 'end' | 'allDay'>, now = new Date()): boolean {
  return eventEnd(ev) <= now;
}

/** "3:00 PM" in the viewer's locale. */
export function formatClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function shortDate(d: Date, year: boolean): string {
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
  });
}

/** The card's time band: "3:00 PM - 4:00 PM", "All day", or the span for a
 *  multi-day event ("Oct 27 – Oct 29", "Oct 27, 3:00 PM – Oct 29, 4:00 PM"). */
export function eventTimeLine(ev: Pick<EventItem, 'start' | 'end' | 'allDay'>): string {
  const s = eventStart(ev);
  if (!isMultiDay(ev)) {
    if (ev.allDay) return 'All day';
    const e = parseLocal(ev.end);
    return e > s ? `${formatClock(s)} - ${formatClock(e)}` : formatClock(s);
  }
  const last = new Date(eventEnd(ev).getTime() - 1);
  const sameYear = s.getFullYear() === last.getFullYear();
  if (ev.allDay) return `${shortDate(s, !sameYear)} – ${shortDate(last, !sameYear)}`;
  const e = parseLocal(ev.end);
  return `${shortDate(s, !sameYear)}, ${formatClock(s)} – ${shortDate(e, !sameYear)}, ${formatClock(e)}`;
}

/** The leaf's parts: year band, weekday, day number and month. */
export function eventLeaf(ev: Pick<EventItem, 'start' | 'allDay'>): {
  year: string;
  weekday: string;
  day: string;
  month: string;
} {
  const s = eventStart(ev);
  return {
    year: String(s.getFullYear()),
    weekday: s.toLocaleDateString(undefined, { weekday: 'long' }),
    day: String(s.getDate()),
    month: s.toLocaleDateString(undefined, { month: 'long' }),
  };
}

/** One line for captions and the lightbox panel: "Tue, Oct 27 · 3:00 PM - 4:00 PM". */
export function eventDetailLine(ev: Pick<EventItem, 'start' | 'end' | 'allDay'>): string {
  const s = eventStart(ev);
  const sameYear = s.getFullYear() === new Date().getFullYear();
  const date = s.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return isMultiDay(ev) ? eventTimeLine(ev) : `${date} · ${eventTimeLine(ev)}`;
}

/** The local wall-clock string `minutes` after another. */
export function addMinutesLocal(local: string, minutes: number): string {
  const d = parseLocal(local);
  d.setMinutes(d.getMinutes() + minutes);
  return localDateTime(d);
}

/** Round a Date up to the next quarter hour (the default start of a new event). */
export function nextQuarterHour(from = new Date()): Date {
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}

/** Keep `end` after `start`; a timed event that would end first is given an hour. */
export function normalizeRange(
  start: string,
  end: string,
  allDay: boolean,
): { start: string; end: string } {
  if (allDay) {
    const s = start.slice(0, 10);
    const e = end.slice(0, 10);
    return { start: s, end: e >= s ? e : s };
  }
  const s = start.length === 10 ? `${start}T09:00` : start.slice(0, 16);
  const e = end.length === 10 ? `${end}T10:00` : end.slice(0, 16);
  return { start: s, end: e > s ? e : addMinutesLocal(s, 60) };
}

/** When the reminder is due, as an instant; null when the event has none. */
export function reminderAt(
  ev: Pick<EventItem, 'start' | 'allDay' | 'remindMinutes'>,
): number | null {
  if (ev.remindMinutes === null) return null;
  return eventStart(ev).getTime() - ev.remindMinutes * 60_000;
}

/** Events in start order. */
export function sortEvents<T extends Pick<EventItem, 'start' | 'allDay'>>(events: T[]): T[] {
  return [...events].sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
}

/** Minutes since midnight that a timed event covers on a day (clamped to the day); null when it does not touch it. */
export function eventSpanOn(
  ev: Pick<EventItem, 'start' | 'end' | 'allDay'>,
  dayKey: string,
): { from: number; to: number } | null {
  if (ev.allDay) return null;
  const s = eventStart(ev);
  const e = eventEnd(ev);
  const day0 = new Date(`${dayKey}T00:00:00`);
  const day1 = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + 1);
  if (e <= day0 || s >= day1) return null;
  const from = Math.max(0, (Math.max(s.getTime(), day0.getTime()) - day0.getTime()) / 60000);
  const to = Math.min(1440, (Math.min(e.getTime(), day1.getTime()) - day0.getTime()) / 60000);
  return { from, to: Math.max(to, from + 15) };
}
