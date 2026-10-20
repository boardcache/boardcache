import { getSessionLock } from '../board/boardLock';
import { getDb } from '../db';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Stage 2 of board search: local semantic retrieval. Extracted item text is
 * chunked, embedded on-device (see embedWorker — MiniLM via transformers.js,
 * or a deterministic mock for tests), and searched by cosine similarity;
 * boardIndex merges these scores with keyword hits into hybrid results.
 *
 * Opt-in (the model is a ~25MB one-time download) but UNGATED — no account,
 * no server, works offline once cached. Vectors persist in the `vectors`
 * IDB store keyed by item id, versioned by content signature + model, so
 * embedding runs once per content version per device. Never synced.
 */

const FLAG_KEY = 'boardcache:semanticSearch';
const RERANK_KEY = 'boardcache:reranker';
const CLIP_KEY = 'boardcache:clipSearch';
const ASR_KEY = 'boardcache:localWhisper';
const MOCK_KEY = 'boardcache:semanticMock';
const MODEL_VERSION = 'minilm-l6-v2/q8/1';
const MOCK_VERSION = 'mock/1';
const CHUNK_CHARS = 600;
const MAX_CHUNKS = 8;
const EMBED_BATCH = 8;

export type SemanticState = 'off' | 'loading' | 'ready' | 'error';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const semanticEnabled = (): boolean => read(FLAG_KEY) === 'on';
export const rerankerEnabled = (): boolean => read(RERANK_KEY) === 'on';
export const clipEnabled = (): boolean => read(CLIP_KEY) === 'on';
export const localWhisperEnabled = (): boolean => read(ASR_KEY) === 'on';
const mockMode = (): boolean => read(MOCK_KEY) === 'on';
const modelVersion = (): string => (mockMode() ? MOCK_VERSION : MODEL_VERSION);

// --- worker ------------------------------------------------------------------

let worker: Worker | null = null;
let state: SemanticState = 'off';
let loadPct = 0;
let rerankState: SemanticState = 'off';
let rerankPct = 0;
let clipState: SemanticState = 'off';
let clipPct = 0;
let asrState: SemanticState = 'off';
let asrPct = 0;
let workerPromise: Promise<boolean> | null = null;
let readyPromise: Promise<boolean> | null = null;
let rerankReadyPromise: Promise<boolean> | null = null;
let clipReadyPromise: Promise<boolean> | null = null;
let asrReadyPromise: Promise<boolean> | null = null;
let embedReadyResolve: ((ok: boolean) => void) | null = null;
let rerankReadyResolve: ((ok: boolean) => void) | null = null;
let clipReadyResolve: ((ok: boolean) => void) | null = null;
let asrReadyResolve: ((ok: boolean) => void) | null = null;
const stateListeners = new Set<() => void>();
const pendingEmbeds = new Map<
  number,
  { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }
>();
const pendingReranks = new Map<
  number,
  { resolve: (v: number[]) => void; reject: (e: Error) => void }
>();
const pendingClips = new Map<
  number,
  { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }
>();
const pendingAsr = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();
let nextMsgId = 1;

const notify = () => stateListeners.forEach((l) => l());

export function onSemanticState(cb: () => void): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

export function semanticState(): { state: SemanticState; pct: number } {
  return { state, pct: loadPct };
}

export function rerankerState(): { state: SemanticState; pct: number } {
  return { state: rerankState, pct: rerankPct };
}

export function clipModelState(): { state: SemanticState; pct: number } {
  return { state: clipState, pct: clipPct };
}

export function asrModelState(): { state: SemanticState; pct: number } {
  return { state: asrState, pct: asrPct };
}

function spawnWorker(): Promise<boolean> {
  if (workerPromise) return workerPromise;
  workerPromise = new Promise<boolean>((resolve) => {
    worker = new Worker(new URL('./embedWorker.ts', import.meta.url), { type: 'module' });
    // A crash before the first message (import failure, OOM) must not leave
    // the UI on "loading" forever.
    worker.onerror = (e) => {
      console.error('boardCache: model worker failed', e.message ?? e);
      if (state === 'loading') state = 'error';
      if (rerankState === 'loading') rerankState = 'error';
      if (clipState === 'loading') clipState = 'error';
      if (asrState === 'loading') asrState = 'error';
      notify();
      embedReadyResolve?.(false);
      rerankReadyResolve?.(false);
      clipReadyResolve?.(false);
      asrReadyResolve?.(false);
      resolve(false);
    };
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: 'ready' }
        | { type: 'embed-progress'; pct: number }
        | { type: 'embed-ready' }
        | { type: 'embed-error'; message: string }
        | { type: 'rerank-progress'; pct: number }
        | { type: 'rerank-ready' }
        | { type: 'rerank-error'; message: string }
        | { type: 'clip-progress'; pct: number }
        | { type: 'clip-ready' }
        | { type: 'clip-error'; message: string }
        | { type: 'clip-vectors'; id: number; dims: number; buffers: ArrayBuffer[] }
        | { type: 'asr-progress'; pct: number }
        | { type: 'asr-ready' }
        | { type: 'asr-error'; message: string }
        | { type: 'transcript'; id: number; text: string }
        | { type: 'vectors'; id: number; dims: number; buffers: ArrayBuffer[] }
        | { type: 'scores'; id: number; scores: number[] }
        | { type: 'error'; id?: number; message: string };
      if (msg.type === 'ready') {
        resolve(true);
      } else if (msg.type === 'embed-progress') {
        loadPct = msg.pct;
        notify();
      } else if (msg.type === 'embed-ready') {
        state = 'ready';
        notify();
        embedReadyResolve?.(true);
      } else if (msg.type === 'embed-error') {
        console.error('boardCache: semantic model failed to load:', msg.message);
        state = 'error';
        notify();
        embedReadyResolve?.(false);
      } else if (msg.type === 'rerank-progress') {
        rerankPct = msg.pct;
        notify();
      } else if (msg.type === 'rerank-ready') {
        rerankState = 'ready';
        notify();
        rerankReadyResolve?.(true);
      } else if (msg.type === 'rerank-error') {
        console.error('boardCache: reranker failed to load:', msg.message);
        rerankState = 'error';
        notify();
        rerankReadyResolve?.(false);
      } else if (msg.type === 'clip-progress') {
        clipPct = msg.pct;
        notify();
      } else if (msg.type === 'clip-ready') {
        clipState = 'ready';
        notify();
        clipReadyResolve?.(true);
      } else if (msg.type === 'clip-error') {
        console.error('boardCache: CLIP failed to load:', msg.message);
        clipState = 'error';
        notify();
        clipReadyResolve?.(false);
      } else if (msg.type === 'clip-vectors') {
        const pending = pendingClips.get(msg.id);
        pendingClips.delete(msg.id);
        pending?.resolve(msg.buffers.map((b) => new Float32Array(b)));
      } else if (msg.type === 'asr-progress') {
        asrPct = msg.pct;
        notify();
      } else if (msg.type === 'asr-ready') {
        asrState = 'ready';
        notify();
        asrReadyResolve?.(true);
      } else if (msg.type === 'asr-error') {
        console.error('boardCache: Whisper failed to load:', msg.message);
        asrState = 'error';
        notify();
        asrReadyResolve?.(false);
      } else if (msg.type === 'transcript') {
        const pending = pendingAsr.get(msg.id);
        pendingAsr.delete(msg.id);
        pending?.resolve(msg.text);
      } else if (msg.type === 'vectors') {
        const pending = pendingEmbeds.get(msg.id);
        pendingEmbeds.delete(msg.id);
        pending?.resolve(msg.buffers.map((b) => new Float32Array(b)));
      } else if (msg.type === 'scores') {
        const pending = pendingReranks.get(msg.id);
        pendingReranks.delete(msg.id);
        pending?.resolve(msg.scores);
      } else if (msg.type === 'error') {
        if (msg.id !== undefined) {
          const e1 = pendingEmbeds.get(msg.id);
          pendingEmbeds.delete(msg.id);
          e1?.reject(new Error(msg.message));
          const e2 = pendingReranks.get(msg.id);
          pendingReranks.delete(msg.id);
          e2?.reject(new Error(msg.message));
          const e3 = pendingClips.get(msg.id);
          pendingClips.delete(msg.id);
          e3?.reject(new Error(msg.message));
          const e4 = pendingAsr.get(msg.id);
          pendingAsr.delete(msg.id);
          e4?.reject(new Error(msg.message));
        }
      }
    };
    worker.postMessage({ type: 'init', mock: mockMode() });
  });
  return workerPromise;
}

/** Spawn the worker (cheap) + load the EMBEDDING model on demand. */
function ensureWorker(): Promise<boolean> {
  if (readyPromise) return readyPromise;
  state = 'loading';
  loadPct = 0;
  notify();
  readyPromise = (async () => {
    if (!(await spawnWorker())) return false;
    return new Promise<boolean>((resolve) => {
      embedReadyResolve = resolve;
      worker!.postMessage({ type: 'embed-init' });
    });
  })();
  return readyPromise;
}

/** Spawn the worker + load the RERANKER model on demand. */
function ensureReranker(): Promise<boolean> {
  if (rerankReadyPromise) return rerankReadyPromise;
  rerankState = 'loading';
  rerankPct = 0;
  notify();
  rerankReadyPromise = (async () => {
    if (!(await spawnWorker())) return false;
    return new Promise<boolean>((resolve) => {
      rerankReadyResolve = resolve;
      worker!.postMessage({ type: 'rerank-init' });
    });
  })();
  return rerankReadyPromise;
}

/** Spawn the worker + load the CLIP text+vision towers on demand. */
function ensureClip(): Promise<boolean> {
  if (clipReadyPromise) return clipReadyPromise;
  clipState = 'loading';
  clipPct = 0;
  notify();
  clipReadyPromise = (async () => {
    if (!(await spawnWorker())) return false;
    return new Promise<boolean>((resolve) => {
      clipReadyResolve = resolve;
      worker!.postMessage({ type: 'clip-init' });
    });
  })();
  return clipReadyPromise;
}

/** Turn CLIP image search on/off (on kicks the model load + an image pass). */
export async function setClipEnabled(on: boolean): Promise<void> {
  try {
    localStorage.setItem(CLIP_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
  if (!on) {
    clipState = 'off';
    notify();
    return;
  }
  const ok = await ensureClip();
  if (ok) {
    const { ensureClipIndex } = await import('./clipIndex');
    await ensureClipIndex();
  }
}

/** Text → CLIP joint-space vectors ([] when off/not ready). */
export async function clipTextVectors(texts: string[]): Promise<Float32Array[]> {
  if (!clipEnabled() || clipState !== 'ready') return [];
  return new Promise((resolve, reject) => {
    const id = nextMsgId++;
    pendingClips.set(id, { resolve, reject });
    worker!.postMessage({ type: 'clip-text', id, texts });
  });
}

/** Images → CLIP joint-space vectors (hints feed the e2e mock). */
export async function clipImageVectors(blobs: Blob[], hints: string[]): Promise<Float32Array[]> {
  if (!clipEnabled() || clipState !== 'ready') return [];
  return new Promise((resolve, reject) => {
    const id = nextMsgId++;
    pendingClips.set(id, { resolve, reject });
    worker!.postMessage({ type: 'clip-image', id, blobs, hints });
  });
}

/** Spawn the worker + load Whisper on demand. */
function ensureAsr(): Promise<boolean> {
  if (asrReadyPromise) return asrReadyPromise;
  asrState = 'loading';
  asrPct = 0;
  notify();
  asrReadyPromise = (async () => {
    if (!(await spawnWorker())) return false;
    return new Promise<boolean>((resolve) => {
      asrReadyResolve = resolve;
      worker!.postMessage({ type: 'asr-init' });
    });
  })();
  return asrReadyPromise;
}

/** Turn local Whisper transcription on/off (on kicks the model load). */
export async function setLocalWhisperEnabled(on: boolean): Promise<void> {
  try {
    localStorage.setItem(ASR_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
  if (!on) {
    asrState = 'off';
    notify();
    return;
  }
  await ensureAsr();
}

/** Transcribe 16kHz mono PCM locally; loads the model first if needed. */
export async function asrTranscribe(pcm: Float32Array): Promise<string> {
  if (!localWhisperEnabled()) throw new Error('Local transcription is off.');
  if (!(await ensureAsr())) throw new Error('The local Whisper model failed to load.');
  return new Promise((resolve, reject) => {
    const id = nextMsgId++;
    pendingAsr.set(id, { resolve, reject });
    worker!.postMessage({ type: 'asr', id, pcm });
  });
}

/** Warm the CLIP model without blocking (search paths call this). */
export function warmClip(): void {
  if (clipEnabled() && clipState === 'off') void ensureClip();
}

function embedTexts(texts: string[]): Promise<Float32Array[]> {
  return new Promise((resolve, reject) => {
    if (!worker || state !== 'ready') {
      reject(new Error('Semantic model not ready'));
      return;
    }
    const id = nextMsgId++;
    pendingEmbeds.set(id, { resolve, reject });
    worker.postMessage({ type: 'embed', id, texts });
  });
}

let rerankCount = 0;

/** Turn the precision reranker on/off (on kicks its model load). */
export async function setRerankerEnabled(on: boolean): Promise<void> {
  try {
    localStorage.setItem(RERANK_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
  if (!on) {
    rerankState = 'off';
    notify();
    return;
  }
  await ensureReranker();
}

/**
 * Cross-encoder scores for (query, passage) pairs — [] when the reranker is
 * off or not ready yet (callers keep their original order).
 */
export async function rerankTexts(query: string, texts: string[]): Promise<number[]> {
  if (!rerankerEnabled() || texts.length === 0) return [];
  if (rerankState !== 'ready') {
    void ensureReranker(); // warm it for next time, don't block this search
    return [];
  }
  const scores = await new Promise<number[]>((resolve, reject) => {
    const id = nextMsgId++;
    pendingReranks.set(id, { resolve, reject });
    worker!.postMessage({ type: 'rerank', id, query, texts });
  });
  rerankCount += 1;
  return scores;
}

/** e2e/debug: how many searches the reranker has actually reordered. */
export function rerankStats(): { enabled: boolean; state: SemanticState; reranks: number } {
  return { enabled: rerankerEnabled(), state: rerankState, reranks: rerankCount };
}

/** Turn semantic search on/off (on kicks the model load + a full embed pass). */
export async function setSemanticEnabled(on: boolean): Promise<void> {
  try {
    localStorage.setItem(FLAG_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
  if (!on) {
    state = 'off';
    notify();
    return;
  }
  const ok = await ensureWorker();
  if (ok) {
    const { boardIndexReady } = await import('./boardIndex');
    await boardIndexReady(); // its entry updates queue the embeds
  }
}

// --- chunking + vector store -------------------------------------------------

interface VectorRecord {
  key: string; // content signature the chunks were embedded from
  model: string;
  dims: number;
  chunks: { text: string; vec: ArrayBuffer }[];
}

function chunk(title: string, body: string): string[] {
  const parts: string[] = [];
  let current = title.trim();
  for (const para of body.split(/\n+/)) {
    const p = para.trim();
    if (!p) continue;
    if (current.length + p.length + 1 > CHUNK_CHARS && current) {
      parts.push(current);
      current = p.slice(0, CHUNK_CHARS);
    } else {
      current = current ? `${current}\n${p.slice(0, CHUNK_CHARS)}` : p.slice(0, CHUNK_CHARS);
    }
    if (parts.length >= MAX_CHUNKS) break;
  }
  if (current && parts.length < MAX_CHUNKS) parts.push(current);
  return parts.filter(Boolean);
}

/** In-memory mirror of stored vectors for the current board. */
const vecCache = new Map<string, VectorRecord>();
let vecCacheBoard: string | null = null;

const queue = new Map<string, { title: string; body: string; key: string }>();
let draining = false;

/** Called by boardIndex whenever an item's indexed text changes. */
export function queueEmbed(id: string, title: string, body: string, key: string): void {
  if (!semanticEnabled()) return;
  queue.set(id, { title, body, key });
  void drain();
}

export function dropVectors(id: string): void {
  vecCache.delete(id);
  void getDb().then((db) => db.delete('vectors', id).catch(() => undefined));
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    if (!(await ensureWorker())) return;
    const db = await getDb();
    while (queue.size > 0) {
      const batch = [...queue.entries()].slice(0, EMBED_BATCH);
      for (const [id] of batch) queue.delete(id);
      const work: { id: string; texts: string[]; key: string }[] = [];
      const lockedNow = !!getSessionLock(useDocumentStore.getState().doc.id);
      for (const [id, job] of batch) {
        const existing = vecCache.get(id) ?? (await db.get('vectors', id).catch(() => undefined));
        if (existing && existing.key === job.key && existing.model === modelVersion()) {
          vecCache.set(id, existing);
          // A previously-unlocked era may have stored this item's chunks —
          // now that the board is locked, keep them in memory only.
          if (lockedNow) await db.delete('vectors', id).catch(() => undefined);
          continue;
        }
        work.push({ id, texts: chunk(job.title, job.body), key: job.key });
      }
      for (const w of work) {
        if (w.texts.length === 0) {
          dropVectors(w.id);
          continue;
        }
        try {
          const vecs = await embedTexts(w.texts);
          const record: VectorRecord = {
            key: w.key,
            model: modelVersion(),
            dims: vecs[0]?.length ?? 0,
            chunks: w.texts.map((text, i) => ({
              text,
              vec: vecs[i]!.buffer as ArrayBuffer,
            })),
          };
          vecCache.set(w.id, record);
          // Locked boards are encrypted at rest — chunk text must stay
          // in-memory only (searchable this session, gone on close).
          if (getSessionLock(useDocumentStore.getState().doc.id)) {
            await db.delete('vectors', w.id).catch(() => undefined);
          } else {
            await db.put('vectors', record, w.id).catch(() => undefined);
          }
        } catch {
          /* embedding failed — keyword search still covers the item */
        }
      }
    }
  } finally {
    draining = false;
    if (queue.size > 0) void drain();
  }
}

async function loadBoardVectors(itemIds: string[]): Promise<void> {
  const boardId = useDocumentStore.getState().doc.id;
  if (vecCacheBoard !== boardId) {
    vecCache.clear();
    vecCacheBoard = boardId;
  }
  const db = await getDb();
  for (const id of itemIds) {
    if (vecCache.has(id)) continue;
    const rec = await db.get('vectors', id).catch(() => undefined);
    if (rec && rec.model === modelVersion()) vecCache.set(id, rec);
  }
}

/**
 * Item-level chunk vectors for the current board — the raw material for
 * connection suggestions. Empty map when semantic search is off or nothing
 * has been embedded yet (callers fall back to keyword overlap).
 */
export async function boardItemVectors(): Promise<Map<string, Float32Array[]>> {
  const out = new Map<string, Float32Array[]>();
  if (!semanticEnabled()) return out;
  const itemIds = Object.keys(useDocumentStore.getState().doc.items);
  await loadBoardVectors(itemIds);
  for (const id of itemIds) {
    const rec = vecCache.get(id);
    if (rec)
      out.set(
        id,
        rec.chunks.map((c) => new Float32Array(c.vec)),
      );
  }
  return out;
}

export interface SemanticHit {
  id: string;
  /** Cosine similarity of the best chunk (normalized vectors → dot product). */
  score: number;
  chunkText: string;
}

/** Cosine search over the current board's stored vectors. */
export async function semanticSearch(query: string, limit = 12): Promise<SemanticHit[]> {
  if (!semanticEnabled() || !(await ensureWorker())) return [];
  const itemIds = Object.keys(useDocumentStore.getState().doc.items);
  await loadBoardVectors(itemIds);
  let q: Float32Array;
  try {
    [q] = (await embedTexts([query])) as [Float32Array];
  } catch {
    return [];
  }
  const hits: SemanticHit[] = [];
  for (const id of itemIds) {
    const rec = vecCache.get(id);
    if (!rec || rec.dims !== q.length) continue;
    let best = -1;
    let bestText = '';
    for (const c of rec.chunks) {
      const v = new Float32Array(c.vec);
      let dot = 0;
      for (let i = 0; i < q.length; i++) dot += q[i]! * v[i]!;
      if (dot > best) {
        best = dot;
        bestText = c.text;
      }
    }
    if (best > 0) hits.push({ id, score: best, chunkText: bestText });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Embed one query for cross-board scoring — null when semantic is off or
 * the model fails. Kicks the model load if the user enabled semantic but it
 * hasn't loaded this session yet (same behavior as board-scope search).
 */
export async function embedQueryVec(query: string): Promise<Float32Array | null> {
  if (!semanticEnabled() || !(await ensureWorker())) return null;
  try {
    const [v] = await embedTexts([query]);
    return v ?? null;
  } catch {
    return null;
  }
}

/** The vector-record model tag current settings produce (mock-aware). */
export function currentModelVersion(): string {
  return modelVersion();
}

/** Drop the in-memory vector mirror (board closed; stored vectors remain). */
export function clearMemory(): void {
  vecCache.clear();
  vecCacheBoard = null;
  queue.clear();
}

/** Introspection for tests + the dialog footer. */
export function semanticStats(): { enabled: boolean; state: SemanticState; vectors: number } {
  return { enabled: semanticEnabled(), state, vectors: vecCache.size };
}
