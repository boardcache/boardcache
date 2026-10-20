import { create } from 'zustand';
import { recognizeTextOnDevice, visionCaps } from '../iosNative';
import { getAssetBlob } from '../board/assetStore';
import { createTextFromString } from '../import/createItems';
import { streamText } from '../ai/streamText';
import { TEXT_PROVIDER_IDS, textProviderMeta } from '../ai/providers';
import { hostedModelRef, promptModels, useAIStore, type ModelRef } from '../../state/aiStore';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * OCR through the existing AI provider seam: the image goes to whichever
 * vision-capable chat model the user has selected (BYO key, Ollama, or
 * hosted AI) via the same /api/ai/chat proxy as everything else. No extra
 * OCR engine, and handwriting works as well as the model does.
 */

const OCR_PROMPT =
  'Extract ALL text visible in this image, exactly as written. ' +
  'Preserve the reading order and line structure. Use Markdown only where the ' +
  'image itself implies structure (headings, lists, tables). ' +
  'Output ONLY the extracted text — no commentary, no code fences. ' +
  'If the image contains no text, output exactly: (no text found)';

/** Longest edge sent to the model - 1568 is the sweet spot for the major
 *  vision APIs (larger gets tiled/downscaled upstream anyway) and keeps the
 *  request a fraction of the proxy's body limit. */
const OCR_MAX_DIM = 1568;

/**
 * There is no capability flag in any provider's models API - vision support
 * is only knowable by name. This matches the current vision-capable families
 * so the picker can hint; unknown names aren't blocked, just unmarked.
 */
export function likelyVisionModel(providerId: string, model: string): boolean {
  if (providerId === 'hosted') return true; // hosted models are vision-capable
  const m = model.toLowerCase();
  return [
    /gpt-4o/,
    /gpt-4\.1/,
    /gpt-4-turbo/,
    /gpt-5/,
    /^o[134]/, // OpenAI
    /claude-3/,
    /claude-[a-z]*-?[45]/,
    /claude-(opus|sonnet|haiku|fable)/, // Anthropic
    /gemini/, // Google
    /grok-(vision|[2-9])/, // xAI
    /llava/,
    /vision/,
    /moondream/,
    /qwen[.-]?vl|qwen2\.5vl/,
    /pixtral/,
    /minicpm-v/,
    /gemma-?3/, // Ollama
  ].some((re) => re.test(m));
}

interface OcrState {
  /** Item ids with OCR in flight. */
  running: Record<string, true>;
  start: (id: string) => void;
  finish: (id: string) => void;
}

export const useOcrStore = create<OcrState>((set) => ({
  running: {},
  start: (id) => set((s) => ({ running: { ...s.running, [id]: true } })),
  finish: (id) =>
    set((s) => {
      const running = { ...s.running };
      delete running[id];
      return { running };
    }),
}));

const OCR_MODEL_KEY = 'boardcache:ocrModel';

/** Every model OCR could use: enabled BYO models plus hosted AI. */
export function ocrModelChoices(): ModelRef[] {
  const { providers } = useAIStore.getState();
  const out: ModelRef[] = [];
  for (const id of TEXT_PROVIDER_IDS) {
    const p = providers[id];
    if (!p || (!textProviderMeta(id).keyless && !p.apiKey.trim())) continue;
    for (const model of p.enabledModels) out.push({ providerId: id, model });
  }
  const hosted = hostedModelRef();
  if (hosted) out.push(hosted);
  return out;
}

/** The user's explicit OCR model choice, or 'auto'. */
export function ocrModelChoice(): ModelRef | 'auto' {
  try {
    const raw = localStorage.getItem(OCR_MODEL_KEY);
    if (!raw || raw === 'auto') return 'auto';
    const ref = JSON.parse(raw) as ModelRef;
    // Only honor the choice while it's still a configured model.
    if (ocrModelChoices().some((c) => c.providerId === ref.providerId && c.model === ref.model)) {
      return ref;
    }
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

export function setOcrModelChoice(choice: ModelRef | 'auto'): void {
  try {
    if (choice === 'auto') localStorage.removeItem(OCR_MODEL_KEY);
    else localStorage.setItem(OCR_MODEL_KEY, JSON.stringify(choice));
  } catch {
    /* storage unavailable */
  }
}

/**
 * The model OCR will use: the explicit choice from the lightbox picker,
 * else the prompt bar's pick, else the first enabled model of any
 * configured provider, else hosted AI.
 */
function ocrModel(): ModelRef | null {
  const choice = ocrModelChoice();
  if (choice !== 'auto') return choice;
  const selected = promptModels();
  if (selected[0]) return selected[0];
  const { providers } = useAIStore.getState();
  for (const id of TEXT_PROVIDER_IDS) {
    const p = providers[id];
    if (!p?.enabledModels[0]) continue;
    if (textProviderMeta(id).keyless || p.apiKey.trim()) {
      return { providerId: id, model: p.enabledModels[0] };
    }
  }
  return hostedModelRef();
}

/** True when at least one usable model is configured (hosted or BYO). */
export function ocrAvailable(): boolean {
  return ocrModel() !== null;
}

/** Downscale + re-encode the asset for the vision request. */
async function imagePayload(assetId: string): Promise<{ mime: string; data: string }> {
  const blob = await getAssetBlob(assetId);
  if (!blob) throw new Error('Image data is missing.');
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, OCR_MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  );
  if (!out) throw new Error('Could not encode the image.');
  const buf = new Uint8Array(await out.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return { mime: 'image/jpeg', data: btoa(bin) };
}

/**
 * Run OCR on an image item and store the result on item.ocrText.
 * Resolves to the extracted text; throws with a readable message.
 */
export async function runOcr(itemId: string): Promise<string> {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || item.type !== 'image') throw new Error('OCR runs on image items.');
  const model = ocrModel();
  // The iOS shell reads text on the device (Vision): free, private, offline.
  const onDevice = (await visionCaps())?.text === true;
  if (!model && !onDevice) throw new Error('Configure an AI model first (Settings → AI).');

  const { running, start, finish } = useOcrStore.getState();
  if (running[itemId]) throw new Error('OCR is already running for this image.');
  start(itemId);
  try {
    const image = await imagePayload(item.assetId);
    if (onDevice) {
      const found = await recognizeTextOnDevice(image.data);
      if (found !== null) {
        const cleanedLocal = found.trim();
        updateItems([itemId], 'Extract text (OCR)', (d) => {
          if (d.type === 'image') d.ocrText = cleanedLocal || null;
        });
        return cleanedLocal;
      }
      if (!model) throw new Error('Text recognition failed on this device.');
    }
    const config = useAIStore.getState().providers[model!.providerId] ?? { apiKey: '', model: '' };
    let text = '';
    try {
      for await (const chunk of streamText({
        providerId: model!.providerId,
        config: { ...config, model: model!.model },
        prompt: OCR_PROMPT,
        image,
      })) {
        text += chunk;
      }
    } catch (err) {
      throw new Error(friendlyOcrError(err, model!.model), { cause: err });
    }
    const cleaned = text.trim();
    updateItems([itemId], 'Extract text (OCR)', (d) => {
      if (d.type === 'image') d.ocrText = cleaned || null;
    });
    return cleaned;
  } finally {
    finish(itemId);
  }
}

const DESCRIBE_PROMPT =
  'Describe this image in detail for search and cataloging: the subject, ' +
  'setting, visual style, dominant colors, composition, any visible text, ' +
  'and the overall mood. Write 2–6 plain sentences. Output ONLY the ' +
  'description — no headings, no commentary.';

export const useDescribeStore = create<OcrState>((set) => ({
  running: {},
  start: (id) => set((s) => ({ running: { ...s.running, [id]: true } })),
  finish: (id) =>
    set((s) => {
      const running = { ...s.running };
      delete running[id];
      return { running };
    }),
}));

/**
 * "Generate Description": same vision seam as OCR, but the result is a
 * detailed search/cataloging description stored on item.description.
 * Manual per item — never automatic.
 */
export async function runDescribe(itemId: string): Promise<string> {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || item.type !== 'image') throw new Error('Descriptions run on image items.');
  const model = ocrModel();
  if (!model) throw new Error('Configure an AI model first (Settings → AI).');

  const { running, start, finish } = useDescribeStore.getState();
  if (running[itemId]) throw new Error('A description is already being generated.');
  start(itemId);
  try {
    const image = await imagePayload(item.assetId);
    const config = useAIStore.getState().providers[model.providerId] ?? { apiKey: '', model: '' };
    let text = '';
    try {
      for await (const chunk of streamText({
        providerId: model.providerId,
        config: { ...config, model: model.model },
        prompt: DESCRIBE_PROMPT,
        image,
      })) {
        text += chunk;
      }
    } catch (err) {
      throw new Error(friendlyOcrError(err, model.model), { cause: err });
    }
    const cleaned = text.trim();
    updateItems([itemId], 'Generate description', (d) => {
      if (d.type === 'image') d.description = cleaned || null;
    });
    return cleaned;
  } finally {
    finish(itemId);
  }
}

/** Place a markdown text box with the item's OCR text beside the image. */
export function textBoxFromOcr(itemId: string): string | null {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || item.type !== 'image' || !item.ocrText) return null;
  return createTextFromString(
    { x: item.x + item.width + 220, y: item.y + 150 },
    item.ocrText,
    'Text box from OCR',
  );
}

/** Turn raw provider/proxy failures into something actionable. */
function friendlyOcrError(err: unknown, model: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('413') || raw.includes('BODY_TOO_LARGE') || raw.includes('Payload Too Large')) {
    return 'The image is too large for the AI request. Update the app (images are downscaled harder now) or crop the image first.';
  }
  if (
    /does not support|image_url|invalid content type|vision|multimodal|unsupported.*image/i.test(
      raw,
    )
  ) {
    return `${model} doesn't accept images - pick a vision-capable model (GPT-4o/4.1/5, Claude, Gemini, llava...).`;
  }
  return raw;
}
