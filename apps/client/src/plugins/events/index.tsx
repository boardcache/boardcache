import './style.css';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { CalendarIcon, FolderInputIcon, PencilIcon } from '../../components/icons';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { boardEvents, eventsIcs } from '../../lib/export/exportIcs';
import { createEventItem } from '../../lib/import/createItems';
import { importIcsFiles, importIcsText } from '../../lib/import/importIcs';
import { normalizeRange } from '../../lib/structure/events';
import { requireLive, requireType } from '../../lib/tools/shared';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { openPluginView, registerPlugin } from '../registry';
import { CalendarView } from './CalendarView';
import { EventDialog } from './EventDialog';
import { startEventReminders } from './reminders';
import { useEventsUi } from './store';

/**
 * Events plugin: the UX for the core `event` item type — the add/edit
 * dialog, iCalendar import and export, reminders before the start, and the
 * Calendar view (every event on the board on a month grid).
 */

const PLUGIN_ID = 'events';
const VIEW_ID = 'calendar';

function viewCenter() {
  return clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
}

function openCalendar(): void {
  // The full view replaces whatever was showing — including the lightbox.
  useSessionStore.getState().setLightbox(null);
  openPluginView(VIEW_ID);
}

function EventsHost() {
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onEdit = (e: Event) => {
      const { itemId } = (e as CustomEvent<{ itemId: string }>).detail;
      const item = useDocumentStore.getState().doc.items[itemId];
      if (item?.type === 'event') useEventsUi.getState().openEdit(item);
    };
    const onImport = () => fileInput.current?.click();
    const onOpenCalendar = (e: Event) => {
      const { itemId } = (e as CustomEvent<{ itemId?: string }>).detail ?? {};
      const item = itemId ? useDocumentStore.getState().doc.items[itemId] : null;
      if (item?.type === 'event') useEventsUi.getState().setSelectedDay(item.start.slice(0, 10));
      openCalendar();
    };
    window.addEventListener('boardcache:open-calendar', onOpenCalendar);
    window.addEventListener('boardcache:edit-event', onEdit);
    window.addEventListener('boardcache:import-calendar', onImport);
    const stopReminders = startEventReminders();
    return () => {
      stopReminders();
      window.removeEventListener('boardcache:open-calendar', onOpenCalendar);
      window.removeEventListener('boardcache:edit-event', onEdit);
      window.removeEventListener('boardcache:import-calendar', onImport);
    };
  }, []);
  return (
    <>
      <EventDialog />
      <input
        ref={fileInput}
        type="file"
        accept=".ics,text/calendar"
        multiple
        hidden
        data-testid="calendar-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void importIcsFiles(files, viewCenter());
        }}
      />
    </>
  );
}

const eventFields = {
  title: z.string().optional(),
  start: z
    .string()
    .optional()
    .describe('Local wall-clock start: YYYY-MM-DDTHH:mm, or YYYY-MM-DD for an all-day event'),
  end: z.string().optional().describe('Local end; all-day events give an inclusive end date'),
  allDay: z.boolean().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  remindMinutes: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe('Minutes before the start to notify; null clears the reminder'),
};

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 56,
    name: 'Events',
    description:
      'Calendar events as cards on the board: import and export .ics files, reminders before the start, and a calendar of everything on the board.',
  },
  addMenu: [
    {
      label: 'Add Event',
      category: 'structure',
      icon: <CalendarIcon />,
      onSelect: () => useEventsUi.getState().openNew(),
    },
    {
      label: 'Import Calendar',
      category: 'structure',
      icon: <FolderInputIcon />,
      onSelect: () => window.dispatchEvent(new CustomEvent('boardcache:import-calendar')),
    },
  ],
  Component: EventsHost,
  itemMenu: (item) =>
    item.type === 'event'
      ? [
          {
            kind: 'action',
            label: 'Edit Event',
            icon: <PencilIcon />,
            onSelect: () => useEventsUi.getState().openEdit(item),
          },
          {
            kind: 'action',
            label: 'Open Calendar',
            icon: <CalendarIcon />,
            onSelect: () => {
              useEventsUi.getState().setSelectedDay(item.start.slice(0, 10));
              openCalendar();
            },
          },
        ]
      : [],
  views: [{ id: VIEW_ID, label: 'Calendar', icon: <CalendarIcon />, Component: CalendarView }],
  tools: [
    {
      name: 'add_calendar_event',
      description:
        'Add a calendar event card to the board: a title, a start and end (local wall-clock YYYY-MM-DDTHH:mm, or dates for all-day), an optional location, notes and a reminder some minutes before the start.',
      parameters: z.object({
        ...eventFields,
        title: z.string(),
        start: eventFields.start.unwrap(),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const center = ctx.viewCenter();
        const allDay = args.allDay ?? args.start.length === 10;
        const range = normalizeRange(args.start, args.end ?? args.start, allDay);
        const id = createEventItem(
          { x: args.x ?? center.x, y: args.y ?? center.y },
          {
            title: args.title,
            ...range,
            allDay,
            ...(args.location ? { location: args.location } : {}),
            ...(args.description ? { description: args.description } : {}),
            ...(args.remindMinutes != null ? { remindMinutes: args.remindMinutes } : {}),
          },
        );
        return { id };
      },
    },
    {
      name: 'edit_calendar_event',
      description:
        'Change an event card: any of its title, start, end, all-day flag, location, notes or reminder. Moving the start or the reminder re-arms a reminder that already fired.',
      parameters: z.object({ id: z.string(), ...eventFields }),
      access: 'write',
      execute: (args, ctx) => {
        const [id] = requireLive(ctx, [args.id]);
        requireType(ctx, id!, 'event');
        updateItems([id!], 'Edit event', (d) => {
          if (d.type !== 'event') return;
          const before = { start: d.start, remind: d.remindMinutes };
          if (args.title !== undefined) d.title = args.title.trim() || 'Event';
          if (args.allDay !== undefined) d.allDay = args.allDay;
          if (args.start !== undefined || args.end !== undefined || args.allDay !== undefined) {
            const range = normalizeRange(args.start ?? d.start, args.end ?? d.end, d.allDay);
            d.start = range.start;
            d.end = range.end;
          }
          if (args.location !== undefined) d.location = args.location;
          if (args.description !== undefined) d.description = args.description;
          if (args.remindMinutes !== undefined) d.remindMinutes = args.remindMinutes;
          if (d.start !== before.start || d.remindMinutes !== before.remind) d.notifiedAt = null;
        });
        return { id };
      },
    },
    {
      name: 'export_calendar',
      description:
        'The board’s events (or the given ones) as iCalendar text (.ics), ready to save or hand to a calendar app.',
      parameters: z.object({ ids: z.array(z.string()).optional() }),
      access: 'read',
      execute: (args, ctx) => {
        const doc = ctx.doc();
        const items = args.ids?.length
          ? requireLive(ctx, args.ids).map((id) => requireType(ctx, id, 'event'))
          : boardEvents(doc);
        return { count: items.length, ics: eventsIcs(items, doc) };
      },
    },
    {
      name: 'import_calendar',
      description:
        'Add event cards from iCalendar text (.ics): every VEVENT becomes a card, laid out in a grid from the given point (default: the view centre). Returns the new ids.',
      parameters: z.object({
        ics: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const center = ctx.viewCenter();
        const ids = importIcsText(args.ics, { x: args.x ?? center.x, y: args.y ?? center.y });
        return { ids };
      },
    },
  ],
});
