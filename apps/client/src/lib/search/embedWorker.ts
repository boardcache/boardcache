/// <reference lib="webworker" />

/**
 * Local-model worker for board search. Hosts up to two models, each loaded
 * on demand (both quantized, downloaded once, cached by the browser):
 *  - all-MiniLM-L6-v2 (~25MB): sentence embeddings for semantic retrieval
 *  - ms-marco-MiniLM-L-6-v2 (~23MB): cross-encoder that scores (query,
 *    passage) pairs directly — the precision reranker
 * WebGPU when an adapter actually answers, WASM otherwise. Mock mode (e2e)
 * substitutes deterministic character-trigram vectors for both so the
 * ranking machinery is testable without downloads.
 *
 * Protocol: {init, mock} → ready; {embed-init} → embed-progress/-ready/-error;
 * {embed, id, texts} → vectors|error; {rerank-init} → rerank-progress/-ready/
 * -error; {rerank, id, query, texts} → scores|error.
 */

const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
const RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';
const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';
const ASR_MODEL = 'Xenova/whisper-base';
const MOCK_DIMS = 64;

type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ dims: number[]; data: Float32Array }>;
type Ranker = (
  inputs: { text: string; text_pair: string }[],
) => Promise<{ label: string; score: number }[]>;

let extractor: Extractor | null = null;
let ranker: Ranker | null = null;
let clip: {
  tokenizer: (texts: string[], opts: object) => unknown;
  processor: (images: unknown[]) => Promise<unknown>;
  textModel: (inputs: unknown) => Promise<{ text_embeds: { data: Float32Array; dims: number[] } }>;
  visionModel: (
    inputs: unknown,
  ) => Promise<{ image_embeds: { data: Float32Array; dims: number[] } }>;
  rawImageFromBlob: (blob: Blob) => Promise<unknown>;
} | null = null;
let asr: ((pcm: Float32Array, opts: object) => Promise<{ text: string }>) | null = null;
let mock = false;

function mockVector(text: string): Float32Array {
  const v = new Float32Array(MOCK_DIMS);
  const s = text.toLowerCase().replace(/\s+/g, ' ');
  for (let i = 0; i < s.length - 2; i++) {
    let h = 0;
    for (let j = 0; j < 3; j++) h = (h * 31 + s.charCodeAt(i + j)) | 0;
    const slot = ((h % MOCK_DIMS) + MOCK_DIMS) % MOCK_DIMS;
    v[slot] = (v[slot] ?? 0) + 1;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= norm;
  return v;
}

async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  // navigator.gpu existing is not enough (headless/blocklisted GPUs advertise
  // it with no adapter) — only pick WebGPU when an adapter actually answers.
  try {
    const nav = navigator as { gpu?: { requestAdapter: () => Promise<unknown | null> } };
    if (nav.gpu && (await nav.gpu.requestAdapter())) return 'webgpu';
  } catch {
    /* wasm */
  }
  return 'wasm';
}

async function loadPipeline(
  task: 'feature-extraction' | 'text-classification',
  model: string,
  progressType: string,
): Promise<unknown> {
  const { pipeline } = await import('@huggingface/transformers');
  const device = await pickDevice();
  const load = (dev: 'webgpu' | 'wasm') =>
    pipeline(task, model, {
      dtype: 'q8',
      device: dev,
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          postMessage({ type: progressType, pct: Math.round(p.progress) });
        }
      },
    });
  try {
    return await load(device);
  } catch (err) {
    if (device === 'wasm') throw err;
    return load('wasm'); // WebGPU adapter answered but init failed
  }
}

async function embedInit(): Promise<void> {
  if (mock || extractor) {
    postMessage({ type: 'embed-ready' });
    return;
  }
  try {
    extractor = (await loadPipeline(
      'feature-extraction',
      EMBED_MODEL,
      'embed-progress',
    )) as Extractor;
    postMessage({ type: 'embed-ready' });
  } catch (err) {
    postMessage({
      type: 'embed-error',
      message: err instanceof Error ? err.message : 'Model failed to load.',
    });
  }
}

async function rerankInit(): Promise<void> {
  if (mock || ranker) {
    postMessage({ type: 'rerank-ready' });
    return;
  }
  try {
    ranker = (await loadPipeline('text-classification', RERANK_MODEL, 'rerank-progress')) as Ranker;
    postMessage({ type: 'rerank-ready' });
  } catch (err) {
    postMessage({
      type: 'rerank-error',
      message: err instanceof Error ? err.message : 'Reranker failed to load.',
    });
  }
}

async function embed(id: number, texts: string[]): Promise<void> {
  try {
    let dims: number;
    let buffers: ArrayBuffer[];
    if (mock) {
      dims = MOCK_DIMS;
      buffers = texts.map((t) => mockVector(t).buffer as ArrayBuffer);
    } else {
      if (!extractor) throw new Error('Model not loaded');
      const out = await extractor(texts, { pooling: 'mean', normalize: true });
      dims = out.dims[out.dims.length - 1]!;
      buffers = texts.map((_, i) => {
        const slice = out.data.slice(i * dims, (i + 1) * dims);
        return slice.buffer as ArrayBuffer;
      });
    }
    postMessage({ type: 'vectors', id, dims, buffers }, { transfer: buffers });
  } catch (err) {
    postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : 'Embedding failed.',
    });
  }
}

async function rerank(id: number, query: string, texts: string[]): Promise<void> {
  try {
    let scores: number[];
    if (mock) {
      // Deterministic: trigram cosine of query vs passage.
      const q = mockVector(query);
      scores = texts.map((t) => {
        const v = mockVector(t);
        let dot = 0;
        for (let i = 0; i < MOCK_DIMS; i++) dot += q[i]! * v[i]!;
        return dot;
      });
    } else {
      if (!ranker) throw new Error('Reranker not loaded');
      const out = await ranker(texts.map((t) => ({ text: query, text_pair: t })));
      scores = out.map((r) => r.score);
    }
    postMessage({ type: 'scores', id, scores });
  } catch (err) {
    postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : 'Rerank failed.',
    });
  }
}

async function clipInit(): Promise<void> {
  if (mock || clip) {
    postMessage({ type: 'clip-ready' });
    return;
  }
  try {
    const T = await import('@huggingface/transformers');
    const device = await pickDevice();
    const progress_callback = (p: { status?: string; progress?: number }) => {
      if (p.status === 'progress' && typeof p.progress === 'number') {
        postMessage({ type: 'clip-progress', pct: Math.round(p.progress) });
      }
    };
    const opts = { dtype: 'q8' as const, device, progress_callback };
    const [tokenizer, processor, textModel, visionModel] = await Promise.all([
      T.AutoTokenizer.from_pretrained(CLIP_MODEL, { progress_callback }),
      T.AutoProcessor.from_pretrained(CLIP_MODEL, { progress_callback }),
      T.CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, opts),
      T.CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, opts),
    ]);
    clip = {
      tokenizer: tokenizer as unknown as (texts: string[], opts: object) => unknown,
      processor: (images: unknown[]) =>
        (processor as unknown as (i: unknown[]) => Promise<unknown>)(images),
      textModel: textModel as unknown as (
        i: unknown,
      ) => Promise<{ text_embeds: { data: Float32Array; dims: number[] } }>,
      visionModel: visionModel as unknown as (
        i: unknown,
      ) => Promise<{ image_embeds: { data: Float32Array; dims: number[] } }>,
      rawImageFromBlob: (blob: Blob) => T.RawImage.fromBlob(blob) as Promise<unknown>,
    };
    postMessage({ type: 'clip-ready' });
  } catch (err) {
    postMessage({
      type: 'clip-error',
      message: err instanceof Error ? err.message : 'CLIP failed to load.',
    });
  }
}

function l2normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

/** Text → CLIP joint-space vector. Mock: trigram vector (shared space). */
async function clipText(id: number, texts: string[]): Promise<void> {
  try {
    let dims: number;
    let buffers: ArrayBuffer[];
    if (mock) {
      dims = MOCK_DIMS;
      buffers = texts.map((t) => mockVector(t).buffer as ArrayBuffer);
    } else {
      if (!clip) throw new Error('CLIP not loaded');
      const inputs = clip.tokenizer(texts, { padding: true, truncation: true });
      const out = await clip.textModel(inputs);
      dims = out.text_embeds.dims[out.text_embeds.dims.length - 1]!;
      buffers = texts.map((_, i) => {
        const v = l2normalize(out.text_embeds.data.slice(i * dims, (i + 1) * dims));
        return v.buffer as ArrayBuffer;
      });
    }
    postMessage({ type: 'clip-vectors', id, dims, buffers }, { transfer: buffers });
  } catch (err) {
    postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : 'CLIP text embed failed.',
    });
  }
}

/**
 * Images → CLIP joint-space vectors. `hints` carry a text stand-in per image
 * for mock mode (e2e without model downloads).
 */
async function clipImage(id: number, blobs: Blob[], hints: string[]): Promise<void> {
  try {
    let dims: number;
    let buffers: ArrayBuffer[];
    if (mock) {
      dims = MOCK_DIMS;
      buffers = blobs.map((_, i) => mockVector(hints[i] ?? '').buffer as ArrayBuffer);
    } else {
      if (!clip) throw new Error('CLIP not loaded');
      const images = await Promise.all(blobs.map((b) => clip!.rawImageFromBlob(b)));
      const inputs = await clip.processor(images);
      const out = await clip.visionModel(inputs);
      dims = out.image_embeds.dims[out.image_embeds.dims.length - 1]!;
      buffers = blobs.map((_, i) => {
        const v = l2normalize(out.image_embeds.data.slice(i * dims, (i + 1) * dims));
        return v.buffer as ArrayBuffer;
      });
    }
    postMessage({ type: 'clip-vectors', id, dims, buffers }, { transfer: buffers });
  } catch (err) {
    postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : 'CLIP image embed failed.',
    });
  }
}

async function asrInit(): Promise<void> {
  if (mock || asr) {
    postMessage({ type: 'asr-ready' });
    return;
  }
  try {
    const { pipeline } = await import('@huggingface/transformers');
    const device = await pickDevice();
    const load = (dev: 'webgpu' | 'wasm') =>
      pipeline('automatic-speech-recognition', ASR_MODEL, {
        dtype: 'q8',
        device: dev,
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p.status === 'progress' && typeof p.progress === 'number') {
            postMessage({ type: 'asr-progress', pct: Math.round(p.progress) });
          }
        },
      });
    let pipe;
    try {
      pipe = await load(device);
    } catch (err) {
      if (device === 'wasm') throw err;
      pipe = await load('wasm');
    }
    asr = pipe as unknown as (pcm: Float32Array, opts: object) => Promise<{ text: string }>;
    postMessage({ type: 'asr-ready' });
  } catch (err) {
    postMessage({
      type: 'asr-error',
      message: err instanceof Error ? err.message : 'Whisper failed to load.',
    });
  }
}

async function transcribe(id: number, pcm: Float32Array): Promise<void> {
  try {
    let text: string;
    if (mock) {
      text = `mock transcript of ${pcm.length} samples`;
    } else {
      if (!asr) throw new Error('Whisper not loaded');
      const out = await asr(pcm, { chunk_length_s: 30, stride_length_s: 5 });
      text = out.text.trim();
    }
    postMessage({ type: 'transcript', id, text });
  } catch (err) {
    postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : 'Transcription failed.',
    });
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as
    | { type: 'init'; mock: boolean }
    | { type: 'embed-init' }
    | { type: 'rerank-init' }
    | { type: 'embed'; id: number; texts: string[] }
    | { type: 'rerank'; id: number; query: string; texts: string[] }
    | { type: 'clip-init' }
    | { type: 'clip-text'; id: number; texts: string[] }
    | { type: 'clip-image'; id: number; blobs: Blob[]; hints: string[] }
    | { type: 'asr-init' }
    | { type: 'asr'; id: number; pcm: Float32Array };
  if (msg.type === 'init') {
    mock = msg.mock;
    postMessage({ type: 'ready' });
  } else if (msg.type === 'embed-init') void embedInit();
  else if (msg.type === 'rerank-init') void rerankInit();
  else if (msg.type === 'clip-init') void clipInit();
  else if (msg.type === 'embed') void embed(msg.id, msg.texts);
  else if (msg.type === 'rerank') void rerank(msg.id, msg.query, msg.texts);
  else if (msg.type === 'clip-text') void clipText(msg.id, msg.texts);
  else if (msg.type === 'clip-image') void clipImage(msg.id, msg.blobs, msg.hints);
  else if (msg.type === 'asr-init') void asrInit();
  else if (msg.type === 'asr') void transcribe(msg.id, msg.pcm);
};
