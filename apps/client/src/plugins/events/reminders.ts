import type { EventItem } from '@boardcache/schema';
import { runSilent } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { isTeamRoom, markRemindedHere, remindedHere } from '../../lib/reminderLedger';
import { eventEnd, eventTimeLine, reminderAt } from '../../lib/structure/events';
import { systemNotify } from '../../lib/systemNotify';
import { scheduleLocalReminders } from '../../lib/iosNative';
import { afterQuietHours, notifyPrefs, onNotifyPrefsChange } from '../../lib/notifyPrefs';

/**
 * Event reminders: the project reminder engine's twin. Timers within a
 * session, an hourly rescan for the rest, a reminder whose time has passed
 * fires at once as long as the event is still ahead or under way (one that
 * is over stays silent), and the fired stamp (`notifiedAt`) is a silent doc
 * write so it syncs and never refires.
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

function body(item: EventItem): string {
  return [eventTimeLine(item), item.location].filter(Boolean).join(' · ');
}

function scheduleEventReminders(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const doc = useDocumentStore.getState().doc;
  const now = Date.now();
  const prefs = notifyPrefs();
  const upcoming: { key: string; title: string; body?: string; at: number; path?: string }[] = [];
  for (const item of Object.values(doc.items)) {
    if (!prefs.enabled || !prefs.events) break;
    if (item.type !== 'event' || fired(doc.id, `event:${item.id}`, item.notifiedAt)) continue;
    const wanted = reminderAt(item);
    if (wanted === null || Number.isNaN(wanted) || eventEnd(item).getTime() <= now) continue;
    const at = afterQuietHours(wanted, prefs);
    // iOS shell: the system holds every future reminder (the app may be
    // closed when it falls due).
    upcoming.push({
      key: `event:${item.id}`,
      title: item.title,
      body: body(item),
      at,
      path: `/b/${doc.id}`,
    });
    const delay = at - now;
    if (delay <= 0) fireReminder(item.id);
    else if (delay <= MAX_TIMER_MS) {
      timers.set(
        item.id,
        setTimeout(() => fireReminder(item.id), delay),
      );
    }
  }
  void scheduleLocalReminders(upcoming, 'events');
}

function fireReminder(itemId: string): void {
  const item = useDocumentStore.getState().doc.items[itemId];
  const docId = useDocumentStore.getState().doc.id;
  if (
    item?.type !== 'event' ||
    fired(docId, `event:${itemId}`, item.notifiedAt) ||
    item.remindMinutes === null
  )
    return;
  if (eventEnd(item).getTime() <= Date.now()) return;
  const prefs = notifyPrefs();
  if (!prefs.enabled || !prefs.events) return;
  const shown = systemNotify(item.title, { body: body(item), tag: `boardcache-event-${itemId}` });
  if (!shown) return; // retry on the next pass
  if (isTeamRoom(docId)) {
    markRemindedHere(`${docId}:event:${itemId}`);
    return;
  }
  runSilent((draft) => {
    const it = draft.items[itemId];
    if (it?.type === 'event') it.notifiedAt = new Date().toISOString();
  });
}

/** Mount once (EventsHost): initial scan, debounced rescan on doc changes,
 *  hourly rescan so far-future reminders roll into timer range. */
export function startEventReminders(): () => void {
  scheduleEventReminders();
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const unsub = useDocumentStore.subscribe(
    (s) => s.doc,
    () => {
      clearTimeout(debounce);
      debounce = setTimeout(scheduleEventReminders, 400);
    },
  );
  const unsubPrefs = onNotifyPrefsChange(() => {
    clearTimeout(debounce);
    debounce = setTimeout(scheduleEventReminders, 50);
  });
  const rescan = setInterval(scheduleEventReminders, 60 * 60 * 1000);
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
