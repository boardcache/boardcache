import type { CanvasDocument } from '@boardcache/schema';
import { collectAssetIds } from '@boardcache/schema';
import { getDb } from '../db';
import { loadBoardRecord, saveBoardRecord } from '../board/boardLibrary';
import { adoptAssets } from '../board/assetStore';
import { cloneTransfer, collectTransfer, landingOffset } from '../board/transferSet';
import { markBoardDirty } from './boardSync';
import { syncedBoardIds } from './syncMetaStore';
import { removeItems, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { unionRects } from '../canvas/geometry';

/**
 * Send selected items to another board WITHOUT opening it: the destination's
 * document is edited directly in storage, and it gets its own copies of the
 * media the items show. Whole groups travel as groups, with the connections
 * between sent things. 'move' also removes the items from the open board
 * (one undoable command — undo restores them here but does not reach into
 * the destination).
 */
export async function sendItemsToBoard(
  itemIds: string[],
  destId: string,
  mode: 'move' | 'copy',
): Promise<{ ok: boolean; error?: string; queued?: boolean }> {
  const { doc } = useDocumentStore.getState();
  if (destId === doc.id) return { ok: false, error: 'That’s the current board.' };
  const set = collectTransfer(doc, itemIds);
  const { items } = set;
  if (!items.length) return { ok: false, error: 'Nothing to send.' };

  // Destination must be a local, unlocked document. A lazy-sync stub is
  // downloaded on the fly first; a board kept in the Files folder comes into
  // the working stores first (and leaves them again below).
  const vault = await import('../vault/vaultBoards');
  const inFiles = await vault.materializeVaultBoard(destId);
  let dest = await loadBoardRecord(destId);
  if (!dest) {
    const db = await getDb();
    const rec = await db.get('boards', destId);
    if (rec?.lock) {
      // A LOCKED destination is ciphertext — nothing can be written into it.
      // The items queue in the board's Inbox instead and are delivered the
      // next time it's opened with its password.
      const { queueItemsForBoard } = await import('./boardInbox');
      await queueItemsForBoard(destId, set, doc.name);
      if (inFiles) await vault.evictVaultBoard(destId);
      if (mode === 'move') removeItems(itemIds, 'Move to Inbox');
      return { ok: true, queued: true };
    }
    if (rec && rec.remote === true && !rec.lock) {
      const { downloadBoard } = await import('./boardSync');
      if (await downloadBoard(destId)) dest = await loadBoardRecord(destId);
    }
  }
  if (!dest) {
    if (inFiles) await vault.evictVaultBoard(destId);
    return { ok: false, error: 'That board can’t receive items (unavailable).' };
  }

  // The destination keeps its own copies of what the items show. Sending out
  // of a locked board is an explicit export out of its lock: the copies open
  // with this session's key and are stored as the destination keeps media.
  const pseudo = {
    ...doc,
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    groups: Object.fromEntries(set.groups.map((g) => [g.id, g])),
  };
  await adoptAssets(destId, collectAssetIds(pseudo as CanvasDocument), doc.id);

  // Land in a clear spot: just right of the destination's existing content,
  // keeping the cluster's relative layout.
  const clones = cloneTransfer(set, {
    ...landingOffset(unionRects(Object.values(dest.items)), unionRects(items)),
    z: topZIndex(dest) + 1,
  });
  for (const item of clones.items) dest.items[item.id] = item;
  for (const group of clones.groups) dest.groups[group.id] = group;
  for (const c of clones.connections) dest.connections[c.id] = c;
  dest.updatedAt = new Date().toISOString();
  await saveBoardRecord(dest, true);
  // A Files board is written to its folder (document, media, previews); the
  // working copy then goes, as it does after any other change made unopened.
  if (inFiles) await vault.evictVaultBoard(destId);
  else if ((await syncedBoardIds()).has(destId)) await markBoardDirty(destId);

  if (mode === 'move') removeItems(itemIds, 'Move to board');
  return { ok: true };
}
