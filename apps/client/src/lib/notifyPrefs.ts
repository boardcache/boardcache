import { create } from 'zustand';

/**
 * Notification preferences, per device (notifications are shown by this
 * device, so the choices live here, not on the account): whether to notify
 * at all and for what, when a day-only due date reminds, how far ahead,
 * quiet hours, and whether the account should also email reminders.
 */
export interface NotifyPrefs {
  /** Master switch for every notification this device shows. */
  enabled: boolean;
  /** Project tasks and checklist items coming due. */
  tasks: boolean;
  /** Calendar events (each carries its own lead time). */
  events: boolean;
  /** Team and community activity, as a system notification when the window is away. */
  account: boolean;
  /** Time of day (HH:mm) a due date without a time reminds at. */
  dayTime: string;
  /** Minutes ahead of the due moment a task reminds (0 = at the moment). */
  leadMinutes: number;
  /** Quiet hours (HH:mm each); a reminder falling inside waits for the end. */
  quietFrom: string | null;
  quietTo: string | null;
  /** The account mails reminders too (when the app may be closed). */
  email: boolean;
  /** Put the task's name in those mails (it leaves the board's encryption). */
  emailTitles: boolean;
  /** This browser is subscribed to push (reminders while the app is closed). */
  push: boolean;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: true,
  tasks: true,
  events: true,
  account: true,
  dayTime: '09:00',
  leadMinutes: 0,
  quietFrom: null,
  quietTo: null,
  email: false,
  emailTitles: false,
  push: false,
};

export const LEAD_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'At the time' },
  { value: 15, label: '15 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 24 * 60, label: 'The day before' },
];

const KEY = 'boardcache:notifications';
const TIME_RE = /^\d{2}:\d{2}$/;

function load(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_NOTIFY_PREFS;
    const p = JSON.parse(raw) as Partial<NotifyPrefs>;
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
    const time = (v: unknown, d: string | null) =>
      typeof v === 'string' && TIME_RE.test(v) ? v : v === null ? null : d;
    return {
      enabled: bool(p.enabled, true),
      tasks: bool(p.tasks, true),
      events: bool(p.events, true),
      account: bool(p.account, true),
      dayTime: time(p.dayTime, '09:00') ?? '09:00',
      leadMinutes: LEAD_OPTIONS.some((o) => o.value === p.leadMinutes) ? p.leadMinutes! : 0,
      quietFrom: time(p.quietFrom, null),
      quietTo: time(p.quietTo, null),
      email: bool(p.email, false),
      emailTitles: bool(p.emailTitles, false),
      push: bool(p.push, false),
    };
  } catch {
    return DEFAULT_NOTIFY_PREFS;
  }
}

export const useNotifyPrefs = create<NotifyPrefs & { set: (patch: Partial<NotifyPrefs>) => void }>(
  (set, get) => ({
    ...load(),
    set: (patch) => {
      set(patch);
      const { set: _set, ...prefs } = get();
      void _set;
      try {
        localStorage.setItem(KEY, JSON.stringify(prefs));
      } catch {
        /* storage unavailable: the choice holds for this session */
      }
    },
  }),
);

/** The current preferences (outside React). */
export function notifyPrefs(): NotifyPrefs {
  return useNotifyPrefs.getState();
}

/** Run `fn` whenever a preference changes (engines reschedule). */
export function onNotifyPrefsChange(fn: () => void): () => void {
  return useNotifyPrefs.subscribe(fn);
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Where a moment lands against the quiet hours: the same moment when it is
 * outside them (or none are set), else the end of the quiet span it falls
 * in. A span may cross midnight (22:00 to 07:00).
 */
export function afterQuietHours(
  at: number,
  prefs: Pick<NotifyPrefs, 'quietFrom' | 'quietTo'>,
): number {
  if (!prefs.quietFrom || !prefs.quietTo || prefs.quietFrom === prefs.quietTo) return at;
  const from = minutesOf(prefs.quietFrom);
  const to = minutesOf(prefs.quietTo);
  const d = new Date(at);
  const minute = d.getHours() * 60 + d.getMinutes();
  const inside = from < to ? minute >= from && minute < to : minute >= from || minute < to;
  if (!inside) return at;
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(to / 60), to % 60);
  // Crossing midnight and already past it: the end is today, else tomorrow.
  if (end.getTime() <= at) end.setDate(end.getDate() + 1);
  return end.getTime();
}

/** The moment a task reminder fires for a due moment: the lead time ahead, after quiet hours. */
export function reminderMoment(
  dueAt: number,
  prefs: Pick<NotifyPrefs, 'leadMinutes' | 'quietFrom' | 'quietTo'>,
): number {
  return afterQuietHours(dueAt - prefs.leadMinutes * 60_000, prefs);
}
