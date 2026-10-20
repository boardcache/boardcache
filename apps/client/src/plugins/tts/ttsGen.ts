import { newId } from '@boardcache/schema';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { importAudioFiles } from '../../lib/import/importAudio';
import { platform } from '../../lib/platform';
import { useSessionStore } from '../../state/sessionStore';
import { getPluginSettings, usePluginSettings } from '../settingsStore';

/**
 * Text-to-speech generation. Provider keys/URLs live in the plugin's settings
 * (synced encrypted). Generated audio imports through the normal audio
 * pipeline — an ordinary audio item on the canvas.
 */

export type TtsProviderId = 'elevenlabs' | 'sglang-omni' | 'chatterbox';

export interface TtsProviderMeta {
  id: TtsProviderId;
  label: string;
  needsUrl: boolean;
  needsKey: boolean;
  urlHint?: string;
  keyHint?: string;
  /** Creates a persistent named voice (ElevenLabs); others clone zero-shot. */
  persistentClone: boolean;
  /** Accepts a per-request reference clip for zero-shot cloning. */
  referenceClone: boolean;
}

export const TTS_PROVIDERS: TtsProviderMeta[] = [
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    needsUrl: false,
    needsKey: true,
    keyHint: 'elevenlabs.io → Profile → API key',
    persistentClone: true,
    referenceClone: false,
  },
  {
    id: 'sglang-omni',
    label: 'SGLang-Omni',
    needsUrl: true,
    needsKey: false,
    urlHint: 'http://host:30000',
    persistentClone: false,
    referenceClone: true,
  },
  {
    id: 'chatterbox',
    label: 'Chatterbox',
    needsUrl: true,
    needsKey: false,
    urlHint: 'http://host:4123',
    persistentClone: false,
    referenceClone: true,
  },
];

export function ttsProviderMeta(id: TtsProviderId): TtsProviderMeta {
  return TTS_PROVIDERS.find((p) => p.id === id)!;
}

interface TtsProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}
interface TtsSettings {
  providers?: Partial<Record<TtsProviderId, TtsProviderConfig>>;
}

export function providerConfig(id: TtsProviderId): TtsProviderConfig {
  return getPluginSettings<TtsSettings>('tts')?.providers?.[id] ?? {};
}
export function setProviderConfig(id: TtsProviderId, patch: TtsProviderConfig): void {
  const cur = getPluginSettings<TtsSettings>('tts') ?? {};
  const providers = { ...(cur.providers ?? {}) };
  providers[id] = { ...providers[id], ...patch };
  usePluginSettings.getState().set('tts', { ...cur, providers });
}

/** A provider is usable once its required key/URL are present. */
export function providerReady(id: TtsProviderId): boolean {
  const meta = ttsProviderMeta(id);
  const cfg = providerConfig(id);
  if (meta.needsKey && !cfg.apiKey?.trim()) return false;
  if (meta.needsUrl && !cfg.baseUrl?.trim()) return false;
  return true;
}
export function anyProviderReady(): boolean {
  return TTS_PROVIDERS.some((p) => providerReady(p.id));
}

function baseBody(id: TtsProviderId) {
  const cfg = providerConfig(id);
  return { providerId: id, apiKey: cfg.apiKey ?? '', baseUrl: cfg.baseUrl ?? '' };
}

async function errText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed (${res.status}).`;
}

async function fileToB64(file: Blob): Promise<{ b64: string; mime: string }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
  return { b64: btoa(bin), mime: file.type || 'audio/wav' };
}

export async function fetchVoices(id: TtsProviderId): Promise<{ id: string; name: string }[]> {
  const res = await platform.ttsVoices({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(baseBody(id)),
  });
  if (!res.ok) throw new Error(await errText(res));
  return ((await res.json()) as { voices: { id: string; name: string }[] }).voices;
}

export async function fetchModels(id: TtsProviderId): Promise<string[]> {
  const res = await platform.ttsModels({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(baseBody(id)),
  });
  if (!res.ok) throw new Error(await errText(res));
  return ((await res.json()) as { models: string[] }).models;
}

/** ElevenLabs persistent clone → new voice id. */
export async function cloneVoice(
  id: TtsProviderId,
  name: string,
  samples: Blob[],
): Promise<string> {
  const encoded = await Promise.all(samples.map(fileToB64));
  const res = await platform.ttsClone({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ...baseBody(id), name, samples: encoded }),
  });
  if (!res.ok) throw new Error(await errText(res));
  return ((await res.json()) as { voiceId: string }).voiceId;
}

export interface SpeakOptions {
  provider: TtsProviderId;
  model: string;
  voice: string;
  text: string;
  /** Provider-specific synthesis knobs (stability, temperature, speed). */
  params?: Record<string, number | boolean>;
  /** Zero-shot reference clip (chatterbox / sglang-omni). */
  reference?: Blob;
}

async function synthesize(opts: SpeakOptions): Promise<Blob> {
  const reference = opts.reference ? await fileToB64(opts.reference) : undefined;
  const res = await platform.ttsSpeak({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      ...baseBody(opts.provider),
      model: opts.model,
      voice: opts.voice,
      text: opts.text,
      ...(opts.params ? { params: opts.params } : {}),
      ...(reference ? { reference } : {}),
    }),
  });
  if (!res.ok) throw new Error(await errText(res));
  const data = (await res.json()) as { audio: string; mime: string };
  const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: data.mime || 'audio/mpeg' });
}

/**
 * Fire-and-forget speech generation: a canvas placeholder now, an audio item
 * when the clip is ready (error shown in place on failure).
 */
export function speakInBackground(opts: SpeakOptions): void {
  const at = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const dims = { width: 300, height: 120 };
  const id = newId();
  const session = useSessionStore.getState();
  const label = opts.text.replace(/\s+/g, ' ').trim().slice(0, 40) || 'speech';
  session.addPendingImport({
    id,
    x: at.x - dims.width / 2,
    y: at.y - dims.height / 2,
    width: dims.width,
    height: dims.height,
    label: 'Generating speech',
    name: label,
  });

  void synthesize(opts)
    .then(async (blob) => {
      const pending = useSessionStore.getState().pendingImports.find((p) => p.id === id);
      const center = pending
        ? { x: pending.x + pending.width / 2, y: pending.y + pending.height / 2 }
        : at;
      useSessionStore.getState().removePendingImport(id);
      const ext = blob.type.includes('mpeg') || blob.type.includes('mp3') ? 'mp3' : 'wav';
      const file = new File([blob], `${label}.${ext}`, { type: blob.type });
      await importAudioFiles([file], center);
    })
    .catch((err) => {
      const s = useSessionStore.getState();
      s.updatePendingImport(id, {
        label: err instanceof Error ? err.message : 'Generation failed.',
        error: true,
      });
      setTimeout(() => useSessionStore.getState().removePendingImport(id), 9000);
    });
}
