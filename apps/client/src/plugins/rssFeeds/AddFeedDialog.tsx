import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { UiDialog } from '../../components/ui/Dialog';
import { UiSelect } from '../../components/ui/Select';
import { createRssItem } from '../../lib/integrations/rss';
import { useDocumentStore } from '../../state/documentStore';
import { allFeedFolders } from './feedsModel';
import { useFeedsUi } from './store';

/** The root folder's value in the folder select (the empty value means "no choice"). */
const ROOT = '/';

/**
 * Add RSS Feed: the feed's address and the Feeds view folder it is filed
 * under (the folder it was asked from, when it was). The card appears at
 * once and fills in as the fetch lands.
 */
export function AddFeedDialog() {
  const dialog = useFeedsUi((s) => s.addDialog);
  if (!dialog) return null;
  return <AddFeedForm key={dialog.folder} folder={dialog.folder} />;
}

function AddFeedForm({ folder: initialFolder }: { folder: string }) {
  const folders = useDocumentStore(useShallow((s) => allFeedFolders(s.doc)));
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState(initialFolder);
  const close = () => useFeedsUi.getState().closeAdd();
  const add = () => {
    const address = url.trim();
    if (!address || address === 'https://') return;
    close();
    void createRssItem(address, undefined, { folder }).then((id) =>
      useFeedsUi.getState().setSelected(id),
    );
  };
  // A folder asked for that no feed holds yet is offered too.
  const options = [
    { value: ROOT, label: 'Feeds' },
    ...[...new Set([...folders, ...(initialFolder ? [initialFolder] : [])])]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((p) => ({ value: p, label: p })),
  ];
  return (
    <UiDialog title="Add RSS Feed" onClose={close} testId="feed-dialog">
      <div className="plugin-settings-fields feeds-add-form">
        <label className="plugin-settings-field">
          <span>Feed URL</span>
          <input
            type="url"
            value={url}
            placeholder="https://"
            autoFocus
            data-testid="feed-url"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') add();
            }}
          />
        </label>
        <label className="plugin-settings-field">
          <span>Folder</span>
          <UiSelect
            value={folder || ROOT}
            options={options}
            onChange={(v) => setFolder(v === ROOT ? '' : v)}
            ariaLabel="Folder"
            testId="feed-folder"
          />
        </label>
        <div className="ui-prompt-actions">
          <button
            type="button"
            className="sync-primary"
            data-testid="feed-add"
            disabled={!url.trim() || url.trim() === 'https://'}
            onClick={add}
          >
            Add Feed
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
