import { platform } from '../platform';
import type { TextProviderId } from './providers';

/**
 * Ask the server proxy for a provider's available models (which also validates
 * the API key). Throws with a friendly message on an invalid key / unreachable
 * provider.
 */
export async function fetchProviderModels(
  providerId: TextProviderId,
  apiKey: string,
  baseUrl: string,
): Promise<string[]> {
  const res = await platform.aiModels({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, apiKey, baseUrl }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `Request failed (${res.status})`);
  }
  const data = (await res.json()) as { models?: string[] };
  return data.models ?? [];
}
