import { z } from 'zod';
import type { CanvasDocument, Item } from '@boardcache/schema';
import { registerBoardTool } from './registry';
import { clip, itemLabel } from './shared';
import { groupChain, groupMembers } from '../canvas/grouping';
import { rectsIntersect } from '../canvas/coords';
import type { Rect } from '../canvas/coords';

/**
 * The board linter: what an agent cannot see while it builds, as a list of
 * problems with the ids to act on. Layout (overlaps, stranded items),
 * structure (empty containers, orphans, unlabelled links, presentation
 * steps pointing nowhere), research hygiene (an evidence status with no
 * source) and meaning (near-duplicates, outliers, from the similarity
 * engine). Read-only: the agent fixes, then runs it again.
 */

const CHECK_KINDS = [
  'overlap',
  'stranded',
  'empty',
  'unlabelled',
  'unsourced',
  'orphan',
  'presentation',
  'duplicate',
  'outlier',
  'hidden',
] as const;
type CheckKind = (typeof CHECK_KINDS)[number];

interface Problem {
  kind: CheckKind;
  level: 'warn' | 'info';
  /** Items (or, for 'empty' groups and 'orphan' connections, the record) to act on. */
  ids: string[];
  message: string;
}

const MAX_ITEMS = 600;
const OVERLAP_SHARE = 0.25;

const rectOf = (i: Item): Rect => ({ x: i.x, y: i.y, width: i.width, height: i.height });
const centre = (i: Item) => ({ x: i.x + i.width / 2, y: i.y + i.height / 2 });
const name = (i: Item) => `"${clip(itemLabel(i) || i.type, 40)}"`;

/** Every item id held by a container (timeline points, tier rows, tree
 *  nodes, storyboard panels, project tasks, playlists): one walk over every
 *  nested `itemIds` list, so a new container needs no entry here. */
function attachedIds(doc: CanvasDocument): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'itemIds' && Array.isArray(x))
        for (const id of x)
          if (typeof id === 'string') out.add(id);
          else walk(x, depth + 1);
    }
  };
  for (const item of Object.values(doc.items)) walk(item, 0);
  return out;
}

/** A container with nothing in it, by type. */
function emptyContainer(item: Item): string | null {
  const has = (xs: unknown) => Array.isArray(xs) && xs.length > 0;
  const anyIds = (rows: unknown) =>
    Array.isArray(rows) && rows.some((r) => has((r as { itemIds?: unknown }).itemIds));
  const it = item as unknown as Record<string, unknown>;
  switch (item.type) {
    case 'timeline':
      return has(it['points']) || anyIds(it['points']) ? null : 'a timeline with no points';
    case 'tierlist':
      return anyIds(it['rows']) ? null : 'a tier list with nothing placed';
    case 'kanban':
      return anyIds(it['columns']) ? null : 'a kanban board with nothing filed';
    case 'tree':
      return has(it['nodes']) ? null : 'a tree with no nodes';
    case 'storyboard':
      return has(it['panels']) ? null : 'a storyboard with no panels';
    case 'case':
      return has(it['conclusions']) || has(it['evidence'])
        ? null
        : 'a case with no conclusions and no evidence';
    case 'tasklist':
      return has(it['tasks']) ? null : 'a task list with no tasks';
    case 'project':
      return has(it['tasks']) ? null : 'a project with no tasks';
    case 'playlist':
      return has(it['itemIds']) ? null : 'a playlist with nothing in it';
    default:
      return null;
  }
}

function layoutProblems(doc: CanvasDocument, items: Item[], out: Problem[]) {
  const attached = attachedIds(doc);
  const first = doc.pages[0]?.id ?? null;
  const pageOf = (i: Item) => i.pageId ?? first;
  const free = items.filter((i) => !attached.has(i.id) && i.type !== 'shape');
  const shareGroup = (a: Item, b: Item) => {
    if (!a.groupId || !b.groupId) return false;
    const ca = groupChain(doc, a.groupId);
    const cb = new Set(groupChain(doc, b.groupId));
    return ca.some((g) => cb.has(g));
  };
  const seen = new Set<string>();
  const sorted = [...free].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    const ra = rectOf(a);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.x > a.x + a.width) break;
      if (pageOf(a) !== pageOf(b) || shareGroup(a, b)) continue;
      const rb = rectOf(b);
      if (!rectsIntersect(ra, rb)) continue;
      const w = Math.min(ra.x + ra.width, rb.x + rb.width) - Math.max(ra.x, rb.x);
      const h = Math.min(ra.y + ra.height, rb.y + rb.height) - Math.max(ra.y, rb.y);
      const share = (w * h) / Math.max(1, Math.min(ra.width * ra.height, rb.width * rb.height));
      if (share < OVERLAP_SHARE) continue;
      const key = [a.id, b.id].sort().join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: 'overlap',
        level: 'warn',
        ids: [a.id, b.id],
        message: `${name(a)} and ${name(b)} overlap by ${Math.round(share * 100)}% of the smaller one`,
      });
    }
  }
  // Stranded: nearest neighbour far beyond what the board's spacing is.
  if (free.length >= 3) {
    const nearest = free.map((a) => {
      const ca = centre(a);
      let best = Infinity;
      for (const b of free) {
        if (b === a || pageOf(a) !== pageOf(b)) continue;
        const cb = centre(b);
        const d = Math.hypot(ca.x - cb.x, ca.y - cb.y);
        if (d < best) best = d;
      }
      return best;
    });
    const finite = nearest.filter((d) => Number.isFinite(d)).sort((x, y) => x - y);
    const median = finite[Math.floor(finite.length / 2)] ?? 0;
    const far = Math.max(2500, median * 4);
    free.forEach((a, k) => {
      const d = nearest[k]!;
      if (Number.isFinite(d) && d > far)
        out.push({
          kind: 'stranded',
          level: 'warn',
          ids: [a.id],
          message: `${name(a)} sits ${Math.round(d)} units from anything else`,
        });
    });
  }
}

function structureProblems(doc: CanvasDocument, items: Item[], out: Problem[]) {
  const pages = new Set(doc.pages.map((p) => p.id));
  for (const item of items) {
    const why = emptyContainer(item);
    if (why)
      out.push({ kind: 'empty', level: 'warn', ids: [item.id], message: `${name(item)}: ${why}` });
    if (item.status && !item.source?.url)
      out.push({
        kind: 'unsourced',
        level: 'warn',
        ids: [item.id],
        message: `${name(item)} is marked ${item.status} but names no source`,
      });
  }
  for (const item of Object.values(doc.items)) {
    if (item.pageId && pages.size && !pages.has(item.pageId))
      out.push({
        kind: 'orphan',
        level: 'warn',
        ids: [item.id],
        message: `${name(item)} is on a page that no longer exists (${item.pageId})`,
      });
    if (item.hidden)
      out.push({
        kind: 'hidden',
        level: 'info',
        ids: [item.id],
        message: `${name(item)} is hidden`,
      });
  }
  for (const [gid] of Object.entries(doc.groups ?? {})) {
    const members = groupMembers(doc, gid);
    if (members.length < 2)
      out.push({
        kind: 'empty',
        level: 'info',
        ids: [gid],
        message: members.length ? 'a group with a single member' : 'a group with no members',
      });
  }
  const exists = (e: { kind: 'item' | 'group'; id: string }) =>
    e.kind === 'item' ? !!doc.items[e.id] : !!doc.groups?.[e.id];
  for (const c of Object.values(doc.connections ?? {})) {
    if (!exists(c.from) || !exists(c.to)) {
      out.push({
        kind: 'orphan',
        level: 'warn',
        ids: [c.id],
        message: 'a connection whose end was deleted (remove_connection)',
      });
      continue;
    }
    if ((c.rel ?? 'relates') === 'relates' && !c.label) {
      const a = c.from.kind === 'item' ? doc.items[c.from.id] : undefined;
      const b = c.to.kind === 'item' ? doc.items[c.to.id] : undefined;
      out.push({
        kind: 'unlabelled',
        level: 'info',
        ids: [c.id],
        message: `the connection${a && b ? ` from ${name(a)} to ${name(b)}` : ''} says nothing about what it means (edit_connection: rel or label)`,
      });
    }
  }
  for (const step of doc.presentation?.steps ?? []) {
    if (!doc.items[step.id] && !doc.groups?.[step.id])
      out.push({
        kind: 'presentation',
        level: 'warn',
        ids: [step.id],
        message: 'a presentation step points at something that was deleted (set_presentation)',
      });
  }
}

async function meaningProblems(doc: CanvasDocument, items: Item[], out: Problem[]) {
  // The same picture twice is a duplicate whatever its words.
  const byAsset = new Map<string, Item[]>();
  for (const i of items)
    if (i.type === 'image')
      (byAsset.get(i.assetId) ?? byAsset.set(i.assetId, []).get(i.assetId)!).push(i);
  for (const dup of byAsset.values())
    if (dup.length > 1)
      out.push({
        kind: 'duplicate',
        level: 'warn',
        ids: dup.map((i) => i.id),
        message: `the same picture ${dup.length} times`,
      });
  const sim = await import('../search/similarity');
  for (const pair of await sim.duplicatePairs(0.9, 20)) {
    const a = doc.items[pair.a];
    const b = doc.items[pair.b];
    if (!a || !b || (a.type === 'image' && b.type === 'image')) continue;
    out.push({
      kind: 'duplicate',
      level: 'warn',
      ids: [pair.a, pair.b],
      message: `${name(a)} and ${name(b)} say nearly the same thing (${Math.round(pair.score * 100)}%)`,
    });
  }
  for (const o of await sim.outlierItems(3)) {
    const item = doc.items[o.id];
    if (item && o.score < 0.05)
      out.push({
        kind: 'outlier',
        level: 'info',
        ids: [o.id],
        message: `${name(item)} shares little with the rest of the board`,
      });
  }
}

registerBoardTool({
  name: 'check_board',
  description:
    'Look the board over for what an agent cannot see while building, and get back problems with the ids to act on: items overlapping others they are not grouped or shelved with (overlap), items stranded far from everything (stranded), containers and groups with nothing in them (empty), plain connections with no label or relation (unlabelled), cards with an evidence status but no source (unsourced), items on a deleted page and connections to deleted items (orphan), presentation steps pointing at deleted items (presentation), the same picture twice or texts that say nearly the same thing (duplicate), items that share little with the rest in meaning (outlier) and hidden items (hidden). `kinds` narrows it. The board is not changed; fix, then run it again.',
  access: 'read',
  parameters: z.object({
    kinds: z.array(z.enum(CHECK_KINDS)).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  execute: async (args, ctx) => {
    const doc = ctx.doc();
    const want = new Set<CheckKind>(args.kinds ?? CHECK_KINDS);
    const items = Object.values(doc.items)
      .filter((i) => !i.hidden)
      .slice(0, MAX_ITEMS);
    const out: Problem[] = [];
    if (want.has('overlap') || want.has('stranded')) layoutProblems(doc, items, out);
    structureProblems(doc, items, out);
    if (want.has('duplicate') || want.has('outlier')) await meaningProblems(doc, items, out);
    const problems = out
      .filter((p) => want.has(p.kind))
      .sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1))
      .slice(0, args.limit ?? 60);
    const counts: Partial<Record<CheckKind, number>> = {};
    for (const p of problems) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
    return { problems, counts, itemsChecked: items.length, clean: problems.length === 0 };
  },
});
