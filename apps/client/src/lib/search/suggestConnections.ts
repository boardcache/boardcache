import { syncText } from './boardIndex';
import { sharedTerms, sparseCosine, tfVector, tokenize } from './similarity';
import { boardItemVectors } from './semanticIndex';
import { useDocumentStore } from '../../state/documentStore';

/**
 * AI-suggested connections (research arc 4/10): rank pairs of UNCONNECTED
 * items whose content overlaps, for a human review queue — suggestions are
 * never applied automatically (user's standing rule). Uses the semantic
 * vectors when the user opted into the local model; always computes a
 * keyword-overlap cosine as the explainable fallback, so the feature works
 * for everyone and every suggestion can say WHY ("shared: warehouse, fire").
 */
export interface ConnectionSuggestion {
  a: string;
  b: string;
  /** 0..1-ish similarity (semantic cosine when available, else keyword). */
  score: number;
  /** Human-readable justification shown in the review row. */
  reason: string;
}

/** Session-scoped dismissals so a rejected pair stays gone until reload. */
const dismissed = new Set<string>();
const pairKey = (boardId: string, a: string, b: string): string =>
  `${boardId}:${[a, b].sort().join('|')}`;

export function dismissSuggestion(a: string, b: string): void {
  dismissed.add(pairKey(useDocumentStore.getState().doc.id, a, b));
}

/** Keep pairwise work bounded on huge boards. */
const MAX_ITEMS = 300;
const MIN_TEXT_CHARS = 12;
const KEYWORD_THRESHOLD = 0.22;
const SEMANTIC_THRESHOLD = 0.6;

export async function suggestConnections(limit = 10): Promise<ConnectionSuggestion[]> {
  const doc = useDocumentStore.getState().doc;

  // Pairs that already have a line (either direction, item endpoints).
  const connected = new Set<string>();
  for (const c of Object.values(doc.connections)) {
    if (c.from.kind === 'item' && c.to.kind === 'item') {
      connected.add([c.from.id, c.to.id].sort().join('|'));
    }
  }

  // Items with enough text to reason about, newest first under the cap.
  const candidates = Object.values(doc.items)
    .map((item) => {
      const { title, body } = syncText(item);
      return { id: item.id, groupId: item.groupId, text: `${title} ${body}`.trim() };
    })
    .filter((c) => c.text.length >= MIN_TEXT_CHARS)
    .slice(0, MAX_ITEMS);

  const tf = new Map(candidates.map((c) => [c.id, tfVector(tokenize(c.text))]));
  const vecs = await boardItemVectors();

  const out: ConnectionSuggestion[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (connected.has([a.id, b.id].sort().join('|'))) continue;
      if (a.groupId && a.groupId === b.groupId) continue; // grouped = already related
      if (dismissed.has(pairKey(doc.id, a.id, b.id))) continue;

      const kw = sparseCosine(tf.get(a.id)!, tf.get(b.id)!);
      let semantic = 0;
      const va = vecs.get(a.id);
      const vb = vecs.get(b.id);
      if (va?.length && vb?.length) {
        // Best chunk-pair cosine (vectors are normalized → dot product).
        for (const ca of va) {
          for (const cb of vb) {
            let dot = 0;
            for (let k = 0; k < ca.length; k++) dot += ca[k]! * cb[k]!;
            if (dot > semantic) semantic = dot;
          }
        }
      }
      // Either signal clears its own bar; a strong keyword overlap must not
      // be vetoed by a middling semantic score (or vice versa).
      if (kw < KEYWORD_THRESHOLD && semantic < SEMANTIC_THRESHOLD) continue;
      const score = Math.max(kw, semantic);

      const terms = sharedTerms(tf.get(a.id)!, tf.get(b.id)!);
      out.push({
        a: a.id,
        b: b.id,
        score,
        reason: terms.length ? `Shared: ${terms.join(', ')}` : 'Semantically similar content',
      });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}
