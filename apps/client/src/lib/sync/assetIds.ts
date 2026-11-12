import { collectAssetIds, type CanvasDocument } from '@boardcache/schema';
import { serverAssetId } from '@boardcache/e2ee';
import { apiFetch } from './apiBase';
import { allSyncMeta } from './syncMetaStore';
import { getDb } from '../db';
import { requireAssetIdKey, useSyncStore } from '../../state/syncStore';

/**
 * Asset names on the server. An asset is named by the HMAC of its board id
 * and plaintext hash under the account's asset-id key (packages/e2ee
 * serverAssetId), so the server cannot test a guessed file against a name
 * or match one account's file with another's, and one board's media is
 * never another's. Older accounts are relabelled forward once by the first
 * signed-in client, in up to two steps:
 *
 *  'hash'    → 'hmac-v1'  every name the account holds, from the plaintext
 *                         hash to the private per-account name;
 *  'hmac-v1' → 'hmac-v2'  every synced board this device holds, from the
 *                         per-account name to the board's own name (a file
 *                         on two boards is moved for one and uploaded again
 *                         for the other by its next push; a board not
 *                         downloaded here keeps its old names, which a pull
 *                         still finds and moves on the way).
 *
 * Until the account is marked current, sync waits.
 */

const BATCH = 400;
let running: Promise<boolean> | null = null;
let outdated = false;

/** True once this account's assets carry current names (relabelling now if needed). */
export function relabelAssetsIfNeeded(): Promise<boolean> {
  const s = useSyncStore.getState();
  if (s.status !== 'signedIn' || !s.assetIdKey) return Promise.resolve(false);
  if (s.assetIds === 'hmac-v2') return Promise.resolve(true);
  if (outdated) return Promise.resolve(false);
  running ??= relabel().finally(() => {
    running = null;
  });
  return running;
}

/**
 * The server answered that the account's names are newer than this build
 * knows (409 client-outdated): sync waits for an update rather than asking
 * again every pass. Cleared by a reload, which is what an update is.
 */
export const clientOutdated = (): boolean => outdated;

interface Pair {
  from: string;
  to: string;
  board?: string;
}

async function send(pairs: Pair[], done: 'hmac-v1' | 'hmac-v2'): Promise<boolean> {
  // Batches, the last one marking the account done; an account with no
  // assets is marked in one empty call.
  const batches = pairs.length ? Math.ceil(pairs.length / BATCH) : 1;
  for (let i = 0; i < batches; i++) {
    const res = await apiFetch('/api/assets/relabel', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pairs: pairs.slice(i * BATCH, (i + 1) * BATCH),
        ...(i === batches - 1 ? { done } : {}),
      }),
    });
    if (res.status === 409) outdated = true;
    if (!res.ok) return false;
  }
  useSyncStore.setState({ assetIds: done });
  return true;
}

async function relabel(): Promise<boolean> {
  try {
    const key = requireAssetIdKey();
    if (useSyncStore.getState().assetIds === 'hash') {
      const listed = await apiFetch('/api/assets', { credentials: 'include' });
      if (!listed.ok) return false;
      const { ids } = (await listed.json()) as { ids: string[] };
      const pairs: Pair[] = [];
      for (const from of ids) {
        const to = await serverAssetId(key, from);
        if (to !== from) pairs.push({ from, to });
      }
      if (!(await send(pairs, 'hmac-v1'))) return false;
    }
    // Per-account names → per-board names, for every synced board here.
    const db = await getDb();
    const pairs: Pair[] = [];
    for (const meta of await allSyncMeta()) {
      if (meta.deleted) continue;
      const record = await db.get('boards', meta.id);
      if (!record || record.remote) continue;
      let hashes: string[] = [];
      if (record.doc) {
        try {
          hashes = collectAssetIds(record.doc as CanvasDocument);
        } catch {
          hashes = [];
        }
      } else hashes = record.lock?.assets ?? [];
      for (const hash of new Set(hashes)) {
        pairs.push({
          from: await serverAssetId(key, hash),
          to: await serverAssetId(key, hash, meta.id),
          board: meta.id,
        });
      }
    }
    return await send(pairs, 'hmac-v2');
  } catch {
    return false; // offline: the next sync pass tries again
  }
}
