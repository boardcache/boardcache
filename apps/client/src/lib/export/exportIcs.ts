import type { CanvasDocument, EventItem } from '@boardcache/schema';
import { writeIcs } from '../structure/ics';
import { downloadBlob, exportFileName } from './download';

/** The iCalendar text for these event items (the board's name as the calendar name). */
export function eventsIcs(items: EventItem[], doc: CanvasDocument): string {
  return writeIcs(
    items.map((it) => ({
      id: it.id,
      uid: it.uid,
      title: it.title,
      start: it.start,
      end: it.end,
      allDay: it.allDay,
      location: it.location,
      description: it.description,
      remindMinutes: it.remindMinutes,
    })),
    { name: doc.name },
  );
}

/** Every event on the board, in document order. */
export function boardEvents(doc: CanvasDocument): EventItem[] {
  return Object.values(doc.items).filter((it): it is EventItem => it.type === 'event');
}

/** Save one event, or a whole calendar, as a .ics file. */
export function downloadEventsIcs(items: EventItem[], doc: CanvasDocument): void {
  if (items.length === 0) return;
  const base = items.length === 1 ? items[0]!.name || items[0]!.title : doc.name || 'calendar';
  downloadBlob(
    new Blob([eventsIcs(items, doc)], { type: 'text/calendar;charset=utf-8' }),
    exportFileName(undefined, base, 'ics'),
  );
}
