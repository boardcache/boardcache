import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { StoryboardItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { FilmIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createStoryboardItem } from '../../lib/import/createItems';
import { updateStoryboard } from '../../lib/structure/storyboardAttach';
import { useDocumentStore } from '../../state/documentStore';
import { registerPlugin } from '../registry';

/**
 * Storyboard plugin: the create/edit UX around the core `storyboard` item
 * type (shot-panel grid). Panels are edited in a dialog opened from the
 * card's ⚙ via the boardcache:edit-storyboard event; the drop/frame
 * machinery lives in lib/storyboardAttach.
 */

const PLUGIN_ID = 'storyboard';

const useSbEditor = create<{
  itemId: string | null;
  open: (itemId: string) => void;
  close: () => void;
}>((set) => ({
  itemId: null,
  open: (itemId) => set({ itemId }),
  close: () => set({ itemId: null }),
}));

function sbOf(id: string | null): StoryboardItem | null {
  const item = id ? useDocumentStore.getState().doc.items[id] : undefined;
  return item?.type === 'storyboard' ? item : null;
}

function SbEditorDialog() {
  const itemId = useSbEditor((s) => s.itemId);
  return itemId ? <SbEditorBody key={itemId} itemId={itemId} /> : null;
}

function SbEditorBody({ itemId }: { itemId: string }) {
  const close = () => useSbEditor.getState().close();
  const item = useDocumentStore((s) => {
    const it = s.doc.items[itemId];
    return it?.type === 'storyboard' ? it : null;
  });
  if (!item) {
    close();
    return null;
  }
  const patch = (label: string, recipe: (sb: StoryboardItem) => void) =>
    updateStoryboard(itemId, label, recipe);
  return (
    <UiDialog
      title="Edit storyboard"
      onClose={close}
      className="tier-sheet"
      testId="storyboard-editor"
    >
      <div className="plugin-settings">
        <label className="settings-row">
          <span>Title</span>
          <input
            className="tag-input"
            defaultValue={item.title}
            data-testid="storyboard-title-input"
            onBlur={(e) => patch('Rename storyboard', (sb) => void (sb.title = e.target.value))}
          />
        </label>
        <label className="settings-row">
          <span>Aspect</span>
          <select
            className="tag-input"
            value={item.aspect}
            data-testid="storyboard-aspect"
            onChange={(e) =>
              patch('Storyboard aspect', (sb) => {
                sb.aspect = e.target.value as StoryboardItem['aspect'];
              })
            }
          >
            <option value="16:9">16:9 — widescreen</option>
            <option value="9:16">9:16 — vertical</option>
            <option value="4:3">4:3</option>
            <option value="2.39:1">2.39:1 — anamorphic</option>
          </select>
        </label>
        <label className="settings-row">
          <span>Columns</span>
          <input
            className="tag-input"
            type="number"
            min={1}
            max={8}
            value={item.columns}
            data-testid="storyboard-columns"
            onChange={(e) =>
              patch('Storyboard columns', (sb) => {
                sb.columns = Math.max(1, Math.min(8, Number(e.target.value) || 3));
              })
            }
          />
        </label>
        <div className="sb-panel-rows">
          {item.panels.map((panel, i) => (
            <div className="sb-panel-row" key={panel.id} data-testid="storyboard-panel-row">
              <input
                className="tag-input sb-panel-label"
                defaultValue={panel.label}
                aria-label="Shot label"
                onBlur={(e) =>
                  patch('Edit shot', (sb) => {
                    const p = sb.panels.find((x) => x.id === panel.id);
                    if (p) p.label = e.target.value;
                  })
                }
              />
              <input
                className="tag-input sb-panel-scene"
                defaultValue={panel.scene}
                placeholder="EXT. HARBOR — DAWN"
                aria-label="Scene"
                onBlur={(e) =>
                  patch('Edit shot', (sb) => {
                    const p = sb.panels.find((x) => x.id === panel.id);
                    if (p) p.scene = e.target.value;
                  })
                }
              />
              <input
                className="tag-input sb-panel-action"
                defaultValue={panel.action}
                placeholder="What happens"
                aria-label="Action"
                onBlur={(e) =>
                  patch('Edit shot', (sb) => {
                    const p = sb.panels.find((x) => x.id === panel.id);
                    if (p) p.action = e.target.value;
                  })
                }
              />
              <input
                className="tag-input sb-panel-dur"
                type="number"
                min={0}
                defaultValue={panel.duration ?? ''}
                placeholder="s"
                aria-label="Duration (seconds)"
                onBlur={(e) =>
                  patch('Edit shot', (sb) => {
                    const p = sb.panels.find((x) => x.id === panel.id);
                    if (p)
                      p.duration =
                        e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                  })
                }
              />
              <button
                type="button"
                className="sb-panel-remove"
                aria-label={`Remove ${panel.label}`}
                data-testid={`storyboard-remove-${i}`}
                onClick={() =>
                  patch('Remove shot', (sb) => {
                    sb.panels = sb.panels.filter((x) => x.id !== panel.id);
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="community-preview-btn"
          data-testid="storyboard-add-panel"
          onClick={() =>
            patch('Add shot', (sb) => {
              sb.panels.push({
                id: newId(),
                label: `Shot ${String(sb.panels.length + 1).padStart(2, '0')}`,
                scene: '',
                action: '',
                move: '',
                lens: '',
                duration: null,
                itemIds: [],
                freeArrange: false,
              });
            })
          }
        >
          + Add shot
        </button>
      </div>
    </UiDialog>
  );
}

function SbDialogs() {
  const [, force] = useState(0);
  useEffect(() => {
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<{ itemId: string }>).detail;
      if (sbOf(detail.itemId)) useSbEditor.getState().open(detail.itemId);
      force((n) => n + 1);
    };
    window.addEventListener('boardcache:edit-storyboard', onEdit);
    return () => window.removeEventListener('boardcache:edit-storyboard', onEdit);
  }, []);
  return <SbEditorDialog />;
}

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 59,
    name: 'Storyboards',
    description:
      'Shot-panel grids with aspect-locked frames: drop images onto panels to board a sequence — slate lines, durations, and a summed runtime.',
  },
  addMenu: [
    {
      label: 'Add Storyboard',
      category: 'structure',
      icon: <FilmIcon />,
      onSelect: () => {
        createStoryboardItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2));
      },
    },
  ],
  Component: SbDialogs,
});
