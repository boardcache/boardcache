import { newId } from '@boardcache/schema';
import type { GenInfo } from '@boardcache/schema';
import { getAssetBlob } from '../../lib/board/assetStore';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { importImageFiles } from '../../lib/import/importImages';
import { importVideoFiles } from '../../lib/import/importVideos';
import { platform } from '../../lib/platform';
import { useAIStore } from '../../state/aiStore';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import type { TextProviderId } from '../../lib/ai/providers';

/**
 * AI image + video generation. Provider keys are the same ones the AI text
 * feature stores (aiStore), so a key entered once works everywhere. Generated
 * media is imported through the normal image/video pipelines — the board just
 * gets ordinary assets (renditions, exports, sync all apply).
 */

export type MediaProviderId = Extract<TextProviderId, 'openai' | 'google' | 'xai' | 'hosted'>;

export interface MediaProviderMeta {
  provider: MediaProviderId;
  providerLabel: string;
  /** Pre-filled default model id. */
  defaultModel: string;
  /** Datalist suggestions — provider model ids churn, so the field is editable. */
  suggestedModels: string[];
  /** Output sizes the model accepts (first is default). */
  sizes: string[];
}

/**
 * Image providers. Model ids are provider-versioned and change often, so the
 * dialog shows an EDITABLE model field seeded with these suggestions — no more
 * hard dependence on one id that a given key may not have.
 */
export const IMAGE_PROVIDERS: MediaProviderMeta[] = [
  {
    provider: 'openai',
    providerLabel: 'OpenAI',
    defaultModel: 'gpt-image-1',
    suggestedModels: ['gpt-image-1', 'dall-e-3'],
    sizes: ['1024x1024', '1536x1024', '1024x1536'],
  },
  {
    provider: 'google',
    providerLabel: 'Google',
    defaultModel: 'gemini-2.0-flash-preview-image-generation',
    suggestedModels: [
      'gemini-2.0-flash-preview-image-generation',
      'gemini-2.0-flash-exp-image-generation',
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-image-preview',
    ],
    sizes: ['1024x1024'],
  },
  {
    provider: 'xai',
    providerLabel: 'xAI',
    defaultModel: 'grok-2-image',
    suggestedModels: ['grok-2-image'],
    sizes: ['1024x1024'],
  },
];

export const VIDEO_PROVIDERS: MediaProviderMeta[] = [
  {
    provider: 'xai',
    providerLabel: 'xAI',
    defaultModel: 'grok-video-1',
    suggestedModels: ['grok-video-1'],
    sizes: [],
  },
  {
    provider: 'google',
    providerLabel: 'Google',
    defaultModel: 'veo-3.0-generate-001',
    suggestedModels: ['veo-3.0-generate-001', 'veo-3.0-fast-generate-001', 'veo-2.0-generate-001'],
    sizes: [],
  },
];

/** A source image for image-to-image / image-to-video (base64, no prefix). */
export interface SourceImage {
  b64: string;
  mime: string;
}

const SOURCE_MAX_EDGE = 1536;

/** An image item's pixels as provider-ready base64 (downscaled to ≤1536). */
export async function itemSourceImage(itemId: string): Promise<SourceImage> {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || item.type !== 'image')
    throw new Error(`"${itemId}" is not an image item on this board.`);
  const blob = await getAssetBlob(item.assetId);
  if (!blob) throw new Error('The source image asset is unavailable.');
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, SOURCE_MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  // PNG keeps alpha (source may be a cutout); JPEG for everything else.
  const mime = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, 0.92));
  if (!out) throw new Error('Could not read the source image pixels.');
  const buf = new Uint8Array(await out.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK)
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return { b64: btoa(bin), mime };
}

/** The stored API key for a media provider (shared with AI text settings). */
export function providerKey(provider: MediaProviderId): string {
  return useAIStore.getState().providers[provider]?.apiKey.trim() ?? '';
}

/**
 * Hosted image generation as a synthetic provider entry: no key, server-billed
 * credits, model fixed server-side. Sizes mirror the actual upstream provider.
 */
export function hostedImageMeta(): MediaProviderMeta | null {
  const h = useAIStore.getState().hosted;
  if (!h?.enabled || h.credits === null || !h.ops.image) return null;
  const upstream = IMAGE_PROVIDERS.find((m) => m.provider === h.ops.image!.provider);
  return {
    provider: 'hosted',
    providerLabel: 'boardCache Cloud',
    defaultModel: h.ops.image.model,
    suggestedModels: [h.ops.image.model],
    sizes: upstream?.sizes ?? ['1024x1024'],
  };
}

/** Fetch which of the user's models can generate images/video (their key's
 *  actual catalog — no hardcoded ids). */
export async function fetchMediaModels(
  provider: MediaProviderId,
  kind: 'image' | 'video',
): Promise<string[]> {
  if (provider === 'hosted') {
    return [hostedImageMeta()?.defaultModel ?? 'included']; // fixed server-side
  }
  const apiKey = providerKey(provider);
  if (!apiKey) return [];
  const res = await platform.aiMediaModels({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ providerId: provider, apiKey, kind }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const data = (await res.json()) as { models: string[] };
  return data.models;
}

/** Remember the last model id the user typed per provider+kind. */
const MODEL_PREF = 'boardcache:aiMediaModels';
export function loadModelPref(key: string, fallback: string): string {
  try {
    const map = JSON.parse(localStorage.getItem(MODEL_PREF) ?? '{}') as Record<string, string>;
    return map[key] || fallback;
  } catch {
    return fallback;
  }
}
export function saveModelPref(key: string, model: string): void {
  try {
    const map = JSON.parse(localStorage.getItem(MODEL_PREF) ?? '{}') as Record<string, string>;
    map[key] = model;
    localStorage.setItem(MODEL_PREF, JSON.stringify(map));
  } catch {
    /* storage unavailable */
  }
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Generation failed (${res.status}).`;
}

/** Generate `n` images as Files (the caller decides placement). */
async function fetchGeneratedImages(
  meta: MediaProviderMeta,
  model: string,
  prompt: string,
  size: string,
  n: number,
  source?: SourceImage,
): Promise<File[]> {
  const hosted = meta.provider === 'hosted';
  const apiKey = hosted ? '' : providerKey(meta.provider);
  if (!hosted && !apiKey) {
    throw new Error(`Add your ${meta.providerLabel} API key in the plugin settings.`);
  }

  const res = await platform.aiImage({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      providerId: meta.provider,
      apiKey,
      model,
      prompt,
      size,
      n,
      ...(source ? { sourceB64: source.b64, sourceMime: source.mime } : {}),
    }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const data = (await res.json()) as { images: { b64: string; mime: string }[] };

  const shortPrompt =
    prompt
      .replace(/[/\\:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 48) || 'image';
  return data.images.map((img, i) => {
    const ext = img.mime.includes('jpeg') ? 'jpg' : 'png';
    return new File(
      [b64ToBlob(img.b64, img.mime)],
      `${shortPrompt}${data.images.length > 1 ? ` ${i + 1}` : ''}.${ext}`,
      {
        type: img.mime,
      },
    );
  });
}

const VIDEO_POLL_MS = 4000;
const VIDEO_TIMEOUT_MS = 5 * 60_000;

/** Start a video job, poll until done, import the result. Returns the item id. */
async function generateVideo(
  meta: MediaProviderMeta,
  model: string,
  prompt: string,
  onStatus?: (label: string) => void,
  source?: SourceImage,
): Promise<File> {
  const apiKey = providerKey(meta.provider);
  if (!apiKey) throw new Error(`Add your ${meta.providerLabel} API key in the plugin settings.`);

  onStatus?.('Submitting');
  const startRes = await platform.aiVideo({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      providerId: meta.provider,
      apiKey,
      model,
      prompt,
      ...(source ? { sourceB64: source.b64, sourceMime: source.mime } : {}),
    }),
  });
  if (!startRes.ok) throw new Error(await errorText(startRes));
  const { jobId } = (await startRes.json()) as { jobId: string };

  const deadline = Date.now() + VIDEO_TIMEOUT_MS;
  onStatus?.('Generating');
  for (;;) {
    if (Date.now() > deadline) throw new Error('Video generation timed out.');
    await new Promise((r) => setTimeout(r, VIDEO_POLL_MS));
    const res = await platform.aiVideoStatus({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ providerId: meta.provider, apiKey, jobId }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    const status = (await res.json()) as { status: string; url: string | null; proxied?: boolean };
    if (status.status === 'failed') throw new Error('The provider reported the job failed.');
    if (status.status === 'done' && status.url) {
      onStatus?.('Downloading');
      const videoRes = status.proxied
        ? await platform.aiVideoDownload({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ providerId: meta.provider, apiKey, url: status.url }),
          })
        : await fetch(status.url);
      if (!videoRes.ok) throw new Error('Could not download the generated video.');
      const blob = await videoRes.blob();
      const name =
        prompt
          .replace(/[/\\:*?"<>|]+/g, ' ')
          .trim()
          .slice(0, 48) || 'video';
      return new File([blob], `${name}.mp4`, { type: blob.type || 'video/mp4' });
    }
  }
}

// --- background generation with canvas placeholders ---------------------------
// Like text generation, the dialog closes immediately and progress lives on
// the canvas: a pending placeholder sized to the request, swapped for the real
// media when it lands (error text shows in place on failure).

const STACK_OFFSET = 24;
const PLACEHOLDER_EDGE = 1024; // = import MAX_PLACED_SIZE, so the swap barely shifts
const ERROR_LINGER_MS = 9000;

export function placeholderDims(size: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(size);
  const w = m ? Number(m[1]) : 1024;
  const h = m ? Number(m[2]) : 1024;
  const scale = PLACEHOLDER_EDGE / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export interface PlaceholderHandle {
  update: (label: string) => void;
  fail: (message: string) => void;
  clear: () => void;
  /** Current center of each placeholder (they're draggable while loading). */
  centers: () => { x: number; y: number }[];
}

export function addPlaceholders(
  at: { x: number; y: number },
  dims: { width: number; height: number },
  count: number,
  label: string,
  name: string,
): PlaceholderHandle {
  const session = useSessionStore.getState();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = newId();
    ids.push(id);
    session.addPendingImport({
      id,
      x: at.x - dims.width / 2 + i * STACK_OFFSET,
      y: at.y - dims.height / 2 + i * STACK_OFFSET,
      width: dims.width,
      height: dims.height,
      label,
      name,
    });
  }
  return {
    update: (next) => {
      const s = useSessionStore.getState();
      for (const id of ids) s.updatePendingImport(id, { label: next });
    },
    fail: (message) => {
      const s = useSessionStore.getState();
      // One error card is enough; the rest vanish.
      ids.slice(1).forEach((id) => s.removePendingImport(id));
      s.updatePendingImport(ids[0]!, { label: message, error: true });
      setTimeout(() => useSessionStore.getState().removePendingImport(ids[0]!), ERROR_LINGER_MS);
    },
    clear: () => {
      const s = useSessionStore.getState();
      ids.forEach((id) => s.removePendingImport(id));
    },
    centers: () => {
      const pending = useSessionStore.getState().pendingImports;
      return ids
        .map((id) => pending.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ x: p.x + p.width / 2, y: p.y + p.height / 2 }));
    },
  };
}

/** Fire-and-forget image generation: placeholders now, images when ready. */
export function generateImagesInBackground(
  meta: MediaProviderMeta,
  model: string,
  prompt: string,
  size: string,
  n: number,
  opts?: { source?: SourceImage; sourceItemId?: string; at?: { x: number; y: number } },
): void {
  const at = opts?.at ?? clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const shortPrompt = prompt.replace(/\s+/g, ' ').trim().slice(0, 40);
  const handle = addPlaceholders(at, placeholderDims(size), n, 'Generating image', shortPrompt);
  const genInfo: GenInfo = {
    provider: meta.provider,
    model,
    prompt,
    ...(opts?.sourceItemId ? { sourceItemId: opts.sourceItemId } : {}),
    extra: { size, kind: opts?.source ? 'image-to-image' : 'text-to-image' },
  };
  void fetchGeneratedImages(meta, model, prompt, size, n, opts?.source)
    .then(async (files) => {
      // Land each image where its placeholder is NOW (they're draggable).
      const centers = handle.centers();
      handle.clear();
      for (let i = 0; i < files.length; i++) {
        await importImageFiles([files[i]!], centers[i] ?? centers[0] ?? at, { genInfo });
      }
    })
    .catch((err) => handle.fail(err instanceof Error ? err.message : 'Generation failed.'));
}

/** Fire-and-forget video generation (16:9 placeholder, staged labels). */
export function generateVideoInBackground(
  meta: MediaProviderMeta,
  model: string,
  prompt: string,
  opts?: { source?: SourceImage; sourceItemId?: string; at?: { x: number; y: number } },
): void {
  const at = opts?.at ?? clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const shortPrompt = prompt.replace(/\s+/g, ' ').trim().slice(0, 40);
  const handle = addPlaceholders(
    at,
    { width: 720, height: 405 }, // videos place at ≤720 long edge
    1,
    'Generating video',
    shortPrompt,
  );
  const genInfo: GenInfo = {
    provider: meta.provider,
    model,
    prompt,
    ...(opts?.sourceItemId ? { sourceItemId: opts.sourceItemId } : {}),
    extra: { kind: opts?.source ? 'image-to-video' : 'text-to-video' },
  };
  void generateVideo(meta, model, prompt, (label) => handle.update(label), opts?.source)
    .then(async (file) => {
      const center = handle.centers()[0] ?? at;
      handle.clear();
      await importVideoFiles([file], center, { genInfo });
    })
    .catch((err) => handle.fail(err instanceof Error ? err.message : 'Generation failed.'));
}
