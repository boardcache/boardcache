import { serverAssetId } from '@boardcache/e2ee';
import { apiFetch } from './apiBase';
import { requireAssetIdKey, useSyncStore } from '../../state/syncStore';

/**
 * Asset names on the server. An asset is named by the HMAC of its plaintext
 * hash under the account's asset-id key (packages/e2ee serverAssetId), so the
 * server cannot test a guessed file against a name or match one account's
 * file with another's. Accounts from before this scheme named assets by the
 * plaintext hash itself; the first signed-in client renames them all once
 * (POST /api/assets/relabel), then the account is marked and names new
 * assets the private way. Until that has happened, sync waits.
 */

const BATCH = 400;
let running: Promise<boolean> | null = null;

/** True once this account's assets carry private names (relabelling now if needed). */
export function relabelAssetsIfNeeded(): Promise<boolean> {
  const s = useSyncStore.getState();
  if (s.status !== 'signedIn' || !s.assetIdKey) return Promise.resolve(false);
  if (s.assetIds === 'hmac-v1') return Promise.resolve(true);
  running ??= relabel().finally(() => {
    running = null;
  });
  return running;
}

async function relabel(): Promise<boolean> {
  try {
    const listed = await apiFetch('/api/assets', { credentials: 'include' });
    if (!listed.ok) return false;
    const { ids } = (await listed.json()) as { ids: string[] };
    const key = requireAssetIdKey();
    const pairs: { from: string; to: string }[] = [];
    for (const from of ids) {
      const to = await serverAssetId(key, from);
      if (to !== from) pairs.push({ from, to });
    }
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
          done: i === batches - 1,
        }),
      });
      if (!res.ok) return false;
    }
    useSyncStore.setState({ assetIds: 'hmac-v1' });
    return true;
  } catch {
    return false; // offline: the next sync pass tries again
  }
}
