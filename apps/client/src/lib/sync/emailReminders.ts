import type { CanvasDocument } from '@boardcache/schema';
import { apiFetch, hasSyncServer } from './apiBase';
import { useSyncStore } from '../../state/syncStore';
import { useDocumentStore } from '../../state/documentStore';
import {
  notifyPrefs,
  onNotifyPrefsChange,
  reminderMoment,
  afterQuietHours,
  useNotifyPrefs,
} from '../notifyPrefs';
import type { NotifyPrefs } from '../notifyPrefs';
import { isClosedStatus, taskDueAt } from '../structure/projects';
import { eventEnd, reminderAt } from '../structure/events';
import { loadPushKey } from './keyStore';
import { sealReminder } from '../push/pushPayload';

/**
 * Reminders through the account, by mail and by push. The server cannot
 * read a board, so this device tells it, per board, the moments the open
 * board's reminders fall due and a link to open at each — the task's name
 * only when the person opted to have it in mails. For push, each reminder
 * carries its name sealed under the account's push key, which the server
 * cannot open and the service worker of any of the account's browsers can.
 * The set is replaced whole whenever it changes, so a finished, moved or
 * deleted task drops out on the next save.
 */

interface ScheduledReminder {
  key: string;
  at: string;
  path?: string;
  title?: string;
  /** The reminder sealed for push (lib/push/pushPayload). */
  payload?: string;
  /** The name, kept here until it is sealed (never sent as is). */
  _name?: string;
}

/** The reminders a board holds, as the server should know them. */
export function computeEmailReminders(
  doc: CanvasDocument,
  prefs: NotifyPrefs,
  now = Date.now(),
): ScheduledReminder[] {
  const out: ScheduledReminder[] = [];
  // A moment a little behind still goes: the worker mails once a minute.
  const floor = now - 10 * 60_000;
  const push = (key: string, at: number, path: string, title: string) => {
    if (!Number.isFinite(at) || at < floor) return;
    out.push({
      key,
      at: new Date(at).toISOString(),
      path,
      ...(prefs.emailTitles && title.trim() ? { title: title.trim().slice(0, 200) } : {}),
      ...(prefs.push && title.trim() ? { _name: title.trim().slice(0, 200) } : {}),
    });
  };
  for (const item of Object.values(doc.items)) {
    if (item.type === 'project' && prefs.tasks) {
      for (const task of item.tasks) {
        if (!task.due || isClosedStatus(task.status)) continue;
        const due = taskDueAt(task, prefs.dayTime);
        if (due === null) continue;
        push(
          `task:${task.id}`,
          reminderMoment(due, prefs),
          `/b/${doc.id}/projects/${item.id}/board/task/${task.id}`,
          task.title,
        );
      }
    } else if (item.type === 'tasklist' && prefs.tasks) {
      for (const task of item.tasks) {
        if (!task.due || task.done) continue;
        push(
          `check:${task.id}`,
          reminderMoment(Date.parse(task.due), prefs),
          `/b/${doc.id}`,
          task.label,
        );
      }
    } else if (item.type === 'event' && prefs.events) {
      const wanted = reminderAt(item);
      if (wanted === null || eventEnd(item).getTime() <= now) continue;
      push(`event:${item.id}`, afterQuietHours(wanted, prefs), `/b/${doc.id}`, item.title);
    }
  }
  return out;
}

/**
 * Each reminder's name sealed under the push key, for push; the plain name
 * never leaves. Without the key (a device signed in before it existed) the
 * rows go without a payload, and a push then only says something is due.
 */
async function sealForPush(
  list: ScheduledReminder[],
  boardName: string,
  prefs: NotifyPrefs,
): Promise<ScheduledReminder[]> {
  const key = prefs.push ? await loadPushKey().catch(() => null) : null;
  const out: ScheduledReminder[] = [];
  for (const r of list) {
    const { _name, ...row } = r;
    if (key && _name) {
      row.payload = await sealReminder(key, {
        title: _name,
        body: boardName,
        ...(row.path ? { path: row.path } : {}),
      });
    }
    out.push(row);
  }
  return out;
}

const sentFor = new Map<string, string>(); // board id → what the server last got
let cleared = true; // the account holds nothing (as far as this device knows)

const signedIn = (): boolean => {
  const s = useSyncStore.getState();
  return hasSyncServer() && s.status === 'signedIn' && !!s.account;
};

/** Send the open board's set when it changed since the last send. */
export async function syncEmailReminders(force = false): Promise<void> {
  const prefs = notifyPrefs();
  const s = useSyncStore.getState();
  if (!hasSyncServer() || s.status !== 'signedIn' || !s.account) return;
  if (!prefs.email && !prefs.push) {
    // Turned off: forget everything, once.
    if (cleared) return;
    try {
      const res = await apiFetch('/api/reminders', { method: 'DELETE' });
      if (res.ok) {
        cleared = true;
        sentFor.clear();
      }
    } catch {
      /* offline: the next change tries again */
    }
    return;
  }
  const doc = useDocumentStore.getState().doc;
  if (!doc.id) return;
  const list = await sealForPush(computeEmailReminders(doc, prefs), doc.name, prefs);
  const body = JSON.stringify({ reminders: list, email: prefs.email });
  if (!force && sentFor.get(doc.id) === body) return;
  try {
    const res = await apiFetch(`/api/reminders/${encodeURIComponent(doc.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (res.ok) {
      sentFor.set(doc.id, body);
      cleared = false;
    }
  } catch {
    /* offline: the next change tries again */
  }
}

/** The account's reminder count and the next moment, for Settings. */
export async function emailReminderSummary(): Promise<{
  count: number;
  next: string | null;
  email: boolean;
  push: boolean;
} | null> {
  if (!signedIn()) return null;
  try {
    const res = await apiFetch('/api/reminders');
    if (!res.ok) return null;
    return (await res.json()) as {
      count: number;
      next: string | null;
      email: boolean;
      push: boolean;
    };
  } catch {
    return null;
  }
}

let started = false;
/** Mount once: follow the open document, the preferences and the sign-in state. */
export function startEmailReminderSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const later = (ms: number) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void syncEmailReminders(), ms);
  };
  useDocumentStore.subscribe(
    (s) => s.doc,
    () => later(2000),
  );
  onNotifyPrefsChange(() => later(200));
  useSyncStore.subscribe((s, prev) => {
    if (s.status === 'signedIn' && prev.status !== 'signedIn') {
      sentFor.clear();
      cleared = false; // unknown: a DELETE is cheap and settles it
      later(500);
    }
  });
  // Once an hour, so a quiet board still refreshes what it told the server.
  setInterval(() => void syncEmailReminders(true), 60 * 60_000);
  // Push switched on or off: the rows are re-sent with or without payloads.
  useNotifyPrefs.subscribe((s, prev) => {
    if (s.push !== prev.push) {
      sentFor.clear();
      later(300);
    }
  });
  later(1500);
}
