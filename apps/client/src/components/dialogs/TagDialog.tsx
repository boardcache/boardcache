import { useEffect } from 'react';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { mediaMeta } from '../../lib/mediaItems';
import { TagEditor } from '../panels/TagEditor';
import { UiDialog } from '../ui/Dialog';

/** The context-menu "Tags" editor: a small modal over the selected item(s). */
export function TagDialog() {
  const ids = useSessionStore((s) => s.tagEditorItems);
  return ids && ids.length ? <TagDialogBody ids={ids} /> : null;
}

function TagDialogBody({ ids }: { ids: string[] }) {
  const close = () => useSessionStore.getState().setTagEditor(null);
  const doc = useDocumentStore((s) => s.doc);
  const present = ids.filter((id) => doc.items[id]);

  useEffect(() => {
    if (!present.length) close();
  }, [present.length]);

  if (!present.length) return null;
  const title =
    present.length === 1 ? mediaMeta(doc.items[present[0]!]!).title : `${present.length} items`;

  return (
    <UiDialog title={`Tags · ${title}`} onClose={close} className="tag-sheet" testId="tag-dialog">
      <div className="tag-sheet-body">
        <TagEditor itemIds={present} autoFocus />
      </div>
    </UiDialog>
  );
}
