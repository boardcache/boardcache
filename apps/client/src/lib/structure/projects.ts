import type {
  CanvasDocument,
  ProjectColumn,
  ProjectComment,
  ProjectEvent,
  ProjectItem,
  ProjectMilestone,
  ProjectTask,
  ProjectTaskStatus,
} from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { currentAuthor, updateItems } from '../../state/commands';
import { useCollabStore } from '../../state/collabStore';

/**
 * Projects suite helpers (docs/archive/PROJECTS_PLAN.md): labeled-undo writers for
 * project cards and their embedded milestones/tasks, derived views, and the
 * association index (which PM entities reference a board item).
 */

/** Canvas card design width: the card renders at this and scales with the item. */
export const PROJECT_CARD_W = 340;

export const TASK_STATUS_LABEL: Record<ProjectTaskStatus, string> = {
  todo: 'To do',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  missed: 'Missed',
};
export const TASK_STATUSES: ProjectTaskStatus[] = ['todo', 'doing', 'blocked', 'done', 'missed'];

/** Done or missed: the task is closed — no reminders, never overdue. */
export const isClosedStatus = (status: ProjectTaskStatus): boolean =>
  status === 'done' || status === 'missed';

export const PROJECT_STATUS_LABEL: Record<ProjectItem['status'], string> = {
  planning: 'Planning',
  active: 'Active',
  'on-hold': 'On hold',
  done: 'Done',
};

export const MILESTONE_STATUS_LABEL: Record<ProjectMilestone['status'], string> = {
  planned: 'Planned',
  active: 'Active',
  done: 'Done',
};

/** One labeled undo entry per edit. */
export function updateProject(
  id: string,
  label: string,
  recipe: (draft: ProjectItem) => void,
): void {
  updateItems([id], label, (d) => {
    if (d.type === 'project') recipe(d);
  });
}

export function updateMilestone(
  projectId: string,
  milestoneId: string,
  label: string,
  recipe: (draft: ProjectMilestone, project: ProjectItem) => void,
): void {
  updateProject(projectId, label, (p) => {
    const m = p.milestones.find((x) => x.id === milestoneId);
    if (m) recipe(m, p);
  });
}

export function addMilestone(
  projectId: string,
  data: Partial<
    Pick<
      ProjectMilestone,
      'title' | 'description' | 'startDate' | 'endDate' | 'status' | 'dependsOn'
    >
  > = {},
): string {
  const id = newId();
  updateProject(projectId, 'Add milestone', (p) => {
    p.milestones.push({
      id,
      title: data.title?.trim() || 'Milestone',
      description: data.description ?? '',
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      status: data.status ?? 'planned',
      itemIds: [],
      dependsOn: (data.dependsOn ?? []).filter((d) => p.milestones.some((m) => m.id === d)),
      comments: [],
    });
  });
  return id;
}

// --- calendar events ---------------------------------------------------------------
// Local wall-clock strings: "YYYY-MM-DDTHH:mm".

export function updateEvent(
  projectId: string,
  eventId: string,
  label: string,
  recipe: (draft: ProjectEvent, project: ProjectItem) => void,
): void {
  updateProject(projectId, label, (p) => {
    const e = p.events.find((x) => x.id === eventId);
    if (e) recipe(e, p);
  });
}

export function addEvent(
  projectId: string,
  data: { title: string; start: string; end?: string | null; description?: string },
): string {
  const id = newId();
  const start = data.start;
  const end = data.end && data.end > start ? data.end : addMinutes(start, 60);
  updateProject(projectId, 'Add event', (p) => {
    p.events.push({
      id,
      title: data.title.trim() || 'Event',
      description: data.description ?? '',
      start,
      end,
    });
  });
  return id;
}

export function removeEvent(projectId: string, eventId: string): void {
  updateProject(projectId, 'Delete event', (p) => {
    p.events = p.events.filter((e) => e.id !== eventId);
  });
}

export function addMinutes(local: string, minutes: number): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  d.setMinutes(d.getMinutes() + minutes);
  return localDateTime(d);
}

function localDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "9:30 AM" (locale) from a local wall-clock string. */
export function formatTime(local: string): string {
  const d = new Date(local);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Minutes since midnight of the event's start / end on a given day (clamped). */
export function eventSpanOn(e: ProjectEvent, dayKey: string): { from: number; to: number } | null {
  const s = new Date(e.start);
  const en = new Date(e.end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(en.getTime())) return null;
  const day0 = new Date(`${dayKey}T00:00:00`);
  const day1 = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + 1);
  if (en <= day0 || s >= day1) return null;
  const from = Math.max(0, (Math.max(s.getTime(), day0.getTime()) - day0.getTime()) / 60000);
  const to = Math.min(1440, (Math.min(en.getTime(), day1.getTime()) - day0.getTime()) / 60000);
  return { from, to: Math.max(to, from + 15) };
}

// --- comments (tasks + milestones) ---------------------------------------------

function makeComment(text: string): ProjectComment {
  const a = currentAuthor();
  return {
    id: newId(),
    author: a.name,
    ...(a.color ? { color: a.color } : {}),
    ...(a.userId ? { userId: a.userId } : {}),
    text: text.trim().slice(0, 4000),
    createdAt: new Date().toISOString(),
  };
}

export function addTaskComment(projectId: string, taskId: string, text: string): void {
  if (!text.trim()) return;
  updateTask(projectId, taskId, 'Add comment', (t) => t.comments.push(makeComment(text)));
}

export function removeTaskComment(projectId: string, taskId: string, commentId: string): void {
  updateTask(
    projectId,
    taskId,
    'Delete comment',
    (t) => (t.comments = t.comments.filter((c) => c.id !== commentId)),
  );
}

export function addMilestoneComment(projectId: string, milestoneId: string, text: string): void {
  if (!text.trim()) return;
  updateMilestone(projectId, milestoneId, 'Add comment', (m) => m.comments.push(makeComment(text)));
}

export function removeMilestoneComment(
  projectId: string,
  milestoneId: string,
  commentId: string,
): void {
  updateMilestone(
    projectId,
    milestoneId,
    'Delete comment',
    (m) => (m.comments = m.comments.filter((c) => c.id !== commentId)),
  );
}

// --- timers ----------------------------------------------------------------------
// A task accumulates `timeSpent` seconds; while running, `timerStartedAt`
// holds the stint's start (it syncs, so every device shows it ticking).

const stint = (t: ProjectTask, now: number) =>
  t.timerStartedAt ? Math.max(0, (now - Date.parse(t.timerStartedAt)) / 1000) : 0;

export function taskTimeSpent(t: ProjectTask, now = Date.now()): number {
  return t.timeSpent + stint(t, now);
}

/** Total across a milestone's tasks (`milestoneId` null = the tasks without one). */
export function milestoneTimeSpent(
  p: ProjectItem,
  milestoneId: string | null,
  now = Date.now(),
): number {
  return p.tasks
    .filter((t) =>
      milestoneId
        ? t.milestoneId === milestoneId
        : !t.milestoneId || !p.milestones.some((m) => m.id === t.milestoneId),
    )
    .reduce((sum, t) => sum + taskTimeSpent(t, now), 0);
}

/** Start a task's timer; any other running timer in the project stops first. */
export function startTaskTimer(projectId: string, taskId: string): void {
  updateProject(projectId, 'Start timer', (p) => {
    const now = Date.now();
    for (const t of p.tasks) {
      if (t.id !== taskId && t.timerStartedAt) {
        t.timeSpent += stint(t, now);
        t.timerStartedAt = null;
      }
    }
    const t = p.tasks.find((x) => x.id === taskId);
    if (t && !t.timerStartedAt) t.timerStartedAt = new Date(now).toISOString();
  });
}

export function stopTaskTimer(projectId: string, taskId: string): void {
  updateTask(projectId, taskId, 'Stop timer', (t) => {
    if (!t.timerStartedAt) return;
    t.timeSpent += stint(t, Date.now());
    t.timerStartedAt = null;
  });
}

/** "45s", "12m", "3h 05m". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60) % 60;
  const h = Math.floor(s / 3600);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Delete a milestone: its tasks become Tasks, dependents forget it. */
export function removeMilestone(projectId: string, milestoneId: string): void {
  updateProject(projectId, 'Delete milestone', (p) => {
    p.milestones = p.milestones.filter((m) => m.id !== milestoneId);
    for (const m of p.milestones) m.dependsOn = m.dependsOn.filter((d) => d !== milestoneId);
    for (const t of p.tasks) if (t.milestoneId === milestoneId) t.milestoneId = null;
  });
}

export function updateTask(
  projectId: string,
  taskId: string,
  label: string,
  recipe: (draft: ProjectTask, project: ProjectItem) => void,
): void {
  updateProject(projectId, label, (p) => {
    const t = p.tasks.find((x) => x.id === taskId);
    if (t) recipe(t, p);
  });
}

// --- Kanban columns ------------------------------------------------------------
// A column is a named lane with a status role. The built-in lanes are the
// four statuses; a project materialises its own list the first time it is
// customised. A task's status is always its column's status.

const DEFAULT_COLUMNS: ProjectColumn[] = (['todo', 'doing', 'blocked', 'done'] as const).map(
  (s) => ({
    id: s,
    title: TASK_STATUS_LABEL[s],
    status: s,
  }),
);

const MISSED_COLUMN: ProjectColumn = {
  id: 'missed',
  title: TASK_STATUS_LABEL.missed,
  status: 'missed',
};

/** The lanes to show. Missed tasks get a trailing lane the moment one exists,
 *  unless the project already has a lane that means missed. */
export function columnsOf(p: ProjectItem): ProjectColumn[] {
  const cols = p.columns.length ? p.columns : DEFAULT_COLUMNS;
  if (cols.some((c) => c.status === 'missed') || !p.tasks.some((t) => t.status === 'missed')) {
    return cols;
  }
  return [...cols, MISSED_COLUMN];
}

/** The column a task sits in: its own, else the lane for its status. */
export function columnOf(p: ProjectItem, t: ProjectTask): ProjectColumn {
  const cols = columnsOf(p);
  return (
    cols.find((c) => c.id === t.columnId) ??
    cols.find((c) => c.id === t.status) ??
    cols.find((c) => c.status === t.status) ??
    cols[0]!
  );
}

/** Put a task in a column (its status follows). Drafts only. */
export function setTaskColumn(p: ProjectItem, t: ProjectTask, columnId: string): void {
  const col = columnsOf(p).find((c) => c.id === columnId);
  if (!col) return;
  t.columnId = col.id;
  t.status = col.status;
}

/** Change a task's status; it moves to a lane with that role if its current
 *  column means something else. Drafts only. */
export function setTaskStatus(p: ProjectItem, t: ProjectTask, status: ProjectTaskStatus): void {
  t.status = status;
  const cols = columnsOf(p);
  const cur = cols.find((c) => c.id === t.columnId);
  if (cur?.status === status) return;
  t.columnId =
    (
      cols.find((c) => c.id === status && c.status === status) ??
      cols.find((c) => c.status === status)
    )?.id ?? null;
}

function ensureColumns(p: ProjectItem): ProjectColumn[] {
  // Materialise what the board shows (a virtual Missed lane included) so an
  // edit to any visible lane sticks.
  const shown = columnsOf(p);
  if (shown !== p.columns) p.columns = shown.map((c) => ({ ...c }));
  return p.columns;
}

export function addColumn(
  projectId: string,
  title: string,
  status: ProjectTaskStatus = 'todo',
  afterId?: string,
): string {
  const id = newId();
  updateProject(projectId, 'Add column', (p) => {
    const cols = ensureColumns(p);
    const at = afterId ? cols.findIndex((c) => c.id === afterId) : -1;
    cols.splice(at === -1 ? cols.length : at + 1, 0, {
      id,
      title: title.trim() || 'Column',
      status,
    });
  });
  return id;
}

export function renameColumn(projectId: string, columnId: string, title: string): void {
  updateProject(projectId, 'Rename column', (p) => {
    const col = ensureColumns(p).find((c) => c.id === columnId);
    if (col) col.title = title.trim() || col.title;
  });
}

/** Change what a column means; every task in it follows. */
export function setColumnStatus(
  projectId: string,
  columnId: string,
  status: ProjectTaskStatus,
): void {
  updateProject(projectId, 'Column status', (p) => {
    const col = ensureColumns(p).find((c) => c.id === columnId);
    if (!col) return;
    col.status = status;
    for (const t of p.tasks)
      if (columnOf(p, t).id === col.id) {
        t.columnId = col.id;
        t.status = status;
      }
  });
}

/** Remove a column; its tasks move to the first remaining one. */
export function removeColumn(projectId: string, columnId: string): void {
  updateProject(projectId, 'Delete column', (p) => {
    const cols = ensureColumns(p);
    if (cols.length < 2) return;
    const rest = cols.filter((c) => c.id !== columnId);
    const home = rest[0]!;
    for (const t of p.tasks)
      if (columnOf(p, t).id === columnId) {
        t.columnId = home.id;
        t.status = home.status;
      }
    p.columns = rest;
  });
}

export function reorderColumns(projectId: string, order: string[]): void {
  updateProject(projectId, 'Reorder columns', (p) => {
    const cols = ensureColumns(p);
    const next = order
      .map((id) => cols.find((c) => c.id === id))
      .filter((c): c is ProjectColumn => !!c);
    if (next.length === cols.length) p.columns = next;
  });
}

export function newTask(title: string, milestoneId: string | null = null): ProjectTask {
  return {
    id: newId(),
    title,
    description: '',
    status: 'todo',
    milestoneId,
    start: null,
    due: null,
    end: null,
    assignee: null,
    notifiedAt: null,
    createdAt: new Date().toISOString(),
    columnId: null,
    comments: [],
    timeSpent: 0,
    timerStartedAt: null,
    subtasks: [],
    itemIds: [],
  };
}

// --- ordering ------------------------------------------------------------------
// The project's task array IS the manual order (persisted, syncs, undoable).
// Other sorts are non-destructive views over it.

export type TaskSort = 'manual' | 'due' | 'name' | 'created';
export const TASK_SORT_LABEL: Record<TaskSort, string> = {
  manual: 'Manual',
  due: 'Due date',
  name: 'Name',
  created: 'Created',
};

export function sortTasks(tasks: ProjectTask[], sort: TaskSort): ProjectTask[] {
  if (sort === 'manual') return tasks;
  const out = [...tasks];
  const last = '￿';
  if (sort === 'due') out.sort((a, b) => (a.due ?? last).localeCompare(b.due ?? last));
  else if (sort === 'name') out.sort((a, b) => a.title.localeCompare(b.title));
  else out.sort((a, b) => (a.createdAt ?? last).localeCompare(b.createdAt ?? last));
  return out;
}

/**
 * Move a task in the manual order: directly before `beforeId`, or to the end
 * of the array when null. `patch` applies alongside (e.g. a new status or
 * milestone when a drag also crossed a column/section) — one undo entry.
 */
export function placeTask(
  projectId: string,
  taskId: string,
  beforeId: string | null,
  patch?: (t: ProjectTask, project: ProjectItem) => void,
  label = 'Reorder task',
): void {
  updateProject(projectId, label, (p) => {
    const idx = p.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return;
    const [task] = p.tasks.splice(idx, 1);
    if (!task) return;
    patch?.(task, p);
    const at = beforeId ? p.tasks.findIndex((t) => t.id === beforeId) : -1;
    if (at === -1) p.tasks.push(task);
    else p.tasks.splice(at, 0, task);
  });
}

/**
 * Drop a task into a milestone section (`sectionKey` '' = Tasks) —
 * the List and Timeline drags: in manual order it also takes the position
 * (`beforeId`); otherwise only a change of milestone is written.
 */
export function dropTaskInSection(
  projectId: string,
  task: ProjectTask,
  sectionKey: string,
  beforeId: string | null,
  manual: boolean,
  milestoneIds: string[],
): void {
  const ms = sectionKey || null;
  const current =
    task.milestoneId && milestoneIds.includes(task.milestoneId) ? task.milestoneId : null;
  const moved = ms !== current;
  const label = moved ? 'Move task' : 'Reorder task';
  if (manual)
    placeTask(projectId, task.id, beforeId, moved ? (x) => (x.milestoneId = ms) : undefined, label);
  else if (moved) updateTask(projectId, task.id, label, (x) => (x.milestoneId = ms));
}

export function addTask(
  projectId: string,
  title: string,
  milestoneId: string | null = null,
  columnId: string | null = null,
  init: Partial<Pick<ProjectTask, 'description' | 'due' | 'status'>> = {},
): string {
  const task = newTask(title, milestoneId);
  if (init.description) task.description = init.description;
  if (init.due) task.due = init.due;
  updateProject(projectId, 'Add task', (p) => {
    if (columnId) setTaskColumn(p, task, columnId);
    if (init.status && init.status !== task.status) setTaskStatus(p, task, init.status);
    p.tasks.push(task);
  });
  return task.id;
}

export function removeTask(projectId: string, taskId: string): void {
  updateProject(projectId, 'Delete task', (p) => {
    p.tasks = p.tasks.filter((t) => t.id !== taskId);
  });
}

/** All projects, in reading order. */
export function projectsOf(doc: CanvasDocument): ProjectItem[] {
  return Object.values(doc.items)
    .filter((i): i is ProjectItem => i.type === 'project')
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** A project's milestones: dated ones first by end date, then the rest. */
export function milestonesOf(project: ProjectItem): ProjectMilestone[] {
  return [...project.milestones].sort((a, b) => {
    const ae = a.endDate ?? '￿';
    const be = b.endDate ?? '￿';
    return ae < be ? -1 : ae > be ? 1 : a.title.localeCompare(b.title);
  });
}

export function projectProgress(project: ProjectItem): {
  done: number;
  total: number;
  frac: number;
} {
  const total = project.tasks.length;
  const done = project.tasks.filter((t) => t.status === 'done').length;
  return { done, total, frac: total ? done / total : 0 };
}

export function milestoneProgress(
  project: ProjectItem,
  milestoneId: string,
): { done: number; total: number; frac: number } {
  const tasks = project.tasks.filter((t) => t.milestoneId === milestoneId);
  const done = tasks.filter((t) => t.status === 'done').length;
  return { done, total: tasks.length, frac: tasks.length ? done / tasks.length : 0 };
}

/** "Sep 14" / "Sep 14, 2027" for ISO dates; passes anything else through. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function isOverdue(iso: string | null | undefined, done: boolean): boolean {
  if (!iso || done) return false;
  const d = new Date(iso.length === 10 ? `${iso}T23:59:59` : iso);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

export interface Membership {
  projectId: string;
  projectTitle: string;
  /** Where the reference lives. */
  kind: 'project' | 'milestone' | 'task';
  /** Milestone or task id for non-project memberships. */
  id: string;
  title: string;
}

/** Every project/milestone/task that references a board item. */
export function membershipsOf(doc: CanvasDocument, itemId: string): Membership[] {
  const out: Membership[] = [];
  for (const p of projectsOf(doc)) {
    if (p.itemIds.includes(itemId)) {
      out.push({
        projectId: p.id,
        projectTitle: p.title,
        kind: 'project',
        id: p.id,
        title: p.title,
      });
    }
    for (const t of p.tasks) {
      if (t.itemIds.includes(itemId)) {
        out.push({
          projectId: p.id,
          projectTitle: p.title,
          kind: 'task',
          id: t.id,
          title: t.title,
        });
      }
    }
  }
  for (const p of projectsOf(doc)) {
    for (const m of p.milestones) {
      if (m.itemIds.includes(itemId)) {
        out.push({
          projectId: p.id,
          projectTitle: p.title,
          kind: 'milestone',
          id: m.id,
          title: m.title,
        });
      }
    }
  }
  return out;
}

/** Attach board items to a project / milestone / task (idempotent). */
export function linkItems(
  target:
    | { kind: 'project'; projectId: string }
    | { kind: 'milestone'; projectId: string; milestoneId: string }
    | { kind: 'task'; projectId: string; taskId: string },
  itemIds: string[],
): void {
  const add = (list: string[]) => {
    for (const id of itemIds) if (!list.includes(id)) list.push(id);
  };
  if (target.kind === 'project')
    updateProject(target.projectId, 'Add to project', (p) => add(p.itemIds));
  else if (target.kind === 'milestone')
    updateMilestone(target.projectId, target.milestoneId, 'Add to milestone', (m) =>
      add(m.itemIds),
    );
  else updateTask(target.projectId, target.taskId, 'Add to task', (t) => add(t.itemIds));
}

export function unlinkItem(m: Membership, itemId: string): void {
  const drop = (list: string[]) => list.filter((id) => id !== itemId);
  if (m.kind === 'project')
    updateProject(m.projectId, 'Remove from project', (p) => (p.itemIds = drop(p.itemIds)));
  else if (m.kind === 'milestone')
    updateMilestone(
      m.projectId,
      m.id,
      'Remove from milestone',
      (ms) => (ms.itemIds = drop(ms.itemIds)),
    );
  else updateTask(m.projectId, m.id, 'Remove from task', (t) => (t.itemIds = drop(t.itemIds)));
}

/** Assignable people on a live team board: account members (self included). */
export function assigneeOptions(): { id: string; name: string }[] {
  const { members, self } = useCollabStore.getState();
  const out = members.map((m) => ({ id: m.userId, name: m.username }));
  if (self && !out.some((o) => o.name === self.name)) out.unshift({ id: self.id, name: self.name });
  return out;
}

/** Display name for a stored assignee id (member username, else the id). */
export function assigneeName(id: string | null): string | null {
  if (!id) return null;
  const { members, self } = useCollabStore.getState();
  return members.find((m) => m.userId === id)?.username ?? (self?.id === id ? self.name : id);
}
