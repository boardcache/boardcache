import { useEffect, useMemo, useState } from 'react';
import type {
  ProjectComment,
  ProjectEvent,
  ProjectItem,
  ProjectMilestone,
  ProjectTask,
} from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { CloseIcon, PauseIcon, PlayIcon, PlusIcon, TrashIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { UserAvatar } from '../../components/chrome/UserAvatar';
import { centerViewportOn } from '../../lib/canvas/viewportActions';
import { renderItemCanvas } from '../../lib/media/thumbnail';
import { orderedItems } from '../../lib/mediaItems';
import { useSessionStore } from '../../state/sessionStore';
import { TaskRow } from './ProjectsView';
import { useNow } from './useNow';
import { UiSelect } from '../../components/ui/Select';
import { confirmDialog } from '../../components/ui/Prompt';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createProjectItem } from '../../lib/import/createItems';
import { mediaMeta } from '../../lib/mediaItems';
import { ensureNotifyPermission } from '../../lib/structure/tasklist';
import { collabActive } from '../../state/collabStore';
import {
  MILESTONE_STATUS_LABEL,
  PROJECT_STATUS_LABEL,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  addEvent,
  addMilestone,
  addMilestoneComment,
  addMinutes,
  addTask,
  addTaskComment,
  assigneeOptions,
  formatDuration,
  milestoneTimeSpent,
  milestonesOf,
  removeEvent,
  removeMilestone,
  removeMilestoneComment,
  removeTask,
  removeTaskComment,
  setTaskStatus,
  startTaskTimer,
  stopTaskTimer,
  taskTimeSpent,
  updateEvent,
  updateMilestone,
  updateProject,
  updateTask,
} from '../../lib/structure/projects';
import { removeItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useProjectsUi } from './store';

/** Shared form primitives — the same `.plugin-settings` / `.settings-row`
 *  vocabulary every plugin dialog in the app uses. */
function DateField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  testId?: string;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <input
        type="date"
        className="tag-input"
        value={value ?? ''}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value || null)}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  );
}

// --- New project ---------------------------------------------------------------

export function NewProjectDialog() {
  const open = useProjectsUi((s) => s.newProjectOpen);
  return open ? <NewProjectBody /> : null;
}

function NewProjectBody() {
  const close = () => useProjectsUi.getState().closeDialogs();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStart] = useState<string | null>(null);
  const [endDate, setEnd] = useState<string | null>(null);
  const create = () => {
    const t = title.trim();
    if (!t) return;
    const el = document.querySelector<HTMLElement>('[data-testid="canvas-viewport"]');
    const r = el?.getBoundingClientRect();
    const at = r ? clientToCanvas(r.left + r.width / 2, r.top + r.height / 2) : { x: 400, y: 300 };
    const id = createProjectItem(at, { title: t, description, startDate, endDate });
    useProjectsUi.getState().setProject(id);
    close();
  };
  return (
    <UiDialog title="New project" onClose={close} className="tier-sheet" testId="project-new">
      <div className="plugin-settings">
        <label className="settings-row">
          <span>Name</span>
          <input
            className="tag-input"
            value={title}
            autoFocus
            placeholder="What are you building?"
            data-testid="project-new-title"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') create();
            }}
          />
        </label>
        <label className="settings-row settings-row-top">
          <span>Description</span>
          <textarea
            className="tag-input pj-textarea"
            value={description}
            placeholder="Optional — markdown"
            data-testid="project-new-desc"
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <DateField label="Start" value={startDate} onChange={setStart} testId="project-new-start" />
        <DateField label="End" value={endDate} onChange={setEnd} testId="project-new-end" />
        <div className="pj-dialog-actions">
          <button type="button" className="suggest-conn-btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="suggest-conn-btn pj-primary"
            disabled={!title.trim()}
            data-testid="project-new-create"
            onClick={create}
          >
            Create project
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

// --- Project settings --------------------------------------------------------

export function ProjectSettingsDialog() {
  const id = useProjectsUi((s) => s.settingsId);
  return id ? <ProjectSettingsBody key={id} id={id} /> : null;
}

function ProjectSettingsBody({ id }: { id: string }) {
  const close = () => useProjectsUi.getState().closeDialogs();
  const item = useDocumentStore((s) => {
    const it = s.doc.items[id];
    return it?.type === 'project' ? it : null;
  });
  if (!item) {
    close();
    return null;
  }
  const set = (label: string, recipe: (p: ProjectItem) => void) => updateProject(id, label, recipe);
  return (
    <UiDialog
      title="Project settings"
      onClose={close}
      className="tier-sheet"
      testId="project-settings"
    >
      <div className="plugin-settings">
        <label className="settings-row">
          <span>Name</span>
          <input
            className="tag-input"
            defaultValue={item.title}
            data-testid="project-title-input"
            onBlur={(e) =>
              set('Rename project', (p) => (p.title = e.target.value.trim() || 'Project'))
            }
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row settings-row-top">
          <span>Description</span>
          <textarea
            className="tag-input pj-textarea"
            defaultValue={item.description}
            placeholder="Markdown"
            data-testid="project-desc-input"
            onBlur={(e) => set('Project description', (p) => (p.description = e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row">
          <span>Status</span>
          <UiSelect
            value={item.status}
            ariaLabel="Project status"
            testId="project-status-select"
            options={(Object.keys(PROJECT_STATUS_LABEL) as ProjectItem['status'][]).map((v) => ({
              value: v,
              label: PROJECT_STATUS_LABEL[v],
            }))}
            onChange={(v) => set('Project status', (p) => (p.status = v as ProjectItem['status']))}
          />
        </label>
        <DateField
          label="Start"
          value={item.startDate}
          onChange={(v) => set('Project dates', (p) => (p.startDate = v))}
          testId="project-start-input"
        />
        <DateField
          label="End"
          value={item.endDate}
          onChange={(v) => set('Project dates', (p) => (p.endDate = v))}
          testId="project-end-input"
        />
        <label className="settings-row">
          <span>Accent</span>
          <input
            type="color"
            value={item.color ?? '#4263eb'}
            aria-label="Accent color"
            data-testid="project-color-input"
            onChange={(e) => set('Project color', (p) => (p.color = e.target.value))}
          />
          <button
            type="button"
            className="suggest-conn-btn tasklist-color-reset"
            disabled={item.color === null}
            onClick={() => set('Project color', (p) => (p.color = null))}
          >
            Theme
          </button>
        </label>
        <div className="pj-dialog-actions">
          <button
            type="button"
            className="suggest-conn-btn pj-danger"
            data-testid="project-delete"
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Delete project?',
                body: 'Its milestones and tasks go with it. Board items stay on the canvas.',
                confirmLabel: 'Delete',
              });
              if (!ok) return;
              close();
              removeItems([id], 'Delete project');
              useSessionStore.getState().clearSelection();
            }}
          >
            <TrashIcon size={14} /> Delete project
          </button>
          <span className="pj-spacer" />
          <button type="button" className="suggest-conn-btn pj-primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

// --- Milestone -----------------------------------------------------------------

export function MilestoneDialog() {
  const m = useProjectsUi((s) => s.milestone);
  if (!m) return null;
  return 'id' in m ? (
    <MilestoneBody key={m.id} projectId={m.projectId} id={m.id} />
  ) : (
    <NewMilestoneBody projectId={m.newFor} />
  );
}

function NewMilestoneBody({ projectId }: { projectId: string }) {
  const close = () => useProjectsUi.getState().closeDialogs();
  const [title, setTitle] = useState('');
  const [startDate, setStart] = useState<string | null>(null);
  const [endDate, setEnd] = useState<string | null>(null);
  const create = () => {
    const t = title.trim();
    if (!t) return;
    addMilestone(projectId, { title: t, startDate, endDate });
    close();
  };
  return (
    <UiDialog title="New milestone" onClose={close} className="tier-sheet" testId="milestone-new">
      <div className="plugin-settings">
        <label className="settings-row">
          <span>Name</span>
          <input
            className="tag-input"
            value={title}
            autoFocus
            placeholder="e.g. Beta launch"
            data-testid="milestone-new-title"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') create();
            }}
          />
        </label>
        <DateField
          label="Start"
          value={startDate}
          onChange={setStart}
          testId="milestone-new-start"
        />
        <DateField label="End" value={endDate} onChange={setEnd} testId="milestone-new-end" />
        <div className="pj-dialog-actions">
          <button type="button" className="suggest-conn-btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="suggest-conn-btn pj-primary"
            disabled={!title.trim()}
            data-testid="milestone-new-create"
            onClick={create}
          >
            Add milestone
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

function MilestoneBody({ projectId, id }: { projectId: string; id: string }) {
  const close = () => useProjectsUi.getState().closeDialogs();
  const project = useDocumentStore((s) => {
    const it = s.doc.items[projectId];
    return it?.type === 'project' ? it : null;
  });
  const item = project?.milestones.find((m) => m.id === id) ?? null;
  if (!project || !item) {
    close();
    return null;
  }
  const set = (label: string, recipe: (m: ProjectMilestone) => void) =>
    updateMilestone(projectId, id, label, recipe);
  const others = milestonesOf(project).filter((m) => m.id !== id);
  return (
    <DetailShell title="Milestone" onClose={close} testId="milestone-editor">
      <div className="plugin-settings pj-task-sheet">
        <label className="settings-row">
          <span>Name</span>
          <input
            className="tag-input"
            defaultValue={item.title}
            data-testid="milestone-title-input"
            onBlur={(e) =>
              set('Rename milestone', (m) => (m.title = e.target.value.trim() || 'Milestone'))
            }
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row settings-row-top">
          <span>Description</span>
          <textarea
            className="tag-input pj-textarea"
            defaultValue={item.description}
            placeholder="Markdown"
            onBlur={(e) => set('Milestone description', (m) => (m.description = e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row">
          <span>Status</span>
          <UiSelect
            value={item.status}
            ariaLabel="Milestone status"
            testId="milestone-status-select"
            options={(Object.keys(MILESTONE_STATUS_LABEL) as ProjectMilestone['status'][]).map(
              (v) => ({
                value: v,
                label: MILESTONE_STATUS_LABEL[v],
              }),
            )}
            onChange={(v) =>
              set('Milestone status', (m) => (m.status = v as ProjectMilestone['status']))
            }
          />
        </label>
        <DateField
          label="Start"
          value={item.startDate}
          onChange={(v) => set('Milestone dates', (m) => (m.startDate = v))}
          testId="milestone-start-input"
        />
        <DateField
          label="End"
          value={item.endDate}
          onChange={(v) => set('Milestone dates', (m) => (m.endDate = v))}
          testId="milestone-end-input"
        />
        {others.length > 0 && (
          <div className="settings-row settings-row-top">
            <span>Comes after</span>
            <div className="pj-chips">
              {others.map((o) => {
                const on = item.dependsOn.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={`suggest-conn-btn${on ? ' pj-primary' : ''}`}
                    aria-pressed={on}
                    data-testid="milestone-dep"
                    onClick={() =>
                      set(on ? 'Remove dependency' : 'Add dependency', (m) => {
                        m.dependsOn = on
                          ? m.dependsOn.filter((d) => d !== o.id)
                          : [...m.dependsOn, o.id];
                      })
                    }
                  >
                    {o.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <MilestoneTasks project={project} milestoneId={id} />
        <LinkedItems
          itemIds={item.itemIds}
          testId="milestone-linked-items"
          onToggle={(lid, on) =>
            set(on ? 'Add to milestone' : 'Remove from milestone', (m) => {
              m.itemIds = on
                ? m.itemIds.includes(lid)
                  ? m.itemIds
                  : [...m.itemIds, lid]
                : m.itemIds.filter((x) => x !== lid);
            })
          }
        />
        <div className="settings-row settings-row-top">
          <span>Comments</span>
          <Comments
            comments={item.comments}
            testId="milestone-comments"
            onPost={(text) => addMilestoneComment(projectId, id, text)}
            onRemove={(cid) => removeMilestoneComment(projectId, id, cid)}
          />
        </div>
        <div className="pj-dialog-actions">
          <button
            type="button"
            className="suggest-conn-btn pj-danger"
            data-testid="milestone-delete"
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Delete milestone?',
                body: 'Its tasks move back to the project backlog.',
                confirmLabel: 'Delete',
              });
              if (!ok) return;
              close();
              removeMilestone(projectId, id);
            }}
          >
            <TrashIcon size={14} /> Delete
          </button>
          <span className="pj-spacer" />
          <button type="button" className="suggest-conn-btn pj-primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </DetailShell>
  );
}

// --- New task --------------------------------------------------------------------

/** Select value for "no milestone" — an empty value would read as unset and render blank. */
const NO_MILESTONE = '__none';

export function NewTaskDialog() {
  const projectId = useProjectsUi((s) => s.newTaskFor);
  if (!projectId) return null;
  return <NewTaskBody key={projectId} projectId={projectId} />;
}

function NewTaskBody({ projectId }: { projectId: string }) {
  const close = () => useProjectsUi.getState().closeDialogs();
  const project = useDocumentStore((s) => {
    const it = s.doc.items[projectId];
    return it?.type === 'project' ? it : null;
  });
  const [title, setTitle] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [status, setStatus] = useState<ProjectTask['status']>('todo');
  const [description, setDescription] = useState('');
  if (!project) {
    close();
    return null;
  }
  const create = () => {
    const t = title.trim();
    if (!t) return;
    const id = addTask(projectId, t, milestoneId || null, null, {
      due,
      status,
      description: description.trim(),
    });
    close();
    useProjectsUi.getState().openTask(projectId, id);
  };
  return (
    <UiDialog title="New task" onClose={close} className="tier-sheet" testId="task-new">
      <div className="plugin-settings">
        <label className="settings-row">
          <span>Name</span>
          <input
            className="tag-input"
            value={title}
            autoFocus
            placeholder="What needs doing?"
            data-testid="task-new-title"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') create();
            }}
          />
        </label>
        <label className="settings-row">
          <span>Milestone</span>
          <UiSelect
            value={milestoneId || NO_MILESTONE}
            ariaLabel="Milestone"
            testId="task-new-milestone"
            options={[
              { value: NO_MILESTONE, label: 'None' },
              ...milestonesOf(project).map((m) => ({ value: m.id, label: m.title })),
            ]}
            onChange={(v) => setMilestoneId(v === NO_MILESTONE ? '' : v)}
          />
        </label>
        <DateField label="Due" value={due} onChange={setDue} testId="task-new-due" />
        <label className="settings-row">
          <span>Status</span>
          <UiSelect
            value={status}
            ariaLabel="Task status"
            testId="task-new-status"
            options={TASK_STATUSES.map((v) => ({ value: v, label: TASK_STATUS_LABEL[v] }))}
            onChange={(v) => setStatus(v as ProjectTask['status'])}
          />
        </label>
        <label className="settings-row settings-row-top">
          <span>Description</span>
          <textarea
            className="tag-input pj-textarea"
            value={description}
            placeholder="Optional — markdown"
            data-testid="task-new-desc"
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <div className="pj-dialog-actions">
          <button type="button" className="suggest-conn-btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="suggest-conn-btn pj-primary"
            disabled={!title.trim()}
            data-testid="task-new-create"
            onClick={create}
          >
            Add task
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

// --- Events ----------------------------------------------------------------------

export function NewEventDialog() {
  const req = useProjectsUi((s) => s.newEventFor);
  if (!req) return null;
  return (
    <NewEventBody key={`${req.projectId}:${req.day}`} projectId={req.projectId} day={req.day} />
  );
}

function NewEventBody({ projectId, day }: { projectId: string; day: string }) {
  const close = () => useProjectsUi.getState().closeDialogs();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(day);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('10:00');
  const create = () => {
    const t = title.trim();
    if (!t || !date) return;
    const start = `${date}T${from || '09:00'}`;
    const end = `${date}T${to || ''}`;
    const id = addEvent(projectId, {
      title: t,
      start,
      end: to && end > start ? end : addMinutes(start, 60),
    });
    close();
    useProjectsUi.getState().openEvent(projectId, id);
  };
  return (
    <UiDialog title="New event" onClose={close} className="tier-sheet" testId="event-new">
      <div className="plugin-settings">
        <label className="settings-row">
          <span>Name</span>
          <input
            className="tag-input"
            value={title}
            autoFocus
            placeholder="e.g. Kickoff call"
            data-testid="event-new-title"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') create();
            }}
          />
        </label>
        <label className="settings-row">
          <span>Date</span>
          <input
            type="date"
            className="tag-input"
            value={date}
            data-testid="event-new-date"
            onChange={(e) => setDate(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row">
          <span>From</span>
          <input
            type="time"
            className="tag-input"
            value={from}
            data-testid="event-new-from"
            onChange={(e) => setFrom(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row">
          <span>To</span>
          <input
            type="time"
            className="tag-input"
            value={to}
            data-testid="event-new-to"
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <div className="pj-dialog-actions">
          <button type="button" className="suggest-conn-btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="suggest-conn-btn pj-primary"
            disabled={!title.trim() || !date}
            data-testid="event-new-create"
            onClick={create}
          >
            Add event
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

export function EventDialog() {
  const req = useProjectsUi((s) => s.event);
  if (!req) return null;
  return <EventBody key={req.eventId} projectId={req.projectId} eventId={req.eventId} />;
}

function EventBody({ projectId, eventId }: { projectId: string; eventId: string }) {
  const close = () => useProjectsUi.getState().closeDialogs();
  const project = useDocumentStore((s) => {
    const it = s.doc.items[projectId];
    return it?.type === 'project' ? it : null;
  });
  const ev = project?.events.find((e) => e.id === eventId) ?? null;
  if (!project || !ev) {
    close();
    return null;
  }
  const set = (label: string, recipe: (e: ProjectEvent) => void) =>
    updateEvent(projectId, eventId, label, recipe);
  const [date, from] = ev.start.split('T');
  const to = ev.end.split('T')[1] ?? '';
  const setTimes = (nextDate: string, nextFrom: string, nextTo: string) =>
    set('Event time', (e) => {
      const start = `${nextDate}T${nextFrom || '09:00'}`;
      const end = `${nextDate}T${nextTo}`;
      e.start = start;
      e.end = nextTo && end > start ? end : addMinutes(start, 60);
    });
  return (
    <DetailShell title="Event" onClose={close} testId="event-editor">
      <div className="plugin-settings pj-task-sheet">
        <label className="settings-row">
          <span>Title</span>
          <input
            className="tag-input"
            defaultValue={ev.title}
            autoFocus
            data-testid="event-title-input"
            onBlur={(e) => set('Rename event', (x) => (x.title = e.target.value.trim() || 'Event'))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        <label className="settings-row">
          <span>Date</span>
          <input
            type="date"
            className="tag-input"
            value={date}
            data-testid="event-date-input"
            onChange={(e) => setTimes(e.target.value, from ?? '09:00', to)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row">
          <span>From</span>
          <input
            type="time"
            className="tag-input"
            value={from ?? ''}
            data-testid="event-from-input"
            onChange={(e) => setTimes(date ?? '', e.target.value, to)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row">
          <span>To</span>
          <input
            type="time"
            className="tag-input"
            value={to}
            data-testid="event-to-input"
            onChange={(e) => setTimes(date ?? '', from ?? '09:00', e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row settings-row-top">
          <span>Notes</span>
          <textarea
            className="tag-input pj-textarea"
            defaultValue={ev.description}
            placeholder="Markdown"
            onBlur={(e) => set('Event notes', (x) => (x.description = e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <div className="pj-dialog-actions">
          <button
            type="button"
            className="suggest-conn-btn pj-danger"
            data-testid="event-delete"
            onClick={() => {
              close();
              removeEvent(projectId, eventId);
            }}
          >
            <TrashIcon size={14} /> Delete event
          </button>
          <span className="pj-spacer" />
          <button type="button" className="suggest-conn-btn pj-primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </DetailShell>
  );
}

// --- Detail pane ----------------------------------------------------------------
// Tasks and milestones open in a detail pane beside the view (a full-screen
// sheet on phones): the same editable fields, plus linked board items,
// comments, and time. Escape closes it, like a dialog.

function DetailShell({
  title,
  onClose,
  testId,
  children,
}: {
  title: string;
  onClose: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <aside className="projects-detail" data-testid={testId}>
      <div className="sheet-head projects-detail-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="sheet-close"
          aria-label="Close"
          data-testid={`${testId}-close`}
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="projects-detail-body">{children}</div>
    </aside>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A comment thread (the board comments' own vocabulary). */
function Comments({
  comments,
  onPost,
  onRemove,
  testId,
}: {
  comments: ProjectComment[];
  onPost: (text: string) => void;
  onRemove: (id: string) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState('');
  const post = () => {
    if (!draft.trim()) return;
    onPost(draft);
    setDraft('');
  };
  return (
    <div className="comments-panel pj-comments" data-testid={testId}>
      <div className="comments-list">
        {comments.length === 0 && <p className="comments-empty">No comments yet.</p>}
        {comments.map((c) => (
          <div className="comment-card" key={c.id} data-testid="pj-comment">
            <div className="comment-head">
              <UserAvatar
                userId={c.userId}
                name={c.author}
                color={c.color}
                className="comment-avatar"
              />
              <span className="comment-author" style={c.color ? { color: c.color } : undefined}>
                {c.author}
              </span>
              <span className="comment-when">{when(c.createdAt)}</span>
              <button
                type="button"
                className="comment-delete"
                title="Delete comment"
                aria-label="Delete comment"
                onClick={() => onRemove(c.id)}
              >
                <CloseIcon />
              </button>
            </div>
            <p className="comment-text">{c.text}</p>
          </div>
        ))}
      </div>
      <div className="comment-composer">
        <textarea
          value={draft}
          placeholder="Add a comment"
          data-testid={`${testId}-input`}
          maxLength={4000}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              post();
            }
          }}
        />
        <button
          type="button"
          className="sync-primary comment-post"
          disabled={!draft.trim()}
          data-testid={`${testId}-post`}
          onClick={post}
        >
          Comment
        </button>
      </div>
    </div>
  );
}

/** A small rendered preview of a board item (the LOD painter, cached per item version). */
const thumbs = new WeakMap<object, string>();
function ItemThumb({ id }: { id: string }) {
  const item = useDocumentStore((s) => s.doc.items[id]);
  const [src, setSrc] = useState<string | null>(() => (item ? (thumbs.get(item) ?? null) : null));
  useEffect(() => {
    if (!item) return;
    const hit = thumbs.get(item);
    if (hit) {
      queueMicrotask(() => setSrc(hit));
      return;
    }
    let live = true;
    void renderItemCanvas(item, 64 / Math.max(1, item.width, item.height)).then((c) => {
      const url = c.toDataURL('image/png');
      thumbs.set(item, url);
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [id, item]);
  return (
    <span className="pj-thumb" aria-hidden data-testid="pj-thumb">
      {src && <img src={src} alt="" />}
    </span>
  );
}

/** Show a linked board item on the canvas: back to the board, selected and centered. */
function revealItem(id: string) {
  const it = useDocumentStore.getState().doc.items[id];
  if (!it) return;
  const session = useSessionStore.getState();
  session.setView('canvas');
  session.setSelection([id]);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="canvas-viewport"]');
      centerViewportOn({ x: it.x + it.width / 2, y: it.y + it.height / 2 }, el);
    }),
  );
}

/** Linked board items as chips, with a picker to add more. */
function LinkedItems({
  itemIds,
  onToggle,
  testId,
}: {
  itemIds: string[];
  onToggle: (id: string, on: boolean) => void;
  testId: string;
}) {
  const items = useDocumentStore((s) => s.doc.items);
  const linked = useMemo(
    () => itemIds.map((id) => ({ id, title: items[id] ? mediaMeta(items[id]!).title : '' })),
    [itemIds, items],
  );
  const [picking, setPicking] = useState(false);
  return (
    <div className="settings-row settings-row-top">
      <span>Items</span>
      <div className="pj-chips" data-testid={testId}>
        {linked.map((l) => (
          <span key={l.id} className="pj-chip pj-chip-item">
            <ItemThumb id={l.id} />
            <button
              type="button"
              className="pj-chip-title"
              title="Show on the canvas"
              onClick={() => revealItem(l.id)}
            >
              {l.title || 'Item'}
            </button>
            <button
              type="button"
              className="pj-iconbtn"
              aria-label={`Remove ${l.title}`}
              onClick={() => onToggle(l.id, false)}
            >
              <CloseIcon size={12} />
            </button>
          </span>
        ))}
        <button
          type="button"
          className="suggest-conn-btn"
          data-testid={`${testId}-add`}
          onClick={() => setPicking(true)}
        >
          <PlusIcon size={13} /> Add items
        </button>
      </div>
      {picking && (
        <ItemPicker linked={itemIds} onToggle={onToggle} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}

function ItemPicker({
  linked,
  onToggle,
  onClose,
}: {
  linked: string[];
  onToggle: (id: string, on: boolean) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const doc = useDocumentStore((s) => s.doc);
  const items = useMemo(
    () =>
      orderedItems(doc)
        .filter((i) => i.type !== 'project')
        .map((i) => {
          const meta = mediaMeta(i);
          return { id: i.id, title: meta.title || i.type, detail: meta.detail ?? '' };
        }),
    [doc],
  );
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? items.filter((i) => `${i.title} ${i.detail}`.toLowerCase().includes(needle))
    : items;
  return (
    <UiDialog
      title="Add board items"
      onClose={onClose}
      className="tier-sheet"
      testId="pj-item-picker"
    >
      <div className="plugin-settings">
        <input
          className="tag-input pick-search"
          placeholder="Search items"
          value={q}
          autoFocus
          data-testid="pj-item-picker-search"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="pj-picker-list">
          {shown.length === 0 && <p className="comments-empty">No items on this board.</p>}
          {shown.map((i) => {
            const on = linked.includes(i.id);
            return (
              <label
                key={i.id}
                className={`pj-picker-row${on ? ' on' : ''}`}
                data-testid="pj-picker-row"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onToggle(i.id, e.target.checked)}
                />
                <ItemThumb id={i.id} />
                <span className="pj-picker-title">{i.title}</span>
                {i.detail && <span className="pj-picker-detail">{i.detail}</span>}
              </label>
            );
          })}
        </div>
        <div className="pj-dialog-actions">
          <span className="pj-spacer" />
          <button type="button" className="suggest-conn-btn pj-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

/** A milestone's tasks with progress and the time spent across them. */
function MilestoneTasks({ project, milestoneId }: { project: ProjectItem; milestoneId: string }) {
  const tasks = project.tasks.filter((t) => t.milestoneId === milestoneId);
  const live = tasks.some((t) => !!t.timerStartedAt);
  const now = useNow(live);
  const total = milestoneTimeSpent(project, milestoneId, now);
  const done = tasks.filter((t) => t.status === 'done').length;
  return (
    <div className="settings-row settings-row-top">
      <span>Tasks</span>
      <div className="pj-ms-tasks">
        <div className="pj-ms-tasks-head">
          <span>{tasks.length ? `${done}/${tasks.length} done` : 'No tasks yet'}</span>
          <span className={`pj-time-value${live ? ' live' : ''}`} data-testid="milestone-time">
            {formatDuration(total)}
          </span>
        </div>
        <div className="projects-tasks">
          {tasks.map((t) => (
            <TaskRow key={t.id} project={project} task={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A task's timer: elapsed (live while running) with Start / Stop. */
function TaskTimer({ projectId, task }: { projectId: string; task: ProjectTask }) {
  const live = !!task.timerStartedAt;
  const now = useNow(live);
  const sec = taskTimeSpent(task, now);
  return (
    <div className="settings-row">
      <span>Time</span>
      <div className="pj-time">
        <span className={`pj-time-value${live ? ' live' : ''}`} data-testid="task-time">
          {formatDuration(sec)}
        </span>
        <button
          type="button"
          className={`suggest-conn-btn${live ? ' pj-primary' : ''}`}
          data-testid="task-timer-toggle"
          onClick={() =>
            live ? stopTaskTimer(projectId, task.id) : startTaskTimer(projectId, task.id)
          }
        >
          {live ? (
            <>
              <PauseIcon size={13} /> Stop
            </>
          ) : (
            <>
              <PlayIcon size={13} /> Start
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// --- Task ------------------------------------------------------------------------

export function TaskDialog() {
  const t = useProjectsUi((s) => s.task);
  return t ? <TaskBody key={t.taskId} projectId={t.projectId} taskId={t.taskId} /> : null;
}

function TaskBody({ projectId, taskId }: { projectId: string; taskId: string }) {
  const close = () => useProjectsUi.getState().closeDialogs();
  const project = useDocumentStore((s) => {
    const it = s.doc.items[projectId];
    return it?.type === 'project' ? it : null;
  });
  const milestones = project ? milestonesOf(project) : [];
  const task = project?.tasks.find((x) => x.id === taskId);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  if (!project || !task) {
    close();
    return null;
  }
  const set = (label: string, recipe: (t: ProjectTask, p: ProjectItem) => void) =>
    updateTask(projectId, taskId, label, recipe);
  const addSubtask = () => {
    const label = subtaskDraft.trim();
    if (!label) return;
    set('Add subtask', (t) => {
      t.subtasks.push({ id: newId(), label, done: false, due: null });
    });
    setSubtaskDraft('');
  };
  return (
    <DetailShell title="Task" onClose={close} testId="task-editor">
      <div className="plugin-settings pj-task-sheet">
        <label className="settings-row">
          <span>Title</span>
          <input
            className="tag-input"
            defaultValue={task.title}
            autoFocus
            data-testid="task-title-input"
            onBlur={(e) => set('Rename task', (t) => (t.title = e.target.value.trim() || 'Task'))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        <label className="settings-row">
          <span>Status</span>
          <UiSelect
            value={task.status}
            ariaLabel="Task status"
            testId="task-status-select"
            options={TASK_STATUSES.map((v) => ({ value: v, label: TASK_STATUS_LABEL[v] }))}
            onChange={(v) =>
              set('Task status', (t, p) => setTaskStatus(p, t, v as ProjectTask['status']))
            }
          />
        </label>
        <label className="settings-row">
          <span>Milestone</span>
          <UiSelect
            value={task.milestoneId ?? NO_MILESTONE}
            ariaLabel="Milestone"
            testId="task-milestone-select"
            options={[
              { value: NO_MILESTONE, label: 'None' },
              ...milestones.map((m) => ({ value: m.id, label: m.title })),
            ]}
            onChange={(v) =>
              set('Task milestone', (t) => (t.milestoneId = v === NO_MILESTONE ? null : v))
            }
          />
        </label>
        <DateField
          label="Start"
          value={task.start}
          onChange={(v) => set('Task dates', (t) => (t.start = v))}
          testId="task-start-input"
        />
        <DateField
          label="Due"
          value={task.due}
          onChange={(v) => {
            if (v) ensureNotifyPermission();
            set('Task dates', (t) => (t.due = v));
          }}
          testId="task-due-input"
        />
        {collabActive() && (
          <label className="settings-row">
            <span>Assignee</span>
            <UiSelect
              value={task.assignee ?? ''}
              ariaLabel="Assignee"
              testId="task-assignee-select"
              options={[
                { value: '', label: 'Unassigned' },
                ...assigneeOptions().map((o) => ({ value: o.id, label: o.name })),
              ]}
              onChange={(v) => set('Task assignee', (t) => (t.assignee = v || null))}
            />
          </label>
        )}
        <DateField
          label="End"
          value={task.end}
          onChange={(v) => set('Task dates', (t) => (t.end = v))}
          testId="task-end-input"
        />
        <TaskTimer projectId={projectId} task={task} />
        <label className="settings-row settings-row-top">
          <span>Notes</span>
          <textarea
            className="tag-input pj-textarea"
            defaultValue={task.description}
            placeholder="Markdown"
            data-testid="task-desc-input"
            onBlur={(e) => set('Task notes', (t) => (t.description = e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>

        <div className="settings-row settings-row-top">
          <span>Subtasks</span>
          <div className="pj-subtasks">
            {task.subtasks.map((st) => (
              <div
                key={st.id}
                className={`pj-subtask${st.done ? ' done' : ''}`}
                data-testid="task-subtask"
              >
                <input
                  type="checkbox"
                  checked={st.done}
                  aria-label={`Done: ${st.label}`}
                  onChange={(e) =>
                    set(e.target.checked ? 'Complete subtask' : 'Reopen subtask', (t) => {
                      const s = t.subtasks.find((x) => x.id === st.id);
                      if (s) s.done = e.target.checked;
                    })
                  }
                />
                <input
                  className="tag-input pj-subtask-label"
                  defaultValue={st.label}
                  onBlur={(e) =>
                    set('Rename subtask', (t) => {
                      const s = t.subtasks.find((x) => x.id === st.id);
                      if (s) s.label = e.target.value.trim() || s.label;
                    })
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <input
                  type="date"
                  className="tag-input pj-subtask-due"
                  value={st.due ?? ''}
                  aria-label="Subtask due"
                  onChange={(e) =>
                    set('Subtask due', (t) => {
                      const s = t.subtasks.find((x) => x.id === st.id);
                      if (s) s.due = e.target.value || null;
                    })
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <button
                  type="button"
                  className="pj-iconbtn"
                  aria-label="Remove subtask"
                  onClick={() =>
                    set(
                      'Remove subtask',
                      (t) => (t.subtasks = t.subtasks.filter((x) => x.id !== st.id)),
                    )
                  }
                >
                  <CloseIcon size={13} />
                </button>
              </div>
            ))}
            <div className="pj-subtask pj-subtask-add">
              <PlusIcon size={13} />
              <input
                className="tag-input pj-subtask-label"
                placeholder="Add a subtask"
                value={subtaskDraft}
                data-testid="task-subtask-add"
                onChange={(e) => setSubtaskDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') addSubtask();
                }}
              />
            </div>
          </div>
        </div>

        <LinkedItems
          itemIds={task.itemIds}
          testId="task-linked-items"
          onToggle={(id, on) =>
            set(on ? 'Add to task' : 'Remove from task', (t) => {
              t.itemIds = on
                ? t.itemIds.includes(id)
                  ? t.itemIds
                  : [...t.itemIds, id]
                : t.itemIds.filter((x) => x !== id);
            })
          }
        />
        <div className="settings-row settings-row-top">
          <span>Comments</span>
          <Comments
            comments={task.comments}
            testId="task-comments"
            onPost={(text) => addTaskComment(projectId, taskId, text)}
            onRemove={(id) => removeTaskComment(projectId, taskId, id)}
          />
        </div>

        <div className="pj-dialog-actions">
          <button
            type="button"
            className="suggest-conn-btn pj-danger"
            data-testid="task-delete"
            onClick={() => {
              close();
              removeTask(projectId, taskId);
            }}
          >
            <TrashIcon size={14} /> Delete task
          </button>
          <span className="pj-spacer" />
          <button type="button" className="suggest-conn-btn pj-primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </DetailShell>
  );
}
