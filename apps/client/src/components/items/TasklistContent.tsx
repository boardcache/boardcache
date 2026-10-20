import { useEffect, useRef, useState } from 'react';
import type { TasklistItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { readableTextColor } from '../../lib/color/color';
import {
  ensureNotifyPermission,
  formatDue,
  isOverdue,
  tasklistBaseW,
  updateTasklist,
} from '../../lib/structure/tasklist';
import { ScaledCard } from './ScaledCard';
import { PencilIcon, CalendarIcon, CloseIcon } from '../icons';

/**
 * WYSIWYG task-list card: centered title, checkbox rows with an optional
 * note and due date. Everything edits in place — double-click text to edit,
 * hover a row for the date/remove chips. Due dates feed the browser
 * notification engine (lib/tasklist).
 */

/** datetime-local value (local time, minute precision) for an ISO string. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditText({
  value,
  className,
  placeholder,
  onCommit,
  onEnter,
  onCancel,
}: {
  value: string;
  className: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  /** Enter commits differently from blur (task chaining); defaults to onCommit. */
  onEnter?: (v: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className={className}
      defaultValue={value}
      placeholder={placeholder}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (onEnter ?? onCommit)((e.target as HTMLInputElement).value);
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}

export function TasklistContent({ item, stage }: { item: TasklistItem; stage?: boolean }) {
  // Which piece is being edited in place: the title, or one field of a task.
  const [editing, setEditing] = useState<
    { kind: 'title' } | { kind: 'label' | 'note' | 'due'; taskId: string } | null
  >(null);
  const stop = () => setEditing(null);
  // A task being typed that isn't in the doc yet: committed on Enter/blur
  // with text, discarded when left empty. Enter chains the next draft —
  // type, Enter, type, Enter like a notes app.
  const [draft, setDraft] = useState<{ afterId: string | null } | null>(null);

  const commitDraft = (value: string, afterId: string | null, chain: boolean) => {
    const label = value.trim();
    if (!label) {
      setDraft(null);
      return;
    }
    const id = newId();
    updateTasklist(item.id, 'Add task', (t) => {
      const at = afterId ? t.tasks.findIndex((x) => x.id === afterId) : -1;
      const idx = at >= 0 ? at + 1 : t.tasks.length;
      t.tasks.splice(idx, 0, { id, label, done: false, note: '', due: null, notifiedAt: null });
    });
    setDraft(chain ? { afterId: id } : null);
  };

  // Manual reordering: drag a row's grip; insertion index from row midpoints
  // (DOM rects, so it works at any card scale and in the lightbox).
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<string | null>(null);
  const dropRef = useRef<number | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const beginTaskDrag = (e: React.PointerEvent, taskId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = taskId;
    setDragTaskId(taskId);
    const onMove = (ev: PointerEvent) => {
      const body = bodyRef.current;
      if (!body || !dragRef.current) return;
      const rows = [...body.querySelectorAll('[data-testid="task-row"]')];
      let idx = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          idx = i;
          break;
        }
      }
      dropRef.current = idx;
      setDropIndex(idx);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const id = dragRef.current;
      const at = dropRef.current;
      dragRef.current = null;
      dropRef.current = null;
      setDragTaskId(null);
      setDropIndex(null);
      if (id && at !== null) {
        updateTasklist(item.id, 'Reorder tasks', (t) => {
          const from = t.tasks.findIndex((x) => x.id === id);
          if (from < 0) return;
          const to = at > from ? at - 1 : at;
          const [moved] = t.tasks.splice(from, 1);
          t.tasks.splice(to, 0, moved!);
        });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const draftRow = draft && (
    <div
      className="task-row task-row-draft"
      data-testid="task-draft"
      key={`draft-${draft.afterId ?? 'end'}`}
    >
      <span className="task-check task-check-ghost" aria-hidden />
      <div className="task-main">
        <EditText
          value=""
          className="task-label-input"
          placeholder="New task"
          onCommit={(v) => commitDraft(v, draft.afterId, false)}
          onEnter={(v) => commitDraft(v, draft.afterId, true)}
          onCancel={() => setDraft(null)}
        />
      </div>
    </div>
  );

  const bg = item.background ?? undefined;
  const ink = item.color ?? (item.background ? readableTextColor(item.background) : undefined);

  // Resize = uniform zoom (like trees): content renders at the design width
  // and scales with the card — live during the drag (ScaledCard).
  const baseW = tasklistBaseW(item);

  const toggle = (taskId: string) =>
    updateTasklist(item.id, 'Toggle task', (t) => {
      const task = t.tasks.find((x) => x.id === taskId);
      if (task) task.done = !task.done;
    });

  const card = (
    <div
      className={`tasklist-card${stage ? ' tasklist-stage' : ''}`}
      style={{ background: bg, color: ink }}
      data-testid="tasklist-card"
    >
      {editing?.kind === 'title' ? (
        <EditText
          value={item.title}
          className="tasklist-title-input"
          onCommit={(v) => {
            updateTasklist(item.id, 'Rename task list', (t) => {
              t.title = v.trim() || 'Tasks';
            });
            stop();
          }}
          onCancel={stop}
        />
      ) : (
        <div
          className="tasklist-title"
          data-testid="tasklist-title"
          onClick={
            stage
              ? (e) => {
                  e.stopPropagation();
                  setEditing({ kind: 'title' });
                }
              : undefined
          }
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing({ kind: 'title' });
          }}
        >
          {item.title}
        </div>
      )}

      {item.tasks.length > 0 && (
        <div
          className="tasklist-progress"
          data-testid="tasklist-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={item.tasks.length}
          aria-valuenow={item.tasks.filter((t) => t.done).length}
          title={`${item.tasks.filter((t) => t.done).length} of ${item.tasks.length} done`}
        >
          <div
            className="tasklist-progress-fill"
            style={{
              width: `${Math.round((item.tasks.filter((t) => t.done).length / item.tasks.length) * 100)}%`,
            }}
          />
        </div>
      )}

      <button
        type="button"
        className="tasklist-edit"
        data-testid="tasklist-edit"
        aria-label="Task list settings"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          window.dispatchEvent(
            new CustomEvent('boardcache:edit-tasklist', { detail: { itemId: item.id } }),
          );
        }}
      >
        <PencilIcon size={14} />
      </button>

      <div className="tasklist-body" ref={bodyRef}>
        {item.tasks.map((task) => {
          const overdue = isOverdue(task.due, task.done);
          return (
            <div key={task.id} className="task-row-wrap">
              <div
                className={`task-row${task.done ? ' task-done' : ''}${dragTaskId === task.id ? ' task-dragging' : ''}${dropIndex === item.tasks.indexOf(task) ? ' task-drop-before' : ''}`}
                data-testid="task-row"
              >
                <button
                  type="button"
                  className="task-grip"
                  aria-label="Drag to reorder"
                  data-testid="task-grip"
                  onPointerDown={(e) => beginTaskDrag(e, task.id)}
                >
                  ⋮⋮
                </button>
                <button
                  type="button"
                  className="task-check"
                  role="checkbox"
                  aria-checked={task.done}
                  data-testid="task-check"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggle(task.id)}
                >
                  {task.done && (
                    <svg viewBox="0 0 12 12" aria-hidden>
                      <path
                        d="M2 6.5 5 9.5 10 3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>

                <div className="task-main">
                  {editing?.kind === 'label' && editing.taskId === task.id ? (
                    <EditText
                      value={task.label}
                      className="task-label-input"
                      onCommit={(v) => {
                        updateTasklist(item.id, 'Edit task', (t) => {
                          const x = t.tasks.find((y) => y.id === task.id);
                          if (x) x.label = v.trim() || x.label;
                        });
                        stop();
                      }}
                      onEnter={(v) => {
                        updateTasklist(item.id, 'Edit task', (t) => {
                          const x = t.tasks.find((y) => y.id === task.id);
                          if (x) x.label = v.trim() || x.label;
                        });
                        stop();
                        setDraft({ afterId: task.id });
                      }}
                      onCancel={stop}
                    />
                  ) : (
                    <span
                      className="task-label"
                      data-testid="task-label"
                      onClick={
                        stage
                          ? (e) => {
                              e.stopPropagation();
                              setEditing({ kind: 'label', taskId: task.id });
                            }
                          : undefined
                      }
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditing({ kind: 'label', taskId: task.id });
                      }}
                    >
                      {task.label}
                    </span>
                  )}
                  {editing?.kind === 'note' && editing.taskId === task.id ? (
                    <EditText
                      value={task.note}
                      className="task-note-input"
                      placeholder="Description"
                      onCommit={(v) => {
                        updateTasklist(item.id, 'Edit task note', (t) => {
                          const x = t.tasks.find((y) => y.id === task.id);
                          if (x) x.note = v.trim();
                        });
                        stop();
                      }}
                      onCancel={stop}
                    />
                  ) : (
                    <span
                      className={`task-note${task.note ? '' : ' task-note-empty'}`}
                      data-testid="task-note"
                      onClick={
                        stage
                          ? (e) => {
                              e.stopPropagation();
                              setEditing({ kind: 'note', taskId: task.id });
                            }
                          : undefined
                      }
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditing({ kind: 'note', taskId: task.id });
                      }}
                    >
                      {task.note || 'Add description'}
                    </span>
                  )}
                </div>

                <div className="task-side">
                  {editing?.kind === 'due' && editing.taskId === task.id ? (
                    <input
                      type="datetime-local"
                      className="task-due-input"
                      data-testid="task-due-input"
                      autoFocus
                      defaultValue={toLocalInput(task.due)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter' || e.key === 'Escape') stop();
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                        ensureNotifyPermission();
                        updateTasklist(item.id, 'Set due date', (t) => {
                          const x = t.tasks.find((y) => y.id === task.id);
                          if (!x) return;
                          x.due = v ? new Date(v).toISOString() : null;
                          x.notifiedAt = null; // a new date notifies again
                        });
                      }}
                      onBlur={stop}
                    />
                  ) : (
                    <button
                      type="button"
                      className={`task-due${overdue ? ' task-due-overdue' : ''}${task.due ? '' : ' task-due-empty'}`}
                      data-testid="task-due"
                      title={task.due ? 'Change due date' : 'Set due date'}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setEditing({ kind: 'due', taskId: task.id })}
                    >
                      <CalendarIcon size={12} />
                      {task.due && <span>{formatDue(task.due)}</span>}
                    </button>
                  )}
                  <button
                    type="button"
                    className="task-remove"
                    aria-label="Remove task"
                    data-testid="task-remove"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() =>
                      updateTasklist(item.id, 'Remove task', (t) => {
                        t.tasks = t.tasks.filter((x) => x.id !== task.id);
                      })
                    }
                  >
                    <CloseIcon size={11} />
                  </button>
                </div>
              </div>
              {draft?.afterId === task.id && draftRow}
            </div>
          );
        })}
        {draft &&
          (draft.afterId === null || !item.tasks.some((t) => t.id === draft.afterId)) &&
          draftRow}
        {!draft && (
          <button
            type="button"
            className={`task-row task-row-blank${dropIndex === item.tasks.length ? ' task-drop-before' : ''}`}
            data-testid="task-add"
            aria-label="Add task"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              setEditing(null);
              setDraft({ afterId: null });
            }}
          >
            <span className="task-check task-check-ghost" aria-hidden />
            <span className="task-blank-hint">Add task</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <ScaledCard item={item} baseW={baseW} stage={stage}>
      {card}
    </ScaledCard>
  );
}
