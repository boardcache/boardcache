import { getAssetBlob } from '../board/assetStore';
import { getSessionLock } from '../board/boardLock';
import { getDb } from '../db';
import { mediaMeta } from '../mediaItems';
import { clipEnabled, clipImageVectors, clipModelState, clipTextVectors } from './semanticIndex';
import { useDocumentStore } from '../../state/documentStore';

/**
 * CLIP image index: every image item gets a joint-space vector computed from
 * its pixels (display rendition when present), so text queries find images
 * with no OCR, description, or name — "the red truck at night" just works.
 * Fully local; vectors cache in IDB keyed by item id (in-memory only on
 * locked boards), versioned by asset id + model. Never synced.
 */

const CLIP_MODEL_VERSION = 'clip-vit-b32/q8/1';
const MOCK_VERSION = 'clip-mock/1';
const BATCH = 4;

const mockMode = (): boolean => {
  try {
    return localStorage.getItem('boardcache:semanticMock') === 'on';
  } catch {
    return false;
  }
};
const modelVersion = (): string => (mockMode() ? MOCK_VERSION : CLIP_MODEL_VERSION);

/** In-memory mirror for the current board. */
const cache = new Map<string, { key: string; vec: Float32Array }>();
let cacheBoard: string | null = null;

let indexing: Promise<void> | null = null;
let clipSearches = 0;

interface ClipTarget {
  id: string;
  assetId: string;
  hint: string;
}

function imageTargets(): ClipTarget[] {
  const doc = useDocumentStore.getState().doc;
  const out: ClipTarget[] = [];
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'image') continue;
    const assetId = item.previewAssetId ?? item.assetId;
    out.push({
      id: item.id,
      assetId,
      // The hint only matters in mock mode (e2e) — real CLIP reads pixels.
      hint: `${mediaMeta(item).title} ${item.notes ?? ''}`.trim(),
    });
  }
  return out;
}

/** Compute + cache vectors for every image item missing one. */
export async function ensureClipIndex(): Promise<void> {
  if (!clipEnabled() || clipModelState().state !== 'ready') return;
  if (indexing) return indexing;
  indexing = (async () => {
    const doc = useDocumentStore.getState().doc;
    if (cacheBoard !== doc.id) {
      cache.clear();
      cacheBoard = doc.id;
    }
    const db = await getDb();
    const locked = !!getSessionLock(doc.id);
    const missing: ClipTarget[] = [];
    for (const t of imageTargets()) {
      const inMem = cache.get(t.id);
      if (inMem?.key === t.assetId) continue;
      const stored = await db.get('clipVectors', t.id).catch(() => undefined);
      if (stored && stored.key === t.assetId && stored.model === modelVersion()) {
        cache.set(t.id, { key: stored.key, vec: new Float32Array(stored.vec) });
        if (locked) await db.delete('clipVectors', t.id).catch(() => undefined);
        continue;
      }
      missing.push(t);
    }
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const blobs: Blob[] = [];
      const kept: ClipTarget[] = [];
      for (const t of batch) {
        const blob = await getAssetBlob(t.assetId).catch(() => undefined);
        if (blob) {
          blobs.push(blob);
          kept.push(t);
        }
      }
      if (!kept.length) continue;
      try {
        const vecs = await clipImageVectors(
          blobs,
          kept.map((t) => t.hint),
        );
        if (vecs.length !== kept.length) continue;
        for (let k = 0; k < kept.length; k++) {
          const t = kept[k]!;
          const record = {
            key: t.assetId,
            model: modelVersion(),
            dims: vecs[k]!.length,
            vec: vecs[k]!.buffer as ArrayBuffer,
          };
          cache.set(t.id, { key: t.assetId, vec: vecs[k]! });
          if (!locked) await db.put('clipVectors', record, t.id).catch(() => undefined);
        }
      } catch {
        /* an image failed to decode — keyword/OCR search still covers it */
      }
    }
  })().finally(() => {
    indexing = null;
  });
  return indexing;
}

export interface ClipHit {
  id: string;
  /** Cosine similarity in CLIP space (normalized vectors → dot product). */
  score: number;
}

/** Text query → image items ranked by CLIP similarity. */
export async function searchClip(query: string, limit = 12): Promise<ClipHit[]> {
  if (!clipEnabled() || clipModelState().state !== 'ready') return [];
  await ensureClipIndex();
  const [q] = await clipTextVectors([query]);
  if (!q) return [];
  const hits: ClipHit[] = [];
  for (const [id, rec] of cache) {
    if (rec.vec.length !== q.length) continue;
    let dot = 0;
    for (let i = 0; i < q.length; i++) dot += q[i]! * rec.vec[i]!;
    hits.push({ id, score: dot });
  }
  clipSearches += 1;
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** e2e/debug counters. */
export function clipStats(): {
  enabled: boolean;
  state: string;
  vectors: number;
  searches: number;
} {
  return {
    enabled: clipEnabled(),
    state: clipModelState().state,
    vectors: cache.size,
    searches: clipSearches,
  };
}
