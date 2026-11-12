import type { LinkItem } from '@boardcache/schema';
import { VIEWER } from '../viewerMode';
import { openUrl } from '../text/itemUrl';
import { showNotice } from '../notices';
import { isNativeShell } from '../mobile';

/**
 * A link button pointing at another board opens it in a window of its own:
 * a tab in the browser, another application window in the desktop app
 * (the shell lets same-origin windows open). Both windows save to the same
 * library; the later save wins. A viewer build (shares, the community,
 * the offline viewer) has no library, so the button is inert there.
 */
function openBoardLink(boardId: string): void {
  if (VIEWER) return;
  void (async () => {
    const { listBoards, revokeSummaries } = await import('./boardLibrary');
    const boards = await listBoards();
    const found = boards.some((b) => b.id === boardId);
    revokeSummaries(boards);
    const inVault = (await import('../vault/vaultStore')).useVaultStore
      .getState()
      .boards.some((b) => b.id === boardId);
    if (!found && !inVault) {
      showNotice('That board is no longer in the library.', { id: 'board-link', kind: 'info' });
      return;
    }
    // A phone's shell opens no windows: it goes there in this one.
    if (isNativeShell()) (await import('../router')).openPath(`/b/${boardId}`);
    else window.open(`${location.origin}/b/${boardId}`, '_blank', 'noopener');
  })();
}

/** Open what a link button points at: its board, else its address. */
export function openItemLink(item: LinkItem): void {
  if (item.boardId) openBoardLink(item.boardId);
  else openUrl(item.url);
}
