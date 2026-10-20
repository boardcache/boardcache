import type { CanvasDocument, Item } from '@boardcache/schema';
import type MiniSearch from 'minisearch';
import { getAssetBlob } from '../board/assetStore';
import { getSessionLock } from '../board/boardLock';
import { getDb } from '../db';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Board content index — Stage 1 of board RAG, and the engine behind "Find on
 * Board". Every item is flattened to searchable text (per-type extractors;
 * uniform name/notes/tags/linkUrl base) and indexed with MiniSearch (BM25-ish
 * keyword search, prefix + light fuzzy). Fully local: built in this browser
 * from content already on the device, never synced, never gated — an open
 * board reindexes lazily after every change.
 *
 * Cheap extractions rebuild on the fly; expensive ones (PDF text layers,
 * HTML-embed bodies) persist in the `extract` IDB store keyed by item id and
 * a content hash, so they run once per content version per device.
 *
 * Every item type's extractor is its `searchText` slot in src/itemTypes —
 * the registry makes a missing one a compile error.
 */

const REINDEX_DEBOUNCE_MS = 600;
const MAX_BODY_CHARS = 20_000;
const PDF_MAX_PAGES = 40;

import type { Extracted } from './extract';
import { join } from './extract';
import { itemType } from '../../itemTypes';
export type { Extracted } from './extract';

// --- per-type extraction ------------------------------------------------------

/** Cheap synchronous extraction (recomputed freely on every reindex).
 *  Shared with the cross-board library index. */
export function syncText(item: Item): Extracted {
  return itemType(item).searchText(item);
}

/** Content signature for the async extraction an item wants, or null. */
export function asyncSource(item: Item): string | null {
  if (item.type === 'pdf') return `pdf:${item.assetId}`;
  if (item.type === 'htmlembed') return `html:${item.htmlAssetId}`;
  return null;
}

async function extractPdf(assetId: string): Promise<string> {
  const blob = await getAssetBlob(assetId);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  try {
    const { loadPdf } = await import('../media/pdfDoc');
    const pdf = await loadPdf(url);
    try {
      const pages = Math.min(pdf.doc.numPages, PDF_MAX_PAGES);
      let out = '';
      for (let p = 1; p <= pages && out.length < MAX_BODY_CHARS; p++) {
        const page = await pdf.doc.getPage(p);
        const content = await page.getTextContent();
        out += content.items
          .map((it) => ('str' in it ? it.str : ''))
          .join(' ')
          .trim();
        out += '\n';
      }
      return out.slice(0, MAX_BODY_CHARS);
    } finally {
      pdf.destroy();
    }
  } catch {
    return ''; // corrupt/imageless PDFs simply contribute no text
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function extractHtml(assetId: string): Promise<string> {
  const blob = await getAssetBlob(assetId);
  if (!blob) return '';
  try {
    const html = await blob.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_BODY_CHARS);
  } catch {
    return '';
  }
}

/**
 * Async extraction, cached in IDB by content hash (runs once per version).
 * Password-locked boards are encrypted at rest — their text must never land
 * in the plaintext cache (persist=false: compute in-memory, purge any
 * previously stored entry).
 */
async function asyncText(itemId: string, source: string, persist: boolean): Promise<string> {
  const db = await getDb();
  if (!persist) {
    await db.delete('extract', itemId).catch(() => undefined);
  } else {
    const cached = await db.get('extract', itemId).catch(() => undefined);
    if (cached && cached.hash === source) return cached.text;
  }
  const text = source.startsWith('pdf:')
    ? await extractPdf(source.slice(4))
    : await extractHtml(source.slice(5));
  if (persist) await db.put('extract', { hash: source, text }, itemId).catch(() => undefined);
  return text;
}

// --- the index ---------------------------------------------------------------

interface IndexDoc {
  id: string;
  title: string;
  body: string;
  type: string;
}

let mini: MiniSearch<IndexDoc> | null = null;
let indexedBoardId: string | null = null;
/** id → the signature the current index entry was built from. */
const entryKeys = new Map<string, string>();
/** id → indexed text (for snippets). */
const entryDocs = new Map<string, IndexDoc>();
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let rebuilding: Promise<void> | null = null;
let rebuildQueued = false;
let started = false;

const boardOpen = (): boolean => {
  const view = useSessionStore.getState().view;
  return view === 'canvas' || view === 'gallery';
};

/** Semantic layer hookup without a hard dependency: only loads when enabled. */
const semanticOn = (): boolean => {
  try {
    return localStorage.getItem('boardcache:semanticSearch') === 'on';
  } catch {
    return false;
  }
};

const entryKey = (item: Item, source: string | null): string =>
  JSON.stringify([syncText(item), source]);

async function rebuild(): Promise<void> {
  if (rebuilding) {
    rebuildQueued = true;
    return;
  }
  rebuilding = (async () => {
    const { default: MiniSearchImpl } = await import('minisearch');
    if (!boardOpen()) return;
    const doc: CanvasDocument = useDocumentStore.getState().doc;
    if (indexedBoardId !== doc.id) {
      mini = null;
      entryKeys.clear();
      entryDocs.clear();
      indexedBoardId = doc.id;
    }
    mini ??= new MiniSearchImpl<IndexDoc>({
      fields: ['title', 'body'],
      storeFields: ['title', 'type'],
      searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.15 },
    });
    const items = Object.values(doc.items);
    const liveIds = new Set(items.map((i) => i.id));
    for (const id of [...entryKeys.keys()]) {
      if (!liveIds.has(id)) {
        entryKeys.delete(id);
        entryDocs.delete(id);
        if (mini.has(id)) mini.discard(id);
        if (semanticOn()) void import('./semanticIndex').then((m) => m.dropVectors(id));
      }
    }
    // Time-slice the scan: a 1,000-item board must never block a frame for
    // the index (the perf smoke budgets p95 < 80ms during pans).
    let sliceStart = performance.now();
    const persistCaches = !getSessionLock(doc.id);
    for (const item of items) {
      if (performance.now() - sliceStart > 8) {
        await new Promise((r) => setTimeout(r, 0));
        sliceStart = performance.now();
      }
      const source = asyncSource(item);
      const key = entryKey(item, source);
      if (entryKeys.get(item.id) === key) continue;
      const sync = syncText(item);
      const deep = source ? await asyncText(item.id, source, persistCaches) : '';
      // The doc may have moved on while we extracted — recheck the item.
      const current = useDocumentStore.getState().doc.items[item.id];
      if (!current) continue;
      const entry: IndexDoc = {
        id: item.id,
        title: sync.title,
        body: join(sync.body, deep).slice(0, MAX_BODY_CHARS),
        type: item.type,
      };
      if (mini.has(item.id)) mini.replace(entry);
      else mini.add(entry);
      entryKeys.set(item.id, key);
      entryDocs.set(item.id, entry);
      if (semanticOn()) {
        void import('./semanticIndex').then((m) =>
          m.queueEmbed(entry.id, entry.title, entry.body, key),
        );
      }
    }
  })().finally(() => {
    rebuilding = null;
    if (rebuildQueued) {
      rebuildQueued = false;
      scheduleRebuild();
    }
  });
  await rebuilding;
}

function scheduleRebuild(): void {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    void rebuild();
  }, REINDEX_DEBOUNCE_MS);
}

/** Start the background indexer (idempotent; call once at app boot). */
export function initBoardIndex(): void {
  if (started) return;
  started = true;
  // Subscribe to the items map, not the whole doc — pans/zooms replace the
  // doc object every frame and must not schedule (even no-op) rescans.
  useDocumentStore.subscribe(
    (s) => s.doc.items,
    () => {
      if (boardOpen()) scheduleRebuild();
    },
  );
  useSessionStore.subscribe(
    (s) => s.view,
    () => {
      if (boardOpen()) {
        scheduleRebuild();
        return;
      }
      // No board open — drop the in-memory index. Locked boards especially
      // must not keep plaintext in RAM after close.
      mini = null;
      entryKeys.clear();
      entryDocs.clear();
      indexedBoardId = null;
      if (semanticOn()) void import('./semanticIndex').then((m) => m.clearMemory());
    },
  );
  if (boardOpen()) scheduleRebuild();
}

/** Flush pending work so a search sees the current board (tests, tool calls). */
export async function boardIndexReady(): Promise<void> {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
  await rebuild();
  while (rebuilding) await rebuilding;
}

export interface BoardSearchHit {
  id: string;
  title: string;
  type: string;
  score: number;
  /** Text around the first query-term match. */
  snippet: string;
}

function snippetFor(id: string, query: string): string {
  const entry = entryDocs.get(id);
  if (!entry) return '';
  const haystack = entry.body;
  const lower = haystack.toLowerCase();
  for (const term of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = lower.indexOf(term);
    if (at >= 0) {
      const from = Math.max(0, at - 60);
      const to = Math.min(haystack.length, at + term.length + 90);
      return `${from > 0 ? '…' : ''}${haystack.slice(from, to).replace(/\s+/g, ' ').trim()}${to < haystack.length ? '…' : ''}`;
    }
  }
  return haystack.slice(0, 120).replace(/\s+/g, ' ').trim();
}

/**
 * Items whose CONTENT can't be searched yet: images without OCR (run
 * "Extract Text (OCR)" from their context menu, or type into the lightbox
 * OCR field) and audio/video (no transcription path yet). Metadata
 * (name/notes/tags) still matches — this is about the content itself.
 */
export function unindexedSummary(): { images: string[]; media: string[] } {
  const doc = useDocumentStore.getState().doc;
  const images: string[] = [];
  const media: string[] = [];
  for (const item of Object.values(doc.items)) {
    if (item.type === 'image' && item.ocrText == null && item.description == null) {
      images.push(item.id);
    } else if ((item.type === 'audio' || item.type === 'video') && item.transcript == null) {
      media.push(item.id);
    }
  }
  return { images, media };
}

/** Keyword search over the open board's indexed content. */
function searchBoardIndex(query: string, limit = 12): BoardSearchHit[] {
  if (!mini || !query.trim()) return [];
  return mini
    .search(query)
    .slice(0, limit)
    .map((r) => ({
      id: String(r.id),
      title: (r['title'] as string) || '',
      type: (r['type'] as string) || '',
      score: r.score,
      snippet: snippetFor(String(r.id), query),
    }));
}

/**
 * Hybrid search: keyword hits merged with semantic (cosine) hits when the
 * local model is enabled. Scores are normalized per method and combined —
 * items found by both rank highest; semantic-only hits surface content that
 * shares no words with the query. Falls back to pure keyword when semantic
 * is off, still loading, or failed.
 */
export async function searchBoardHybrid(query: string, limit = 12): Promise<BoardSearchHit[]> {
  const keyword = searchBoardIndex(query, limit * 2);
  // CLIP: images matched by their PIXELS (no OCR/description needed). CLIP
  // cosines live in their own space, so they merge as a bonus signal with
  // their own weight rather than competing raw with keyword scores.
  let clipHits: { id: string; score: number }[] = [];
  try {
    const c = await import('./clipIndex');
    const si = await import('./semanticIndex');
    if (si.clipEnabled()) {
      si.warmClip();
      clipHits = (await c.searchClip(query, limit)).filter((h) => h.score > 0.22);
    }
  } catch {
    /* image search unavailable — text signals still run */
  }
  if (!semanticOn()) {
    return rerankPass(query, mergeClip(keyword.slice(0, limit), clipHits, limit));
  }
  let semantic: { id: string; score: number; chunkText: string }[];
  try {
    const m = await import('./semanticIndex');
    semantic = await m.semanticSearch(query, limit * 2);
  } catch {
    return rerankPass(query, mergeClip(keyword.slice(0, limit), clipHits, limit));
  }
  if (semantic.length === 0) {
    return rerankPass(query, mergeClip(keyword.slice(0, limit), clipHits, limit));
  }
  const maxKw = keyword[0]?.score || 1;
  const merged = new Map<string, BoardSearchHit & { combined: number }>();
  for (const h of keyword) {
    merged.set(h.id, { ...h, combined: 0.6 * (h.score / maxKw) });
  }
  for (const s of semantic) {
    const existing = merged.get(s.id);
    if (existing) {
      existing.combined += 0.5 * s.score;
    } else {
      const entry = entryDocs.get(s.id);
      merged.set(s.id, {
        id: s.id,
        title: entry?.title ?? '',
        type: entry?.type ?? '',
        score: s.score,
        snippet: s.chunkText.replace(/\s+/g, ' ').trim().slice(0, 150),
        combined: 0.5 * s.score,
      });
    }
  }
  return rerankPass(
    query,
    mergeClip(
      [...merged.values()]
        .sort((a, b) => b.combined - a.combined)
        .slice(0, limit)
        .map(({ combined, ...hit }) => ({ ...hit, score: combined })),
      clipHits,
      limit,
    ),
  );
}

/** Fold CLIP image hits into a hit list (boost existing, append new). */
function mergeClip(
  hits: BoardSearchHit[],
  clipHits: { id: string; score: number }[],
  limit: number,
): BoardSearchHit[] {
  if (clipHits.length === 0) return hits;
  const out = new Map(hits.map((h) => [h.id, { ...h, combined: h.score }]));
  for (const c of clipHits) {
    const existing = out.get(c.id);
    if (existing) {
      existing.combined += 0.45 * c.score;
    } else {
      const entry = entryDocs.get(c.id);
      out.set(c.id, {
        id: c.id,
        title: entry?.title ?? '',
        type: entry?.type ?? 'image',
        score: 0.45 * c.score,
        snippet: '(image match)',
        combined: 0.45 * c.score,
      });
    }
  }
  return [...out.values()]
    .sort((a, b) => b.combined - a.combined)
    .slice(0, limit)
    .map(({ combined, ...hit }) => ({ ...hit, score: combined }));
}

/**
 * Precision pass: when the cross-encoder is enabled AND ready, rescore the
 * candidate hits against the query directly and reorder. A miss (off, still
 * downloading, or failed) leaves the original ranking untouched.
 */
async function rerankPass(query: string, hits: BoardSearchHit[]): Promise<BoardSearchHit[]> {
  if (hits.length < 2) return hits;
  try {
    const m = await import('./semanticIndex');
    if (!m.rerankerEnabled()) return hits;
    const texts = hits.map((h) => {
      const entry = entryDocs.get(h.id);
      return `${entry?.title ?? h.title} ${entry?.body ?? h.snippet}`.slice(0, 500);
    });
    const scores = await m.rerankTexts(query, texts);
    if (scores.length !== hits.length) return hits;
    return hits
      .map((h, i) => ({ h, s: scores[i]! }))
      .sort((a, b) => b.s - a.s)
      .map(({ h }) => h);
  } catch {
    return hits;
  }
}
