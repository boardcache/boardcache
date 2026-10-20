import type { TimeItem } from '@boardcache/schema';

/**
 * Pure time-widget arithmetic. Every widget's "running" state is absolute
 * wall-clock timestamps in the item, so all of this derives display state
 * from (item, now) — no intervals, no hidden state, survives reloads and
 * syncs cleanly.
 */

export interface ClockParts {
  hours: number; // 0-23 in the target zone
  minutes: number;
  seconds: number;
  /** Formatted per options (locale-aware 12/24h). */
  text: string;
  /** Short zone label, e.g. "GMT+9" or "PST". */
  zone: string;
}

export function clockParts(item: TimeItem, now: Date): ClockParts {
  const timeZone = item.timezone ?? undefined;
  const fmt = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(item.showSeconds ? { second: '2-digit' } : {}),
    ...(item.hour12 !== null ? { hour12: item.hour12 } : {}),
    ...(timeZone ? { timeZone } : {}),
  });
  const zoneFmt = new Intl.DateTimeFormat(undefined, {
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  });
  const numeric = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(now);
  const get = (type: string) => Number(numeric.find((p) => p.type === type)?.value ?? 0);
  return {
    hours: get('hour') % 24,
    minutes: get('minute'),
    seconds: get('second'),
    text: fmt.format(now),
    zone: zoneFmt.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '',
  };
}

/** Milliseconds → clamped display fields. */
export interface Duration {
  negative: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}

export function splitDuration(ms: number): Duration {
  const negative = ms < 0;
  let rest = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(rest / 86_400);
  rest -= days * 86_400;
  const hours = Math.floor(rest / 3600);
  rest -= hours * 3600;
  const minutes = Math.floor(rest / 60);
  const seconds = rest - minutes * 60;
  return { negative, days, hours, minutes, seconds, totalMs: ms };
}

const two = (n: number) => String(n).padStart(2, '0');

/** "3d 04:05:06" / "04:05:06" / "05:06" — compact, leading units dropped. */
export function formatDuration(d: Duration, opts: { showSeconds?: boolean } = {}): string {
  const showSeconds = opts.showSeconds ?? true;
  const core =
    d.days > 0
      ? `${d.days}d ${two(d.hours)}:${two(d.minutes)}${showSeconds ? `:${two(d.seconds)}` : ''}`
      : d.hours > 0
        ? `${two(d.hours)}:${two(d.minutes)}${showSeconds ? `:${two(d.seconds)}` : ''}`
        : `${two(d.minutes)}:${two(d.seconds)}`;
  return d.negative ? `-${core}` : core;
}

/** Countdown remaining (negative once past the target). */
export function countdownRemainingMs(item: TimeItem, now: Date): number | null {
  if (!item.targetAt) return null;
  const target = Date.parse(item.targetAt);
  if (Number.isNaN(target)) return null;
  return target - now.getTime();
}

/** Stopwatch elapsed: banked time plus the live run. */
export function stopwatchElapsedMs(item: TimeItem, now: Date): number {
  const live = item.startedAt ? Math.max(0, now.getTime() - Date.parse(item.startedAt)) : 0;
  return item.accumulatedMs + live;
}

export interface PomodoroState {
  phase: 'work' | 'break';
  running: boolean;
  remainingMs: number;
  cyclesDone: number;
  /** Set when the stored phase deadline has passed: the item should be
   *  advanced (possibly multiple phases if the tab was away a while). */
  rollover: Pick<TimeItem, 'phase' | 'phaseEndAt' | 'cyclesDone'> | null;
}

const phaseMs = (item: TimeItem, phase: 'work' | 'break') =>
  (phase === 'work' ? item.workMin : item.breakMin) * 60_000;

/**
 * Derive the pomodoro display — and, when the deadline passed while nobody
 * was looking, the catch-up write that advances phases to the present.
 */
export function pomodoroState(item: TimeItem, now: Date): PomodoroState {
  const base = {
    phase: item.phase,
    cyclesDone: item.cyclesDone,
    rollover: null as PomodoroState['rollover'],
  };
  if (!item.phaseEndAt) {
    return {
      ...base,
      running: false,
      remainingMs: item.phaseRemainingMs ?? phaseMs(item, item.phase),
    };
  }
  let phase = item.phase;
  let cycles = item.cyclesDone;
  let end = Date.parse(item.phaseEndAt);
  if (Number.isNaN(end)) {
    return { ...base, running: false, remainingMs: phaseMs(item, item.phase) };
  }
  let advanced = false;
  while (end <= now.getTime()) {
    if (phase === 'work') cycles += 1;
    phase = phase === 'work' ? 'break' : 'work';
    end += phaseMs(item, phase);
    advanced = true;
  }
  return {
    phase,
    cyclesDone: cycles,
    running: true,
    remainingMs: end - now.getTime(),
    rollover: advanced
      ? { phase, phaseEndAt: new Date(end).toISOString(), cyclesDone: cycles }
      : null,
  };
}

/** One-line static rendering of the widget "right now" — thumbnails/exports. */
export function timeSnapshotText(item: TimeItem, now: Date = new Date()): string {
  if (item.mode === 'clock') return clockParts(item, now).text;
  if (item.mode === 'countdown') {
    const ms = countdownRemainingMs(item, now);
    if (ms === null) return '--:--';
    const d = splitDuration(ms);
    return d.negative ? 'Done' : formatDuration(d, { showSeconds: item.showSeconds });
  }
  if (item.mode === 'stopwatch')
    return formatDuration(splitDuration(stopwatchElapsedMs(item, now)));
  const st = pomodoroState(item, now);
  return formatDuration(splitDuration(Math.max(0, st.remainingMs)));
}

/** Every IANA zone the runtime knows, else a useful curated list. */
export function allTimezones(): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    if (zones.length) return zones;
  } catch {
    /* older runtimes */
  }
  return [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Africa/Cairo',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Australia/Sydney',
    'Pacific/Auckland',
    'UTC',
  ];
}
