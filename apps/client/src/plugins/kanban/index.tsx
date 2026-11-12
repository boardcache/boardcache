import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { KanbanItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { ColumnsIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createKanbanItem, KANBAN_DEFAULT_COLUMNS } from '../../lib/import/createItems';
import { updateKanban } from '../../lib/structure/kanbanAttach';
import { useDocumentStore } from '../../state/documentStore';
import { registerPlugin } from '../registry';

/**
 * Kanban plugin: the create/edit UX around the core `kanban` item type (a
 * standalone board of named columns). Columns are edited in a dialog opened
 * from the card's pencil via the boardcache:edit-kanban event; the
 * drop/file machinery lives in lib/structure/kanbanAttach.
 */

const useKanbanEditor = create<{
  itemId: string | null;
  open: (itemId: string) => void;
  close: () => void;
}>((set) => ({
  itemId: null,
  open: (itemId) => set({ itemId }),
  close: () => set({ itemId: null }),
}));

function kanbanOf(id: string | null): KanbanItem | null {
  const item = id ? useDocumentStore.getState().doc.items[id] : undefined;
  return item?.type === 'kanban' ? item : null;
}

function KanbanEditorDialog() {
  const itemId = useKanbanEditor((s) => s.itemId);
  return itemId ? <KanbanEditorBody key={itemId} itemId={itemId} /> : null;
}

function KanbanEditorBody({ itemId }: { itemId: string }) {
  const close = () => useKanbanEditor.getState().close();
  const item = useDocumentStore((s) => {
    const it = s.doc.items[itemId];
    return it?.type === 'kanban' ? it : null;
  });
  if (!item) {
    close();
    return null;
  }
  return (
    <UiDialog title="Edit columns" onClose={close} className="tier-sheet" testId="kanban-editor">
      <div className="plugin-settings">
        <label className="settings-row">
          <span>Title</span>
          <input
            className="tag-input"
            defaultValue={item.title}
            data-testid="kanban-title-input"
            onBlur={(e) =>
              updateKanban(itemId, 'Rename kanban', (kb) => {
                kb.title = e.target.value.trim() || 'Kanban';
              })
            }
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row">
          <span>About</span>
          <input
            className="tag-input"
            defaultValue={item.description}
            placeholder="Optional description"
            data-testid="kanban-desc-input"
            onBlur={(e) =>
              updateKanban(itemId, 'Describe kanban', (kb) => {
                kb.description = e.target.value.trim();
              })
            }
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="plugin-settings-check">
          <input
            type="checkbox"
            checked={item.showTitles}
            data-testid="kanban-titles-check"
            onChange={(e) =>
              updateKanban(itemId, 'Toggle card titles', (kb) => {
                kb.showTitles = e.target.checked;
              })
            }
          />
          Show a title under each card
        </label>
        <div className="plugin-settings-list">
          {item.columns.map((column, i) => (
            <div className="tier-editor-row" key={column.id} data-testid="kanban-editor-column">
              <input
                type="color"
                value={column.color}
                aria-label={`Column ${column.label} color`}
                onChange={(e) =>
                  updateKanban(itemId, 'Recolor column', (kb) => {
                    const c = kb.columns.find((x) => x.id === column.id);
                    if (c) c.color = e.target.value;
                  })
                }
              />
              <input
                className="tag-input"
                defaultValue={column.label}
                aria-label="Column name"
                data-testid="kanban-column-label"
                onBlur={(e) =>
                  updateKanban(itemId, 'Rename column', (kb) => {
                    const c = kb.columns.find((x) => x.id === column.id);
                    if (c) c.label = e.target.value.trim() || c.label;
                  })
                }
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="suggest-conn-btn"
                disabled={i === 0}
                aria-label="Move column left"
                onClick={() =>
                  updateKanban(itemId, 'Reorder columns', (kb) => {
                    const [c] = kb.columns.splice(i, 1);
                    kb.columns.splice(i - 1, 0, c!);
                  })
                }
              >
                ←
              </button>
              <button
                type="button"
                className="suggest-conn-btn"
                aria-label="Remove column"
                data-testid="kanban-column-remove"
                disabled={item.columns.length <= 1}
                onClick={() =>
                  updateKanban(itemId, 'Remove column', (kb) => {
                    // Unfile the column's items rather than orphaning them.
                    kb.columns = kb.columns.filter((x) => x.id !== column.id);
                  })
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="suggest-conn-btn plugin-settings-add"
          data-testid="kanban-column-add"
          onClick={() =>
            updateKanban(itemId, 'Add column', (kb) => {
              const preset =
                KANBAN_DEFAULT_COLUMNS[kb.columns.length % KANBAN_DEFAULT_COLUMNS.length]!;
              kb.columns.push({ id: newId(), label: 'New', color: preset.color, itemIds: [] });
              kb.width += 200;
            })
          }
        >
          + Add column
        </button>
      </div>
    </UiDialog>
  );
}

function KanbanDialogs() {
  const [, force] = useState(0);
  useEffect(() => {
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<{ itemId: string }>).detail;
      if (kanbanOf(detail.itemId)) useKanbanEditor.getState().open(detail.itemId);
      force((n) => n + 1);
    };
    window.addEventListener('boardcache:edit-kanban', onEdit);
    return () => window.removeEventListener('boardcache:edit-kanban', onEdit);
  }, []);
  return <KanbanEditorDialog />;
}

registerPlugin({
  manifest: {
    id: 'kanban',
    order: 59,
    name: 'Kanban Boards',
    description:
      'Standalone kanban cards: named columns side by side; drag canvas items onto a column to file them — they stack in the lane, sized to fit.',
  },
  addMenu: [
    {
      label: 'Add Kanban Board',
      category: 'structure',
      icon: <ColumnsIcon />,
      onSelect: () => {
        createKanbanItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2));
      },
    },
  ],
  Component: KanbanDialogs,
});
