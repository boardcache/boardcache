import { Fragment, useEffect, useState } from 'react';
import { SimpleMarkdown } from '../../components/ui/SimpleMarkdown';
import type { ProjectItem, ProjectMilestone, ProjectTask } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import {
  BoardsIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  GanttIcon,
  GearIcon,
  KanbanIcon,
  ListIcon,
  MilestoneIcon,
  PlusIcon,
} from '../../components/icons';
import { ProjectContent } from '../../components/items/ProjectContent';
import { CalendarView } from './CalendarView';
import { EventDialog, MilestoneDialog, TaskDialog } from './dialogs';
import { useNow } from './useNow';
import { GanttView } from './GanttView';
import { KanbanView } from './KanbanView';
import type { ProjectsMode } from './store';
import { UiSelect } from '../../components/ui/Select';
import { ThemeToggle } from '../../components/chrome/ThemeToggle';
import {
  PROJECT_STATUS_LABEL,
  TASK_SORT_LABEL,
  TASK_STATUS_LABEL,
  addTask,
  assigneeName,
  dropTaskInSection,
  formatDate,
  formatDuration,
  isOverdue,
  milestoneProgress,
  milestoneTimeSpent,
  milestonesOf,
  projectProgress,
  projectsOf,
  setTaskStatus,
  sortTasks,
  taskTimeSpent,
  type TaskSort,
  updateTask,
  isClosedStatus,
} from '../../lib/structure/projects';
import { DropSlot, Grip, useTaskDrag } from './dnd';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useProjectsUi } from './store';

/**
 * The Projects view (full-screen, gallery chassis). The root is the All
 * Projects index — every project's summary card; open one and the header
 * becomes a breadcrumb (Projects › ⟨switcher⟩) with the List / Board /
 * Calendar / Timeline modes. The open project survives a reload.
 */
export function ProjectsView() {
  const projects = useDocumentStore(useShallow((s) => projectsOf(s.doc)));
  const chosen = useProjectsUi((s) => s.projectId);
  const project = (chosen && projects.find((p) => p.id === chosen)) || null;
  // A deleted project falls back to the index.
  useEffect(() => {
    if (chosen && !project) useProjectsUi.getState().setProject(null);
  }, [project, chosen]);

  const back = () => useSessionStore.getState().setView('canvas');
  const mode = useProjectsUi((s) => s.mode);
  const sort = useProjectsUi((s) => s.sort);

  return (
    <div className="gallery-screen projects-screen" data-testid="projects-screen">
      <header className="gallery-header projects-bar">
        <div className="gallery-header-left">
          <h1 data-testid="projects-title">
            {project ? (
              <button
                type="button"
                className="projects-crumb-root"
                data-testid="projects-all"
                title="All projects"
                onClick={() => useProjectsUi.getState().setProject(null)}
              >
                Projects
              </button>
            ) : (
              'Projects'
            )}
          </h1>
          {project && (
            <>
              <span className="projects-crumb-sep" aria-hidden>
                ›
              </span>
              <UiSelect
                value={project.id}
                ariaLabel="Project"
                testId="projects-switcher"
                options={projects.map((p) => ({ value: p.id, label: p.title }))}
                onChange={(id) => useProjectsUi.getState().setProject(id)}
              />
              <ModeSwitch />
            </>
          )}
        </div>
        <div className="gallery-actions">
          {project && mode !== 'calendar' && (
            <div className="gallery-sort">
              <UiSelect
                value={sort}
                ariaLabel="Sort by"
                testId="projects-sort"
                options={SORTS.map((s) => ({ value: s, label: TASK_SORT_LABEL[s] }))}
                onChange={(v) => useProjectsUi.getState().setSort(v as TaskSort)}
              />
            </div>
          )}
          {/* New projects start from the index (or the canvas) — never from
              inside a project, where a + would read as "new task/milestone". */}
          {!project && (
            <button
              type="button"
              className="gallery-action-btn"
              data-testid="projects-new"
              onClick={() => useProjectsUi.getState().openNewProject()}
            >
              <PlusIcon size={15} /> <span className="pj-label">New project</span>
            </button>
          )}
          <ThemeToggle className="gallery-theme-toggle" testId="projects-theme-toggle" />
          <button
            type="button"
            className="gallery-back"
            aria-label="Back to canvas"
            title="Back to the canvas"
            data-testid="projects-back"
            onClick={back}
          >
            <BoardsIcon size={17} />
          </button>
        </div>
      </header>

      <div className="projects-split">
        <div className="projects-scroll">
          {project ? (
            <ProjectList project={project} />
          ) : projects.length > 0 ? (
            <ProjectsIndex projects={projects} />
          ) : (
            <div className="projects-empty" data-testid="projects-empty">
              <MilestoneIcon size={28} />
              <p>No projects on this board yet.</p>
              <button
                type="button"
                className="gallery-action-btn"
                onClick={() => useProjectsUi.getState().openNewProject()}
              >
                <PlusIcon size={15} /> New project
              </button>
            </div>
          )}
        </div>
        <TaskDialog />
        <MilestoneDialog />
        <EventDialog />
      </div>
    </div>
  );
}

const SORTS: TaskSort[] = ['manual', 'due', 'name', 'created'];

/** All Projects: every project's summary card (the canvas card, unscaled); click to open. */
function ProjectsIndex({ projects }: { projects: ProjectItem[] }) {
  const open = (id: string) => useProjectsUi.getState().setProject(id);
  return (
    <div className="projects-index" data-testid="projects-index">
      {projects.map((p) => (
        <div
          key={p.id}
          role="button"
          tabIndex={0}
          className="projects-index-card"
          data-testid="projects-index-card"
          onClick={() => open(p.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open(p.id);
            }
          }}
        >
          <ProjectContent item={p} stage />
        </div>
      ))}
    </div>
  );
}

const MODES: { id: ProjectsMode; label: string; icon: React.ReactNode }[] = [
  { id: 'list', label: 'List', icon: <ListIcon size={15} /> },
  { id: 'kanban', label: 'Board', icon: <KanbanIcon size={15} /> },
  { id: 'calendar', label: 'Calendar', icon: <CalendarIcon size={15} /> },
  { id: 'gantt', label: 'Timeline', icon: <GanttIcon size={15} /> },
];

/** The same segmented pill the library uses for its view modes. */
function ModeSwitch() {
  const mode = useProjectsUi((s) => s.mode);
  return (
    <div className="library-view-switch projects-modes" role="group" aria-label="View">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={mode === m.id ? 'active' : ''}
          aria-pressed={mode === m.id}
          aria-label={m.label}
          title={m.label}
          data-testid={`projects-mode-${m.id}`}
          onClick={() => useProjectsUi.getState().setMode(m.id)}
        >
          {m.icon}
        </button>
      ))}
    </div>
  );
}

function ProjectList({ project }: { project: ProjectItem }) {
  const milestones = milestonesOf(project);
  const progress = projectProgress(project);
  const ui = useProjectsUi.getState();
  const mode = useProjectsUi((s) => s.mode);
  const sort = useProjectsUi((s) => s.sort);
  const manual = sort === 'manual';
  const backlog = project.tasks.filter(
    (t) => !t.milestoneId || !milestones.some((m) => m.id === t.milestoneId),
  );
  // Rows drag between sections (milestone) and, in manual order, within one.
  const drag = useTaskDrag({
    manual,
    vertical: true,
    onDrop: (task, t) => {
      if (t)
        dropTaskInSection(
          project.id,
          task,
          t.key,
          t.beforeId,
          manual,
          milestones.map((m) => m.id),
        );
    },
  });
  const sectionProps = { project, sort, manual, drag };
  return (
    <div className={`projects-body mode-${mode}`} data-testid="projects-list">
      <div
        className="projects-summary"
        style={project.color ? { ['--project-accent' as string]: project.color } : undefined}
      >
        <div className="projects-summary-head">
          <span className="project-dot" aria-hidden />
          <h2 className="projects-summary-title" data-testid="projects-project-title">
            {project.title}
          </h2>
          <span className={`project-status status-${project.status}`}>
            {PROJECT_STATUS_LABEL[project.status]}
          </span>
          <span className="pj-spacer" />
          <button
            type="button"
            className="gallery-action-btn"
            data-testid="projects-new-task"
            onClick={() => ui.openNewTask(project.id)}
          >
            <PlusIcon size={14} /> <span className="pj-label">New task</span>
          </button>
          <button
            type="button"
            className="gallery-action-btn"
            data-testid="projects-new-milestone"
            onClick={() => ui.openNewMilestone(project.id)}
          >
            <MilestoneIcon size={14} /> <span className="pj-label">New milestone</span>
          </button>
          <button
            type="button"
            className="gallery-action-btn projects-iconbtn"
            aria-label="Project settings"
            title="Project settings"
            data-testid="projects-settings"
            onClick={() => ui.openSettings(project.id)}
          >
            <GearIcon size={15} />
          </button>
        </div>
        {(project.startDate || project.endDate) && (
          <div className="project-dates">
            {formatDate(project.startDate) || '…'}
            <span className="project-dates-arrow" aria-hidden>
              →
            </span>
            {formatDate(project.endDate) || '…'}
          </div>
        )}
        {project.description && (
          <SimpleMarkdown
            text={project.description}
            className="projects-summary-desc"
            testId="projects-summary-desc"
          />
        )}
        <div className="project-progress">
          <i style={{ width: `${Math.round(progress.frac * 100)}%` }} />
        </div>
        <div className="project-meta" data-testid="projects-progress">
          {progress.total ? `${progress.done}/${progress.total} tasks done` : 'No tasks yet'}
        </div>
      </div>

      {mode === 'kanban' ? (
        <KanbanView project={project} />
      ) : mode === 'calendar' ? (
        <CalendarView project={project} />
      ) : mode === 'gantt' ? (
        <GanttView project={project} />
      ) : (
        <>
          {milestones.map((m) => (
            <MilestoneSection key={m.id} {...sectionProps} milestone={m} />
          ))}
          <TaskSection
            {...sectionProps}
            title="Tasks"
            milestoneId={null}
            tasks={backlog}
            testId="projects-section-unscheduled"
          />
        </>
      )}
    </div>
  );
}

/** Cumulative time across a milestone's tasks. */
function MilestoneTimeChip({
  project,
  milestoneId,
}: {
  project: ProjectItem;
  milestoneId: string;
}) {
  const live = project.tasks.some((t) => t.milestoneId === milestoneId && !!t.timerStartedAt);
  const now = useNow(live);
  const sec = milestoneTimeSpent(project, milestoneId, now);
  if (!live && sec < 1) return null;
  return (
    <span
      className={`projects-section-time${live ? ' live' : ''}`}
      title="Time spent"
      data-testid="milestone-time-chip"
    >
      {formatDuration(sec)}
    </span>
  );
}

type ListDrag = ReturnType<typeof useTaskDrag>;
interface SectionShared {
  project: ProjectItem;
  sort: TaskSort;
  manual: boolean;
  drag: ListDrag;
}

function MilestoneSection({
  milestone,
  ...shared
}: SectionShared & { milestone: ProjectMilestone }) {
  const { project } = shared;
  const tasks = project.tasks.filter((t) => t.milestoneId === milestone.id);
  const mp = milestoneProgress(project, milestone.id);
  return (
    <TaskSection
      {...shared}
      title={milestone.title}
      milestoneId={milestone.id}
      tasks={tasks}
      testId="projects-section"
      onOpen={() => useProjectsUi.getState().openMilestone(project.id, milestone.id)}
      head={
        <>
          <button
            type="button"
            className="projects-section-edit"
            aria-label={`Edit milestone ${milestone.title}`}
            onClick={() => useProjectsUi.getState().openMilestone(project.id, milestone.id)}
          >
            <MilestoneIcon size={14} />
          </button>
          {milestone.endDate && (
            <span
              className={`projects-section-date${isOverdue(milestone.endDate, milestone.status === 'done') ? ' overdue' : ''}`}
            >
              {formatDate(milestone.endDate)}
            </span>
          )}
          {mp.total > 0 && (
            <span className="projects-section-count">
              {mp.done}/{mp.total}
            </span>
          )}
          <MilestoneTimeChip project={project} milestoneId={milestone.id} />
        </>
      }
    />
  );
}

function TaskSection({
  project,
  sort,
  manual,
  drag,
  title,
  milestoneId,
  tasks,
  head,
  testId,
  onOpen,
}: SectionShared & {
  title: string;
  milestoneId: string | null;
  tasks: ProjectTask[];
  head?: React.ReactNode;
  testId: string;
  /** Opens the milestone (its name is a button when given). */
  onOpen?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const folded = useProjectsUi((s) => s.listFolded.includes(milestoneId ?? ''));
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    addTask(project.id, t, milestoneId);
    setDraft('');
  };
  const key = milestoneId ?? '';
  const here = drag.target?.key === key;
  const slotBefore = (id: string | null) =>
    here && drag.slot !== null && drag.target?.beforeId === id;
  return (
    <section
      className={`projects-section${here && !manual ? ' drop-over' : ''}`}
      data-drop-key={key}
      data-testid={testId}
    >
      <div className="projects-section-head">
        <button
          type="button"
          className={`projects-section-fold${folded ? ' folded' : ''}`}
          aria-label={folded ? `Expand ${title}` : `Collapse ${title}`}
          aria-expanded={!folded}
          data-testid="projects-section-fold"
          onClick={() => useProjectsUi.getState().toggleListFold(milestoneId ?? '')}
        >
          <ChevronDownIcon size={16} />
        </button>
        {onOpen ? (
          <button
            type="button"
            className="projects-section-title"
            data-testid="projects-section-title"
            onClick={onOpen}
          >
            <h3>{title}</h3>
          </button>
        ) : (
          <h3>{title}</h3>
        )}
        {head}
        {folded && tasks.length > 0 && (
          <span className="projects-section-count">{tasks.length}</span>
        )}
      </div>
      {!folded && (
        <div className="projects-tasks">
          {sortTasks(tasks, sort).map((t) => (
            <Fragment key={t.id}>
              {slotBefore(t.id) && <DropSlot height={drag.slot!} />}
              <TaskRow project={project} task={t} drag={drag} />
            </Fragment>
          ))}
          {slotBefore(null) && <DropSlot height={drag.slot!} />}
          <div className="projects-task-add">
            <PlusIcon size={14} />
            <input
              className="projects-task-add-input"
              placeholder="Add a task"
              value={draft}
              data-testid={`${testId}-add`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') add();
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

/** Time spent on a task (ticking while its timer runs); nothing when none. */
export function TaskTimeChip({
  task,
  className = 'projects-task-time',
}: {
  task: ProjectTask;
  className?: string;
}) {
  const live = !!task.timerStartedAt;
  const now = useNow(live);
  const sec = taskTimeSpent(task, now);
  if (!live && sec < 1) return null;
  return (
    <span
      className={`${className}${live ? ' live' : ''}`}
      title="Time spent"
      data-testid="task-time-chip"
    >
      {formatDuration(sec)}
    </span>
  );
}

/** Initials chip for an assignee (team boards); nothing when unassigned. */
export function AssigneeChip({ id }: { id: string | null }) {
  const name = assigneeName(id);
  if (!name) return null;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="pj-assignee" title={name} data-testid="task-assignee">
      {initials}
    </span>
  );
}

/** A task row: check, title (opens the editor), chips. With `drag`, it reorders. */
export function TaskRow({
  project,
  task,
  drag,
}: {
  project: ProjectItem;
  task: ProjectTask;
  drag?: ListDrag;
}) {
  const done = task.status === 'done';
  const subDone = task.subtasks.filter((s) => s.done).length;
  const toggle = () =>
    updateTask(project.id, task.id, done ? 'Reopen task' : 'Complete task', (t, p) => {
      setTaskStatus(p, t, done ? 'todo' : 'done');
    });
  return (
    <div
      className={`projects-task status-${task.status}${drag?.draggingId === task.id ? ' dragging' : ''}`}
      data-testid="projects-task"
      data-task-id={task.id}
      style={drag?.ghost(task.id)}
      onPointerDown={drag ? (e) => drag.beginDrag(e, task) : undefined}
    >
      {drag && <Grip className="projects-task-grip" />}
      <button
        type="button"
        className={`projects-task-check${done ? ' on' : ''}`}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? 'Reopen' : 'Complete'}
        data-testid="projects-task-check"
        onClick={toggle}
      >
        {done && <CheckIcon size={12} />}
      </button>
      <button
        type="button"
        className="projects-task-main"
        data-testid="projects-task-title"
        onClick={() => useProjectsUi.getState().openTask(project.id, task.id)}
      >
        <span className="projects-task-title">{task.title}</span>
        {task.status !== 'todo' && task.status !== 'done' && (
          <span className={`project-status status-${task.status}`}>
            {TASK_STATUS_LABEL[task.status]}
          </span>
        )}
        {task.subtasks.length > 0 && (
          <span className="projects-task-sub">
            {subDone}/{task.subtasks.length}
          </span>
        )}
        {task.itemIds.length > 0 && (
          <span className="projects-task-sub" title="Linked board items">
            {task.itemIds.length} item{task.itemIds.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="pj-spacer" />
        <TaskTimeChip task={task} />
        <AssigneeChip id={task.assignee} />
        {task.due && (
          <span
            className={`projects-task-due${isOverdue(task.due, isClosedStatus(task.status)) ? ' overdue' : ''}`}
          >
            {formatDate(task.due)}
          </span>
        )}
      </button>
    </div>
  );
}
