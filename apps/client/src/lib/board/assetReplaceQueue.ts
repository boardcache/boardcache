import { getDb } from '../db';

/**
 * Assets whose copy on the sync server must be written again, in the form
 * this device now holds: a board lock's layer was added to them (the board
 * was locked) or taken off (it was unlocked, or the asset turned out to be
 * shared with an open board). The server keeps one object per id and never
 * overwrites it on its own, so the next push names these explicitly.
 * Persisted, so a replacement queued offline goes out on the next sync.
 */
const KEY = 'assetReplace';

export async function queuedReplacements(): Promise<Set<string>> {
  const db = await getDb();
  const stored = await db.get('meta', KEY);
  return new Set(Array.isArray(stored) ? (stored as string[]) : []);
}

export async function queueReplacement(hashes: Iterable<string>): Promise<void> {
  const set = await queuedReplacements();
  const before = set.size;
  for (const h of hashes) set.add(h);
  if (set.size !== before) await (await getDb()).put('meta', [...set], KEY);
}

export async function clearReplacement(hash: string): Promise<void> {
  const set = await queuedReplacements();
  if (set.delete(hash)) await (await getDb()).put('meta', [...set], KEY);
}
