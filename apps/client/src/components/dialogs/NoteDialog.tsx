import { useEffect, useState } from 'react';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { updateItems } from '../../state/commands';
import { mediaMeta } from '../../lib/mediaItems';
import { UiDialog } from '../ui/Dialog';

/** The context-menu "Note" editor: a small modal over the selected item(s). */
export function NoteDialog() {
  const ids = useSessionStore((s) => s.noteEditorItems);
  return ids && ids.length ? <NoteDialogBody ids={ids} /> : null;
}

function NoteDialogBody({ ids }: { ids: string[] }) {
  const close = () => useSessionStore.getState().setNoteEditor(null);
  const doc = useDocumentStore((s) => s.doc);
  const present = ids.filter((id) => doc.items[id]);
  const [value, setValue] = useState(() => (present[0] && doc.items[present[0]]?.notes) ?? '');

  useEffect(() => {
    if (!present.length) close();
  }, [present.length]);

  if (!present.length) return null;
  const title =
    present.length === 1 ? mediaMeta(doc.items[present[0]!]!).title : `${present.length} items`;

  const save = () => {
    const v = value.trim();
    updateItems(present, 'Edit note', (d) => {
      if (v) d.notes = v;
      else delete d.notes;
    });
    close();
  };

  return (
    <UiDialog title={`Note · ${title}`} onClose={close} className="note-sheet" testId="note-dialog">
      <div className="note-sheet-body">
        <textarea
          className="note-textarea"
          value={value}
          autoFocus
          data-autofocus
          placeholder="Write a note"
          data-testid="note-textarea"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return; // let the dialog close (discard)
            e.stopPropagation();
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          }}
        />
        <div className="note-sheet-actions">
          <button type="button" className="sync-primary" onClick={save} data-testid="note-save">
            Save
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
