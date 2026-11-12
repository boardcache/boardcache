import type { IDBPDatabase } from 'idb';
import type { CanvasDocument } from '@boardcache/schema';
import { collectAssetIds } from '@boardcache/schema';
import type { BoardcacheDB } from '../db';

/**
 * One-time move of media from the shared, hash-keyed store (`assets`, one
 * record per file for the whole library) to the per-board store (`media`,
 * one record per board and file). Every board gets its own copy of what it
 * references: a plain record as it is; a record sealed under the board's own
 * lock as it is; a record sealed under ANOTHER board's lock is skipped — the
 * board could not read it before either, and a synced board fetches the
 * server's copy on demand. Records nothing references are dropped with the
 * old store, which is what frees the media of boards deleted long ago.
 *
 * Runs on open, before the first read, with the `meta` flag below marking it
 * done; an interrupted pass simply runs again (every write is idempotent).
 */

const FLAG = 'mediaPerBoard';

/** A board's media hashes: from its document, or a locked record's list. */
function referenced(record: BoardcacheDB['boards']['value']): string[] {
  if (record.doc) {
    try {
      return [...new Set(collectAssetIds(record.doc as CanvasDocument))];
    } catch {
      return [];
    }
  }
  return [...new Set(record.lock?.assets ?? [])];
}

export async function migrateMediaPerBoard(db: IDBPDatabase<BoardcacheDB>): Promise<void> {
  if ((await db.get('meta', FLAG)) === 1) return;
  const old = await db.count('assets');
  if (old === 0) {
    await db.put('meta', 1, FLAG);
    return;
  }
  let copied = 0;
  const boards = await db.getAll('boards');
  for (const board of boards) {
    const hashes = referenced(board);
    if (hashes.length === 0) continue;
    // A locked board from before locks listed their media: its sealed
    // records are the ones marked with its id.
    const marked =
      board.lock && !board.lock.assets
        ? (await db.getAll('assets')).filter((a) => a.lock?.boardId === board.id).map((a) => a.hash)
        : [];
    for (const hash of new Set([...hashes, ...marked])) {
      if ((await db.getKey('media', [board.id, hash])) !== undefined) continue;
      const record = await db.get('assets', hash);
      if (!record) continue;
      if (record.lock && record.lock.boardId !== board.id) continue;
      await db.put('media', {
        board: board.id,
        hash,
        blob: record.blob,
        mime: record.mime,
        bytes: record.bytes,
        ...(record.lock ? { locked: true } : {}),
      });
      copied++;
    }
  }
  await db.clear('assets');
  await db.put('meta', 1, FLAG);
  console.info(
    `boardCache: media is now kept per board (${copied} records for ${boards.length} boards; ${old} shared records retired).`,
  );
}
