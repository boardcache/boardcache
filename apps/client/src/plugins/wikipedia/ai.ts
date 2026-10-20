import { z } from 'zod';
import { streamText } from '../../lib/ai/streamText';
import { defaultModel, useAIStore } from '../../state/aiStore';
import type { WikiArticle } from './wiki';

/**
 * The model's contribution to a Wikipedia board: a fresh summary, a short
 * gist per section (so boxes read as cards, not walls), the dated events
 * worth a timeline, how sections relate to one another, and the facts that
 * matter. Everything is optional — the arranger has a plain fallback for
 * each field, so a malformed reply degrades, never fails.
 */
export interface AiEnrichment {
  summary: string | null;
  gists: Map<number, string>;
  events: { date: string; label: string; detail: string }[];
  relations: { a: number; b: number; rel: RelationKind; label: string }[];
  facts: { key: string; value: string }[] | null;
}

type RelationKind = 'relates' | 'supports' | 'causes' | 'follows' | 'partof' | 'cites';

const replySchema = z.object({
  summary: z.string().optional(),
  sections: z.array(z.object({ i: z.number().int(), gist: z.string() })).optional(),
  events: z
    .array(z.object({ date: z.string(), label: z.string(), detail: z.string().optional() }))
    .optional(),
  relations: z
    .array(
      z.object({
        a: z.number().int(),
        b: z.number().int(),
        rel: z
          .enum(['relates', 'supports', 'causes', 'follows', 'partof', 'cites'])
          .catch('relates'),
        label: z.string().optional(),
      }),
    )
    .optional(),
  facts: z.array(z.object({ k: z.string(), v: z.string() })).optional(),
});

/** True when a model is configured (hosted or the user's own). */
export function aiAvailable(): boolean {
  return defaultModel() !== null;
}

const SECTION_BUDGET = 1400;
const TOTAL_BUDGET = 26_000;

function buildPrompt(article: WikiArticle): string {
  let used = 0;
  const outline = article.sections
    .map((s, i) => {
      const body = s.text.length > SECTION_BUDGET ? `${s.text.slice(0, SECTION_BUDGET)}…` : s.text;
      if (used + body.length > TOTAL_BUDGET) return `[${i}] ${s.heading}\n(omitted)`;
      used += body.length;
      return `[${i}] ${s.heading}\n${body}`;
    })
    .join('\n\n');
  return [
    'You are helping turn a Wikipedia article into a visual research board: a summary card, one card per section, a timeline of dated events, and connecting lines between related sections.',
    'Reply with ONE JSON object and nothing else, using exactly these keys:',
    '{"summary": "2-3 plain sentences that say what this is and why it matters",',
    ' "sections": [{"i": <section index>, "gist": "<= 70 words, plain prose, keep the concrete names, numbers and dates"}],',
    ' "events": [{"date": "YYYY or YYYY-MM-DD", "label": "<= 8 words", "detail": "one sentence"}]  (only genuinely dated milestones from the text, 0-10 of them, chronological),',
    ' "relations": [{"a": <index>, "b": <index>, "rel": "causes|supports|follows|partof|relates|cites", "label": "<= 4 words"}]  (3-8 meaningful links between DIFFERENT sections; skip trivial adjacency),',
    ' "facts": [{"k": "…", "v": "…"}]  (up to 8 key facts a reader should know; omit if the article has no clear facts)}',
    'Use only what the article says. No markdown, no commentary outside the JSON.',
    '',
    `TITLE: ${article.title}`,
    article.description ? `DESCRIPTION: ${article.description}` : '',
    `LEAD: ${article.lead.slice(0, 2000)}`,
    '',
    'SECTIONS:',
    outline,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(start, end + 1));
}

export async function enrichWithAI(
  article: WikiArticle,
  signal?: AbortSignal,
): Promise<AiEnrichment | null> {
  const model = defaultModel();
  if (!model) return null;
  const provider = useAIStore.getState().providers[model.providerId];
  const config = { apiKey: provider.apiKey, model: model.model, baseUrl: provider.baseUrl };
  let text = '';
  for await (const chunk of streamText({
    providerId: model.providerId,
    config,
    prompt: buildPrompt(article),
    ...(signal ? { signal } : {}),
  })) {
    text += chunk;
  }
  let parsed: z.infer<typeof replySchema>;
  try {
    parsed = replySchema.parse(extractJson(text));
  } catch {
    return null;
  }
  const n = article.sections.length;
  const gists = new Map<number, string>();
  for (const s of parsed.sections ?? []) {
    if (s.i >= 0 && s.i < n && s.gist.trim()) gists.set(s.i, s.gist.trim());
  }
  const relations = (parsed.relations ?? []).filter(
    (r) => r.a !== r.b && r.a >= 0 && r.b >= 0 && r.a < n && r.b < n,
  );
  return {
    summary: parsed.summary?.trim() || null,
    gists,
    events: (parsed.events ?? [])
      .filter((e) => /^\d{4}/.test(e.date) && e.label.trim())
      .map((e) => ({ date: e.date, label: e.label.trim(), detail: e.detail?.trim() ?? '' })),
    relations: relations.map((r) => ({ a: r.a, b: r.b, rel: r.rel, label: r.label?.trim() ?? '' })),
    facts: parsed.facts?.length
      ? parsed.facts.map((f) => ({ key: f.k.trim(), value: f.v.trim() })).filter((f) => f.key)
      : null,
  };
}
