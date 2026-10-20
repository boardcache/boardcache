import { getDb } from '../db';

/** Per-board sync state (see the `sync` store in db.ts). */
export interface BoardSyncMeta {
  id: string;
  rev: number;
  dirty: boolean;
  deleted?: boolean;
}

export async function getSyncMeta(id: string): Promise<BoardSyncMeta | undefined> {
  return (await getDb()).get('sync', id);
}

export async function allSyncMeta(): Promise<BoardSyncMeta[]> {
  return (await getDb()).getAll('sync');
}

export async function setSyncMeta(meta: BoardSyncMeta): Promise<void> {
  await (await getDb()).put('sync', meta);
}

export async function deleteSyncMeta(id: string): Promise<void> {
  await (await getDb()).delete('sync', id);
}

/** Ids of boards opted into sync (excluding pending local tombstones). */
export async function syncedBoardIds(): Promise<Set<string>> {
  const metas = await allSyncMeta();
  return new Set(metas.filter((m) => !m.deleted).map((m) => m.id));
}

const ACCOUNT_KEY = 'syncAccount';

/**
 * Bind local sync state to the signed-in account. Local revs and tombstones
 * only mean anything relative to the account that produced them, so signing
 * into a DIFFERENT account resets every opted-in board to "new + dirty" —
 * they re-upload fresh under the new account instead of pushing stale revs
 * against foreign rows (endless 409s / undecryptable pulls).
 */
export async function ensureSyncAccount(accountId: string): Promise<void> {
  const db = await getDb();
  const prev = (await db.get('meta', ACCOUNT_KEY)) as string | undefined;
  if (prev === accountId) return;
  if (prev !== undefined) {
    for (const m of await db.getAll('sync')) {
      if (m.deleted) await db.delete('sync', m.id);
      else await db.put('sync', { id: m.id, rev: 0, dirty: true });
    }
  }
  await db.put('meta', accountId, ACCOUNT_KEY);
}
