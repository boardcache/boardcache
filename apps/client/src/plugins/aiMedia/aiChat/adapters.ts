import { z } from 'zod';
import { activeBoardTools, activeLibraryTools } from '../../../lib/tools/registry';
import type { TextProviderId } from '../../../lib/ai/providers';

/**
 * Provider adapters for the tool-calling agent loop. Neutral message/tool
 * shapes in, provider-native request payloads out; provider-native responses
 * back to a neutral AgentTurn. Supported: anthropic, openai/xai
 * (OpenAI-compatible) and ollama (native tools). Google's dialect can follow.
 */

export type AgentProviderId = Extract<
  TextProviderId,
  'anthropic' | 'openai' | 'xai' | 'openrouter' | 'ollama'
>;

export const AGENT_PROVIDERS: AgentProviderId[] = [
  'anthropic',
  'openai',
  'xai',
  'openrouter',
  'ollama',
];

export interface NeutralImage {
  b64: string;
  mime: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

/** Conversation kept in neutral form; adapters translate per request. */
export type NeutralMessage =
  | { role: 'user'; text: string; images?: NeutralImage[] }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[] }
  | { role: 'toolResults'; results: { call: ToolCall; output: string }[] };

export interface AgentTurn {
  text: string;
  toolCalls: ToolCall[];
}

function toolSchemas() {
  return [...activeBoardTools(), ...activeLibraryTools()].map((t) => ({
    name: t.name,
    description: t.description,
    schema: z.toJSONSchema(t.parameters, { io: 'input' }) as Record<string, unknown>,
  }));
}

// --- anthropic -----------------------------------------------------------------

export interface AgentPayloadOpts {
  /** Provider-native web search (Anthropic server tool / xAI live search). */
  webSearch?: boolean;
}

function anthropicBody(
  model: string,
  system: string,
  messages: NeutralMessage[],
  opts: AgentPayloadOpts,
) {
  const out: { role: 'user' | 'assistant'; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const content: unknown[] = (m.images ?? []).map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mime, data: img.b64 },
      }));
      content.push({ type: 'text', text: m.text });
      out.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      const content: unknown[] = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      for (const call of m.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args ?? {} });
      }
      out.push({ role: 'assistant', content });
    } else {
      out.push({
        role: 'user',
        content: m.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.call.id,
          content: r.output,
        })),
      });
    }
  }
  return {
    model,
    max_tokens: 4096,
    system,
    messages: out,
    tools: [
      ...toolSchemas().map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.schema,
      })),
      // Server-side tool: Anthropic runs the searches mid-response and the
      // reply comes back with citations; the parser below ignores the
      // server_tool_use / web_search_tool_result blocks by design.
      ...(opts.webSearch ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }] : []),
    ],
  };
}

function anthropicParse(json: unknown): AgentTurn {
  const data = json as {
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block.type === 'text') text += block.text ?? '';
    if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
    }
  }
  return { text: text.trim(), toolCalls };
}

// --- openai-compatible (openai, xai) ---------------------------------------------

function openaiBody(
  model: string,
  system: string,
  messages: NeutralMessage[],
  opts: AgentPayloadOpts & { live?: boolean },
) {
  const out: unknown[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.images?.length) {
        out.push({
          role: 'user',
          content: [
            ...m.images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mime};base64,${img.b64}` },
            })),
            { type: 'text', text: m.text },
          ],
        });
      } else {
        out.push({ role: 'user', content: m.text });
      }
    } else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.call.id, content: r.output });
      }
    }
  }
  return {
    model,
    messages: out,
    tools: toolSchemas().map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.schema },
    })),
    // xAI Live Search: executed provider-side; results are folded into the
    // reply, so the parser needs no changes.
    ...(opts.webSearch && opts.live ? { search_parameters: { mode: 'auto' } } : {}),
  };
}

function openaiParse(json: unknown): AgentTurn {
  const data = json as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
      };
    }[];
    error?: { message?: string } | string;
  };
  const err = typeof data.error === 'string' ? data.error : data.error?.message;
  if (err) throw new Error(err);
  const msg = data.choices?.[0]?.message;
  const toolCalls: ToolCall[] = [];
  for (const c of msg?.tool_calls ?? []) {
    if (!c.function?.name) continue;
    let args: unknown;
    try {
      args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      args = {};
    }
    toolCalls.push({ id: c.id ?? `call_${toolCalls.length}`, name: c.function.name, args });
  }
  return { text: (msg?.content ?? '').trim(), toolCalls };
}

// --- openai Responses API ---------------------------------------------------------
// GPT-5.x reasoning models reject function tools + reasoning on the legacy
// /v1/chat/completions — the Responses API supports both (and the native
// web_search tool). xAI stays on the chat-completions dialect above.

function responsesBody(
  model: string,
  system: string,
  messages: NeutralMessage[],
  opts: AgentPayloadOpts,
) {
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      input.push({
        role: 'user',
        content: [
          ...(m.images ?? []).map((img) => ({
            type: 'input_image',
            image_url: `data:${img.mime};base64,${img.b64}`,
          })),
          { type: 'input_text', text: m.text },
        ],
      });
    } else if (m.role === 'assistant') {
      if (m.text) {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: m.text }],
        });
      }
      for (const call of m.toolCalls ?? []) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        });
      }
    } else {
      for (const r of m.results) {
        input.push({ type: 'function_call_output', call_id: r.call.id, output: r.output });
      }
    }
  }
  return {
    model,
    instructions: system,
    input,
    // Never persist conversations on OpenAI's side.
    store: false,
    tools: [
      ...toolSchemas().map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.schema,
        strict: false,
      })),
      ...(opts.webSearch ? [{ type: 'web_search' }] : []),
    ],
  };
}

function responsesParse(json: unknown): AgentTurn {
  const data = json as {
    output?: {
      type: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      content?: { type: string; text?: string }[];
    }[];
    error?: { message?: string } | string | null;
  };
  const err = typeof data.error === 'string' ? data.error : data.error?.message;
  if (err) throw new Error(err);
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const item of data.output ?? []) {
    if (item.type === 'message') {
      for (const c of item.content ?? []) if (c.type === 'output_text') text += c.text ?? '';
    } else if (item.type === 'function_call' && item.call_id && item.name) {
      let args: unknown;
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        args = {};
      }
      toolCalls.push({ id: item.call_id, name: item.name, args });
    }
    // reasoning / web_search_call items are server-side bookkeeping — skipped.
  }
  return { text: text.trim(), toolCalls };
}

// --- ollama ----------------------------------------------------------------------

function ollamaBody(model: string, system: string, messages: NeutralMessage[]) {
  const out: unknown[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({
        role: 'user',
        content: m.text,
        ...(m.images?.length ? { images: m.images.map((i) => i.b64) } : {}),
      });
    } else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.text,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                function: { name: c.name, arguments: c.args ?? {} },
              })),
            }
          : {}),
      });
    } else {
      for (const r of m.results) out.push({ role: 'tool', content: r.output });
    }
  }
  return {
    model,
    stream: false,
    messages: out,
    tools: toolSchemas().map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.schema },
    })),
  };
}

function ollamaParse(json: unknown): AgentTurn {
  const data = json as {
    message?: {
      content?: string;
      tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
    };
    error?: string;
  };
  if (data.error) throw new Error(data.error);
  const toolCalls: ToolCall[] = (data.message?.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({
      id: `ollama_${i}`,
      name: c.function!.name!,
      args: c.function!.arguments ?? {},
    }));
  return { text: (data.message?.content ?? '').trim(), toolCalls };
}

// --- dispatch ---------------------------------------------------------------------

export function buildAgentPayload(
  providerId: AgentProviderId,
  model: string,
  system: string,
  messages: NeutralMessage[],
  opts: AgentPayloadOpts = {},
): unknown {
  switch (providerId) {
    case 'anthropic':
      return anthropicBody(model, system, messages, opts);
    case 'openai':
      return responsesBody(model, system, messages, opts);
    case 'xai':
      return openaiBody(model, system, messages, { ...opts, live: true });
    case 'openrouter':
      // Plain chat-completions tools; no provider-native web search here.
      return openaiBody(model, system, messages, { ...opts, webSearch: false });
    case 'ollama':
      return ollamaBody(model, system, messages);
  }
}

export function parseAgentResponse(providerId: AgentProviderId, json: unknown): AgentTurn {
  switch (providerId) {
    case 'anthropic':
      return anthropicParse(json);
    case 'openai':
      return responsesParse(json);
    case 'xai':
    case 'openrouter':
      return openaiParse(json);
    case 'ollama':
      return ollamaParse(json);
  }
}
