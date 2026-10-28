import { eventEnd, eventStart, localDate, localDateTime, normalizeRange } from './events';

/**
 * iCalendar (RFC 5545) in and out, for event items. Reading takes any
 * calendar a mail client or phone exports: folded lines, escaped text,
 * floating, UTC and zoned times, DURATION in place of DTEND, VALARM
 * reminders. Recurrence rules are not expanded: a repeating event imports as
 * its first occurrence. Writing emits timed events in UTC (every calendar
 * app shifts them into the reader's zone) and all-day events as dates.
 */

export interface IcsEvent {
  uid: string | null;
  title: string;
  /** Local wall-clock `YYYY-MM-DDTHH:mm`, or `YYYY-MM-DD` when all-day. */
  start: string;
  /** Inclusive end date for all-day events. */
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  /** Minutes before the start the first display alarm asks for; null = none. */
  remindMinutes: number | null;
}

// --- reading ---------------------------------------------------------------------

/** Join folded continuation lines (CRLF or LF followed by a space or tab). */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((l) => l.length > 0);
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** `DTSTART;TZID=Europe/Paris:20261027T150000` → name, params, value. */
function parseLine(line: string): Prop | null {
  // The value starts at the first ':' outside a double-quoted parameter.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: (rawName ?? '').toUpperCase(), params, value };
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/** The zone's wall clock at an instant, as a UTC timestamp of the same digits. */
function wallClockIn(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
}

/** The instant a wall-clock time in a named zone names (two passes cover DST edges). */
function zonedToInstant(wall: number, timeZone: string): number {
  let instant = wall - (wallClockIn(wall, timeZone) - wall);
  const drift = wallClockIn(instant, timeZone) - wall;
  if (drift !== 0) instant -= drift;
  return instant;
}

/** A DATE or DATE-TIME property → local wall-clock string (+ whether it was a date). */
function readStamp(prop: Prop): { value: string; date: boolean } | null {
  const v = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || prop.params.VALUE === 'DATE') {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { value: `${m[1]}-${m[2]}-${m[3]}`, date: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '00'].map(Number) as number[];
  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
  if (m[7] === 'Z') return { value: localDateTime(new Date(wall)), date: false };
  const tz = prop.params.TZID;
  if (tz) {
    try {
      return { value: localDateTime(new Date(zonedToInstant(wall, tz))), date: false };
    } catch {
      /* unknown zone name: keep the floating wall clock */
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return { value: `${y}-${pad(mo!)}-${pad(d!)}T${pad(h!)}:${pad(mi!)}`, date: false };
}

/** `P1DT2H30M`, `-PT15M`, `P2W` → minutes (signed). */
export function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    v.trim(),
  );
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const [w, d, h, mi, s] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0));
  return sign * (w! * 7 * 1440 + d! * 1440 + h! * 60 + mi! + Math.round(s! / 60));
}

/** Every VEVENT in an iCalendar text, in file order. Anything unreadable is skipped. */
export function parseIcs(text: string): IcsEvent[] {
  const lines = unfold(text);
  const out: IcsEvent[] = [];
  const depth: string[] = [];
  let cur: Record<string, Prop> | null = null;
  let alarm: { trigger: Prop | null; action: string } | null = null;
  let firstAlarm: number | null = null;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      const kind = prop.value.trim().toUpperCase();
      depth.push(kind);
      if (kind === 'VEVENT') {
        cur = {};
        firstAlarm = null;
      } else if (kind === 'VALARM' && cur) alarm = { trigger: null, action: '' };
      continue;
    }
    if (prop.name === 'END') {
      const kind = prop.value.trim().toUpperCase();
      depth.pop();
      if (kind === 'VALARM' && alarm) {
        if (
          firstAlarm === null &&
          alarm.trigger &&
          alarm.action !== 'EMAIL' &&
          !alarm.trigger.params.RELATED?.startsWith('END')
        ) {
          const minutes = parseDuration(alarm.trigger.value);
          if (minutes !== null) firstAlarm = Math.max(0, -minutes);
        }
        alarm = null;
      } else if (kind === 'VEVENT' && cur) {
        const ev = finishEvent(cur, firstAlarm);
        if (ev) out.push(ev);
        cur = null;
      }
      continue;
    }
    if (alarm) {
      if (prop.name === 'TRIGGER') alarm.trigger = prop;
      else if (prop.name === 'ACTION') alarm.action = prop.value.trim().toUpperCase();
      continue;
    }
    if (cur && depth[depth.length - 1] === 'VEVENT' && !(prop.name in cur)) cur[prop.name] = prop;
  }
  return out;
}

function finishEvent(props: Record<string, Prop>, remind: number | null): IcsEvent | null {
  const start = props.DTSTART ? readStamp(props.DTSTART) : null;
  if (!start) return null;
  const allDay = start.date;
  let end: string;
  const endProp = props.DTEND ? readStamp(props.DTEND) : null;
  if (endProp) {
    end = endProp.value;
    // DTEND is exclusive: an all-day event through the 29th says DTEND 30th.
    if (allDay && endProp.date) {
      const d = new Date(`${end}T00:00:00`);
      d.setDate(d.getDate() - 1);
      end = localDate(d);
    }
  } else if (props.DURATION) {
    const minutes = parseDuration(props.DURATION.value) ?? 0;
    const d = new Date(allDay ? `${start.value}T00:00:00` : start.value);
    d.setMinutes(d.getMinutes() + Math.max(0, minutes) - (allDay ? 1 : 0));
    end = allDay ? localDate(d) : localDateTime(d);
  } else {
    end = start.value;
  }
  const range = normalizeRange(start.value, end, allDay);
  return {
    uid: props.UID?.value.trim() || null,
    title: unescapeText(props.SUMMARY?.value ?? '').trim() || 'Event',
    start: range.start,
    end: range.end,
    allDay,
    location: unescapeText(props.LOCATION?.value ?? '').trim(),
    description: unescapeText(props.DESCRIPTION?.value ?? '').trim(),
    remindMinutes: remind,
  };
}

/** Does this text look like a calendar at all? */
export function looksLikeIcs(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(text) && /BEGIN:VEVENT/i.test(text);
}

// --- writing ---------------------------------------------------------------------

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** 75-octet line folding (RFC 5545 §3.1); continuation lines start with a space. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (utf8Length(rest) > 75) {
    let cut = 75;
    while (cut > 0 && utf8Length(rest.slice(0, cut)) > 75) cut--;
    // Never split a surrogate pair.
    if (cut > 0 && /[\uD800-\uDBFF]$/.test(rest.slice(0, cut))) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

const utcStamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const dateStamp = (local: string) => local.slice(0, 10).replace(/-/g, '');

export interface IcsWriteEvent extends IcsEvent {
  /** Stable id used when the event carries no UID of its own. */
  id: string;
}

/** A VCALENDAR holding the given events. `now` stamps DTSTAMP (tests pin it). */
export function writeIcs(
  events: IcsWriteEvent[],
  opts: { name?: string; now?: Date } = {},
): string {
  const stamp = utcStamp(opts.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//boardCache//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (opts.name) lines.push(`X-WR-CALNAME:${escapeText(opts.name)}`);
  for (const ev of events) {
    lines.push('BEGIN:VEVENT', `UID:${ev.uid ?? `${ev.id}@boardcache`}`, `DTSTAMP:${stamp}`);
    if (ev.allDay) {
      // DTEND is exclusive: the day after the inclusive end.
      lines.push(
        `DTSTART;VALUE=DATE:${dateStamp(ev.start)}`,
        `DTEND;VALUE=DATE:${dateStamp(localDate(eventEnd(ev)))}`,
      );
    } else {
      lines.push(`DTSTART:${utcStamp(eventStart(ev))}`, `DTEND:${utcStamp(eventEnd(ev))}`);
    }
    lines.push(`SUMMARY:${escapeText(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.remindMinutes !== null) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(ev.title)}`,
        `TRIGGER:${ev.remindMinutes === 0 ? 'PT0M' : `-PT${ev.remindMinutes}M`}`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
