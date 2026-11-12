import type { CanvasDocument } from '@boardcache/schema';
import { syncText } from './boardIndex';
import { boardItemVectors, clipEnabled, clipModelState, clipTextVectors } from './semanticIndex';
import { boardClipVectors } from './clipIndex';
import { useDocumentStore } from '../../state/documentStore';

/**
 * One shared similarity engine for the "cheap win" features built on the
 * vectors we already have: related items, More Like This, tag suggestions,
 * duplicate detection, and topic layout. Fully local — semantic (MiniLM)
 * scores when the user opted into the on-device model, CLIP when the image
 * model is on (pictures that look alike, and a text beside the picture it
 * describes), always a keyword term-frequency cosine as the
 * everyone-gets-it fallback.
 */

// --- keyword vectors (shared with suggestConnections) ----------------------

const STOPWORDS = new Set(
  (
    'the a an and or but if then else for nor of to in on at by with from as is are was were be been ' +
    'being it its this that these those there here not no yes you your we our they their he she his her ' +
    'do does did done have has had having will would can could should may might must about into over ' +
    'under out up down off so than too very just also more most some any all each every other another ' +
    'what which who whom when where why how http https www com'
  ).split(' '),
);

export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9à-ž]+/i)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

/** Sparse term-frequency vector, L2-normalized. */
export function tfVector(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  let norm = 0;
  for (const v of tf.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (const [k, v] of tf) tf.set(k, v / norm);
  return tf;
}

export function sparseCosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w) dot += v * w;
  }
  return dot;
}

/** Top shared terms, strongest first, for "why" lines. */
export function sharedTerms(a: Map<string, number>, b: Map<string, number>, n = 3): string[] {
  const shared: { term: string; w: number }[] = [];
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w) shared.push({ term: k, w: v * w });
  }
  return shared
    .sort((x, y) => y.w - x.w)
    .slice(0, n)
    .map((s) => s.term);
}

// --- board corpus ----------------------------------------------------------

interface CorpusEntry {
  id: string;
  text: string;
  tf: Map<string, number>;
}

export interface BoardCorpus {
  entries: CorpusEntry[];
  byId: Map<string, CorpusEntry>;
  /** Semantic chunk vectors (empty map when the model is off). */
  vecs: Map<string, Float32Array[]>;
  /** CLIP vectors of image items (empty when the image model is off). */
  clip: Map<string, Float32Array>;
  /** CLIP vectors of text entries, in the same space (only with `clip`). */
  clipText: Map<string, Float32Array>;
}

const MIN_TEXT_CHARS = 12;
const MAX_ITEMS = 400;

/** Every item with enough text to reason about, or a picture the image
 *  model has read, plus its vectors. */
export async function buildCorpus(doc?: CanvasDocument): Promise<BoardCorpus> {
  const d = doc ?? useDocumentStore.getState().doc;
  const clip =
    doc && doc.id !== useDocumentStore.getState().doc.id ? new Map() : await boardClipVectors();
  const entries: CorpusEntry[] = [];
  for (const item of Object.values(d.items).slice(0, MAX_ITEMS * 2)) {
    const { title, body } = syncText(item);
    const text = `${title} ${body}`.trim();
    if (text.length < MIN_TEXT_CHARS && !clip.has(item.id)) continue;
    entries.push({ id: item.id, text, tf: tfVector(tokenize(text)) });
    if (entries.length >= MAX_ITEMS) break;
  }
  const vecs = await boardItemVectors();
  // With pictures in CLIP space, the texts go there too, so a note can sit
  // beside the picture it describes.
  const clipText = new Map<string, Float32Array>();
  const worded = clip.size ? entries.filter((e) => e.text.length >= MIN_TEXT_CHARS) : [];
  if (worded.length && clipEnabled() && clipModelState().state === 'ready') {
    const vs = await clipTextVectors(worded.map((e) => e.text.slice(0, 300))).catch(() => []);
    if (vs.length === worded.length) worded.forEach((e, i) => clipText.set(e.id, vs[i]!));
  }
  return { entries, byId: new Map(entries.map((e) => [e.id, e])), vecs, clip, clipText };
}

const dot = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) return 0;
  let d = 0;
  for (let k = 0; k < a.length; k++) d += a[k]! * b[k]!;
  return d;
};
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * CLIP's cosines on the engine's 0..1 scale. Two pictures of the same thing
 * sit near 0.9 and strangers near 0.5; a sentence and the picture it
 * describes near 0.3, an unrelated pair near 0.15.
 */
const imagePairScore = (c: number): number => clamp01((c - 0.55) / 0.4);
const textImageScore = (c: number): number => clamp01((c - 0.2) / 0.15);

export interface PairDetail {
  score: number;
  /** The pictures (or a text and a picture) decided it, not the words. */
  image: boolean;
}

/** Best available similarity between two corpus items (0..1-ish), and which signal won. */
export function pairScoreDetail(corpus: BoardCorpus, a: string, b: string): PairDetail {
  const ea = corpus.byId.get(a);
  const eb = corpus.byId.get(b);
  if (!ea || !eb) return { score: 0, image: false };
  const kw = sparseCosine(ea.tf, eb.tf);
  let sem = 0;
  const va = corpus.vecs.get(a);
  const vb = corpus.vecs.get(b);
  if (va?.length && vb?.length) {
    for (const ca of va) {
      for (const cb of vb) {
        const d = dot(ca, cb);
        if (d > sem) sem = d;
      }
    }
  }
  let img = 0;
  const ia = corpus.clip.get(a);
  const ib = corpus.clip.get(b);
  if (ia && ib) img = imagePairScore(dot(ia, ib));
  else if (ia || ib) {
    const picture = ia ?? ib!;
    const words = corpus.clipText.get(ia ? b : a);
    if (words) img = textImageScore(dot(picture, words));
  }
  const words = Math.max(kw, sem);
  return img > words ? { score: img, image: true } : { score: words, image: false };
}

/** Best available similarity between two corpus items (0..1-ish). */
export function pairScore(corpus: BoardCorpus, a: string, b: string): number {
  return pairScoreDetail(corpus, a, b).score;
}

export interface ScoredItem {
  id: string;
  score: number;
  /** Shared keywords when the keyword signal contributed; may be empty. */
  terms: string[];
  /** The pictures decided it (CLIP): "looks alike", not shared words. */
  image?: boolean;
}

/** Items most similar to `itemId` on the current board. */
export async function similarItems(itemId: string, limit = 6): Promise<ScoredItem[]> {
  const corpus = await buildCorpus();
  if (!corpus.byId.has(itemId)) return [];
  const me = corpus.byId.get(itemId)!;
  const out: ScoredItem[] = [];
  for (const e of corpus.entries) {
    if (e.id === itemId) continue;
    const { score, image } = pairScoreDetail(corpus, itemId, e.id);
    if (score < 0.15) continue;
    out.push({
      id: e.id,
      score,
      terms: image ? [] : sharedTerms(me.tf, e.tf),
      ...(image ? { image: true } : {}),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Near-duplicate pairs (very high similarity), strongest first. */
export async function duplicatePairs(
  threshold = 0.88,
  limit = 20,
): Promise<{ a: string; b: string; score: number }[]> {
  const corpus = await buildCorpus();
  const out: { a: string; b: string; score: number }[] = [];
  for (let i = 0; i < corpus.entries.length; i++) {
    for (let j = i + 1; j < corpus.entries.length; j++) {
      const a = corpus.entries[i]!;
      const b = corpus.entries[j]!;
      const score = pairScore(corpus, a.id, b.id);
      if (score >= threshold) out.push({ a: a.id, b: b.id, score });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

/**
 * Items that fit the board least: lowest mean similarity to everything else.
 * Only meaningful with a reasonable corpus — returns [] under 6 items.
 */
export async function outlierItems(limit = 5): Promise<ScoredItem[]> {
  const corpus = await buildCorpus();
  if (corpus.entries.length < 6) return [];
  const out: ScoredItem[] = [];
  for (const e of corpus.entries) {
    let sum = 0;
    for (const other of corpus.entries) {
      if (other.id === e.id) continue;
      sum += pairScore(corpus, e.id, other.id);
    }
    out.push({ id: e.id, score: sum / (corpus.entries.length - 1), terms: [] });
  }
  // Ascending: least-connected-in-meaning first.
  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}

/**
 * Suggest existing board tags for the given items: each tag is represented
 * by the centroid of the TF vectors of items already carrying it.
 */
export async function suggestTags(itemIds: string[], limit = 5): Promise<string[]> {
  const doc = useDocumentStore.getState().doc;
  const corpus = await buildCorpus(doc);
  // tag → items carrying it (excluding the targets themselves)
  const tagged = new Map<string, CorpusEntry[]>();
  for (const item of Object.values(doc.items)) {
    if (itemIds.includes(item.id)) continue;
    const entry = corpus.byId.get(item.id);
    if (!entry) continue;
    for (const tag of item.tags ?? []) {
      (tagged.get(tag) ?? tagged.set(tag, []).get(tag)!).push(entry);
    }
  }
  if (tagged.size === 0) return [];
  const targets = itemIds.map((id) => corpus.byId.get(id)).filter((e): e is CorpusEntry => !!e);
  if (targets.length === 0) return [];
  const already = new Set(
    itemIds.flatMap((id) => useDocumentStore.getState().doc.items[id]?.tags ?? []),
  );
  const scores: { tag: string; score: number }[] = [];
  for (const [tag, entries] of tagged) {
    if (already.has(tag)) continue;
    // centroid TF of the tag's items
    const centroid = new Map<string, number>();
    for (const e of entries) {
      for (const [k, v] of e.tf) centroid.set(k, (centroid.get(k) ?? 0) + v / entries.length);
    }
    let norm = 0;
    for (const v of centroid.values()) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (const [k, v] of centroid) centroid.set(k, v / norm);
    const score =
      targets.reduce((acc, t) => acc + sparseCosine(t.tf, centroid), 0) / targets.length;
    if (score >= 0.12) scores.push({ tag, score });
  }
  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.tag);
}
