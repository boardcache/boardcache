import { Fragment, useState } from 'react';
import type {
  ProjectColumn,
  ProjectItem,
  ProjectTask,
  ProjectTaskStatus,
} from '@boardcache/schema';
import {
  ColumnsIcon,
  MilestoneIcon,
  MoreIcon,
  PlusIcon,
  StackIcon,
  TrashIcon,
} from '../../components/icons';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from '../../components/ui/Popover';
import { confirmDialog, promptText } from '../../components/ui/Prompt';
import { UiSelect } from '../../components/ui/Select';
import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  addColumn,
  addTask,
  columnOf,
  columnsOf,
  formatDate,
  isOverdue,
  milestonesOf,
  placeTask,
  removeColumn,
  renameColumn,
  reorderColumns,
  setColumnStatus,
  setTaskColumn,
  sortTasks,
  updateTask,
  isClosedStatus,
} from '../../lib/structure/projects';
import { DropSlot, Grip, dropTargetAt, startPointerDrag, useTaskDrag } from './dnd';
import { AssigneeChip, TaskTimeChip } from './ProjectsView';
import { useProjectsUi } from './store';

/**
 * Kanban: the project's columns (named lanes with a status role — the four
 * statuses until customised). Drag a card to a column to move it (and, in
 * manual order, to a position within it); click a card to edit it. Column
 * headers drag to rearrange; their menu renames, changes the role, adds a
 * neighbour or deletes. Phones choose stacked columns or a horizontal row.
 */
export function KanbanView({ project }: { project: ProjectItem }) {
  const milestones = milestonesOf(project);
  const msTitle = (id: string | null) => milestones.find((m) => m.id === id)?.title ?? null;
  const sort = useProjectsUi((s) => s.sort);
  const layout = useProjectsUi((s) => s.kanbanLayout);
  const manual = sort === 'manual';
  const columns = columnsOf(project);
  const lanes = useProjectsUi((s) => s.kanbanLanes);
  const filter = useProjectsUi((s) => s.kanbanMilestone);
  const milestoneKeyOf = (t: ProjectTask) =>
    t.milestoneId && milestones.some((m) => m.id === t.milestoneId) ? t.milestoneId : '';
  const laneList: { key: string; title: string; open?: () => void }[] = [
    ...milestones.map((m) => ({
      key: m.id,
      title: m.title,
      open: () => useProjectsUi.getState().openMilestone(project.id, m.id),
    })),
    { key: '', title: 'Tasks' },
  ];
  const shownLanes = filter === null ? laneList : laneList.filter((l) => l.key === filter);
  const inScope = (t: ProjectTask) => filter === null || milestoneKeyOf(t) === filter;
  const { draggingId, target, beginDrag, ghost, slot } = useTaskDrag({
    manual,
    onDrop: (task, t) => {
      if (!t) return;
      const [laneKey, colId] = t.key.includes('::')
        ? (t.key.split('::') as [string, string])
        : [null, t.key];
      const col = columns.find((c) => c.id === colId);
      if (!col) return;
      const colMoved = columnOf(project, task).id !== col.id;
      const laneMoved = laneKey !== null && laneKey !== milestoneKeyOf(task);
      const label = laneMoved ? 'Move task' : colMoved ? `Move to ${col.title}` : 'Reorder task';
      const patch = (x: ProjectTask, p: ProjectItem) => {
        if (colMoved) setTaskColumn(p, x, col.id);
        if (laneMoved) x.milestoneId = laneKey || null;
      };
      if (manual)
        placeTask(
          project.id,
          task.id,
          t.beforeId,
          colMoved || laneMoved ? patch : undefined,
          label,
        );
      else if (colMoved || laneMoved) updateTask(project.id, task.id, label, patch);
    },
    onClick: (task) => useProjectsUi.getState().openTask(project.id, task.id),
  });

  // Column rearranging: the order previews live under the pointer.
  const [colDrag, setColDrag] = useState<{ id: string; order: string[] } | null>(null);
  const order = colDrag?.order ?? columns.map((c) => c.id);
  const shown = order
    .map((id) => columns.find((c) => c.id === id))
    .filter((c): c is ProjectColumn => !!c);
  const beginColDrag = (e: React.PointerEvent, col: ProjectColumn) => {
    if ((e.target as Element).closest('button, input, [data-radix-popper-content-wrapper]')) return;
    if (e.pointerType === 'touch' && !(e.target as Element).closest('.pj-grip')) return;
    let live = columns.map((c) => c.id);
    startPointerDrag(e, {
      dropSelector: '[data-kanban-col]',
      onStart: () => setColDrag({ id: col.id, order: live }),
      onMove: (ev) => {
        const over = dropTargetAt(ev.clientX, ev.clientY, '[data-kanban-col]');
        const overId = over?.dataset.kanbanCol;
        if (!over || !overId || overId === col.id) return;
        const r = over.getBoundingClientRect();
        const stacked = getComputedStyle(over.parentElement!).flexDirection === 'column';
        const before = stacked
          ? ev.clientY < r.top + r.height / 2
          : ev.clientX < r.left + r.width / 2;
        const rest = live.filter((id) => id !== col.id);
        const at = rest.indexOf(overId) + (before ? 0 : 1);
        rest.splice(at, 0, col.id);
        if (rest.join() !== live.join()) {
          live = rest;
          setColDrag({ id: col.id, order: rest });
        }
      },
      onDrop: () => {
        setColDrag(null);
        if (live.join() !== columns.map((c) => c.id).join()) reorderColumns(project.id, live);
      },
    });
  };

  const add = async () => {
    const title = await promptText({
      title: 'New column',
      placeholder: 'Column name',
      confirmLabel: 'Add',
    });
    if (title?.trim()) addColumn(project.id, title, 'todo');
  };

  /** The columns, for the whole board (lane null) or one milestone lane. */
  const renderColumns = (lane: { key: string; title: string } | null) =>
    shown.map((col) => {
      const tasks = sortTasks(
        project.tasks.filter(
          (t) =>
            columnOf(project, t).id === col.id &&
            inScope(t) &&
            (lane === null || milestoneKeyOf(t) === lane.key),
        ),
        sort,
      );
      const dropKey = lane === null ? col.id : `${lane.key}::${col.id}`;
      const here = target?.key === dropKey;
      return (
        <section
          key={col.id}
          className={`kanban-col status-${col.status}${here && !manual ? ' drop-over' : ''}${colDrag?.id === col.id ? ' col-dragging' : ''}`}
          data-kanban-col={col.id}
          data-drop-key={dropKey}
          data-testid={`kanban-col-${col.id}`}
        >
          <header
            className="kanban-col-head"
            onPointerDown={lane === null ? (e) => beginColDrag(e, col) : undefined}
          >
            <Grip className="kanban-col-grip" />
            <h3 data-testid="kanban-col-title">{col.title}</h3>
            <span className="kanban-col-count">{tasks.length}</span>
            <span className="pj-spacer" />
            <ColumnMenu project={project} col={col} taskCount={tasks.length} />
          </header>
          <div className="kanban-cards">
            {tasks.map((task) => {
              const dragging = draggingId === task.id;
              const ms = msTitle(task.milestoneId);
              const subDone = task.subtasks.filter((s) => s.done).length;
              return (
                <Fragment key={task.id}>
                  {here && slot !== null && target?.beforeId === task.id && (
                    <DropSlot height={slot} />
                  )}
                  <article
                    className={`kanban-card${dragging ? ' dragging' : ''}`}
                    data-testid="kanban-card"
                    data-task-id={task.id}
                    style={ghost(task.id)}
                    onPointerDown={(e) => beginDrag(e, task)}
                  >
                    <Grip className="kanban-grip" />
                    <div className="kanban-card-title">{task.title}</div>
                    {(ms ||
                      task.due ||
                      task.subtasks.length > 0 ||
                      task.assignee ||
                      task.timeSpent > 0 ||
                      task.timerStartedAt) && (
                      <div className="kanban-card-meta">
                        {ms && lane === null && (
                          <span className="kanban-chip">
                            <MilestoneIcon size={11} /> {ms}
                          </span>
                        )}
                        {task.due && (
                          <span
                            className={`kanban-chip${isOverdue(task.due, isClosedStatus(task.status)) ? ' overdue' : ''}`}
                          >
                            {formatDate(task.due)}
                          </span>
                        )}
                        {task.subtasks.length > 0 && (
                          <span className="kanban-chip">
                            {subDone}/{task.subtasks.length}
                          </span>
                        )}
                        <TaskTimeChip task={task} className="kanban-chip kanban-chip-time" />
                        <AssigneeChip id={task.assignee} />
                      </div>
                    )}
                  </article>
                </Fragment>
              );
            })}
            {here && slot !== null && target?.beforeId === null && <DropSlot height={slot} />}
            <KanbanAdd
              projectId={project.id}
              columnId={col.id}
              milestoneId={lane === null ? filter || null : lane.key || null}
            />
          </div>
        </section>
      );
    });

  return (
    <div className="kanban-wrap">
      <div className="kanban-toolbar">
        <button
          type="button"
          className={`gallery-action-btn kanban-lanes-toggle${lanes ? ' active' : ''}`}
          aria-pressed={lanes}
          title="Swimlanes by milestone"
          data-testid="kanban-lanes"
          onClick={() => useProjectsUi.getState().setKanbanLanes(!lanes)}
        >
          <MilestoneIcon size={14} /> <span className="pj-label">Milestones</span>
        </button>
        {milestones.length > 0 && (
          <UiSelect
            value={filter ?? '__all'}
            ariaLabel="Milestone filter"
            testId="kanban-filter"
            options={[
              { value: '__all', label: 'All milestones' },
              ...milestones.map((m) => ({ value: m.id, label: m.title })),
              { value: '', label: 'Tasks' },
            ]}
            onChange={(v) => useProjectsUi.getState().setKanbanMilestone(v === '__all' ? null : v)}
          />
        )}
        <span className="pj-spacer" />
        <div className="seg seg-icons kanban-layouts" role="group" aria-label="Layout">
          {(
            [
              ['stacked', 'Stacked', <StackIcon key="s" size={15} />],
              ['row', 'Side by side', <ColumnsIcon key="r" size={15} />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              className={layout === id ? 'active' : ''}
              aria-pressed={layout === id}
              aria-label={label}
              title={label}
              data-testid={`kanban-layout-${id}`}
              onClick={() => useProjectsUi.getState().setKanbanLayout(id)}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
      {lanes ? (
        <div className="kanban-lanes" data-testid="kanban-lanes-board">
          {shownLanes.map((lane) => {
            const laneTasks = project.tasks.filter((t) => milestoneKeyOf(t) === lane.key);
            const done = laneTasks.filter((t) => t.status === 'done').length;
            return (
              <section
                key={lane.key || '__other'}
                className="kanban-lane"
                data-testid="kanban-lane"
              >
                <header className="kanban-lane-head">
                  {lane.open ? (
                    <button
                      type="button"
                      className="kanban-lane-title"
                      data-testid="kanban-lane-title"
                      onClick={lane.open}
                    >
                      <MilestoneIcon size={14} /> {lane.title}
                    </button>
                  ) : (
                    <span className="kanban-lane-title muted">{lane.title}</span>
                  )}
                  {laneTasks.length > 0 && (
                    <span className="kanban-col-count">
                      {done}/{laneTasks.length}
                    </span>
                  )}
                </header>
                <div className={`kanban layout-${layout}`}>{renderColumns(lane)}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className={`kanban layout-${layout}`} data-testid="projects-kanban">
          {renderColumns(null)}
          <button
            type="button"
            className="kanban-add-col"
            title="Add column"
            aria-label="Add column"
            data-testid="kanban-add-col"
            onClick={() => void add()}
          >
            <PlusIcon size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Per-column menu: rename, status role, add a neighbour, delete. */
function ColumnMenu({
  project,
  col,
  taskCount,
}: {
  project: ProjectItem;
  col: ProjectColumn;
  taskCount: number;
}) {
  const [open, setOpen] = useState(false);
  const columns = columnsOf(project);
  const last = columns.length < 2;
  const home = columns.find((c) => c.id !== col.id);
  const remove = async () => {
    setOpen(false);
    if (last) return;
    if (
      taskCount > 0 &&
      !(await confirmDialog({
        title: `Delete “${col.title}”?`,
        body: `${taskCount} task${taskCount === 1 ? '' : 's'} will move to “${home?.title ?? ''}”.`,
        confirmLabel: 'Delete',
      }))
    )
      return;
    removeColumn(project.id, col.id);
  };
  const addAfter = async () => {
    setOpen(false);
    const title = await promptText({
      title: 'New column',
      placeholder: 'Column name',
      confirmLabel: 'Add',
    });
    if (title?.trim()) addColumn(project.id, title, col.status, col.id);
  };
  return (
    <UiPopover open={open} onOpenChange={setOpen}>
      <UiPopoverTrigger asChild>
        <button
          type="button"
          className="kanban-col-menu"
          aria-label={`${col.title} column options`}
          title="Column options"
          data-testid="kanban-col-menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <MoreIcon size={15} />
        </button>
      </UiPopoverTrigger>
      <UiPopoverContent className="cw-pop kanban-col-pop" align="end">
        {open && (
          <div className="plugin-settings">
            <label className="settings-row">
              <span>Name</span>
              <input
                className="tag-input"
                defaultValue={col.title}
                autoFocus
                data-testid="kanban-col-name"
                onBlur={(e) => renameColumn(project.id, col.id, e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            </label>
            <label className="settings-row">
              <span>Means</span>
              <UiSelect
                value={col.status}
                ariaLabel="Column status"
                testId="kanban-col-status"
                options={TASK_STATUSES.map((v) => ({ value: v, label: TASK_STATUS_LABEL[v] }))}
                onChange={(v) => setColumnStatus(project.id, col.id, v as ProjectTaskStatus)}
              />
            </label>
            <div className="pj-pop-actions">
              <button
                type="button"
                className="gallery-action-btn"
                data-testid="kanban-col-add-after"
                onClick={() => void addAfter()}
              >
                <PlusIcon size={14} /> Add column
              </button>
              <button
                type="button"
                className="gallery-action-btn btn-danger"
                disabled={last}
                title={last ? 'A board keeps at least one column' : undefined}
                data-testid="kanban-col-delete"
                onClick={() => void remove()}
              >
                <TrashIcon size={14} /> Delete
              </button>
            </div>
          </div>
        )}
      </UiPopoverContent>
    </UiPopover>
  );
}

function KanbanAdd({
  projectId,
  columnId,
  milestoneId,
}: {
  projectId: string;
  columnId: string;
  milestoneId: string | null;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    addTask(projectId, t, milestoneId, columnId);
    setDraft('');
  };
  return (
    <div className="projects-task-add kanban-add">
      <PlusIcon size={14} />
      <input
        className="projects-task-add-input"
        placeholder="Add a task"
        value={draft}
        data-testid="kanban-add"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') add();
        }}
      />
    </div>
  );
}
