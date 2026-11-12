import { runSilent } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { isTeamRoom, markRemindedHere, remindedHere } from '../../lib/reminderLedger';
import { formatDate, formatDueTime, isClosedStatus, taskDueAt } from '../../lib/structure/projects';
import type { ProjectTask } from '@boardcache/schema';
import { systemNotify } from '../../lib/systemNotify';
import { publishWidgetData, scheduleLocalReminders } from '../../lib/iosNative';
import { notifyPrefs, onNotifyPrefsChange, reminderMoment } from '../../lib/notifyPrefs';

/**
 * Due-date reminders for project tasks — the Task List engine's twin
 * (lib/tasklist.ts): timers within a session, an hourly rescan for the
 * rest, overdue-unnotified tasks fire immediately (catch-up), and the fired
 * stamp (`notifiedAt`) is a silent doc write so it syncs and never refires.
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

/** "due Nov 5" or "due Nov 5, 2:30 PM". */
function dueLine(task: ProjectTask): string {
  const time = formatDueTime(task);
  return `due ${formatDate(task.due)}${time ? `, ${time}` : ''}`;
}

function scheduleProjectReminders(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const doc = useDocumentStore.getState().doc;
  const now = Date.now();
  const prefs = notifyPrefs();
  const on = prefs.enabled && prefs.tasks;
  // iOS shell: the system holds every future reminder (the app may be
  // closed when it falls due) and the widget shows what is due today.
  const upcoming: { key: string; title: string; body?: string; at: number; path?: string }[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const dueToday: { title: string; board: string; due: string }[] = [];
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'project') continue;
    for (const task of item.tasks) {
      if (!task.due || isClosedStatus(task.status)) continue;
      const due = taskDueAt(task, prefs.dayTime);
      if (on && due !== null && !task.notifiedAt) {
        upcoming.push({
          key: `task:${task.id}`,
          title: task.title || 'Task due',
          body: [item.title, dueLine(task)].filter(Boolean).join(' — '),
          at: reminderMoment(due, prefs),
          path: `/b/${doc.id}`,
        });
      }
      if (task.due.slice(0, 10) === today) {
        dueToday.push({ title: task.title || 'Task', board: doc.name, due: task.due });
      }
    }
  }
  void scheduleLocalReminders(upcoming);
  publishWidgetData({ tasks: dueToday.slice(0, 8) });
  if (!on || (typeof Notification === 'undefined' && upcoming.length === 0)) return;
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'project') continue;
    for (const task of item.tasks) {
      if (
        !task.due ||
        isClosedStatus(task.status) ||
        fired(doc.id, `task:${task.id}`, task.notifiedAt)
      )
        continue;
      const due = taskDueAt(task, prefs.dayTime);
      if (due === null) continue;
      const delay = reminderMoment(due, prefs) - now;
      if (delay <= 0) fireReminder(item.id, task.id);
      else if (delay <= MAX_TIMER_MS) {
        timers.set(
          task.id,
          setTimeout(() => fireReminder(item.id, task.id), delay),
        );
      }
    }
  }
}

function fireReminder(projectId: string, taskId: string): void {
  const item = useDocumentStore.getState().doc.items[projectId];
  if (item?.type !== 'project') return;
  const task = item.tasks.find((t) => t.id === taskId);
  const docId = useDocumentStore.getState().doc.id;
  if (
    !task ||
    isClosedStatus(task.status) ||
    fired(docId, `task:${taskId}`, task.notifiedAt) ||
    !task.due
  )
    return;
  const prefs = notifyPrefs();
  if (!prefs.enabled || !prefs.tasks) return;
  const shown = systemNotify(task.title || 'Task due', {
    body: [item.title, dueLine(task)].filter(Boolean).join(' — '),
    tag: `boardcache-project-task-${taskId}`,
  });
  if (!shown) return; // retry on the next pass
  if (isTeamRoom(docId)) {
    markRemindedHere(`${docId}:task:${taskId}`);
    return;
  }
  runSilent((draft) => {
    const p = draft.items[projectId];
    if (p?.type !== 'project') return;
    const t = p.tasks.find((x) => x.id === taskId);
    if (t) t.notifiedAt = new Date().toISOString();
  });
}

/** Mount once (ProjectsHost): initial scan, debounced rescan on doc changes,
 *  hourly rescan so far-future dues roll into timer range. */
export function startProjectReminders(): () => void {
  scheduleProjectReminders();
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const unsub = useDocumentStore.subscribe(
    (s) => s.doc,
    () => {
      clearTimeout(debounce);
      debounce = setTimeout(scheduleProjectReminders, 400);
    },
  );
  const unsubPrefs = onNotifyPrefsChange(() => {
    clearTimeout(debounce);
    debounce = setTimeout(scheduleProjectReminders, 50);
  });
  const rescan = setInterval(scheduleProjectReminders, 60 * 60 * 1000);
  return () => {
    unsub();
    unsubPrefs();
    clearTimeout(debounce);
    clearInterval(rescan);
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}

/** Already shown: the item's own stamp on a board of yours, this device's
 *  ledger on a team board (where a shared stamp would silence the others). */
function fired(boardId: string, key: string, stamp: string | null | undefined): boolean {
  return isTeamRoom(boardId) ? remindedHere(`${boardId}:${key}`) : !!stamp;
}
