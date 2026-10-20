import { useEffect } from 'react';
import { create } from 'zustand';
import { NetworkIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { UiSelect } from '../../components/ui/Select';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createTreeItem } from '../../lib/import/createItems';
import { updateTree } from '../../lib/structure/treeAttach';
import { useDocumentStore } from '../../state/documentStore';
import { registerPlugin } from '../registry';

/**
 * Tree / Mind Map plugin: creation + the settings dialog (title, layout
 * mode). All NODE editing is WYSIWYG on the card itself — inline rename,
 * hover chips, drag to re-parent/reorder (see TreeContent).
 */

const PLUGIN_ID = 'tree';

const useTreeEditor = create<{
  itemId: string | null;
  open: (itemId: string) => void;
  close: () => void;
}>((set) => ({
  itemId: null,
  open: (itemId) => set({ itemId }),
  close: () => set({ itemId: null }),
}));

function TreeEditorDialog() {
  const itemId = useTreeEditor((s) => s.itemId);
  return itemId ? <Body key={itemId} itemId={itemId} /> : null;
}

function Body({ itemId }: { itemId: string }) {
  const close = () => useTreeEditor.getState().close();
  const item = useDocumentStore((s) => {
    const it = s.doc.items[itemId];
    return it?.type === 'tree' ? it : null;
  });
  if (!item) {
    close();
    return null;
  }
  return (
    <UiDialog title="Tree settings" onClose={close} className="tier-sheet" testId="tree-editor">
      <div className="plugin-settings">
        <label className="settings-row">
          <span>Title</span>
          <input
            className="tag-input"
            defaultValue={item.title}
            data-testid="tree-title-input"
            onBlur={(e) =>
              updateTree(itemId, 'Rename tree', (t) => {
                t.title = e.target.value.trim() || 'Tree';
              })
            }
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="settings-row">
          <span>Layout</span>
          <UiSelect
            value={item.mode}
            ariaLabel="Tree layout"
            testId="tree-mode-select"
            options={[
              { value: 'tree', label: 'Tree (top-down)' },
              { value: 'mindmap', label: 'Mind map (left-right)' },
            ]}
            onChange={(v) =>
              updateTree(itemId, 'Switch tree layout', (t) => {
                t.mode = v === 'mindmap' ? 'mindmap' : 'tree';
              })
            }
          />
        </label>
        <p className="settings-hint">
          Edit the map right on the card: double-click a node to rename, hover for add / color /
          remove, and drag a node onto another to re-parent it (drop near an edge to reorder
          siblings instead).
        </p>
      </div>
    </UiDialog>
  );
}

function TreeDialogs() {
  useEffect(() => {
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<{ itemId: string }>).detail;
      const item = useDocumentStore.getState().doc.items[detail.itemId];
      if (item?.type === 'tree') useTreeEditor.getState().open(detail.itemId);
    };
    window.addEventListener('boardcache:edit-tree', onEdit);
    return () => window.removeEventListener('boardcache:edit-tree', onEdit);
  }, []);
  return <TreeEditorDialog />;
}

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 59,
    name: 'Trees & Mind Maps',
    description:
      'Hierarchical tree and mind-map cards with automatic layout — drop canvas items onto a node to attach them under it.',
  },
  addMenu: [
    {
      label: 'Add Tree / Mind Map',
      category: 'structure',
      icon: <NetworkIcon />,
      onSelect: () => {
        createTreeItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2));
      },
    },
  ],
  Component: TreeDialogs,
});
