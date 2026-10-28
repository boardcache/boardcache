import { create } from 'zustand';
import type { EventItem } from '@boardcache/schema';
import { localDate, localDateTime, nextQuarterHour } from '../../lib/structure/events';

/** What the event dialog edits: the form's own shape, folded into an item on save. */
export interface EventForm {
  title: string;
  allDay: boolean;
  /** YYYY-MM-DD */
  date: string;
  endDate: string;
  /** HH:mm (timed events). */
  from: string;
  to: string;
  location: string;
  description: string;
  remindMinutes: number | null;
}

function defaultForm(day?: string, hour?: number): EventForm {
  const start = nextQuarterHour();
  if (day) {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    start.setFullYear(y, m - 1, d);
    start.setHours(hour ?? 9, 0, 0, 0);
  }
  const end = new Date(start.getTime() + 3_600_000);
  return {
    title: '',
    allDay: false,
    date: localDate(start),
    endDate: localDate(start),
    from: localDateTime(start).slice(11),
    to: localDateTime(end).slice(11),
    location: '',
    description: '',
    remindMinutes: null,
  };
}

function formFromItem(item: EventItem): EventForm {
  const timed = !item.allDay;
  return {
    title: item.title,
    allDay: item.allDay,
    date: item.start.slice(0, 10),
    endDate: item.end.slice(0, 10),
    from: timed ? item.start.slice(11, 16) : '09:00',
    to: timed ? item.end.slice(11, 16) : '10:00',
    location: item.location,
    description: item.description,
    remindMinutes: item.remindMinutes,
  };
}

const thisMonth = () => localDate(new Date()).slice(0, 7);

export type CalendarScope = 'month' | 'week' | 'day';
const SCOPE_KEY = 'boardcache:eventsScope';

function loadScope(): CalendarScope {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    return v === 'week' || v === 'day' ? v : 'month';
  } catch {
    return 'month';
  }
}

interface EventsUi {
  dialog: { itemId: string | null; initial: EventForm } | null;
  openNew: (day?: string, hour?: number) => void;
  openEdit: (item: EventItem) => void;
  closeDialog: () => void;
  /** Calendar view: the month shown (YYYY-MM) and the day picked. */
  month: string;
  setMonth: (month: string) => void;
  selectedDay: string;
  setSelectedDay: (day: string) => void;
  /** Month grid, one week, or one day (persisted). */
  scope: CalendarScope;
  setScope: (scope: CalendarScope) => void;
}

export const useEventsUi = create<EventsUi>((set) => ({
  dialog: null,
  openNew: (day, hour) => set({ dialog: { itemId: null, initial: defaultForm(day, hour) } }),
  openEdit: (item) => set({ dialog: { itemId: item.id, initial: formFromItem(item) } }),
  closeDialog: () => set({ dialog: null }),
  month: thisMonth(),
  setMonth: (month) => set({ month }),
  selectedDay: localDate(new Date()),
  setSelectedDay: (selectedDay) => set({ selectedDay, month: selectedDay.slice(0, 7) }),
  scope: loadScope(),
  setScope: (scope) => {
    try {
      localStorage.setItem(SCOPE_KEY, scope);
    } catch {
      /* storage unavailable */
    }
    set({ scope });
  },
}));
