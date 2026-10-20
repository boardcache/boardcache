import type { TasklistItem } from '@boardcache/schema';
import { runCommand, runSilent } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { systemNotify } from '../systemNotify';

/**
 * Task-list helpers: the single command wrapper every edit goes through,
 * plus the due-date notification engine (browser Notification API).
 *
 * Notifications are per-device and fire only while the board is open in a
 * running app — this is a local-first canvas, not a server-side reminder
 * service. `notifiedAt` is written back (silently — no undo entry) and
 * syncs, so a task notifies once, not once per device.
 */

/** The card's minimum design width: content renders at the design width and
 *  the canvas card scales it uniformly (resize = zoom, like trees). */
const TASKLIST_BASE_W = 320;
/** Long labels widen the design width up to here, then wrap. */
const TASKLIST_MAX_W = 560;

let measureCtx: CanvasRenderingContext2D | null = null;
let appFont = 'Inter, system-ui, sans-serif';
function textWidth(text: string, spec: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    const bodyFont = getComputedStyle(document.body).fontFamily;
    if (bodyFont) appFont = bodyFont;
  }
  if (!measureCtx) return 0;
  measureCtx.font = `${spec} ${appFont}`;
  return measureCtx.measureText(text).width;
}

/**
 * The card's intrinsic design width: wide enough for the longest task on one
 * line (checkbox, due chip and remove included), clamped to
 * [TASKLIST_BASE_W, TASKLIST_MAX_W]. Everything that renders or lays out the
 * card divides by this.
 */
export function tasklistBaseW(item: TasklistItem): number {
  let need = textWidth(item.title, '750 16px') + 96;
  for (const t of item.tasks) {
    const label = textWidth(t.label, '550 13.5px');
    const note = t.note ? textWidth(t.note, '400 11.5px') : 0;
    // body padding + checkbox + gaps + remove chip + the due chip's width.
    // +8 safety: canvas metrics run a hair tighter than DOM layout.
    const chrome = 92 + (t.due ? textWidth(formatDue(t.due), '400 11px') + 46 : 26);
    need = Math.max(need, Math.max(label, note) + chrome);
  }
  return Math.ceil(Math.min(TASKLIST_MAX_W, Math.max(TASKLIST_BASE_W, need)));
}

export function updateTasklist(id: string, label: string, recipe: (t: TasklistItem) => void): void {
  runCommand(label, (draft) => {
    const item = draft.items[id];
    if (item?.type !== 'tasklist') return;
    const before = tasklistBaseW(item);
    recipe(item);
    // A longer/shorter longest-line changes the design width — keep the
    // card's SCALE constant, so the box widens instead of the text wrapping.
    const after = tasklistBaseW(item);
    if (after !== before) item.width = (item.width / before) * after;
  });
}

/** Ask for notification permission (call from a user gesture — setting a due date). */
export function ensureNotifyPermission(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

/** "Aug 27, 2:30 PM" (year only when it differs from today). */
export function formatDue(due: string): string {
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return due;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function isOverdue(due: string | null, done: boolean): boolean {
  if (!due || done) return false;
  const at = new Date(due).getTime();
  return !Number.isNaN(at) && at <= Date.now();
}

// ── notification engine ──

const timers = new Map<string, ReturnType<typeof setTimeout>>();
// setTimeout is only reliable within a session; anything further out is
// caught by the periodic rescan (and by the reschedule on every doc change).
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

/**
 * (Re)schedule notifications for every due task on the open board. Idempotent
 * and cheap — call on doc changes; overdue unnotified tasks fire immediately
 * (catch-up for due dates that passed while the app was closed).
 */
export function scheduleTaskNotifications(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  if (typeof Notification === 'undefined') return;
  const doc = useDocumentStore.getState().doc;
  const now = Date.now();
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'tasklist') continue;
    for (const task of item.tasks) {
      if (!task.due || task.done || task.notifiedAt) continue;
      const at = new Date(task.due).getTime();
      if (Number.isNaN(at)) continue;
      const delay = at - now;
      if (delay <= 0) fireTaskNotification(item.id, task.id);
      else if (delay <= MAX_TIMER_MS) {
        timers.set(
          task.id,
          setTimeout(() => fireTaskNotification(item.id, task.id), delay),
        );
      }
    }
  }
}

/** Fire one task's notification — re-reads fresh state (the task may have
 *  been completed, rescheduled, or deleted since the timer was set). */
function fireTaskNotification(itemId: string, taskId: string): void {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (item?.type !== 'tasklist') return;
  const task = item.tasks.find((t) => t.id === taskId);
  if (!task || task.done || task.notifiedAt || !task.due) return;
  const shown = systemNotify(task.label || 'Task due', {
    body: [item.title, task.note, formatDue(task.due)].filter(Boolean).join(' — '),
    tag: `boardcache-task-${taskId}`,
  });
  if (!shown) return; // retry next pass
  runSilent((draft) => {
    const it = draft.items[itemId];
    if (it?.type !== 'tasklist') return;
    const t = it.tasks.find((x) => x.id === taskId);
    if (t) t.notifiedAt = new Date().toISOString();
  });
}
