import {
  addPage,
  deletePage,
  duplicatePage,
  pageItems,
  renamePage,
  switchPage,
  activePageId,
} from '../../lib/board/pages';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { confirmDialog, promptText } from '../ui/Prompt';
import { CloseIcon, DuplicateIcon, PlusIcon, RenameIcon, TrashIcon } from '../icons';
import { VIEWER } from '../../lib/viewerMode';

/**
 * Pages switcher (docs/archive/PAGES_PLAN.md): list, switch, add, rename, duplicate,
 * delete. Deleting a page with items asks move-or-delete. Opens from the
 * corner cluster's pages toggle.
 */
export function PagesPanel() {
  const open = useSessionStore((s) => s.pagesOpen);
  const doc = useDocumentStore((s) => s.doc);
  const activeSession = useSessionStore((s) => s.activePageId);
  void activeSession; // re-render on switches
  if (!open) return null;

  const active = activePageId(doc);
  // A single-page board lists its one (implicit) page for orientation.
  const pages = doc.pages.length
    ? doc.pages
    : [{ id: '__implicit', name: 'Page 1', viewport: doc.viewport }];

  const rename = async (id: string, current: string) => {
    const name = await promptText({
      title: 'Rename page',
      label: 'Name',
      initial: current,
      confirmLabel: 'Rename',
    });
    if (name?.trim()) renamePage(id, name);
  };

  const remove = async (id: string, name: string) => {
    const count = pageItems(doc, id).length;
    if (count === 0) {
      deletePage(id, 'delete');
      return;
    }
    const move = await confirmDialog({
      title: `Delete “${name}”?`,
      body: `This page holds ${count} item${count === 1 ? '' : 's'}. Move them to the first page, or delete them with the page?`,
      confirmLabel: 'Move items',
      cancelLabel: 'Delete items',
    });
    deletePage(id, move ? 'move' : 'delete');
  };

  return (
    <div className="pages-panel" data-testid="pages-panel">
      <header className="pages-panel-head">
        <h3>Pages</h3>
        <button
          type="button"
          aria-label="Close pages"
          data-testid="pages-close"
          onClick={() => useSessionStore.getState().setPagesOpen(false)}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="pages-list">
        {pages.map((p) => {
          const isActive = p.id === '__implicit' ? true : p.id === active;
          const count = pageItems(doc, p.id === '__implicit' ? null : p.id).length;
          return (
            <div
              key={p.id}
              className={`pages-row${isActive ? ' active' : ''}`}
              data-testid="pages-row"
            >
              <button
                type="button"
                className="pages-row-main"
                data-testid="pages-switch"
                onClick={() => p.id !== '__implicit' && switchPage(p.id)}
              >
                <span className="pages-row-name">{p.name}</span>
                <span className="pages-row-count">{count}</span>
              </button>
              {p.id !== '__implicit' && !VIEWER && (
                <span className="pages-row-actions">
                  <button
                    type="button"
                    title="Rename page"
                    data-testid="pages-rename"
                    onClick={() => void rename(p.id, p.name)}
                  >
                    <RenameIcon size={13} />
                  </button>
                  <button
                    type="button"
                    title="Duplicate page"
                    data-testid="pages-duplicate"
                    onClick={() => duplicatePage(p.id)}
                  >
                    <DuplicateIcon size={13} />
                  </button>
                  {doc.pages.length > 1 && (
                    <button
                      type="button"
                      className="danger"
                      title="Delete page"
                      data-testid="pages-delete"
                      onClick={() => void remove(p.id, p.name)}
                    >
                      <TrashIcon size={13} />
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {!VIEWER && (
        <button
          type="button"
          className="pages-add"
          data-testid="pages-add"
          onClick={() => addPage()}
        >
          <PlusIcon size={14} /> Add page
        </button>
      )}
    </div>
  );
}
