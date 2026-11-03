import {
  getAssetBlob,
  repairSharedLockedAssets,
  retryLockedAssets,
} from '../../lib/board/assetStore';
import { flushAssetReplacements } from '../../lib/sync/assetSync';
import { borrowSessionLock, unlockForSession } from '../../lib/board/boardLock';
import { useSessionStore } from '../../state/sessionStore';
import { BoardLockDialog } from './BoardLockDialog';

/**
 * Media on the open board that is encrypted with ANOTHER board's password
 * (a picture shared with a locked board): the Unlock button on its box asks
 * for that password here. The key is borrowed for this board only — it goes
 * when the board closes — and every box held back by that lock looks again.
 */
export function AssetUnlockDialog() {
  const req = useSessionStore((s) => s.assetUnlock);
  if (!req) return null;
  const close = () => useSessionStore.getState().setAssetUnlock(null);
  return (
    <BoardLockDialog
      mode="media"
      boardName={req.name}
      onClose={close}
      onSubmit={async (password) => {
        if (!(await unlockForSession(req.boardId, password))) return 'Wrong password.';
        borrowSessionLock(req.boardId);
        // What this board shows is by definition shared with that lock's
        // board: stored plain from now on, here and on the server.
        const repaired = await repairSharedLockedAssets(req.boardId);
        retryLockedAssets(req.boardId);
        if (repaired.length > 0) void flushAssetReplacements().catch(() => undefined);
        // The right password, yet this record stays shut: it was sealed under
        // an earlier lock of that board whose key was not kept. Say so rather
        // than close as if it had opened.
        if (!(await getAssetBlob(req.assetId))) {
          return 'The password is right, but this media was sealed under an earlier lock of that board and no longer opens. A device that still shows it can re-upload the board’s media.';
        }
        return null;
      }}
    />
  );
}
