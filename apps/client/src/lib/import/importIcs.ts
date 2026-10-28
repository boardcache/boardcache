import type { EventItem } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { EVENT_CARD_H, EVENT_CARD_W } from '../structure/events';
import { parseIcs } from '../structure/ics';
import { showNotice } from '../notices';
import { addItems, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { buildEventItem } from './createItems';

/**
 * iCalendar import: every VEVENT in a dropped, picked or pasted .ics becomes
 * an event card, laid out as a grid from the drop point, in one undo step.
 */

export function isIcsFile(f: File): boolean {
  return f.type === 'text/calendar' || /\.ics$/i.test(f.name);
}

export async function importIcsFiles(files: File[], point: Point): Promise<string[]> {
  const ids: string[] = [];
  for (const file of files) ids.push(...importIcsText(await file.text(), point));
  return ids;
}

/** Event cards for the calendar text; ids of what landed (empty = nothing readable). */
export function importIcsText(text: string, point: Point): string[] {
  const events = parseIcs(text);
  if (events.length === 0) {
    showNotice('No events found in that calendar.');
    return [];
  }
  const { doc } = useDocumentStore.getState();
  const cols = Math.ceil(Math.sqrt(events.length));
  const gap = 24;
  let z = topZIndex(doc) + 1;
  const items: EventItem[] = events.map((ev, i) =>
    buildEventItem(
      {
        x: point.x + (i % cols) * (EVENT_CARD_W + gap),
        y: point.y + Math.floor(i / cols) * (EVENT_CARD_H + gap),
      },
      ev,
      z++,
    ),
  );
  addItems(items, events.length === 1 ? 'Import event' : `Import ${events.length} events`);
  const ids = items.map((it) => it.id);
  useSessionStore.getState().setSelection(ids);
  return ids;
}
