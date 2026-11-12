import { useEffect, useState } from 'react';
import { LockIcon } from '../icons';
import type { BoardSummary } from '../../lib/board/boardLibrary';
import { listBoards, revokeSummaries } from '../../lib/board/boardLibrary';
import { createBoardLinkItem } from '../../lib/import/createItems';
import { useVaultStore } from '../../lib/vault/vaultStore';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { UiDialog } from '../ui/Dialog';

/**
 * The board picker behind "Add Board Link" and a link button's "Change
 * Board": every board of the library and of the Files folder but the open
 * one. Picking makes a new button at the point asked for, or repoints the
 * button named; its label takes the board's name.
 */
export function BoardLinkDialog() {
  const req = useSessionStore((s) => s.boardLinkPicker);
  return req ? <Body key={'itemId' in req ? req.itemId : 'new'} req={req} /> : null;
}

type Choice = { id: string; name: string; locked: boolean; thumb: string | null };

function Body({ req }: { req: { at: { x: number; y: number } } | { itemId: string } }) {
  const close = () => useSessionStore.getState().setBoardLinkPicker(null);
  const currentId = useDocumentStore((s) => s.doc.id);
  const vaultBoards = useVaultStore((s) => s.boards);
  const [boards, setBoards] = useState<Choice[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live: BoardSummary[] = [];
    let cancelled = false;
    void listBoards().then((all) => {
      if (cancelled) {
        revokeSummaries(all);
        return;
      }
      live = all;
      setBoards(
        all.map((b) => ({
          id: b.id,
          name: b.name,
          locked: b.locked,
          thumb: b.thumbnailLightUrl ?? b.thumbnailUrl ?? null,
        })),
      );
    });
    return () => {
      cancelled = true;
      revokeSummaries(live);
    };
  }, []);

  const needle = query.trim().toLowerCase();
  const all = [
    ...(boards ?? []),
    ...vaultBoards
      .filter((v) => !boards?.some((b) => b.id === v.id))
      .map((v) => ({ id: v.id, name: v.name, locked: v.locked, thumb: null })),
  ]
    .filter((b) => b.id !== currentId)
    .filter((b) => !needle || b.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));

  const pick = (b: Choice) => {
    if ('itemId' in req) {
      updateItems([req.itemId], 'Link to board', (d) => {
        if (d.type !== 'link') return;
        d.boardId = b.id;
        d.url = '';
        d.label = b.name;
      });
    } else createBoardLinkItem(req.at, b.id, b.name);
    close();
  };

  return (
    <UiDialog
      title={'itemId' in req ? 'Link to another board' : 'Add a board link'}
      onClose={close}
      className="sendto-sheet"
      testId="board-link-dialog"
    >
      <div className="sendto-body">
        <input
          className="tag-input pick-search"
          placeholder="Search boards"
          value={query}
          autoFocus
          data-testid="board-link-search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {boards === null ? (
          <p className="sendto-note">Loading boards</p>
        ) : all.length === 0 ? (
          <p className="sendto-note">
            {needle ? 'No board by that name.' : 'No other boards in the library yet.'}
          </p>
        ) : (
          <div className="sendto-list">
            {all.map((b) => (
              <button
                type="button"
                key={b.id}
                className="sendto-row"
                data-testid="board-link-board"
                onClick={() => pick(b)}
              >
                {b.thumb ? <img src={b.thumb} alt="" /> : <span className="sendto-thumb-empty" />}
                <span className="sendto-name">{b.name}</span>
                {b.locked && (
                  <span className="sendto-tag">
                    <LockIcon size={11} /> locked
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </UiDialog>
  );
}
