import { create } from 'zustand';
import type { TaskSort } from '../../lib/structure/projects';

export type ProjectsMode = 'list' | 'kanban' | 'calendar' | 'gantt';
const MODE_KEY = 'boardcache:projectsMode';
function loadMode(): ProjectsMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'kanban' || v === 'calendar' || v === 'gantt' ? v : 'list';
  } catch {
    return 'list';
  }
}
const SORT_KEY = 'boardcache:projectsSort';
function loadSort(): TaskSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === 'due' || v === 'name' || v === 'created' ? v : 'manual';
  } catch {
    return 'manual';
  }
}
export type KanbanLayout = 'stacked' | 'row';
export type CalendarScope = 'month' | 'week' | 'day';
export type GanttScale = 'days' | 'weeks' | 'months';
const GANTT_SCALE_KEY = 'boardcache:ganttScale';
function loadGanttScale(): GanttScale {
  try {
    const v = localStorage.getItem(GANTT_SCALE_KEY);
    return v === 'days' || v === 'months' ? v : 'weeks';
  } catch {
    return 'weeks';
  }
}
const SCOPE_KEY = 'boardcache:calendarScope';
function loadScope(): CalendarScope {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    return v === 'week' || v === 'day' ? v : 'month';
  } catch {
    return 'month';
  }
}
const LANES_KEY = 'boardcache:kanbanLanes';
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const LAYOUT_KEY = 'boardcache:kanbanLayout';
function loadLayout(): KanbanLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'row' ? 'row' : 'stacked';
  } catch {
    return 'stacked';
  }
}
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** UI state for the Projects suite: which project the view shows and which
 *  dialog is open. Document data lives on the items (see lib/projects.ts). */
export const useProjectsUi = create<{
  /** Project open in the full-screen view (null = the All Projects index). Routed: /b/:id/projects/:projectId. */
  projectId: string | null;
  setProject: (id: string | null) => void;
  /** List / Kanban / Calendar — remembered per device. */
  mode: ProjectsMode;
  setMode: (mode: ProjectsMode) => void;
  /** Task order in List / Board (manual = the project's own order). */
  sort: TaskSort;
  setSort: (sort: TaskSort) => void;
  /** Timeline scale: days / weeks / months (per device). */
  ganttScale: GanttScale;
  setGanttScale: (scale: GanttScale) => void;
  /** Timeline: milestones whose tasks are folded away (session only). */
  ganttFolded: string[];
  toggleGanttFold: (milestoneId: string) => void;
  /** Kanban on phones: columns stacked, or a horizontal scroller. */
  kanbanLayout: KanbanLayout;
  setKanbanLayout: (layout: KanbanLayout) => void;
  /** Calendar month shown (YYYY-MM). */
  calendarMonth: string;
  setCalendarMonth: (m: string) => void;
  /** Calendar: Month / Week / Day, and the day the week/day scopes anchor on. */
  calendarScope: CalendarScope;
  setCalendarScope: (scope: CalendarScope) => void;
  calendarDate: string;
  setCalendarDate: (d: string) => void;
  /** Focus a day without changing the month shown (a tap in Month). */
  setCalendarFocus: (d: string) => void;
  /** Kanban: swimlanes by milestone, and an optional single-milestone filter ('' = Tasks). */
  kanbanLanes: boolean;
  setKanbanLanes: (on: boolean) => void;
  kanbanMilestone: string | null;
  setKanbanMilestone: (id: string | null) => void;
  /** List: milestone sections folded away (session only). */
  listFolded: string[];
  toggleListFold: (key: string) => void;
  /** New-task dialog for a project. */
  newTaskFor: string | null;
  openNewTask: (projectId: string) => void;
  newProjectOpen: boolean;
  /** Project settings dialog. */
  settingsId: string | null;
  /** Milestone editor: an existing milestone of a project, or a new one for it. */
  milestone: { projectId: string; id: string } | { newFor: string } | null;
  /** Task editor. */
  task: { projectId: string; taskId: string } | null;
  /** Event editor, and the new-event dialog (for a project, on a day). */
  event: { projectId: string; eventId: string } | null;
  newEventFor: { projectId: string; day: string } | null;
  openEvent: (projectId: string, eventId: string) => void;
  openNewEvent: (projectId: string, day: string) => void;
  openNewProject: () => void;
  openSettings: (id: string) => void;
  openMilestone: (projectId: string, id: string) => void;
  openNewMilestone: (projectId: string) => void;
  openTask: (projectId: string, taskId: string) => void;
  closeDialogs: () => void;
}>((set) => ({
  projectId: null,
  setProject: (projectId) => set({ projectId }),
  mode: loadMode(),
  setMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* storage unavailable */
    }
    set({ mode });
  },
  ganttScale: loadGanttScale(),
  setGanttScale: (ganttScale) => {
    try {
      localStorage.setItem(GANTT_SCALE_KEY, ganttScale);
    } catch {
      /* storage unavailable */
    }
    set({ ganttScale });
  },
  ganttFolded: [],
  toggleGanttFold: (id) =>
    set((s) => ({
      ganttFolded: s.ganttFolded.includes(id)
        ? s.ganttFolded.filter((x) => x !== id)
        : [...s.ganttFolded, id],
    })),
  kanbanLayout: loadLayout(),
  setKanbanLayout: (kanbanLayout) => {
    try {
      localStorage.setItem(LAYOUT_KEY, kanbanLayout);
    } catch {
      /* storage unavailable */
    }
    set({ kanbanLayout });
  },
  sort: loadSort(),
  setSort: (sort) => {
    try {
      localStorage.setItem(SORT_KEY, sort);
    } catch {
      /* storage unavailable */
    }
    set({ sort });
  },
  calendarMonth: thisMonth(),
  setCalendarMonth: (calendarMonth) => set({ calendarMonth }),
  calendarScope: loadScope(),
  setCalendarScope: (calendarScope) => {
    try {
      localStorage.setItem(SCOPE_KEY, calendarScope);
    } catch {
      /* storage unavailable */
    }
    set({ calendarScope });
  },
  calendarDate: todayKey(),
  setCalendarDate: (calendarDate) => set({ calendarDate, calendarMonth: calendarDate.slice(0, 7) }),
  setCalendarFocus: (calendarDate) => set({ calendarDate }),
  kanbanLanes: (() => {
    try {
      return localStorage.getItem(LANES_KEY) === '1';
    } catch {
      return false;
    }
  })(),
  setKanbanLanes: (kanbanLanes) => {
    try {
      localStorage.setItem(LANES_KEY, kanbanLanes ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    set({ kanbanLanes });
  },
  kanbanMilestone: null,
  setKanbanMilestone: (kanbanMilestone) => set({ kanbanMilestone }),
  listFolded: [],
  toggleListFold: (key) =>
    set((s) => ({
      listFolded: s.listFolded.includes(key)
        ? s.listFolded.filter((x) => x !== key)
        : [...s.listFolded, key],
    })),
  newTaskFor: null,
  openNewTask: (newTaskFor) => set({ newTaskFor }),
  newProjectOpen: false,
  settingsId: null,
  milestone: null,
  task: null,
  openNewProject: () => set({ newProjectOpen: true }),
  openSettings: (settingsId) => set({ settingsId }),
  openMilestone: (projectId, id) => set({ milestone: { projectId, id }, event: null }),
  openNewMilestone: (newFor) => set({ milestone: { newFor } }),
  openTask: (projectId, taskId) => set({ task: { projectId, taskId }, event: null }),
  event: null,
  newEventFor: null,
  openEvent: (projectId, eventId) =>
    set({ event: { projectId, eventId }, task: null, milestone: null }),
  openNewEvent: (projectId, day) => set({ newEventFor: { projectId, day } }),
  closeDialogs: () =>
    set({
      newProjectOpen: false,
      settingsId: null,
      milestone: null,
      task: null,
      newTaskFor: null,
      event: null,
      newEventFor: null,
    }),
}));
