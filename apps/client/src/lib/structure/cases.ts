import type {
  CanvasDocument,
  CaseConclusion,
  CaseEvidence,
  CaseItem,
  Item,
} from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { runCommand } from '../../state/commands';

/**
 * Cases: a question with competing conclusions, each scored by the
 * evidence linked to it. Evidence is a reference to a canvas item — the
 * item stays wherever it sits; nothing here moves or sizes anything. One
 * module owns the scoring so the card, the lightbox stage, the Cases
 * panel, the assistant and the dossier agree.
 */

export type Stance = CaseEvidence['stance'];

/** The card's design width: the zoom is width ÷ this until a corner drag sets it. */
export const CASE_CARD_W = 360;

export interface ConclusionScore {
  conclusion: CaseConclusion;
  /** supports − contradicts, each the item's strength. */
  net: number;
  supports: number;
  contradicts: number;
  /** Linked items that exist on the board. */
  count: number;
  /** Of those, how many carry no strength rating (they count for nothing). */
  unrated: number;
}

/** Every conclusion's score, strongest first (ties keep the case's order). */
export function conclusionScores(items: Record<string, Item>, card: CaseItem): ConclusionScore[] {
  const rows = card.conclusions.map((conclusion) => {
    const row: ConclusionScore = {
      conclusion,
      net: 0,
      supports: 0,
      contradicts: 0,
      count: 0,
      unrated: 0,
    };
    for (const ev of card.evidence) {
      if (ev.conclusionId !== conclusion.id) continue;
      const item = items[ev.itemId];
      if (!item) continue;
      row.count++;
      if (!item.weight) {
        row.unrated++;
        continue;
      }
      const share = item.weight;
      if (ev.stance === 'supports') row.supports += share;
      else row.contradicts += share;
    }
    row.net = row.supports - row.contradicts;
    return row;
  });
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => b.row.net - a.row.net || a.i - b.i)
    .map(({ row }) => row);
}

/** The strongest conclusion, or null for a case with none. */
export function caseLeader(items: Record<string, Item>, card: CaseItem): ConclusionScore | null {
  return conclusionScores(items, card)[0] ?? null;
}

/** Distinct linked items that exist. */
export function caseItemCount(items: Record<string, Item>, card: CaseItem): number {
  return new Set(card.evidence.map((e) => e.itemId).filter((id) => id in items)).size;
}

/** "+7.5" / "−3" / "0", one decimal at most. */
export function formatScore(n: number, signed = true): string {
  const rounded = Math.round(n * 10) / 10;
  const text = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1);
  if (rounded === 0) return '0';
  if (!signed) return text;
  return rounded > 0 ? `+${text}` : `−${text}`;
}

/** Run a labeled mutation on one case. */
export function updateCase(
  itemId: string,
  label: string,
  recipe: (card: CaseItem, draft: CanvasDocument) => void,
): void {
  runCommand(label, (draft) => {
    const card = draft.items[itemId];
    if (card?.type !== 'case') return;
    recipe(card, draft);
  });
}

/** Add a conclusion; returns its id. */
/**
 * The card height (at zoom 1) that shows every conclusion: the sum of the
 * parts in 58-cases.css — card border, header (title, optional question),
 * list padding, 26px rows with 8px gaps, footer.
 */
export function caseDesignHeight(conclusions: number, question: boolean): number {
  const header = 10 + 18 + (question ? 1 + 15 : 0) + 8 + 1;
  const rows = Math.max(1, conclusions);
  const list = 6 + rows * 26 + (rows - 1) * 8 + 6;
  const footer = 1 + 6 + 15 + 9;
  return 2 + header + list + footer;
}

/** Grow a case card (never shrink it) so every conclusion is in view. */
function fitCaseHeight(c: CaseItem): void {
  const zoom = c.zoom ?? c.width / Math.max(1, CASE_CARD_W);
  c.height = Math.max(c.height, caseDesignHeight(c.conclusions.length, !!c.question) * zoom);
}

export function addConclusion(caseId: string, label: string): string {
  const id = newId();
  updateCase(caseId, 'Add conclusion', (c) => {
    c.conclusions.push({ id, label: label.trim() || `Conclusion ${c.conclusions.length + 1}` });
    fitCaseHeight(c);
  });
  return id;
}

/** Remove a conclusion and every link to it. */
export function removeConclusion(caseId: string, conclusionId: string): void {
  updateCase(caseId, 'Remove conclusion', (c) => {
    c.conclusions = c.conclusions.filter((x) => x.id !== conclusionId);
    c.evidence = c.evidence.filter((e) => e.conclusionId !== conclusionId);
  });
}

/** Link items to a conclusion (an existing link to the same conclusion is
 *  updated in place, so relinking never duplicates). Containers are never
 *  evidence. */
export function linkEvidence(
  caseId: string,
  ids: string[],
  conclusionId: string,
  stance: Stance,
): void {
  updateCase(caseId, 'Link evidence', (c, draft) => {
    if (!c.conclusions.some((x) => x.id === conclusionId)) return;
    for (const id of ids) {
      const item = draft.items[id];
      if (!item || NOT_EVIDENCE.has(item.type)) continue;
      const existing = c.evidence.find((e) => e.itemId === id && e.conclusionId === conclusionId);
      if (existing) {
        existing.stance = stance;
      } else {
        // `relevance` is a field older boards carry; it no longer scores.
        c.evidence.push({ itemId: id, conclusionId, stance, relevance: 1 });
      }
    }
  });
}

/** Move an item's link from one conclusion to another, keeping its side.
 *  A link already on the target absorbs the moved one. */
export function moveEvidence(caseId: string, itemId: string, from: string, to: string): void {
  if (from === to) return;
  updateCase(caseId, 'Move evidence', (c) => {
    const source = c.evidence.find((e) => e.itemId === itemId && e.conclusionId === from);
    if (!source) return;
    const target = c.evidence.find((e) => e.itemId === itemId && e.conclusionId === to);
    if (target) {
      target.stance = source.stance;
      c.evidence = c.evidence.filter((e) => e !== source);
    } else {
      source.conclusionId = to;
    }
  });
}

/** Unlink items from a conclusion, or from every conclusion of the case. */
export function unlinkEvidence(caseId: string, ids: string[], conclusionId?: string): void {
  const moving = new Set(ids);
  updateCase(caseId, 'Unlink evidence', (c) => {
    c.evidence = c.evidence.filter(
      (e) =>
        !(moving.has(e.itemId) && (conclusionId === undefined || e.conclusionId === conclusionId)),
    );
  });
}

const NOT_EVIDENCE = new Set<Item['type']>([
  'case',
  'tierlist',
  'timeline',
  'storyboard',
  'tree',
  'project',
]);

export function canBeEvidence(item: Item): boolean {
  return !NOT_EVIDENCE.has(item.type);
}

export interface Membership {
  caseId: string;
  caseTitle: string;
  conclusion: CaseConclusion;
  stance: Stance;
}

/** Every case link an item has, for its metadata surfaces. */
export function membershipsOf(items: Record<string, Item>, itemId: string): Membership[] {
  const out: Membership[] = [];
  for (const it of Object.values(items)) {
    if (it.type !== 'case') continue;
    for (const ev of it.evidence) {
      if (ev.itemId !== itemId) continue;
      const conclusion = it.conclusions.find((c) => c.id === ev.conclusionId);
      if (!conclusion) continue;
      out.push({
        caseId: it.id,
        caseTitle: it.name ?? it.title,
        conclusion,
        stance: ev.stance,
      });
    }
  }
  return out;
}
