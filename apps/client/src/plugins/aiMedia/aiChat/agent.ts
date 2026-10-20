import { platform } from '../../../lib/platform';
import { tally } from '../../../lib/usageTally';
import { runBoardTool, runToolTurn } from '../../../lib/tools/registry';
import { useAIStore } from '../../../state/aiStore';
import { buildAgentPayload, parseAgentResponse } from './adapters';
import type { AgentProviderId, NeutralMessage, ToolCall } from './adapters';
import { buildSystemPrompt, selectedImagePixels } from './context';
import { RESEARCH_PIPELINE } from './researchPrompt';

/**
 * The agent loop: send conversation + tool schemas → provider; execute any
 * tool calls locally through the Board Tool Registry; feed results back;
 * repeat until the model answers in text (or the iteration cap). The whole
 * user turn is one undo step ("AI: …").
 */

const MAX_ITERATIONS = 12;
// Deep-research runs legitimately take many more tool rounds (search, read,
// build, weave) — still finite so a confused model can't loop forever.
const MAX_RESEARCH_ITERATIONS = 48;

type AgentEvent =
  | { type: 'status'; label: string }
  | { type: 'tool'; call: ToolCall; ok: boolean; summary: string }
  /** sources: item ids whose CONTENT the model actually read this turn
   *  (get_items / get_selection / search_board) — the deterministic half of
   *  the citations UI. */
  | { type: 'text'; text: string; sources?: string[] };

export interface AgentTurnOptions {
  providerId: AgentProviderId | 'hosted';
  model: string;
  /** Prior conversation (neutral form); the loop appends to a copy. */
  history: NeutralMessage[];
  userText: string;
  /** Item ids the user @-tagged in this message (full detail rides along). */
  mentionIds?: string[];
  /** Per-item chats: this item's full detail rides in every round's system
   *  prompt (live) and its pixels go along when it's an image. */
  focusItemId?: string;
  signal?: AbortSignal;
  /** Deep-research mode: raised round budget + the pipeline system prompt. */
  research?: boolean;
  /** Think harder: hosted rounds go to the frontier model (its own price). */
  deep?: boolean;
  onEvent: (event: AgentEvent) => void;
}

/** Compact, provider-agnostic result string for a tool call. */
function resultText(outcome: Awaited<ReturnType<typeof runBoardTool>>): string {
  return JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error });
}

function summarize(call: ToolCall, ok: boolean): string {
  const pretty = call.name.replace(/_/g, ' ');
  return ok ? pretty : `${pretty} — failed`;
}

/** Runs one user turn. Returns the updated history (including the reply). */
export async function runAgentTurn(opts: AgentTurnOptions): Promise<NeutralMessage[]> {
  const { providerId, model, userText, signal, onEvent } = opts;
  // Hosted: the server injects its own key and model; we only need to know
  // the upstream dialect to build/parse provider-native payloads.
  const hosted = providerId === 'hosted';
  const hostedOps = useAIStore.getState().hosted?.ops;
  const deep = hosted && opts.deep === true && Boolean(hostedOps?.deep);
  const hostedOp = deep ? hostedOps?.deep : hostedOps?.agent;
  const dialect: AgentProviderId = hosted
    ? ((hostedOp?.provider ?? 'anthropic') as AgentProviderId)
    : providerId;
  const provider = hosted ? undefined : useAIStore.getState().providers[providerId];
  const apiKey = provider?.apiKey ?? '';
  const baseUrl = provider?.baseUrl ?? '';

  tally(
    opts.research
      ? 'assistant.research'
      : deep
        ? 'assistant.deep'
        : hosted
          ? 'assistant.hosted'
          : 'assistant.byo',
  );
  onEvent({ type: 'status', label: 'Reading the board' });
  // Ground-truth citation record: every item whose content reached the model.
  const sourceIds = new Set<string>();
  const collectSources = (
    name: string,
    outcome: Awaited<ReturnType<typeof runBoardTool>>,
  ): void => {
    if (!outcome.ok) return;
    const r = outcome.result as {
      items?: { id?: unknown }[];
      hits?: { id?: unknown }[];
    } | null;
    if (name === 'get_items' || name === 'get_selection') {
      for (const it of r?.items ?? []) if (typeof it?.id === 'string') sourceIds.add(it.id);
    } else if (name === 'search_board') {
      for (const h of r?.hits ?? []) if (typeof h?.id === 'string') sourceIds.add(h.id);
    }
  };
  const mentionIds = [...(opts.mentionIds ?? [])];
  if (opts.focusItemId && !mentionIds.includes(opts.focusItemId)) {
    mentionIds.push(opts.focusItemId);
  }
  const images = await selectedImagePixels(mentionIds);
  let text = userText;
  if (mentionIds.length) {
    const detail = await runBoardTool('get_items', { ids: mentionIds });
    collectSources('get_items', detail);
    if (detail.ok) {
      text += `\n\n[Items the user @-tagged, full detail: ${JSON.stringify(detail.result)}]`;
    }
  }
  const messages: NeutralMessage[] = [
    ...opts.history,
    { role: 'user', text, ...(images.length ? { images } : {}) },
  ];

  const label = `AI: ${userText.replace(/\s+/g, ' ').slice(0, 60)}`;
  await runToolTurn(label, async () => {
    const cap = opts.research ? MAX_RESEARCH_ITERATIONS : MAX_ITERATIONS;
    for (let i = 0; i < cap; i++) {
      if (signal?.aborted) throw new Error('Stopped.');
      onEvent({
        type: 'status',
        label: i === 0 ? (deep ? 'Thinking harder' : 'Thinking') : 'Working',
      });

      // The system prompt is rebuilt each round so the model always sees the
      // LIVE board (its own edits included).
      const tier = !hosted ? null : deep ? 'deep' : hostedOps?.deep ? 'fast' : null;
      const system =
        (await buildSystemPrompt(opts.focusItemId, tier)) +
        (opts.research ? RESEARCH_PIPELINE : '');
      // Provider-native web research: BYO keys only (hosted searches would
      // bill our account), enabled by the AI-settings toggle.
      const webSearch = !hosted && useAIStore.getState().webResearch === true;
      const payload = buildAgentPayload(
        dialect,
        hosted ? (hostedOp?.model ?? '') : model,
        system,
        messages,
        { webSearch },
      );
      const res = await platform.aiAgent({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
        body: JSON.stringify({ providerId, apiKey, baseUrl, payload, ...(deep ? { deep } : {}) }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (json as { error?: { message?: string } | string } | null)?.error;
        const msg =
          typeof err === 'string' ? err : (err?.message ?? `Request failed (${res.status}).`);
        throw new Error(msg);
      }
      const turn = parseAgentResponse(dialect, json);

      if (turn.toolCalls.length === 0) {
        messages.push({ role: 'assistant', text: turn.text || '(no reply)' });
        onEvent({
          type: 'text',
          text: turn.text || '(no reply)',
          ...(sourceIds.size ? { sources: [...sourceIds] } : {}),
        });
        return;
      }

      messages.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls });
      const results: { call: ToolCall; output: string }[] = [];
      for (const call of turn.toolCalls) {
        if (signal?.aborted) throw new Error('Stopped.');
        const outcome = await runBoardTool(call.name, call.args);
        collectSources(call.name, outcome);
        onEvent({ type: 'tool', call, ok: outcome.ok, summary: summarize(call, outcome.ok) });
        results.push({ call, output: resultText(outcome) });
      }
      messages.push({ role: 'toolResults', results });
    }
    const capNote = 'Stopped after the maximum number of tool rounds.';
    messages.push({ role: 'assistant', text: capNote });
    onEvent({ type: 'text', text: capNote });
  });

  return messages;
}
