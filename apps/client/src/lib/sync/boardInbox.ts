import type { CanvasDocument, Connection, Group, Item } from '@boardcache/schema';
import { collectAssetIds, newId } from '@boardcache/schema';
import { getAssetBlob } from '../board/assetStore';
import { getSessionLock } from '../board/boardLock';
import { cloneTransfer, landingOffset, type TransferSet } from '../board/transferSet';
import { getDb } from '../db';
import { unionRects } from '../canvas/geometry';
import { showNotice } from '../notices';
import { runCommand, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Board Inbox: a plaintext holding queue for items sent TO a locked board.
 * A locked board's record is ciphertext, so nothing can be written into it
 * directly — queued bundles wait in the device's `meta` store and are
 * delivered (as one undoable command) the moment the board is opened with
 * its password. Assets are content-addressed and device-wide, so bundles
 * only carry items; on delivery the board's own save re-encrypts everything
 * under its lock as usual.
 */

interface InboxBundle {
  id: string;
  fromBoard: string;
  queuedAt: string;
  items: Item[];
  /** Whole groups and inside connections sent along (absent in older bundles). */
  groups?: Group[];
  connections?: Connection[];
}

const key = (boardId: string) => `inbox:${boardId}`;

async function readQueue(boardId: string): Promise<InboxBundle[]> {
  const db = await getDb();
  const raw = (await db.get('meta', key(boardId))) as { bundles?: InboxBundle[] } | undefined;
  return raw?.bundles ?? [];
}

/** Queue items for a locked board. Items sent OUT of a locked source have
 *  their assets materialized as plaintext first (explicit export, same rule
 *  as a direct send). */
export async function queueItemsForBoard(
  destId: string,
  set: TransferSet,
  fromBoard: string,
): Promise<void> {
  const { doc } = useDocumentStore.getState();
  const { items } = set;
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
        const blob = await getAssetBlob(hash);
        if (blob) {
          await db.put('assets', { hash, blob, mime: blob.type || rec.mime, bytes: blob.size });
        }
      }
    }
  }
  const db = await getDb();
  const bundles = await readQueue(destId);
  bundles.push({
    id: newId(),
    fromBoard,
    queuedAt: new Date().toISOString(),
    items,
    groups: set.groups,
    connections: set.connections,
  });
  await db.put('meta', { bundles }, key(destId));
}

/** Deliver a board's queued inbox into the OPEN document (call right after a
 *  locked board unlocks). One undoable command; the queue clears. */
export async function deliverInbox(boardId: string): Promise<number> {
  const bundles = await readQueue(boardId);
  const queued = bundles.flatMap((b) => b.items);
  if (queued.length === 0) return 0;
  const doc = useDocumentStore.getState().doc;
  if (doc.id !== boardId) return 0; // board changed under us — keep the queue

  // Land right of the existing content, keeping each bundle's layout.
  const offset = landingOffset(unionRects(Object.values(doc.items)), unionRects(queued));
  let z = topZIndex(doc) + 1;
  const now = new Date().toISOString();
  runCommand('Deliver Inbox', (draft) => {
    for (const bundle of bundles) {
      const clones = cloneTransfer(
        { items: bundle.items, groups: bundle.groups ?? [], connections: bundle.connections ?? [] },
        { ...offset, z },
      );
      z += clones.items.length;
      for (const item of clones.items) {
        draft.items[item.id] = { ...item, createdAt: item.createdAt ?? now };
      }
      for (const group of clones.groups) draft.groups[group.id] = group;
      for (const c of clones.connections) draft.connections[c.id] = c;
    }
  });
  const db = await getDb();
  await db.delete('meta', key(boardId));
  showNotice(
    `${queued.length} item${queued.length === 1 ? '' : 's'} from this board’s Inbox ${queued.length === 1 ? 'was' : 'were'} delivered.`,
    { id: 'inbox-delivered', kind: 'info' },
  );
  return queued.length;
}
