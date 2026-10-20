import type { GenInfo } from '@boardcache/schema';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { getAssetBlob } from '../../lib/board/assetStore';
import { importImageFiles } from '../../lib/import/importImages';
import { importVideoFiles } from '../../lib/import/importVideos';
import { platform } from '../../lib/platform';
import { useDocumentStore } from '../../state/documentStore';
import { addPlaceholders } from '../aiMedia/aiMediaGen';
import { getPluginSettings } from '../settingsStore';

/**
 * ComfyUI generation: the client builds API-format workflow graphs and drives
 * them through the same-origin /comfy proxy. Two model families are handled:
 *
 *  - classic checkpoints (CheckpointLoaderSimple embeds model+CLIP+VAE)
 *  - component models (FLUX, SD3, Wan, Hunyuan, LTX): UNETLoader +
 *    CLIPLoader/DualCLIPLoader text encoder(s) + VAELoader — these
 *    checkpoints have NO embedded CLIP, which is why running them through
 *    CheckpointLoaderSimple errors with "clip input is invalid: None".
 *
 * Anything beyond the built-in graphs (video architectures especially) runs
 * through user-saved WORKFLOW TEMPLATES: an API-format export of any ComfyUI
 * workflow, into which we inject prompt/negative/source image/seed.
 *
 * Results import through the normal media pipelines; video files (webm/mp4)
 * become video items, animated WebP becomes an animating image item.
 */

// --- settings -------------------------------------------------------------------

export interface ComfyTemplate {
  id: string;
  name: string;
  kind: 'image' | 'video';
  /** Detected on save: the workflow contains a LoadImage node. */
  needsImage: boolean;
  /** API-format workflow JSON (string, as exported by ComfyUI). */
  json: string;
}

export interface ComfySettings {
  serverUrl?: string;
  templates?: ComfyTemplate[];
}

export function comfyServerUrl(): string {
  return getPluginSettings<ComfySettings>('comfyui')?.serverUrl?.trim() ?? '';
}

export function comfyTemplates(): ComfyTemplate[] {
  return getPluginSettings<ComfySettings>('comfyui')?.templates ?? [];
}

export interface ComfyModels {
  checkpoints: string[];
  videoCheckpoints: string[];
  unets: string[];
  clips: string[];
  vaes: string[];
  clipVisions: string[];
  clipTypes: string[];
  samplers: string[];
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `ComfyUI request failed (${res.status}).`;
}

async function post(
  method: 'comfyModels' | 'comfyPrompt' | 'comfyStatus' | 'comfyUpload',
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await platform[method]({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ baseUrl: comfyServerUrl(), ...body }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function fetchComfyModels(): Promise<ComfyModels> {
  const data = (await post('comfyModels', {})) as Partial<ComfyModels>;
  return {
    checkpoints: data.checkpoints ?? [],
    // ComfyUI's image-only loader lists EVERY checkpoint file — only actual
    // SVD models can run the built-in SVD graph.
    videoCheckpoints: (data.videoCheckpoints ?? []).filter((n) => /svd/i.test(n)),
    unets: data.unets ?? [],
    clips: data.clips ?? [],
    vaes: data.vaes ?? [],
    clipVisions: data.clipVisions ?? [],
    clipTypes: data.clipTypes ?? [],
    samplers: data.samplers ?? [],
  };
}

// --- component auto-detection ------------------------------------------------------

/** Guess the CLIPLoader `type` for a model filename (must exist server-side). */
export function guessClipType(modelName: string, clipTypes: string[]): string {
  const n = modelName.toLowerCase();
  const candidates: [string, string][] = [
    ['flux', 'flux'],
    ['wan', 'wan'],
    ['sd3', 'sd3'],
    ['hunyuan', 'hunyuan_video'],
    ['ltx', 'ltxv'],
    ['mochi', 'mochi'],
    ['qwen', 'qwen_image'],
    ['cosmos', 'cosmos'],
    ['pixart', 'pixart'],
    ['sdxl', 'sdxl'],
  ];
  for (const [pat, type] of candidates) {
    if (n.includes(pat) && clipTypes.includes(type)) return type;
  }
  return clipTypes.includes('stable_diffusion')
    ? 'stable_diffusion'
    : (clipTypes[0] ?? 'stable_diffusion');
}

/** Best-guess text encoder file(s) for a component model. */
export function guessTextEncoders(
  modelName: string,
  clips: string[],
): { clip1?: string | undefined; clip2?: string | undefined } {
  const n = modelName.toLowerCase();
  const find = (...pats: string[]) =>
    clips.find((c) => pats.some((p) => c.toLowerCase().includes(p)));
  if (n.includes('flux')) {
    const l = find('clip_l');
    const t5 = find('t5');
    return t5 && l ? { clip1: l, clip2: t5 } : { clip1: l ?? t5 ?? clips[0] };
  }
  if (n.includes('wan')) return { clip1: find('umt5', 'wan') ?? clips[0] };
  if (n.includes('hunyuan')) {
    const llava = find('llava', 'hunyuan');
    const l = find('clip_l');
    return llava && l ? { clip1: llava, clip2: l } : { clip1: llava ?? clips[0] };
  }
  if (n.includes('sd3')) {
    const g = find('clip_g');
    const second = find('t5') ?? find('clip_l');
    return g && second ? { clip1: g, clip2: second } : { clip1: g ?? clips[0] };
  }
  if (n.includes('ltx')) return { clip1: find('gemma', 't5') ?? clips[0] };
  if (n.includes('qwen')) return { clip1: find('qwen') ?? clips[0] };
  return { clip1: clips[0] };
}

/** Checkpoint filenames that are component models (no embedded CLIP). */
export const COMPONENT_FAMILY = /flux|ltx|wan|sd3|hunyuan|qwen|lumina|cosmos|pixart/i;

/**
 * Video-architecture models (video-shaped latents). The generic image graph
 * CANNOT drive these — "Tensors must have same number of dimensions" — they
 * run through saved workflow templates instead.
 */
export function isVideoFamily(name: string): boolean {
  return /ltx|wan|hunyuan|svd|mochi|cosmos|allegro|animatediff|i2v|t2v|img2vid|video/i.test(name);
}

/** Audio-architecture models (ACE-Step etc.) — not usable here at all. */
export function isAudioFamily(name: string): boolean {
  return /acestep|stable_audio|_ace|ace_|s2v/i.test(name);
}

// --- native Wan video support -------------------------------------------------

export interface WanModel {
  /** Stable key for dropdowns. */
  key: string;
  /** Human label ("wan2.2 t2v 14B"). */
  label: string;
  /** High-noise (or only) diffusion model file. */
  high: string;
  /** Low-noise partner for two-stage 2.2 pairs. */
  low?: string | undefined;
  mode: 't2v' | 'i2v' | 'ti2v';
}

/** Group the server's Wan diffusion models into runnable entries. */
export function detectWanModels(unets: string[], vaes: string[]): WanModel[] {
  const wans = unets.filter((n) => /wan/i.test(n) && !/s2v|vace|fun_|camera/i.test(n));
  const hasVae = vaes.some((v) => /wan/i.test(v));
  if (!hasVae) return [];
  const hasVae22 = vaes.some((v) => /wan\s*2\.2|wan_2\.2|wan2\.2|wan22/i.test(v));
  const out: WanModel[] = [];
  const used = new Set<string>();
  const modeOf = (n: string): WanModel['mode'] =>
    /ti2v/i.test(n) ? 'ti2v' : /i2v/i.test(n) ? 'i2v' : 't2v';
  const labelOf = (n: string) =>
    n
      .replace(/\.(safetensors|sft|gguf)$/i, '')
      .replace(/_?(high|low)_noise_?/i, ' ')
      .replace(/_fp8[\w]*|_fp16|_bf16|_scaled|_kj/gi, '')
      .replace(/[_]+/g, ' ')
      .trim();
  for (const n of wans) {
    if (used.has(n)) continue;
    if (/low_noise/i.test(n)) continue; // picked up via its high partner
    // The 5B ti2v model needs the Wan 2.2 VAE specifically.
    if (/ti2v/i.test(n) && !hasVae22) continue;
    if (/high_noise/i.test(n)) {
      const low = wans.find((m) => m === n.replace(/high_noise/i, 'low_noise'));
      if (low) used.add(low);
      out.push({ key: n, label: labelOf(n), high: n, low, mode: modeOf(n) });
    } else {
      out.push({ key: n, label: labelOf(n), high: n, mode: modeOf(n) });
    }
  }
  return out;
}

/** Preferred Wan supporting files from the server's catalogs. */
export function wanComponents(models: ComfyModels, wan: WanModel) {
  const clip =
    models.clips.find((c) => /umt5/i.test(c)) ?? models.clips.find((c) => /wan/i.test(c));
  const vae = /ti2v/i.test(wan.high)
    ? models.vaes.find((v) => /wan\s*2\.2|wan_2\.2|wan2\.2|wan22/i.test(v))
    : (models.vaes.find((v) => /wan\s*2\.1|wan_2\.1|wan2[._]1/i.test(v)) ??
      models.vaes.find((v) => /wan/i.test(v)));
  // clip_vision only helps Wan 2.1 i2v.
  const clipVision =
    wan.mode === 'i2v' && /2[._]1/.test(wan.high)
      ? models.clipVisions.find((c) => /clip_vision_h/i.test(c))
      : undefined;
  return { clip, vae, clipVision };
}

/** Image-model family — picks the right latent node and sane defaults. */
export type ImageFamily = 'flux' | 'sd3' | 'qwen' | 'sd';

export function imageFamily(name: string): ImageFamily {
  const n = name.toLowerCase();
  if (n.includes('flux')) return 'flux';
  if (n.includes('sd3')) return 'sd3';
  if (n.includes('qwen')) return 'qwen';
  return 'sd';
}

/** Dummy-proof per-family sampling defaults (Advanced can still override). */
export function familyDefaults(family: ImageFamily): { steps: number; cfg: number } {
  switch (family) {
    case 'flux':
      return { steps: 20, cfg: 1 }; // guidance comes from FluxGuidance instead
    case 'sd3':
      return { steps: 20, cfg: 4.5 };
    case 'qwen':
      return { steps: 20, cfg: 2.5 };
    case 'sd':
      return { steps: 20, cfg: 7 };
  }
}

/** Best-guess VAE file for a component model. */
export function guessVae(modelName: string, vaes: string[]): string | undefined {
  const n = modelName.toLowerCase();
  const find = (...pats: string[]) =>
    vaes.find((v) => pats.some((p) => v.toLowerCase().includes(p)));
  if (n.includes('flux')) return find('ae.s', 'flux') ?? vaes[0];
  if (n.includes('wan')) return find('wan') ?? vaes[0];
  if (n.includes('hunyuan')) return find('hunyuan') ?? vaes[0];
  if (n.includes('ltx')) return find('ltx') ?? vaes[0];
  if (n.includes('sd3')) return find('sd3') ?? vaes[0];
  return vaes[0];
}

// --- workflow graphs (ComfyUI API format) ---------------------------------------

type GraphNode = { class_type: string; inputs: Record<string, unknown> };
type Graph = Record<string, GraphNode>;

const randomSeed = () => Math.floor(Math.random() * 2 ** 48);

export interface ImageJobOptions {
  prompt: string;
  negative: string;
  /** Classic checkpoint (embedded CLIP+VAE) or component diffusion model. */
  modelKind: 'checkpoint' | 'unet';
  model: string;
  /** Component pieces — required for 'unet', optional overrides for 'checkpoint'. */
  clip1?: string;
  clip2?: string;
  clipType?: string;
  vae?: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  /** Uploaded init image name — switches txt2img to img2img. */
  sourceName?: string;
  /** img2img strength (0 = keep source, 1 = ignore it). */
  denoise: number;
}

function imageGraph(o: ImageJobOptions): Graph {
  const graph: Graph = {};
  let modelRef: [string, number];
  let clipRef: [string, number];
  let vaeRef: [string, number];

  if (o.modelKind === 'checkpoint') {
    graph['4'] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: o.model } };
    modelRef = ['4', 0];
    clipRef = ['4', 1];
    vaeRef = ['4', 2];
  } else {
    if (!o.clip1 || !o.vae) {
      throw new Error(
        'This diffusion model needs a text encoder and a VAE — pick them in the dialog (Components) or add the files to your ComfyUI models folder.',
      );
    }
    graph['4'] = {
      class_type: 'UNETLoader',
      inputs: { unet_name: o.model, weight_dtype: 'default' },
    };
    modelRef = ['4', 0];
  }

  // Separate text encoder(s): required for component models, optional
  // override for checkpoints whose embedded CLIP is missing/broken.
  if (o.clip1) {
    const type = o.clipType || 'stable_diffusion';
    graph['12'] = o.clip2
      ? {
          class_type: 'DualCLIPLoader',
          inputs: { clip_name1: o.clip1, clip_name2: o.clip2, type, device: 'default' },
        }
      : { class_type: 'CLIPLoader', inputs: { clip_name: o.clip1, type, device: 'default' } };
    clipRef = ['12', 0];
  }
  if (o.vae) {
    graph['13'] = { class_type: 'VAELoader', inputs: { vae_name: o.vae } };
    vaeRef = ['13', 0];
  }
  clipRef = clipRef!;
  vaeRef = vaeRef!;

  const family = imageFamily(o.model);
  graph['6'] = { class_type: 'CLIPTextEncode', inputs: { text: o.prompt, clip: clipRef } };
  graph['7'] = { class_type: 'CLIPTextEncode', inputs: { text: o.negative, clip: clipRef } };
  let positiveRef: [string, number] = ['6', 0];
  if (family === 'flux') {
    // FLUX ignores CFG; guidance rides in the conditioning.
    graph['14'] = {
      class_type: 'FluxGuidance',
      inputs: { conditioning: ['6', 0], guidance: 3.5 },
    };
    positiveRef = ['14', 0];
  }
  graph['3'] = {
    class_type: 'KSampler',
    inputs: {
      seed: randomSeed(),
      steps: o.steps,
      cfg: o.cfg,
      sampler_name: o.sampler,
      scheduler: 'normal',
      denoise: o.sourceName ? o.denoise : 1,
      model: modelRef,
      positive: positiveRef,
      negative: ['7', 0],
      latent_image: o.sourceName ? ['11', 0] : ['5', 0],
    },
  };
  graph['8'] = { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: vaeRef } };
  graph['9'] = {
    class_type: 'SaveImage',
    inputs: { images: ['8', 0], filename_prefix: 'boardcache' },
  };
  if (o.sourceName) {
    graph['10'] = { class_type: 'LoadImage', inputs: { image: o.sourceName } };
    graph['11'] = { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: vaeRef } };
  } else {
    graph['5'] = {
      // FLUX/SD3/Qwen use 16-channel latents — EmptyLatentImage's 4-channel
      // output would fail with a channel/shape mismatch mid-sampling.
      class_type:
        family === 'flux' || family === 'sd3' || family === 'qwen'
          ? 'EmptySD3LatentImage'
          : 'EmptyLatentImage',
      inputs: { width: o.width, height: o.height, batch_size: 1 },
    };
  }
  return graph;
}

export interface VideoJobOptions {
  checkpoint: string;
  sourceName: string;
  frames: number;
  fps: number;
  motion: number;
}

/** Stable Video Diffusion img2vid — vanilla-ComfyUI nodes only. */
function videoGraph(o: VideoJobOptions): Graph {
  return {
    '1': { class_type: 'ImageOnlyCheckpointLoader', inputs: { ckpt_name: o.checkpoint } },
    '2': { class_type: 'LoadImage', inputs: { image: o.sourceName } },
    '3': {
      class_type: 'SVD_img2vid_Conditioning',
      inputs: {
        width: 1024,
        height: 576,
        video_frames: o.frames,
        motion_bucket_id: o.motion,
        fps: o.fps,
        augmentation_level: 0,
        clip_vision: ['1', 1],
        init_image: ['2', 0],
        vae: ['1', 2],
      },
    },
    '4': { class_type: 'VideoLinearCFGGuidance', inputs: { model: ['1', 0], min_cfg: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: randomSeed(),
        steps: 20,
        cfg: 2.5,
        sampler_name: 'euler',
        scheduler: 'karras',
        denoise: 1,
        model: ['4', 0],
        positive: ['3', 0],
        negative: ['3', 1],
        latent_image: ['3', 2],
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': {
      class_type: 'SaveAnimatedWEBP',
      inputs: {
        images: ['6', 0],
        fps: o.fps,
        filename_prefix: 'boardcache',
        lossless: false,
        quality: 85,
        method: 'default',
      },
    },
  };
}

export interface WanJobOptions {
  wan: WanModel;
  clip: string;
  vae: string;
  clipVision?: string | undefined;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  length: number;
  fps: number;
  steps: number;
  sourceName?: string | undefined;
}

/**
 * Native Wan graph (vanilla nodes, mirrors the official templates):
 * UNETLoader(+ low-noise partner) → ModelSamplingSD3(shift 8) → KSampler
 * (two-stage KSamplerAdvanced for 2.2 high/low pairs), umt5 CLIPLoader
 * (type wan), Wan VAE. t2v uses EmptyHunyuanLatentVideo; i2v/ti2v route
 * through WanImageToVideo with the uploaded start image. Output is a real
 * MP4 via CreateVideo + SaveVideo.
 */
function wanGraph(o: WanJobOptions): Graph {
  const graph: Graph = {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: o.wan.high, weight_dtype: 'default' },
    },
    '2': { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8 } },
    '5': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: o.clip, type: 'wan', device: 'default' },
    },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: o.prompt, clip: ['5', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: o.negative, clip: ['5', 0] } },
    '8': { class_type: 'VAELoader', inputs: { vae_name: o.vae } },
  };
  let positive: [string, number] = ['6', 0];
  let negative: [string, number] = ['7', 0];
  let latent: [string, number];

  if (o.sourceName) {
    graph['10'] = { class_type: 'LoadImage', inputs: { image: o.sourceName } };
    const i2v: Record<string, unknown> = {
      positive,
      negative,
      vae: ['8', 0],
      width: o.width,
      height: o.height,
      length: o.length,
      batch_size: 1,
      start_image: ['10', 0],
    };
    if (o.clipVision) {
      graph['11'] = { class_type: 'CLIPVisionLoader', inputs: { clip_name: o.clipVision } };
      graph['12'] = {
        class_type: 'CLIPVisionEncode',
        inputs: { clip_vision: ['11', 0], image: ['10', 0], crop: 'none' },
      };
      i2v.clip_vision_output = ['12', 0];
    }
    graph['9'] = { class_type: 'WanImageToVideo', inputs: i2v };
    positive = ['9', 0];
    negative = ['9', 1];
    latent = ['9', 2];
  } else {
    graph['9'] = {
      class_type: 'EmptyHunyuanLatentVideo',
      inputs: { width: o.width, height: o.height, length: o.length, batch_size: 1 },
    };
    latent = ['9', 0];
  }

  const common = {
    steps: o.steps,
    cfg: 3.5,
    sampler_name: 'euler',
    scheduler: 'simple',
    positive,
    negative,
  };
  let lastSampler: string;
  if (o.wan.low) {
    // Two-stage 2.2 pair: high-noise model for the first half of the steps,
    // low-noise for the rest.
    graph['3'] = {
      class_type: 'UNETLoader',
      inputs: { unet_name: o.wan.low, weight_dtype: 'default' },
    };
    graph['4'] = { class_type: 'ModelSamplingSD3', inputs: { model: ['3', 0], shift: 8 } };
    const half = Math.max(1, Math.floor(o.steps / 2));
    graph['13'] = {
      class_type: 'KSamplerAdvanced',
      inputs: {
        ...common,
        model: ['2', 0],
        add_noise: 'enable',
        noise_seed: randomSeed(),
        latent_image: latent,
        start_at_step: 0,
        end_at_step: half,
        return_with_leftover_noise: 'enable',
      },
    };
    graph['14'] = {
      class_type: 'KSamplerAdvanced',
      inputs: {
        ...common,
        model: ['4', 0],
        add_noise: 'disable',
        noise_seed: 0,
        latent_image: ['13', 0],
        start_at_step: half,
        end_at_step: 10000,
        return_with_leftover_noise: 'disable',
      },
    };
    lastSampler = '14';
  } else {
    graph['13'] = {
      class_type: 'KSampler',
      inputs: {
        ...common,
        cfg: o.sourceName ? 6 : 5,
        model: ['2', 0],
        seed: randomSeed(),
        denoise: 1,
        latent_image: latent,
      },
    };
    lastSampler = '13';
  }
  graph['15'] = { class_type: 'VAEDecode', inputs: { samples: [lastSampler, 0], vae: ['8', 0] } };
  graph['16'] = { class_type: 'CreateVideo', inputs: { images: ['15', 0], fps: o.fps } };
  graph['17'] = {
    class_type: 'SaveVideo',
    inputs: { video: ['16', 0], filename_prefix: 'boardcache', format: 'auto', codec: 'auto' },
  };
  return graph;
}

// --- workflow templates ------------------------------------------------------------

export function parseTemplateGraph(json: string): Graph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Not valid JSON. In ComfyUI use Workflow → Export (API).');
  }
  const graph = parsed as Graph;
  const nodes = Object.values(graph ?? {});
  if (
    !nodes.length ||
    !nodes.every((n) => n && typeof n === 'object' && typeof n.class_type === 'string')
  ) {
    throw new Error(
      'This is not an API-format workflow. In ComfyUI use Workflow → Export (API), not the regular save.',
    );
  }
  return graph;
}

export function templateNeedsImage(json: string): boolean {
  try {
    return Object.values(parseTemplateGraph(json)).some((n) => n.class_type === 'LoadImage');
  } catch {
    return false;
  }
}

const isRef = (v: unknown): v is [string, number] =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';

/** Follow conditioning pass-through nodes (FluxGuidance, etc.) to a text node. */
function resolveTextNode(graph: Graph, ref: unknown, depth = 0): GraphNode | null {
  if (!isRef(ref) || depth > 6) return null;
  const node = graph[ref[0]];
  if (!node) return null;
  if (typeof node.inputs.text === 'string') return node;
  for (const key of ['conditioning', 'positive', 'negative', 'clip_l', 'guidance']) {
    if (isRef(node.inputs[key])) return resolveTextNode(graph, node.inputs[key], depth + 1);
  }
  return null;
}

/** Inject prompt/negative/source/seed into a template graph (in place, on a copy). */
function prepareTemplate(
  json: string,
  inject: { prompt?: string; negative?: string; sourceName?: string },
): Graph {
  const graph = parseTemplateGraph(json);
  const copy: Graph = JSON.parse(JSON.stringify(graph)) as Graph;

  // Fresh seed on every run.
  for (const node of Object.values(copy)) {
    for (const key of ['seed', 'noise_seed']) {
      if (typeof node.inputs[key] === 'number') node.inputs[key] = randomSeed();
    }
  }

  // Prompt/negative: trace samplers' positive/negative inputs to text nodes.
  const textNodes = Object.values(copy).filter((n) => typeof n.inputs.text === 'string');
  let positive: GraphNode | null = null;
  let negative: GraphNode | null = null;
  for (const node of Object.values(copy)) {
    positive ??= resolveTextNode(copy, node.inputs.positive);
    negative ??= resolveTextNode(copy, node.inputs.negative);
  }
  if (!positive && textNodes.length > 0) positive = textNodes[0]!;
  if (positive && negative === positive) negative = null;
  if (inject.prompt !== undefined && positive) positive.inputs.text = inject.prompt;
  if (inject.negative !== undefined && negative) negative.inputs.text = inject.negative;

  // Source image: repoint the first LoadImage at the uploaded file.
  if (inject.sourceName) {
    const load = Object.values(copy).find((n) => n.class_type === 'LoadImage');
    if (load) load.inputs.image = inject.sourceName;
  }
  return copy;
}

// --- job lifecycle ---------------------------------------------------------------

const POLL_MS = 2000;
const TIMEOUT_MS = 15 * 60_000;

interface JobImage {
  filename: string;
  subfolder: string;
  type: string;
}

async function runJob(graph: Graph, onStatus?: (label: string) => void): Promise<JobImage[]> {
  onStatus?.('Queued on ComfyUI');
  const { promptId } = (await post('comfyPrompt', { prompt: graph })) as { promptId: string };
  const deadline = Date.now() + TIMEOUT_MS;
  onStatus?.('Generating');
  for (;;) {
    if (Date.now() > deadline) throw new Error('ComfyUI generation timed out.');
    await new Promise((r) => setTimeout(r, POLL_MS));
    const status = (await post('comfyStatus', { promptId })) as {
      done: boolean;
      error?: string;
      images: JobImage[];
    };
    if (!status.done) continue;
    if (status.error) throw new Error(status.error);
    if (status.images.length === 0) throw new Error('The workflow produced no output files.');
    return status.images;
  }
}

async function downloadOutput(img: JobImage, name: string): Promise<File> {
  const res = await platform.comfyView({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ baseUrl: comfyServerUrl(), ...img }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const blob = await res.blob();
  const extFromName = /\.(\w{2,4})$/.exec(img.filename)?.[1];
  const ext = blob.type.includes('webm')
    ? 'webm'
    : blob.type.includes('mp4')
      ? 'mp4'
      : blob.type.includes('webp')
        ? 'webp'
        : blob.type.includes('jpeg')
          ? 'jpg'
          : (extFromName ?? 'png');
  return new File([blob], `${name}.${ext}`, { type: blob.type || 'image/png' });
}

async function importOutput(
  file: File,
  center: { x: number; y: number },
  genInfo?: GenInfo,
): Promise<void> {
  const opts = genInfo ? { genInfo } : undefined;
  if (file.type.startsWith('video/')) await importVideoFiles([file], center, opts);
  else await importImageFiles([file], center, opts);
}

/** Upload a board image asset as a ComfyUI input image; returns its name. */
async function uploadSourceImage(itemId: string): Promise<string> {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || item.type !== 'image') throw new Error('The source item is not an image.');
  const blob = await getAssetBlob(item.assetId);
  if (!blob) throw new Error('The source image asset is unavailable.');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  const data = (await post('comfyUpload', {
    imageB64: btoa(bin),
    mime: blob.type || 'image/png',
    name: `boardcache-${itemId.slice(0, 8)}.png`,
  })) as { name: string };
  return data.name;
}

function shortName(prompt: string, fallback: string): string {
  return (
    prompt
      .replace(/[/\\:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48) || fallback
  );
}

function runInBackground(
  dims: { width: number; height: number },
  label: string,
  name: string,
  job: (handle: { update: (label: string) => void }) => Promise<{ file: File }>,
  genInfo?: GenInfo,
): void {
  const at = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const handle = addPlaceholders(at, dims, 1, label, name);
  void job(handle)
    .then(async ({ file }) => {
      const center = handle.centers()[0] ?? at;
      handle.clear();
      await importOutput(file, center, genInfo);
    })
    .catch((err) => handle.fail(err instanceof Error ? err.message : 'Generation failed.'));
}

/** Fire-and-forget image generation: placeholder now, image when ready. */
export function generateComfyImageInBackground(
  options: Omit<ImageJobOptions, 'sourceName'> & { sourceItemId?: string },
): void {
  const scale = 1024 / Math.max(options.width, options.height);
  const dims = {
    width: Math.round(options.width * scale),
    height: Math.round(options.height * scale),
  };
  runInBackground(
    dims,
    'Generating with ComfyUI',
    shortName(options.prompt, 'comfy image'),
    async (handle) => {
      const sourceName = options.sourceItemId
        ? await uploadSourceImage(options.sourceItemId)
        : undefined;
      const images = await runJob(
        imageGraph({ ...options, ...(sourceName ? { sourceName } : {}) }),
        (label) => handle.update(label),
      );
      return { file: await downloadOutput(images[0]!, shortName(options.prompt, 'comfy image')) };
    },
    {
      provider: 'comfyui',
      model: options.model,
      prompt: options.prompt,
      ...(options.sourceItemId ? { sourceItemId: options.sourceItemId } : {}),
      extra: {
        kind: options.sourceItemId ? 'image-to-image' : 'text-to-image',
        ...(options.negative ? { negative: options.negative } : {}),
        size: `${options.width}x${options.height}`,
        steps: String(options.steps),
        sampler: options.sampler,
      },
    },
  );
}

/** Fire-and-forget SVD video (animated WebP) from a board image. */
export function generateComfyVideoInBackground(
  options: Omit<VideoJobOptions, 'sourceName'> & { sourceItemId: string },
): void {
  runInBackground(
    { width: 1024, height: 576 },
    'Generating video with ComfyUI',
    'comfy video',
    async (handle) => {
      const sourceName = await uploadSourceImage(options.sourceItemId);
      const images = await runJob(videoGraph({ ...options, sourceName }), (label) =>
        handle.update(label),
      );
      return { file: await downloadOutput(images[0]!, 'comfy video') };
    },
    {
      provider: 'comfyui',
      model: options.checkpoint,
      sourceItemId: options.sourceItemId,
      extra: {
        kind: 'image-to-video',
        frames: String(options.frames),
        fps: String(options.fps),
      },
    },
  );
}

/** Fire-and-forget Wan video (real MP4) — t2v, or i2v from a board image. */
export function generateComfyWanInBackground(
  options: Omit<WanJobOptions, 'sourceName'> & { sourceItemId?: string },
): void {
  const scale = 720 / Math.max(options.width, options.height);
  runInBackground(
    { width: Math.round(options.width * scale), height: Math.round(options.height * scale) },
    `Generating video (${options.wan.label})…`,
    shortName(options.prompt, 'wan video'),
    async (handle) => {
      const sourceName = options.sourceItemId
        ? await uploadSourceImage(options.sourceItemId)
        : undefined;
      const images = await runJob(wanGraph({ ...options, sourceName }), (label) =>
        handle.update(label),
      );
      return { file: await downloadOutput(images[0]!, shortName(options.prompt, 'wan video')) };
    },
    {
      provider: 'comfyui',
      model: options.wan.label,
      prompt: options.prompt,
      ...(options.sourceItemId ? { sourceItemId: options.sourceItemId } : {}),
      extra: {
        kind: options.sourceItemId ? 'image-to-video' : 'text-to-video',
        ...(options.negative ? { negative: options.negative } : {}),
        size: `${options.width}x${options.height}`,
        length: String(options.length),
        fps: String(options.fps),
      },
    },
  );
}

/** Fire-and-forget generation through a saved workflow template. */
export function generateComfyTemplateInBackground(options: {
  template: ComfyTemplate;
  prompt: string;
  negative: string;
  sourceItemId?: string;
}): void {
  const { template } = options;
  const dims =
    template.kind === 'video' ? { width: 960, height: 540 } : { width: 1024, height: 1024 };
  runInBackground(
    dims,
    `Running "${template.name}" on ComfyUI`,
    shortName(options.prompt, template.name),
    async (handle) => {
      const sourceName = options.sourceItemId
        ? await uploadSourceImage(options.sourceItemId)
        : undefined;
      if (template.needsImage && !sourceName) {
        throw new Error(`The "${template.name}" workflow needs a source image.`);
      }
      const graph = prepareTemplate(template.json, {
        prompt: options.prompt,
        negative: options.negative,
        ...(sourceName ? { sourceName } : {}),
      });
      const images = await runJob(graph, (label) => handle.update(label));
      return {
        file: await downloadOutput(images[0]!, shortName(options.prompt, template.name)),
      };
    },
    {
      provider: 'comfyui',
      model: template.name,
      prompt: options.prompt,
      ...(options.sourceItemId ? { sourceItemId: options.sourceItemId } : {}),
      extra: {
        kind: 'workflow',
        ...(options.negative ? { negative: options.negative } : {}),
      },
    },
  );
}
