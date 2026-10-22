import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { StoryboardItem, StoryboardPanel } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { FilmIcon, PlusIcon, TrashIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { UiSelect } from '../../components/ui/Select';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createStoryboardItem } from '../../lib/import/createItems';
import { updateStoryboard } from '../../lib/structure/storyboardAttach';
import { useDocumentStore } from '../../state/documentStore';
import { registerPlugin } from '../registry';

/**
 * Storyboard plugin: the create/edit UX around the core `storyboard` item
 * type (shot-panel grid). Panels are edited in a dialog opened from the
 * card's pencil or the lightbox via the boardcache:edit-storyboard event; the drop/frame
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

const ASPECTS: { value: StoryboardItem['aspect']; label: string }[] = [
  { value: '16:9', label: '16:9 widescreen' },
  { value: '9:16', label: '9:16 vertical' },
  { value: '4:3', label: '4:3' },
  { value: '2.39:1', label: '2.39:1 anamorphic' },
];

type PanelText = 'label' | 'scene' | 'action' | 'move' | 'lens';

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
  const setPanel = (panelId: string, recipe: (p: StoryboardPanel) => void) =>
    patch('Edit shot', (sb) => {
      const p = sb.panels.find((x) => x.id === panelId);
      if (p) recipe(p);
    });
  const text = (panel: StoryboardPanel, field: PanelText, placeholder: string, label: string) => (
    <input
      className={`settings-input sb-shot-${field}`}
      defaultValue={panel[field]}
      placeholder={placeholder}
      aria-label={label}
      onBlur={(e) => {
        const v = e.target.value;
        if (v !== panel[field]) setPanel(panel.id, (p) => void (p[field] = v));
      }}
    />
  );
  return (
    <UiDialog
      title="Edit storyboard"
      onClose={close}
      className="sb-editor-sheet"
      testId="storyboard-editor"
    >
      <div className="sb-editor-body">
        <div className="sb-editor-settings">
          <label className="sb-editor-field sb-editor-title">
            <span>Title</span>
            <input
              className="settings-input"
              defaultValue={item.title}
              data-testid="storyboard-title-input"
              onBlur={(e) => patch('Rename storyboard', (sb) => void (sb.title = e.target.value))}
            />
          </label>
          <div className="sb-editor-field">
            <span>Aspect</span>
            <UiSelect
              value={item.aspect}
              options={ASPECTS}
              ariaLabel="Aspect"
              testId="storyboard-aspect"
              onChange={(v) =>
                patch('Storyboard aspect', (sb) => {
                  sb.aspect = v as StoryboardItem['aspect'];
                })
              }
            />
          </div>
          <label className="sb-editor-field sb-editor-cols">
            <span>Columns</span>
            <input
              className="settings-input"
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
        </div>

        <div className="sb-shots-head">
          <h3>Shots</h3>
          <span className="sb-shots-count">{item.panels.length}</span>
        </div>
        <ol className="sb-shots">
          {item.panels.map((panel, i) => (
            <li className="sb-shot" key={panel.id} data-testid="storyboard-panel-row">
              <div className="sb-shot-line">
                {text(panel, 'label', 'Shot', 'Shot label')}
                {text(panel, 'scene', 'EXT. HARBOR, DAWN', 'Scene')}
                <span className="sb-shot-dur">
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    step="0.5"
                    defaultValue={panel.duration ?? ''}
                    aria-label="Duration in seconds"
                    onBlur={(e) => {
                      const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                      if (v !== panel.duration) setPanel(panel.id, (p) => void (p.duration = v));
                    }}
                  />
                  <i aria-hidden>s</i>
                </span>
                <button
                  type="button"
                  className="sb-shot-remove"
                  title="Remove shot"
                  aria-label={`Remove ${panel.label}`}
                  data-testid={`storyboard-remove-${i}`}
                  onClick={() =>
                    patch('Remove shot', (sb) => {
                      sb.panels = sb.panels.filter((x) => x.id !== panel.id);
                    })
                  }
                >
                  <TrashIcon size={15} />
                </button>
              </div>
              <textarea
                className="settings-input sb-shot-action"
                rows={2}
                defaultValue={panel.action}
                placeholder="What happens in the shot"
                aria-label="Action"
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== panel.action) setPanel(panel.id, (p) => void (p.action = v));
                }}
              />
              <div className="sb-shot-line">
                {text(panel, 'move', 'Camera move, e.g. slow push in', 'Camera move')}
                {text(panel, 'lens', 'Lens, e.g. 35mm', 'Lens')}
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="sb-add-shot"
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
          <PlusIcon size={15} /> Add shot
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
