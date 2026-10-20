import { useEffect, useState } from 'react';
import { LockIcon } from '../icons';
import type { BoardSummary } from '../../lib/board/boardLibrary';
import { listBoards, revokeSummaries } from '../../lib/board/boardLibrary';
import { selectionGroupState } from '../../lib/canvas/grouping';
import { sendItemsToBoard } from '../../lib/sync/sendToBoard';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { UiDialog } from '../ui/Dialog';

/**
 * The context-menu "Move / Copy to Board" picker. Sends the selection to
 * another board's stored document directly — the destination never opens.
 */
export function SendToBoardDialog() {
  const req = useSessionStore((s) => s.sendToBoard);
  return req && req.ids.length ? <Body key={req.mode + req.ids.join()} req={req} /> : null;
}

function Body({ req }: { req: { ids: string[]; mode: 'move' | 'copy' } }) {
  const close = () => useSessionStore.getState().setSendToBoard(null);
  const doc = useDocumentStore((s) => s.doc);
  const currentId = doc.id;
  const group = selectionGroupState(doc, req.ids);
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live: BoardSummary[] = [];
    let cancelled = false;
    void listBoards().then((all) => {
      if (cancelled) {
        revokeSummaries(all);
        return;
      }
      live = all;
      // Locked boards ARE listed: items queue in their Inbox and land when
      // the board is next opened with its password.
      setBoards(all.filter((b) => b.id !== currentId && !(b.locked && b.remote)));
    });
    return () => {
      cancelled = true;
      revokeSummaries(live);
    };
  }, [currentId]);

  const send = async (destId: string) => {
    setBusy(destId);
    setError(null);
    const res = await sendItemsToBoard(req.ids, destId, req.mode);
    setBusy(null);
    if (res.ok) {
      if (res.queued) {
        const { showNotice } = await import('../../lib/notices');
        showNotice(
          `${req.ids.length === 1 ? '1 item' : `${req.ids.length} items`} queued in that board’s Inbox — delivered when it’s next unlocked.`,
          { id: 'inbox-queued', kind: 'info' },
        );
      }
      close();
    } else setError(res.error ?? 'Couldn’t send the items.');
  };

  const verb = req.mode === 'move' ? 'Move' : 'Copy';
  const what = group.groupId
    ? group.groupName
      ? `the group “${group.groupName}”`
      : `a group of ${req.ids.length} items`
    : req.ids.length === 1
      ? '1 item'
      : `${req.ids.length} items`;

  return (
    <UiDialog
      title={`${verb} ${what} to`}
      onClose={close}
      className="sendto-sheet"
      testId="sendto-dialog"
    >
      <div className="sendto-body">
        {boards === null ? (
          <p className="sendto-note">Loading boards</p>
        ) : boards.length === 0 ? (
          <p className="sendto-note">No other boards to send to yet.</p>
        ) : (
          <div className="sendto-list">
            {boards.map((b) => (
              <button
                type="button"
                key={b.id}
                className="sendto-row"
                disabled={busy !== null}
                data-testid="sendto-board"
                onClick={() => void send(b.id)}
              >
                {b.thumbnailLightUrl || b.thumbnailUrl ? (
                  <img src={b.thumbnailLightUrl ?? b.thumbnailUrl ?? ''} alt="" />
                ) : (
                  <span className="sendto-thumb-empty" />
                )}
                <span className="sendto-name">{b.name}</span>
                {b.locked && (
                  <span className="sendto-tag">
                    <LockIcon size={11} /> via Inbox
                  </span>
                )}
                {b.remote && !b.locked && <span className="sendto-tag">will download</span>}
                {busy === b.id && (
                  <span className="sendto-tag">{verb === 'Move' ? 'Moving' : 'Copying'}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {error && <p className="sendto-error">{error}</p>}
      </div>
    </UiDialog>
  );
}
