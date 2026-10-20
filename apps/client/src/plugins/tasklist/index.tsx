import { useEffect } from 'react';
import type { Task, TasklistItem } from '@boardcache/schema';
import { create } from 'zustand';
import { ArrowDownIcon, ArrowUpIcon, ListChecksIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createTasklistItem } from '../../lib/import/createItems';
import { scheduleTaskNotifications, updateTasklist } from '../../lib/structure/tasklist';
import { useDocumentStore } from '../../state/documentStore';
import { registerPlugin } from '../registry';

/**
 * Task Lists plugin: creation, the card-settings dialog (title, background
 * and text colors), and the due-date notification engine. All TASK editing
 * is WYSIWYG on the card itself (see TasklistContent).
 */

const PLUGIN_ID = 'tasklist';

const useTasklistEditor = create<{
  itemId: string | null;
  open: (itemId: string) => void;
  close: () => void;
}>((set) => ({
  itemId: null,
  open: (itemId) => set({ itemId }),
  close: () => set({ itemId: null }),
}));

function TasklistEditorDialog() {
  const itemId = useTasklistEditor((s) => s.itemId);
  return itemId ? <Body key={itemId} itemId={itemId} /> : null;
}

const SORT_CMPS = {
  name: (a: Task, b: Task) => a.label.localeCompare(b.label),
  due: (a: Task, b: Task) =>
    (a.due ? new Date(a.due).getTime() : Infinity) - (b.due ? new Date(b.due).getTime() : Infinity),
  open: (a: Task, b: Task) => Number(a.done) - Number(b.done),
} as const;

/** Apply a sort; clicking again when already in that order reverses it. */
function applySort(itemId: string, label: string, cmp: (a: Task, b: Task) => number): void {
  updateTasklist(itemId, label, (t: TasklistItem) => {
    const asc = [...t.tasks].sort(cmp);
    const already = t.tasks.every((x, i) => x.id === asc[i]!.id);
    t.tasks = already ? asc.reverse() : asc;
  });
}

/** Which direction the list currently sits in for a criterion (null = unsorted). */
function sortDir(item: TasklistItem, cmp: (a: Task, b: Task) => number): 'asc' | 'desc' | null {
  if (item.tasks.length < 2) return null;
  // All-tied lists (no dues, nothing done) match every order — no arrow.
  if (item.tasks.every((x, i) => i === 0 || cmp(item.tasks[i - 1]!, x) === 0)) return null;
  const asc = [...item.tasks].sort(cmp);
  if (item.tasks.every((x, i) => x.id === asc[i]!.id)) return 'asc';
  if (item.tasks.every((x, i) => x.id === asc[asc.length - 1 - i]!.id)) return 'desc';
  return null;
}

/** ↑/↓ suffix reflecting the list's current order for this criterion. */
function DirArrow({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (!dir) return null;
  return (
    <span className="tasklist-sort-dir" data-testid={`sort-dir-${dir}`}>
      {dir === 'asc' ? <ArrowUpIcon size={11} /> : <ArrowDownIcon size={11} />}
    </span>
  );
}

function Body({ itemId }: { itemId: string }) {
  const close = () => useTasklistEditor.getState().close();
  const item = useDocumentStore((s) => {
    const it = s.doc.items[itemId];
    return it?.type === 'tasklist' ? it : null;
  });
  if (!item) {
    close();
    return null;
  }
  return (
    <UiDialog
      title="Task list settings"
      onClose={close}
      className="tier-sheet"
      testId="tasklist-editor"
    >
      <div className="plugin-settings">
        <label className="settings-row">
          <span>Title</span>
          <input
            className="tag-input"
            defaultValue={item.title}
            data-testid="tasklist-title-input"
            onBlur={(e) =>
              updateTasklist(itemId, 'Rename task list', (t) => {
                t.title = e.target.value.trim() || 'Tasks';
              })
            }
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row">
          <span>Card</span>
          <input
            type="color"
            value={item.background ?? '#ffffff'}
            aria-label="Background color"
            data-testid="tasklist-bg-input"
            onChange={(e) =>
              updateTasklist(itemId, 'Task list background', (t) => {
                t.background = e.target.value;
              })
            }
          />
          <button
            type="button"
            className="suggest-conn-btn tasklist-color-reset"
            disabled={item.background === null}
            data-testid="tasklist-bg-reset"
            onClick={() =>
              updateTasklist(itemId, 'Task list background', (t) => {
                t.background = null;
              })
            }
          >
            Theme
          </button>
        </label>
        <label className="settings-row">
          <span>Text</span>
          <input
            type="color"
            value={item.color ?? '#16181d'}
            aria-label="Text color"
            data-testid="tasklist-color-input"
            onChange={(e) =>
              updateTasklist(itemId, 'Task list text color', (t) => {
                t.color = e.target.value;
              })
            }
          />
          <button
            type="button"
            className="suggest-conn-btn tasklist-color-reset"
            disabled={item.color === null}
            data-testid="tasklist-color-reset"
            onClick={() =>
              updateTasklist(itemId, 'Task list text color', (t) => {
                t.color = null;
              })
            }
          >
            Auto
          </button>
        </label>
        <label className="settings-row">
          <span>Sort</span>
          <button
            type="button"
            className="suggest-conn-btn tasklist-color-reset"
            data-testid="tasklist-sort-name"
            onClick={() => applySort(itemId, 'Sort tasks by name', SORT_CMPS.name)}
          >
            Name <DirArrow dir={sortDir(item, SORT_CMPS.name)} />
          </button>
          <button
            type="button"
            className="suggest-conn-btn tasklist-color-reset"
            data-testid="tasklist-sort-due"
            onClick={() => applySort(itemId, 'Sort tasks by due date', SORT_CMPS.due)}
          >
            Due date <DirArrow dir={sortDir(item, SORT_CMPS.due)} />
          </button>
          <button
            type="button"
            className="suggest-conn-btn tasklist-color-reset"
            data-testid="tasklist-sort-open"
            onClick={() => applySort(itemId, 'Sort tasks by status', SORT_CMPS.open)}
          >
            Open first <DirArrow dir={sortDir(item, SORT_CMPS.open)} />
          </button>
        </label>
        <p className="settings-hint">
          Edit tasks right on the card: click a checkbox to complete, double-click text to edit,
          drag the ⋮⋮ grip to reorder, and use the calendar chip for a due date — due tasks raise a
          browser notification while the board is open. Sorts are one-shot: click again to reverse,
          drag anytime to fine-tune.
        </p>
      </div>
    </UiDialog>
  );
}

function TasklistDialogs() {
  useEffect(() => {
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<{ itemId: string }>).detail;
      const item = useDocumentStore.getState().doc.items[detail.itemId];
      if (item?.type === 'tasklist') useTasklistEditor.getState().open(detail.itemId);
    };
    window.addEventListener('boardcache:edit-tasklist', onEdit);
    return () => window.removeEventListener('boardcache:edit-tasklist', onEdit);
  }, []);

  // Notification engine: reschedule on every doc change (debounced) and on a
  // slow interval so far-future due dates roll into setTimeout range.
  useEffect(() => {
    scheduleTaskNotifications();
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const unsub = useDocumentStore.subscribe(
      (s) => s.doc,
      () => {
        clearTimeout(debounce);
        debounce = setTimeout(scheduleTaskNotifications, 400);
      },
    );
    const rescan = setInterval(scheduleTaskNotifications, 60 * 60 * 1000);
    return () => {
      unsub();
      clearTimeout(debounce);
      clearInterval(rescan);
    };
  }, []);

  return <TasklistEditorDialog />;
}

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 60,
    name: 'Task Lists',
    description:
      'WYSIWYG checklist cards: tasks with notes and due dates, custom colors, and browser notifications when a task comes due.',
  },
  addMenu: [
    {
      label: 'Add Task List',
      category: 'structure',
      icon: <ListChecksIcon />,
      onSelect: () => {
        createTasklistItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2));
      },
    },
  ],
  Component: TasklistDialogs,
});
