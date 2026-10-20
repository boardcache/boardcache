import type { CanvasDocument, Item } from '@boardcache/schema';
import { z } from 'zod';
import { onPage } from '../board/pages';
import { groupMembers } from '../canvas/grouping';
import { mediaMeta, orderedItems } from '../mediaItems';
import { useAIStore, type ModelRef } from '../../state/aiStore';
import { streamText } from './streamText';

/**
 * Let the assistant order a board into a presentation. The board is
 * flattened to a numbered outline (items in reading order, then groups with
 * their member numbers, then the connections between them); the model
 * answers with the numbers it would fly to, in order. Everything here except
 * `suggestPresentationOrder` is pure so the outline and the reply parsing
 * can be unit-tested without a model.
 */

interface OutlineEntry {
  id: string;
  kind: 'item' | 'group';
  line: string;
}

export interface BoardOutline {
  entries: OutlineEntry[];
  connections: string[];
}

const EXCERPT = 220;
const MAX_ENTRIES = 220;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The words a reader would see on this item: its own text, then the author's notes. */
function excerpt(item: Item): string {
  const rec = item as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['text', 'description', 'code', 'note', 'url'] as const) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) parts.push(squash(v));
  }
  if (item.notes?.trim()) parts.push(squash(item.notes));
  return clip(parts.join(' · '), EXCERPT);
}

/** Items and groups of one page as numbered lines the model can refer back to. */
export function buildOutline(doc: CanvasDocument, pageId: string | null): BoardOutline {
  const items = orderedItems(doc)
    .filter((it) => !it.hidden && onPage(doc, it, pageId))
    .slice(0, MAX_ENTRIES);
  const index = new Map<string, number>();
  const entries: OutlineEntry[] = [];
  for (const it of items) {
    const i = entries.length;
    index.set(it.id, i);
    const meta = mediaMeta(it);
    const bits = [`[${i}] ${it.type}`, `"${clip(squash(meta.title), 80)}"`];
    if (meta.detail) bits.push(`(${clip(squash(meta.detail), 60)})`);
    bits.push(`at ${Math.round(it.x / 100)},${Math.round(it.y / 100)}`);
    if (it.tags?.length) bits.push(`tags: ${it.tags.slice(0, 6).join(', ')}`);
    if (it.status) bits.push(`status: ${it.status}`);
    const text = excerpt(it);
    if (text) bits.push(`— ${text}`);
    entries.push({ id: it.id, kind: 'item', line: bits.join(' ') });
  }
  for (const g of Object.values(doc.groups)) {
    const members = groupMembers(doc, g.id)
      .map((id) => index.get(id))
      .filter((n): n is number => n !== undefined);
    if (members.length === 0) continue;
    const i = entries.length;
    index.set(g.id, i);
    const name = g.name?.trim() ? `"${clip(squash(g.name), 80)}"` : '(unnamed)';
    entries.push({
      id: g.id,
      kind: 'group',
      line: `[${i}] GROUP ${name} — members ${members.join(', ')}`,
    });
  }
  const connections: string[] = [];
  for (const c of Object.values(doc.connections)) {
    const a = index.get(c.from.id);
    const b = index.get(c.to.id);
    if (a === undefined || b === undefined) continue;
    connections.push(
      `${a} -> ${b} (${c.rel})${c.label?.trim() ? ` "${clip(squash(c.label), 40)}"` : ''}`,
    );
  }
  return { entries, connections };
}

export function buildPresentationPrompt(
  doc: CanvasDocument,
  outline: BoardOutline,
  current: string[],
): string {
  const idx = new Map(outline.entries.map((e, i) => [e.id, i]));
  const draft = current.map((id) => idx.get(id)).filter((n): n is number => n !== undefined);
  return [
    'You are ordering a visual board into a presentation: a sequence of steps the camera flies to one at a time. Each step is one item or one group from the numbered outline below.',
    'Reply with ONE JSON object and nothing else: {"steps": [{"i": <number>, "why": "<= 6 words"}]}',
    'Rules:',
    '- Tell a story: open with whatever introduces the board (a title, a summary, a question), build through the material in a logical order, close on the conclusion or the ask.',
    '- Follow the connections: "causes", "follows" and "cites" point from earlier to later; "supports" and "contradicts" belong right after the claim they answer.',
    '- Use a GROUP as one step when its members belong together; never list both a group and its members.',
    '- Nearby positions (the "at x,y" numbers, in hundreds of pixels) usually mean related material.',
    '- Skip decoration (plain shapes, arrows, stray swatches) unless it carries meaning. Aim for 3–15 steps; small boards may use every item.',
    draft.length > 0
      ? `- The author already drafted this order: ${draft.join(', ')}. Keep its intent — refine, extend or fix it rather than starting over, unless it is clearly wrong.`
      : '',
    '',
    `BOARD "${squash(doc.name)}" — ${outline.entries.length} entries, ${outline.connections.length} connections`,
    'OUTLINE:',
    ...outline.entries.map((e) => e.line),
    outline.connections.length > 0 ? '' : '',
    outline.connections.length > 0 ? 'CONNECTIONS:' : '',
    ...outline.connections,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const replySchema = z.object({
  steps: z.array(z.object({ i: z.number().int(), why: z.string().optional() })),
});

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * The reply as step ids: unknown numbers and repeats dropped, and a member
 * dropped when its group is also a step (the group is the step). Null when
 * nothing usable came back.
 */
export function parsePresentationReply(
  text: string,
  outline: BoardOutline,
  doc: CanvasDocument,
): string[] | null {
  let parsed: z.infer<typeof replySchema>;
  try {
    parsed = replySchema.parse(extractJson(text));
  } catch {
    return null;
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const s of parsed.steps) {
    const e = outline.entries[s.i];
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    ids.push(e.id);
  }
  const out = ids.filter((id) => {
    const it = doc.items[id];
    return !(it?.groupId && seen.has(it.groupId));
  });
  return out.length > 0 ? out.slice(0, 40) : null;
}

/** Ask `model` for an order. Null: nothing to order, or no usable reply. */
export async function suggestPresentationOrder(
  doc: CanvasDocument,
  pageId: string | null,
  model: ModelRef,
  signal?: AbortSignal,
): Promise<string[] | null> {
  const outline = buildOutline(doc, pageId);
  if (outline.entries.length === 0) return null;
  const provider = useAIStore.getState().providers[model.providerId];
  const config = { apiKey: provider.apiKey, model: model.model, baseUrl: provider.baseUrl };
  const current = doc.presentation.steps.map((s) => s.id);
  let text = '';
  for await (const chunk of streamText({
    providerId: model.providerId,
    config,
    prompt: buildPresentationPrompt(doc, outline, current),
    ...(signal ? { signal } : {}),
  })) {
    text += chunk;
  }
  return parsePresentationReply(text, outline, doc);
}
