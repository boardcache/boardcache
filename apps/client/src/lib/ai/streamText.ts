import { apiUrl } from '../sync/apiBase';
import { platform } from '../platform';
import type { ProviderConfig, TextProviderId } from './providers';

/**
 * Text streaming across providers. Each provider speaks a slightly different
 * wire format; the per-provider `*Delta` helpers are pure (parsed JSON → text
 * chunk) so they're easy to unit test, and `streamText` wires them to fetch.
 *
 * Cloud providers (OpenAI/Anthropic/Google) reject direct browser calls (no
 * CORS), so they go through our same-origin `/api/ai/chat` proxy, which forwards
 * the native SSE back unchanged — the parsing here is identical either way.
 * Ollama is a direct browser call to the user's own endpoint (configure
 * OLLAMA_ORIGINS / CORS to permit this origin).
 */

export interface StreamTextOptions {
  providerId: TextProviderId;
  config: ProviderConfig;
  prompt: string;
  /** Vision attachment (raw base64) — the proxy wraps it per provider. */
  image?: { mime: string; data: string };
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

// --- pure delta extractors (one parsed message → its text chunk) -------------

type Json = Record<string, unknown>;

export function openaiDelta(msg: Json): string {
  const choice = (msg.choices as Json[] | undefined)?.[0];
  const delta = choice?.delta as Json | undefined;
  return typeof delta?.content === 'string' ? delta.content : '';
}

export function anthropicDelta(msg: Json): string {
  if (msg.type !== 'content_block_delta') return '';
  const delta = msg.delta as Json | undefined;
  return delta?.type === 'text_delta' && typeof delta.text === 'string' ? delta.text : '';
}

export function googleDelta(msg: Json): string {
  const candidate = (msg.candidates as Json[] | undefined)?.[0];
  const parts = (candidate?.content as Json | undefined)?.parts as Json[] | undefined;
  return (parts ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
}

export function ollamaDelta(msg: Json): string {
  const message = msg.message as Json | undefined;
  if (typeof message?.content === 'string') return message.content;
  return typeof msg.response === 'string' ? msg.response : '';
}

// --- low-level stream readers ------------------------------------------------

async function* readChunks(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/** Yield the `data:` payloads of an SSE stream (concatenated multi-line data). */
async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  let buffer = '';
  for await (const chunk of readChunks(body, signal)) {
    buffer += chunk.replace(/\r\n/g, '\n'); // normalize CRLF → LF
    let idx: number;
    // Events are separated by a blank line.
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = rawEvent
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) yield data;
    }
  }
}

/** Yield complete newline-delimited lines (for NDJSON). */
async function* readLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  let buffer = '';
  for await (const chunk of readChunks(body, signal)) {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

// --- request building --------------------------------------------------------

function buildRequest(
  providerId: TextProviderId,
  config: ProviderConfig,
  prompt: string,
  image?: { mime: string; data: string },
): {
  url: string;
  init: RequestInit;
} {
  // Every provider goes through the same-origin proxy (browsers can't reach the
  // cloud APIs or a self-hosted Ollama directly because of CORS). The proxy
  // forwards the native stream back unchanged; Ollama speaks NDJSON, the rest
  // SSE. 'hosted' sends no key or model — the server injects its own and
  // reports the actual upstream dialect in an X-Hosted-Provider header.
  return {
    url: apiUrl('/api/ai/chat'),
    init: {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        providerId === 'hosted'
          ? { providerId, prompt, ...(image ? { image } : {}) }
          : {
              providerId,
              apiKey: config.apiKey,
              model: config.model,
              prompt,
              baseUrl: config.baseUrl, // ollama only; cloud endpoints are fixed
              ...(image ? { image } : {}),
            },
      ),
    },
  };
}

function deltaFor(providerId: Exclude<TextProviderId, 'hosted'>): (msg: Json) => string {
  switch (providerId) {
    case 'openai':
    case 'xai': // xAI is OpenAI-compatible
    case 'openrouter': // so is OpenRouter
      return openaiDelta;
    case 'anthropic':
      return anthropicDelta;
    case 'google':
      return googleDelta;
    case 'ollama':
      return ollamaDelta;
  }
}

const UPSTREAMS = ['openai', 'anthropic', 'google', 'xai', 'openrouter', 'ollama'] as const;

/** The dialect to parse: hosted resolves via the response header. */
function effectiveProvider(
  providerId: TextProviderId,
  res: Response,
): Exclude<TextProviderId, 'hosted'> {
  if (providerId !== 'hosted') return providerId;
  const h = res.headers.get('x-hosted-provider') ?? '';
  return (UPSTREAMS as readonly string[]).includes(h)
    ? (h as Exclude<TextProviderId, 'hosted'>)
    : 'anthropic';
}

// --- public API --------------------------------------------------------------

export async function* streamText(opts: StreamTextOptions): AsyncGenerator<string> {
  const { providerId, config, prompt, signal } = opts;
  const { url, init } = buildRequest(providerId, config, prompt, opts.image);
  const finalInit = signal ? { ...init, signal } : init;
  const res = opts.fetchImpl
    ? await opts.fetchImpl(url, finalInit)
    : await platform.aiChat(finalInit);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `${providerId} request failed (${res.status})${detail ? `: ${truncate(detail)}` : ''}`,
    );
  }
  if (!res.body) throw new Error(`${providerId} returned no response body`);

  const upstream = effectiveProvider(providerId, res);
  const transport = upstream === 'ollama' ? 'ndjson' : 'sse';
  const extract = deltaFor(upstream);

  if (transport === 'sse') {
    for await (const data of readSSE(res.body, signal)) {
      if (data === '[DONE]') return;
      let msg: Json;
      try {
        msg = JSON.parse(data) as Json;
      } catch {
        continue; // ignore keep-alives / partial frames
      }
      if (msg.type === 'error' || msg.error) throw new Error(errorText(msg));
      const text = extract(msg);
      if (text) yield text;
    }
  } else {
    for await (const line of readLines(res.body, signal)) {
      let msg: Json;
      try {
        msg = JSON.parse(line) as Json;
      } catch {
        continue;
      }
      if (msg.error) throw new Error(errorText(msg));
      const text = extract(msg);
      if (text) yield text;
      if (msg.done === true) return;
    }
  }
}

function errorText(msg: Json): string {
  const err = msg.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && typeof (err as Json).message === 'string') {
    return (err as Json).message as string;
  }
  return 'provider error';
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
