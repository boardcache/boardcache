import type { CanvasDocument } from '@boardcache/schema';
import { collectAssetIds } from '@boardcache/schema';
import { assetTotalBytes } from './assetStore';

/**
 * Estimated on-disk size of a board: the document JSON plus the bytes of every
 * asset it references (images, video, PDFs). Matches what an export would
 * weigh; assets dominate, so the document term is usually negligible.
 */
export async function estimateBoardBytes(doc: CanvasDocument): Promise<number> {
  const docBytes = new TextEncoder().encode(JSON.stringify(doc)).byteLength;
  return docBytes + (await assetTotalBytes(collectAssetIds(doc)));
}

/** Human-readable byte count, e.g. 15_700_000 → "15 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${units[unit]}`;
}
