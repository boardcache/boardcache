/**
 * AI provider registry. The single source of truth for which text-generation
 * providers exist and their defaults. Image/video providers will live in
 * parallel registries (IMAGE_PROVIDERS, …) once text generation is solid.
 */

export type TextProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'openrouter'
  | 'ollama'
  | 'hosted';

/** Per-provider, user-editable configuration (persisted in aiStore). */
export interface ProviderConfig {
  apiKey: string;
  model: string;
  /** Ollama endpoint override; ignored for cloud providers (fixed endpoints). */
  baseUrl?: string;
}

export interface TextProviderMeta {
  id: TextProviderId;
  label: string;
  defaultModel: string;
  /** Local providers (Ollama) need no API key. */
  keyless?: boolean;
  /** Providers (Ollama) that expose a configurable instance URL. */
  hasUrl?: boolean;
  /** Hint shown under the API-key field. */
  keyHint?: string;
}

export const TEXT_PROVIDERS: TextProviderMeta[] = [
  {
    // Server-billed AI: no key, no model picking — the server decides which
    // provider it pays for. Only offered when the server reports it enabled.
    id: 'hosted',
    label: 'boardCache Cloud',
    defaultModel: 'included',
    keyless: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    keyHint: 'platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-3-5-sonnet-latest',
    keyHint: 'console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    keyHint: 'aistudio.google.com/apikey',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    defaultModel: 'grok-2-latest',
    keyHint: 'console.x.ai',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'qwen/qwen3-235b-a22b',
    keyHint: 'openrouter.ai/keys · one key for Qwen, GLM, DeepSeek, Llama, Mistral and more',
  },
  {
    id: 'ollama',
    hasUrl: true,
    label: 'Ollama (local)',
    defaultModel: 'llama3.2',
    keyless: true,
    keyHint: 'Your Ollama instance URL. Leave blank to use the server default.',
  },
];

export const TEXT_PROVIDER_IDS = TEXT_PROVIDERS.map((p) => p.id);

export function textProviderMeta(id: TextProviderId): TextProviderMeta {
  const meta = TEXT_PROVIDERS.find((p) => p.id === id);
  if (!meta) throw new Error(`Unknown text provider: ${id}`);
  return meta;
}
