import { runSilent } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { formatDate, isClosedStatus } from '../../lib/structure/projects';
import { systemNotify } from '../../lib/systemNotify';
import { publishWidgetData, scheduleLocalReminders } from '../../lib/iosNative';

/**
 * Due-date reminders for project tasks — the Task List engine's twin
 * (lib/tasklist.ts): timers within a session, an hourly rescan for the
 * rest, overdue-unnotified tasks fire immediately (catch-up), and the fired
 * stamp (`notifiedAt`) is a silent doc write so it syncs and never refires.
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

/** Due dates are YYYY-MM-DD: remind at 9:00 local on that day. */
function dueInstant(due: string): number {
  const d = new Date(due.length === 10 ? `${due}T09:00:00` : due);
  return d.getTime();
}

function scheduleProjectReminders(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const doc = useDocumentStore.getState().doc;
  const now = Date.now();
  // iOS shell: the system holds every future reminder (the app may be
  // closed when it falls due) and the widget shows what is due today.
  const upcoming: { key: string; title: string; body?: string; at: number; path?: string }[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const dueToday: { title: string; board: string; due: string }[] = [];
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'project') continue;
    for (const task of item.tasks) {
      if (!task.due || isClosedStatus(task.status)) continue;
      const at = dueInstant(task.due);
      if (!Number.isNaN(at) && !task.notifiedAt) {
        upcoming.push({
          key: `task:${task.id}`,
          title: task.title || 'Task due',
          body: [item.title, `due ${formatDate(task.due)}`].filter(Boolean).join(' — '),
          at,
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
  if (typeof Notification === 'undefined' && upcoming.length === 0) return;
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'project') continue;
    for (const task of item.tasks) {
      if (!task.due || isClosedStatus(task.status) || task.notifiedAt) continue;
      const at = dueInstant(task.due);
      if (Number.isNaN(at)) continue;
      const delay = at - now;
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
  if (!task || isClosedStatus(task.status) || task.notifiedAt || !task.due) return;
  const shown = systemNotify(task.title || 'Task due', {
    body: [item.title, `due ${formatDate(task.due)}`].filter(Boolean).join(' — '),
    tag: `boardcache-project-task-${taskId}`,
  });
  if (!shown) return; // retry on the next pass
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
  const rescan = setInterval(scheduleProjectReminders, 60 * 60 * 1000);
  return () => {
    unsub();
    clearTimeout(debounce);
    clearInterval(rescan);
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}
