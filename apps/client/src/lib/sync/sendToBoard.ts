import type { CanvasDocument } from '@boardcache/schema';
import { collectAssetIds } from '@boardcache/schema';
import { getDb } from '../db';
import { loadBoardRecord, saveBoardRecord } from '../board/boardLibrary';
import { getSessionLock } from '../board/boardLock';
import { getAssetBlob } from '../board/assetStore';
import { cloneTransfer, collectTransfer, landingOffset } from '../board/transferSet';
import { markBoardDirty } from './boardSync';
import { syncedBoardIds } from './syncMetaStore';
import { removeItems, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { unionRects } from '../canvas/geometry';

/**
 * Send selected items to another board WITHOUT opening it: the destination's
 * document is edited directly in storage (assets are content-addressed and
 * device-wide, so clones just reference the same blobs). Whole groups travel
 * as groups, with the connections between sent things. 'move' also removes
 * the items from the open board (one undoable command — undo restores them
 * here but does not reach into the destination).
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
  // downloaded on the fly first.
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
      if (mode === 'move') removeItems(itemIds, 'Move to Inbox');
      return { ok: true, queued: true };
    }
    if (rec && rec.remote === true && !rec.lock) {
      const { downloadBoard } = await import('./boardSync');
      if (await downloadBoard(destId)) dest = await loadBoardRecord(destId);
    }
  }
  if (!dest) {
    return { ok: false, error: 'That board can’t receive items (unavailable).' };
  }

  // If the open board is password-locked its assets sit encrypted at rest.
  // Sending an item to a plain board is an explicit export out of the lock —
  // materialize plaintext records (same content hash) so the destination
  // can read them.
  if (getSessionLock(doc.id)) {
    const db = await getDb();
    const pseudo = {
      ...doc,
      items: Object.fromEntries(items.map((i) => [i.id, i])),
      groups: Object.fromEntries(set.groups.map((g) => [g.id, g])),
    };
    for (const hash of new Set(collectAssetIds(pseudo as CanvasDocument))) {
      const rec = await db.get('assets', hash);
      if (rec?.lock) {
        const blob = await getAssetBlob(hash); // decrypts with the session key
        if (blob) {
          await db.put('assets', {
            hash,
            blob,
            mime: blob.type || rec.mime,
            bytes: blob.size,
          });
        }
      }
    }
  }

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
  if ((await syncedBoardIds()).has(destId)) await markBoardDirty(destId);

  if (mode === 'move') removeItems(itemIds, 'Move to board');
  return { ok: true };
}
