import { getDb } from '../db';

/**
 * Media whose copy on the sync server must be written again, in the form
 * this device now holds: a board lock's layer was added to it (the board was
 * locked) or taken off (it was unlocked). The server keeps one object per
 * board and hash and never overwrites it on its own, so the next push names
 * these explicitly. Persisted, so a replacement queued offline goes out on
 * the next sync. Entries are `board/hash`.
 */
const KEY = 'assetReplace';

export const replacementKey = (board: string, hash: string): string => `${board}/${hash}`;

export async function queuedReplacements(): Promise<Set<string>> {
  const db = await getDb();
  const stored = await db.get('meta', KEY);
  // Entries from before media was kept per board name a hash alone; those
  // boards push their media again when they next change.
  return new Set(Array.isArray(stored) ? (stored as string[]).filter((k) => k.includes('/')) : []);
}

export async function queueReplacement(board: string, hashes: Iterable<string>): Promise<void> {
  const set = await queuedReplacements();
  const before = set.size;
  for (const h of hashes) set.add(replacementKey(board, h));
  if (set.size !== before) await (await getDb()).put('meta', [...set], KEY);
}

export async function clearReplacement(board: string, hash: string): Promise<void> {
  const set = await queuedReplacements();
  if (set.delete(replacementKey(board, hash))) await (await getDb()).put('meta', [...set], KEY);
}
