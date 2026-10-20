import { getDb } from './db';

/**
 * Client-side knowledge of the sync boundaries, for user-facing awareness
 * BEFORE something fails mid-push. Matches the server defaults
 * (config.maxAssetBytes / nginx client_max_body_size — both 512MB).
 */

const DEFAULT_SYNC_ASSET_LIMIT = 512 * 1024 * 1024;

/** Largest single file that can sync. Test-overridable via localStorage. */
export function syncAssetLimitBytes(): number {
  try {
    const raw = localStorage.getItem('boardcache:testAssetLimit');
    if (raw) return Number(raw);
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_SYNC_ASSET_LIMIT;
}

export function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Of the given asset hashes, the ones too large to ever upload. */
export async function oversizeAssets(hashes: string[]): Promise<{ hash: string; bytes: number }[]> {
  const db = await getDb();
  const limit = syncAssetLimitBytes();
  const out: { hash: string; bytes: number }[] = [];
  for (const hash of [...new Set(hashes)]) {
    const record = await db.get('assets', hash).catch(() => undefined);
    const size = (record as { blob?: Blob } | undefined)?.blob?.size ?? 0;
    if (size > limit) out.push({ hash, bytes: size });
  }
  return out;
}
