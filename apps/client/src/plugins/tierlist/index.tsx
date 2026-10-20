import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { TierlistItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { LayersIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createTierListItem, TIER_DEFAULT_ROWS } from '../../lib/import/createItems';
import { updateTier } from '../../lib/structure/tierAttach';
import { useDocumentStore } from '../../state/documentStore';
import { registerPlugin } from '../registry';

/**
 * Tier List plugin: the create/edit UX around the core `tierlist` item type
 * (S–F ranking card). Rows are edited in a dialog opened from the card's ⚙
 * via the boardcache:edit-tierlist event; the drop/rank machinery lives in
 * lib/tierAttach.
 */

const PLUGIN_ID = 'tierlist';

const useTierEditor = create<{
  itemId: string | null;
  open: (itemId: string) => void;
  close: () => void;
}>((set) => ({
  itemId: null,
  open: (itemId) => set({ itemId }),
  close: () => set({ itemId: null }),
}));

function tierOf(id: string | null): TierlistItem | null {
  const item = id ? useDocumentStore.getState().doc.items[id] : undefined;
  return item?.type === 'tierlist' ? item : null;
}

function TierEditorDialog() {
  const itemId = useTierEditor((s) => s.itemId);
  return itemId ? <TierEditorBody key={itemId} itemId={itemId} /> : null;
}

function TierEditorBody({ itemId }: { itemId: string }) {
  const close = () => useTierEditor.getState().close();
  const item = useDocumentStore((s) => {
    const it = s.doc.items[itemId];
    return it?.type === 'tierlist' ? it : null;
  });
  if (!item) {
    close();
    return null;
  }
  return (
    <UiDialog title="Edit tiers" onClose={close} className="tier-sheet" testId="tier-editor">
      <div className="plugin-settings">
        <label className="settings-row">
          <span>Title</span>
          <input
            className="tag-input"
            defaultValue={item.title}
            data-testid="tier-title-input"
            onBlur={(e) =>
              updateTier(itemId, 'Rename tier list', (t) => {
                t.title = e.target.value.trim() || 'Tier List';
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
            data-testid="tier-desc-input"
            onBlur={(e) =>
              updateTier(itemId, 'Describe tier list', (t) => {
                t.description = e.target.value.trim();
              })
            }
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <div className="plugin-settings-list">
          {item.rows.map((row, i) => (
            <div className="tier-editor-row" key={row.id} data-testid="tier-editor-row">
              <input
                type="color"
                value={row.color}
                aria-label={`Row ${row.label} color`}
                onChange={(e) =>
                  updateTier(itemId, 'Recolor tier', (t) => {
                    const r = t.rows.find((x) => x.id === row.id);
                    if (r) r.color = e.target.value;
                  })
                }
              />
              <input
                className="tag-input"
                defaultValue={row.label}
                aria-label="Row label"
                data-testid="tier-row-label"
                onBlur={(e) =>
                  updateTier(itemId, 'Rename tier', (t) => {
                    const r = t.rows.find((x) => x.id === row.id);
                    if (r) r.label = e.target.value.trim() || r.label;
                  })
                }
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="suggest-conn-btn"
                disabled={i === 0}
                aria-label="Move row up"
                onClick={() =>
                  updateTier(itemId, 'Reorder tiers', (t) => {
                    const [r] = t.rows.splice(i, 1);
                    t.rows.splice(i - 1, 0, r!);
                  })
                }
              >
                ↑
              </button>
              <button
                type="button"
                className="suggest-conn-btn"
                aria-label="Remove row"
                data-testid="tier-row-remove"
                disabled={item.rows.length <= 1}
                onClick={() =>
                  updateTier(itemId, 'Remove tier', (t) => {
                    // Un-rank the row's items rather than orphaning them.
                    const r = t.rows.find((x) => x.id === row.id);
                    if (r) t.rows = t.rows.filter((x) => x.id !== row.id);
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
          data-testid="tier-row-add"
          onClick={() =>
            updateTier(itemId, 'Add tier', (t) => {
              const preset = TIER_DEFAULT_ROWS[t.rows.length % TIER_DEFAULT_ROWS.length]!;
              t.rows.push({ id: newId(), label: 'New', color: preset.color, itemIds: [] });
              t.height += 96;
            })
          }
        >
          + Add row
        </button>
      </div>
    </UiDialog>
  );
}

function TierDialogs() {
  const [, force] = useState(0);
  useEffect(() => {
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<{ itemId: string }>).detail;
      if (tierOf(detail.itemId)) useTierEditor.getState().open(detail.itemId);
      force((n) => n + 1);
    };
    window.addEventListener('boardcache:edit-tierlist', onEdit);
    return () => window.removeEventListener('boardcache:edit-tierlist', onEdit);
  }, []);
  return <TierEditorDialog />;
}

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 58,
    name: 'Tier Lists',
    description:
      'Classic S–F ranking cards: drag canvas items onto a tier shelf to rank them — they snap to the row, sized to fit.',
  },
  addMenu: [
    {
      label: 'Add Tier List',
      category: 'structure',
      icon: <LayersIcon />,
      onSelect: () => {
        createTierListItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2));
      },
    },
  ],
  Component: TierDialogs,
});
