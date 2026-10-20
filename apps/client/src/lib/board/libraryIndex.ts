import type { CanvasDocument, Item } from '@boardcache/schema';
import type MiniSearch from 'minisearch';
import { asyncSource, syncText } from '../search/boardIndex';
import { loadBoardRecord } from './boardLibrary';
import { getDb } from '../db';

/**
 * Cross-board content search over the LOCAL library (user decision:
 * downloaded boards only, locked boards excluded). Reuses the per-item
 * extractors; deep text (PDF/HTML) comes from the shared `extract` cache
 * when a board has been opened before — never re-extracted here, so a
 * library-wide search stays cheap. Per-board entries cache by `updatedAt`;
 * only changed boards re-extract on the next search.
 *
 * Coverage is reported, not hidden: locked and not-downloaded boards are
 * counted so the UI can say what a search did NOT look inside.
 */

interface LibEntry {
  id: string; // `${boardId} ${itemId}`
  title: string;
  body: string;
  type: string;
  boardId: string;
  boardName: string;
}

interface BoardCacheEntry {
  updatedAt: string;
  name: string;
  entries: LibEntry[];
}

const perBoard = new Map<string, BoardCacheEntry>();
let libIndex: MiniSearch<LibEntry> | null = null;
let libDirty = true;
let skippedLocked = 0;
let skippedRemote = 0;

async function entriesFor(boardId: string, doc: CanvasDocument, name: string): Promise<LibEntry[]> {
  const db = await getDb();
  const out: LibEntry[] = [];
  for (const item of Object.values(doc.items) as Item[]) {
    const sync = syncText(item);
    let deep = '';
    const source = asyncSource(item);
    if (source) {
      // Cache hits only — cross-board search never triggers extraction.
      const cached = await db.get('extract', item.id).catch(() => undefined);
      if (cached && cached.hash === source) deep = cached.text;
    }
    const body = [sync.body, deep].filter(Boolean).join('\n');
    if (!sync.title && !body) continue;
    // Untitled items display their first line (mirrors per-board behavior).
    const firstLine =
      body
        .split('\n')
        .find((l) => l.trim())
        ?.trim() ?? '';
    out.push({
      id: `${boardId} ${item.id}`,
      title: sync.title || (firstLine.length > 64 ? `${firstLine.slice(0, 63)}…` : firstLine),
      body: body.slice(0, 20_000),
      type: item.type,
      boardId,
      boardName: name,
    });
  }
  return out;
}

/** Bring the library index up to date (changed boards only). */
async function ensureLibraryIndex(): Promise<void> {
  const db = await getDb();
  const records = await db.getAll('boards');
  skippedLocked = records.filter((r) => !!r.lock || r.remoteLocked === true).length;
  skippedRemote = records.filter((r) => r.remote === true && !r.lock).length;
  const eligible = records.filter((r) => !r.lock && r.remoteLocked !== true && !r.remote && r.doc);
  const liveIds = new Set(eligible.map((r) => r.id));
  let changed = false;
  for (const id of [...perBoard.keys()]) {
    if (!liveIds.has(id)) {
      perBoard.delete(id);
      changed = true;
    }
  }
  for (const r of eligible) {
    const cached = perBoard.get(r.id);
    if (cached && cached.updatedAt === r.updatedAt) continue;
    const doc = await loadBoardRecord(r.id);
    if (!doc) continue;
    perBoard.set(r.id, {
      updatedAt: r.updatedAt,
      name: r.name,
      entries: await entriesFor(r.id, doc, r.name),
    });
    changed = true;
  }
  if (changed || libDirty || !libIndex) {
    const { default: MiniSearchImpl } = await import('minisearch');
    libIndex = new MiniSearchImpl<LibEntry>({
      fields: ['title', 'body', 'boardName'],
      storeFields: ['title', 'type', 'boardId', 'boardName'],
      searchOptions: { boost: { title: 3, boardName: 2 }, prefix: true, fuzzy: 0.15 },
    });
    for (const b of perBoard.values()) libIndex.addAll(b.entries);
    libDirty = false;
  }
}

interface LibrarySearchHit {
  boardId: string;
  boardName: string;
  itemId: string;
  title: string;
  type: string;
  score: number;
  snippet: string;
}

export interface LibrarySearchResult {
  hits: LibrarySearchHit[];
  boardsSearched: number;
  skippedLocked: number;
  skippedRemote: number;
  /** Boards with at least one stored embedding ("semantic where available" —
   *  user decision: no background embedding of unopened boards). Absent when
   *  semantic search is off. */
  semanticBoards?: number;
}

function snippetFrom(body: string, query: string): string {
  const lower = body.toLowerCase();
  for (const term of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = lower.indexOf(term);
    if (at >= 0) {
      const from = Math.max(0, at - 60);
      const to = Math.min(body.length, at + term.length + 90);
      return `${from > 0 ? '…' : ''}${body.slice(from, to).replace(/\s+/g, ' ').trim()}${to < body.length ? '…' : ''}`;
    }
  }
  return body.slice(0, 120).replace(/\s+/g, ' ').trim();
}

/** Hybrid search across every downloaded, unlocked board: keyword always;
 *  semantic (cosine over stored vectors) merged in where embeddings exist. */
export async function searchLibrary(query: string, limit = 15): Promise<LibrarySearchResult> {
  await ensureLibraryIndex();
  const base = {
    boardsSearched: perBoard.size,
    skippedLocked,
    skippedRemote,
  };
  if (!libIndex || !query.trim()) return { hits: [], ...base };
  const byEntryId = new Map<string, LibEntry>();
  for (const b of perBoard.values()) for (const e of b.entries) byEntryId.set(e.id, e);

  const keyword: LibrarySearchHit[] = libIndex
    .search(query)
    .slice(0, limit * 2)
    .map((r) => ({
      boardId: (r['boardId'] as string) ?? '',
      boardName: (r['boardName'] as string) ?? '',
      itemId: String(r.id).split(' ')[1] ?? '',
      title: (r['title'] as string) || '',
      type: (r['type'] as string) || '',
      score: r.score,
      snippet: snippetFrom(byEntryId.get(String(r.id))?.body ?? '', query),
    }));

  // "Semantic where available": score whatever vectors past per-board
  // embedding passes have stored — no new embedding work here.
  const sem = await import('../search/semanticIndex');
  if (!sem.semanticEnabled()) return { hits: keyword.slice(0, limit), ...base };
  const q = await sem.embedQueryVec(query);
  if (!q) return { hits: keyword.slice(0, limit), ...base };

  const db = await getDb();
  const [keys, records] = await Promise.all([
    db.getAllKeys('vectors').catch(() => [] as string[]),
    db.getAll('vectors').catch(() => []),
  ]);
  const model = sem.currentModelVersion();
  const semScores = new Map<string, { score: number; chunkText: string }>();
  const semBoardIds = new Set<string>();
  // itemId → its library entry (only eligible boards' items participate).
  const entryByItemId = new Map<string, LibEntry>();
  for (const e of byEntryId.values()) entryByItemId.set(e.id.split(' ')[1] ?? '', e);
  for (let i = 0; i < keys.length; i++) {
    const itemId = String(keys[i]);
    const entry = entryByItemId.get(itemId);
    const rec = records[i];
    if (!entry || !rec || rec.model !== model || rec.dims !== q.length) continue;
    semBoardIds.add(entry.boardId);
    let best = -1;
    let bestText = '';
    for (const c of rec.chunks) {
      const v = new Float32Array(c.vec);
      let dot = 0;
      for (let j = 0; j < q.length; j++) dot += q[j]! * v[j]!;
      if (dot > best) {
        best = dot;
        bestText = c.text;
      }
    }
    if (best > 0) semScores.set(itemId, { score: best, chunkText: bestText });
  }

  const maxKw = keyword[0]?.score || 1;
  const merged = new Map<string, LibrarySearchHit & { combined: number }>();
  for (const h of keyword) merged.set(h.itemId, { ...h, combined: 0.6 * (h.score / maxKw) });
  for (const [itemId, s] of semScores) {
    const existing = merged.get(itemId);
    if (existing) {
      existing.combined += 0.5 * s.score;
    } else {
      const entry = entryByItemId.get(itemId)!;
      merged.set(itemId, {
        boardId: entry.boardId,
        boardName: entry.boardName,
        itemId,
        title: entry.title,
        type: entry.type,
        score: s.score,
        snippet: s.chunkText.replace(/\s+/g, ' ').trim().slice(0, 150),
        combined: 0.5 * s.score,
      });
    }
  }
  return {
    hits: [...merged.values()]
      .sort((a, b) => b.combined - a.combined)
      .slice(0, limit)
      .map(({ combined, ...hit }) => ({ ...hit, score: combined })),
    ...base,
    semanticBoards: semBoardIds.size,
  };
}
