import { collectAssetIds } from '@boardcache/schema';
import { getAssetBlob, hasAsset, setDefaultAssetMissHandler } from '../board/assetStore';
import { pullAsset, pullAssets } from './assetSync';
import { collabActive } from '../../state/collabStore';
import { getSyncMeta } from './syncMetaStore';
import { useDocumentStore } from '../../state/documentStore';
import { useSyncStore } from '../../state/syncStore';

/**
 * Missing-asset recovery for private synced boards.
 *
 * A board document travels separately from its media, and a download can be
 * cut short (tab closed, connection dropped, storage full) leaving items
 * whose bytes never arrived. Team rooms already fetch on demand; this gives
 * signed-in sync users the same two safety nets:
 *
 *  1. On-demand: a renderer that finds no local bytes asks the sync server
 *     for them right then (the default asset-miss handler).
 *  2. On open: a synced board is checked for assets it should have, and any
 *     that are absent are pulled in the background with a sync-bar note.
 */

let installed = false;
const reconciling = new Set<string>();

export function installAssetRecovery(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const apply = (signedIn: boolean) => {
    setDefaultAssetMissHandler(
      signedIn
        ? async (assetId) => {
            try {
              return (await pullAsset(assetId)) ? ((await getAssetBlob(assetId)) ?? null) : null;
            } catch {
              return null;
            }
          }
        : null,
    );
  };
  apply(useSyncStore.getState().status === 'signedIn');
  useSyncStore.subscribe((s, prev) => {
    if (s.status !== prev.status) {
      apply(s.status === 'signedIn');
      if (s.status === 'signedIn') void reconcileOpenBoard();
    }
  });
  useDocumentStore.subscribe(
    (s) => s.doc.id,
    () => void reconcileOpenBoard(),
  );
  void reconcileOpenBoard();
}

/** Pull whatever the open synced board references but this device lacks. */
async function reconcileOpenBoard(): Promise<number> {
  const { doc } = useDocumentStore.getState();
  const id = doc.id;
  if (useSyncStore.getState().status !== 'signedIn' || collabActive() || reconciling.has(id))
    return 0;
  if (!(await getSyncMeta(id))) return 0; // a local-only board has nowhere to pull from
  const ids = [...new Set(collectAssetIds(doc))];
  const missing: string[] = [];
  for (const assetId of ids) if (!(await hasAsset(assetId))) missing.push(assetId);
  if (missing.length === 0 || useDocumentStore.getState().doc.id !== id) return 0;
  reconciling.add(id);
  const note = (fraction: number) =>
    useSyncStore.setState({
      detail: `Downloading ${missing.length} ${missing.length === 1 ? 'file' : 'files'}… ${Math.round(fraction * 100)}%`,
    });
  try {
    note(0);
    return await pullAssets(missing, note);
  } catch {
    return 0;
  } finally {
    reconciling.delete(id);
    useSyncStore.setState({ detail: null });
  }
}
