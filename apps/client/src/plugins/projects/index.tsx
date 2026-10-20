import './style.css';
import { useEffect } from 'react';
import type { Item } from '@boardcache/schema';
import { z } from 'zod';
import { BoardsIcon, ExpandIcon, MilestoneIcon } from '../../components/icons';
import { createProjectItem } from '../../lib/import/createItems';
import {
  addEvent,
  addMilestone,
  addTask,
  linkItems,
  membershipsOf,
  milestonesOf,
  newTask,
  projectsOf,
  removeMilestone,
  setTaskStatus,
  unlinkItem,
  updateProject,
  updateTask,
} from '../../lib/structure/projects';
import type { MenuEntry } from '../../lib/menuBuilders';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { syncUrl } from '../../lib/router';
import { openPluginView, registerPlugin } from '../registry';
import { NewEventDialog, NewProjectDialog, NewTaskDialog, ProjectSettingsDialog } from './dialogs';
import { ProjectsView } from './ProjectsView';
import { startProjectReminders } from './reminders';
import { useProjectsUi, type ProjectsMode } from './store';

/**
 * Projects plugin (docs/archive/PROJECTS_PLAN.md): the project card is a core item
 * type (milestones and tasks live on it); this plugin supplies the New
 * Project flow, the editors, the full-screen Projects view, association
 * entries, and the assistant tools.
 */

const PLUGIN_ID = 'projects';
const VIEW_ID = 'projects';
const MODE_SLUG: Record<ProjectsMode, string> = {
  list: 'list',
  kanban: 'board',
  calendar: 'calendar',
  gantt: 'timeline',
};
const SLUG_MODE: Record<string, ProjectsMode> = {
  list: 'list',
  board: 'kanban',
  calendar: 'calendar',
  timeline: 'gantt',
};

function ProjectsHost() {
  useEffect(() => {
    const onEditProject = (e: Event) => {
      const { itemId } = (e as CustomEvent<{ itemId: string }>).detail;
      if (useDocumentStore.getState().doc.items[itemId]?.type === 'project') {
        useProjectsUi.getState().openSettings(itemId);
      }
    };
    const onEditMilestone = (e: Event) => {
      const { projectId, milestoneId } = (
        e as CustomEvent<{ projectId: string; milestoneId: string }>
      ).detail;
      if (useDocumentStore.getState().doc.items[projectId]?.type === 'project') {
        useProjectsUi.getState().openMilestone(projectId, milestoneId);
      }
    };
    const onOpen = (e: Event) => {
      const { projectId } = (e as CustomEvent<{ projectId?: string }>).detail ?? {};
      if (projectId) useProjectsUi.getState().setProject(projectId);
      // The full view replaces whatever was showing — including the lightbox.
      useSessionStore.getState().setLightbox(null);
      openPluginView(VIEW_ID);
    };
    window.addEventListener('boardcache:edit-project', onEditProject);
    window.addEventListener('boardcache:edit-milestone', onEditMilestone);
    window.addEventListener('boardcache:open-projects', onOpen);
    const stopReminders = startProjectReminders();
    // Routed state → URL (a history entry per project / view / detail change).
    const stopRoute = useProjectsUi.subscribe((now, prev) => {
      if (
        now.projectId !== prev.projectId ||
        now.mode !== prev.mode ||
        now.task !== prev.task ||
        now.milestone !== prev.milestone ||
        now.event !== prev.event
      )
        syncUrl();
    });
    return () => {
      stopRoute();
      stopReminders();
      window.removeEventListener('boardcache:edit-project', onEditProject);
      window.removeEventListener('boardcache:edit-milestone', onEditMilestone);
      window.removeEventListener('boardcache:open-projects', onOpen);
    };
  }, []);
  return (
    <>
      <NewProjectDialog />
      <NewTaskDialog />
      <NewEventDialog />
      <ProjectSettingsDialog />
    </>
  );
}

const openProjects = (projectId?: string) =>
  window.dispatchEvent(new CustomEvent('boardcache:open-projects', { detail: { projectId } }));

/** Context entries: open a project card in the view; associate any other
 *  item with a project (and un-associate from wherever it is). */
function itemMenu(item: Item): MenuEntry[] {
  const doc = useDocumentStore.getState().doc;
  if (item.type === 'project') {
    return [
      {
        kind: 'action',
        label: 'Open in Projects',
        icon: <ExpandIcon />,
        onSelect: () => openProjects(item.id),
      },
    ];
  }
  const projects = projectsOf(doc);
  if (projects.length === 0) return [];
  const memberships = membershipsOf(doc, item.id);
  const entries: MenuEntry[] = [];
  // A one-off Task List can graduate into a project's tasks (labels, notes
  // and due dates carry over; the card stays on the board).
  if (item.type === 'tasklist' && item.tasks.length > 0) {
    entries.push({
      kind: 'submenu',
      label: 'Copy tasks to project',
      icon: <MilestoneIcon />,
      children: projects.map((p) => ({
        kind: 'action' as const,
        label: p.title,
        onSelect: () => {
          updateProject(p.id, 'Copy tasks from list', (draft) => {
            for (const t of item.tasks) {
              const task = newTask(t.label, null);
              task.description = t.note;
              task.due = t.due ? t.due.slice(0, 10) : null;
              task.status = t.done ? 'done' : 'todo';
              draft.tasks.push(task);
            }
          });
        },
      })),
    });
  }
  entries.push({
    kind: 'submenu',
    label: 'Add to project',
    icon: <MilestoneIcon />,
    children: projects.flatMap((p) => {
      const ms = milestonesOf(p);
      const inProject = memberships.some((m) => m.kind === 'project' && m.id === p.id);
      return [
        {
          kind: 'action' as const,
          label: p.title,
          checked: inProject,
          onSelect: () => {
            if (!inProject) linkItems({ kind: 'project', projectId: p.id }, [item.id]);
          },
        },
        ...ms.map((m) => {
          const inMs = memberships.some((x) => x.kind === 'milestone' && x.id === m.id);
          return {
            kind: 'action' as const,
            label: `  ↳ ${m.title}`,
            checked: inMs,
            onSelect: () => {
              if (!inMs)
                linkItems({ kind: 'milestone', projectId: p.id, milestoneId: m.id }, [item.id]);
            },
          };
        }),
      ];
    }),
  });
  if (memberships.length > 0) {
    entries.push({
      kind: 'submenu',
      label: 'Remove from project',
      icon: <MilestoneIcon />,
      children: memberships.map((m) => ({
        kind: 'action' as const,
        label:
          m.kind === 'project'
            ? m.title
            : `${m.projectTitle} › ${m.title}${m.kind === 'task' ? ' (task)' : ''}`,
        onSelect: () => unlinkItem(m, item.id),
      })),
    });
  }
  return entries;
}

const dateArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .optional();

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 62,
    name: 'Projects',
    description:
      'Project management on the canvas: projects with milestones and tasks, board items linked to the work, and a full-screen list view.',
  },
  addMenu: [
    {
      label: 'New Project',
      category: 'structure',
      icon: <BoardsIcon />,
      onSelect: () => useProjectsUi.getState().openNewProject(),
    },
  ],
  Component: ProjectsHost,
  views: [
    {
      id: VIEW_ID,
      label: 'Projects',
      icon: <MilestoneIcon />,
      Component: ProjectsView,
      // /b/:id/projects[/:project[/:view][/task|milestone/:id]] — the view
      // slug is written whenever it isn't the default List or a detail follows.
      subPath: () => {
        const ui = useProjectsUi.getState();
        if (!ui.projectId) return [];
        const detail = ui.task
          ? ['task', ui.task.taskId]
          : ui.event
            ? ['event', ui.event.eventId]
            : ui.milestone && 'id' in ui.milestone
              ? ['milestone', ui.milestone.id]
              : [];
        const out = [ui.projectId];
        if (ui.mode !== 'list' || detail.length) out.push(MODE_SLUG[ui.mode]);
        return [...out, ...detail];
      },
      applySubPath: (segments) => {
        const ui = useProjectsUi.getState();
        const doc = useDocumentStore.getState().doc;
        const [pid, ...rest] = segments;
        const project = pid && doc.items[pid]?.type === 'project' ? doc.items[pid] : null;
        ui.setProject(project ? project.id : null);
        if (!project || project.type !== 'project') {
          ui.closeDialogs();
          return;
        }
        let i = 0;
        const mode = rest[0] ? SLUG_MODE[rest[0]] : undefined;
        if (mode) {
          if (ui.mode !== mode) ui.setMode(mode);
          i = 1;
        }
        const kind = rest[i];
        const id = rest[i + 1];
        if (kind === 'task' && id && project.tasks.some((t) => t.id === id))
          ui.openTask(project.id, id);
        else if (kind === 'milestone' && id && project.milestones.some((m) => m.id === id))
          ui.openMilestone(project.id, id);
        else if (kind === 'event' && id && project.events.some((e) => e.id === id))
          ui.openEvent(project.id, id);
        else if (ui.task || ui.milestone || ui.event) ui.closeDialogs();
      },
    },
  ],
  itemMenu,
  tools: [
    {
      name: 'create_project',
      description:
        'Create a project card (Projects suite): a named body of work with optional description, start/end dates (YYYY-MM-DD). Returns its id; add milestones with add_milestone and tasks with add_task.',
      parameters: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        startDate: dateArg,
        endDate: dateArg,
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const c = ctx.viewCenter();
        const id = createProjectItem(
          { x: args.x ?? c.x, y: args.y ?? c.y },
          {
            title: args.title,
            description: args.description ?? '',
            startDate: args.startDate ?? null,
            endDate: args.endDate ?? null,
          },
        );
        return { id };
      },
    },
    {
      name: 'add_milestone',
      description:
        'Add a milestone to a project: a dated goal (start/end YYYY-MM-DD) that groups tasks. dependsOn lists predecessor milestone ids (Timeline arrows). Returns its id.',
      parameters: z.object({
        projectId: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        startDate: dateArg,
        endDate: dateArg,
        dependsOn: z.array(z.string()).optional(),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const p = ctx.doc().items[args.projectId];
        if (p?.type !== 'project') return { error: 'projectId is not a project card.' };
        const id = addMilestone(p.id, {
          title: args.title,
          description: args.description ?? '',
          startDate: args.startDate ?? null,
          endDate: args.endDate ?? null,
          dependsOn: args.dependsOn ?? [],
        });
        return { id };
      },
    },
    {
      name: 'add_event',
      description:
        'Add a calendar event to a project: a timed entry with a start and end (local wall-clock "YYYY-MM-DDTHH:mm"). Tasks and milestones are dated, events are timed.',
      parameters: z.object({
        projectId: z.string(),
        title: z.string().min(1),
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:mm'),
        end: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:mm')
          .optional(),
        description: z.string().optional(),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const p = ctx.doc().items[args.projectId];
        if (p?.type !== 'project') return { error: 'projectId is not a project card.' };
        const id = addEvent(p.id, {
          title: args.title,
          start: args.start,
          end: args.end ?? null,
          description: args.description ?? '',
        });
        return { id };
      },
    },
    {
      name: 'remove_milestone',
      description: 'Remove a milestone from a project; its tasks become unscheduled.',
      parameters: z.object({ projectId: z.string(), milestoneId: z.string() }),
      access: 'write',
      execute: (args, ctx) => {
        const p = ctx.doc().items[args.projectId];
        if (p?.type !== 'project') return { error: 'projectId is not a project card.' };
        if (!p.milestones.some((m) => m.id === args.milestoneId))
          return { error: 'Unknown milestoneId.' };
        removeMilestone(p.id, args.milestoneId);
        return { done: true };
      },
    },
    {
      name: 'add_task',
      description:
        'Add a task to a project (optionally under one of its milestones). Tasks have a title, markdown description, status, start/due/end dates and subtasks. Returns the task id.',
      parameters: z.object({
        projectId: z.string(),
        title: z.string().min(1),
        milestoneId: z.string().optional(),
        description: z.string().optional(),
        due: dateArg,
        start: dateArg,
        end: dateArg,
        subtasks: z.array(z.string().min(1)).max(30).optional(),
        itemIds: z.array(z.string()).optional().describe('Board items to link to the task'),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const doc = ctx.doc();
        const p = doc.items[args.projectId];
        if (p?.type !== 'project') return { error: 'projectId is not a project card.' };
        if (args.milestoneId && !p.milestones.some((m) => m.id === args.milestoneId)) {
          return { error: 'milestoneId is not a milestone of that project.' };
        }
        const taskId = addTask(p.id, args.title, args.milestoneId ?? null);
        updateTask(p.id, taskId, 'Task details', (t) => {
          if (args.description) t.description = args.description;
          if (args.due) t.due = args.due;
          if (args.start) t.start = args.start;
          if (args.end) t.end = args.end;
          for (const label of args.subtasks ?? []) {
            t.subtasks.push({ id: crypto.randomUUID(), label, done: false, due: null });
          }
          for (const id of args.itemIds ?? []) {
            if (doc.items[id] && !t.itemIds.includes(id)) t.itemIds.push(id);
          }
        });
        return { id: taskId };
      },
    },
    {
      name: 'update_task',
      description:
        'Update a task: status (todo/doing/blocked/done/missed), title, dates, milestone (empty string = unscheduled).',
      parameters: z.object({
        projectId: z.string(),
        taskId: z.string(),
        status: z.enum(['todo', 'doing', 'blocked', 'done', 'missed']).optional(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        due: dateArg,
        start: dateArg,
        end: dateArg,
        milestoneId: z.string().optional(),
        assignee: z
          .string()
          .optional()
          .describe('Team member user id (team boards); empty string clears'),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const doc = ctx.doc();
        const p = doc.items[args.projectId];
        if (p?.type !== 'project') return { error: 'projectId is not a project card.' };
        if (!p.tasks.some((t) => t.id === args.taskId)) return { error: 'Unknown taskId.' };
        updateTask(p.id, args.taskId, 'Update task', (t, draft) => {
          if (args.status) setTaskStatus(draft, t, args.status);
          if (args.assignee !== undefined) t.assignee = args.assignee || null;
          if (args.title) t.title = args.title;
          if (args.description !== undefined) t.description = args.description;
          if (args.due) t.due = args.due;
          if (args.start) t.start = args.start;
          if (args.end) t.end = args.end;
          if (args.milestoneId !== undefined) t.milestoneId = args.milestoneId || null;
        });
        return { done: true };
      },
    },
    {
      name: 'link_items_to_project',
      description:
        'Associate board items with a project, or with one of its milestones or tasks (many-to-many: an item can belong to several).',
      parameters: z.object({
        projectId: z.string(),
        itemIds: z.array(z.string()).min(1),
        milestoneId: z.string().optional(),
        taskId: z.string().optional(),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const doc = ctx.doc();
        const p = doc.items[args.projectId];
        if (p?.type !== 'project') return { error: 'projectId is not a project card.' };
        const ids = (args.itemIds as string[]).filter((id: string) => doc.items[id] && id !== p.id);
        if (args.taskId) linkItems({ kind: 'task', projectId: p.id, taskId: args.taskId }, ids);
        else if (args.milestoneId)
          linkItems({ kind: 'milestone', projectId: p.id, milestoneId: args.milestoneId }, ids);
        else linkItems({ kind: 'project', projectId: p.id }, ids);
        return { linked: ids.length };
      },
    },
  ],
});
