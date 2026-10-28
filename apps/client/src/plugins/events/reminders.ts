import type { EventItem } from '@boardcache/schema';
import { runSilent } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { eventEnd, eventTimeLine, reminderAt } from '../../lib/structure/events';
import { systemNotify } from '../../lib/systemNotify';
import { scheduleLocalReminders } from '../../lib/iosNative';

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
  const upcoming: { key: string; title: string; body?: string; at: number; path?: string }[] = [];
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'event' || item.notifiedAt) continue;
    const at = reminderAt(item);
    if (at === null || Number.isNaN(at) || eventEnd(item).getTime() <= now) continue;
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
  if (item?.type !== 'event' || item.notifiedAt || item.remindMinutes === null) return;
  if (eventEnd(item).getTime() <= Date.now()) return;
  const shown = systemNotify(item.title, { body: body(item), tag: `boardcache-event-${itemId}` });
  if (!shown) return; // retry on the next pass
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
  const rescan = setInterval(scheduleEventReminders, 60 * 60 * 1000);
  return () => {
    unsub();
    clearTimeout(debounce);
    clearInterval(rescan);
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}
