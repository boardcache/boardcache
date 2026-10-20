import './style.css';
import { useEffect, useState } from 'react';
import { ItemChat } from './aiChat/ItemChat';
import { threadSearchTool } from './aiChat/threadSearch';
import { create } from 'zustand';
import { AIProvidersDialog, AIProvidersPanel } from './AIProvidersDialog';
import { GenerateTextDialog } from '../../components/dialogs/GenerateTextDialog';
import { ChatIcon, ImageIcon, SparkleIcon, VideoIcon } from '../../components/icons';
import { UiTooltip } from '../../components/ui/Tooltip';
import { UiDialog } from '../../components/ui/Dialog';
import { useSessionStore } from '../../state/sessionStore';
import { ensureHostedAi, useAIStore, aiSource } from '../../state/aiStore';
import {
  fetchMediaModels,
  generateImagesInBackground,
  generateVideoInBackground,
  IMAGE_PROVIDERS,
  itemSourceImage,
  loadModelPref,
  placeholderDims,
  hostedImageMeta,
  providerKey,
  saveModelPref,
  VIDEO_PROVIDERS,
} from './aiMediaGen';
import type { MediaProviderMeta } from './aiMediaGen';
import { registerPlugin } from '../registry';
import { z } from 'zod';
import { openSpotNear } from '../../lib/canvas/placeSpot';
import { useDocumentStore } from '../../state/documentStore';
import type { BoardTool } from '../../lib/tools/registry';
import { ChatPanel, useChatStore } from './aiChat/ChatPanel';

/** AI image + video generation, keyed off the shared AI provider keys. */

type Mode = 'image' | 'video';

interface DialogState {
  mode: Mode | null;
  open: (mode: Mode) => void;
  close: () => void;
}
const useMediaDialog = create<DialogState>((set) => ({
  mode: null,
  open: (mode) => set({ mode }),
  close: () => set({ mode: null }),
}));

function AiPluginComponent() {
  const mode = useMediaDialog((s) => s.mode);
  return (
    <>
      {mode ? <MediaDialogBody key={mode} mode={mode} /> : null}
      <GenerateTextDialog />
      <AIProvidersDialog />
      <ChatPanel />
    </>
  );
}

function MediaDialogBody({ mode }: { mode: Mode }) {
  const close = () => useMediaDialog.getState().close();
  const isVideo = mode === 'video';
  // Subscribe so the usable-provider list updates as keys are entered.
  useAIStore((s) => s.providers);
  useAIStore((s) => s.hosted);
  useEffect(() => void ensureHostedAi(), []);
  // Cloud or own keys, never both: the source chosen in AI settings.
  const hostedMeta = isVideo ? null : hostedImageMeta();
  const providers =
    aiSource() === 'hosted'
      ? hostedMeta
        ? [hostedMeta]
        : []
      : (isVideo ? VIDEO_PROVIDERS : IMAGE_PROVIDERS).filter((m) => providerKey(m.provider));

  const [providerIdx, setProviderIdx] = useState(0);
  const meta = providers[Math.min(providerIdx, providers.length - 1)];
  const modelKey = `${mode}:${meta?.provider ?? ''}`;

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(() =>
    meta ? loadModelPref(modelKey, meta.defaultModel) : '',
  );
  const [size, setSize] = useState(meta?.sizes[0] ?? '1024x1024');
  const [count, setCount] = useState(1);
  // The provider's actual catalog for this kind, fetched with the user's key
  // (model ids churn — hardcoded ids broke every provider at least once).
  const [modelList, setModelList] = useState<string[] | null>(null);
  const [listState, setListState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    // Reset happens in the microtask so the effect body itself stays pure.
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setListState('loading');
        setModelList(null);
      }
    });
    fetchMediaModels(meta.provider, mode)
      .then((models) => {
        if (cancelled) return;
        setModelList(models);
        setListState('ok');
        // Keep the remembered/typed model if it's in the list; else take the
        // first available.
        setModel((cur) => (models.includes(cur) ? cur : (models[0] ?? cur)));
      })
      .catch(() => {
        if (!cancelled) setListState('error'); // editable fallback below
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.provider, mode]);

  const pickProvider = (idx: number) => {
    setProviderIdx(idx);
    const next = providers[idx];
    if (next) {
      setModel(loadModelPref(`${mode}:${next.provider}`, next.defaultModel));
      setSize(next.sizes[0] ?? '1024x1024');
    }
  };

  const sizes = meta?.sizes ?? [];
  const activeSize = sizes.includes(size) ? size : (sizes[0] ?? '1024x1024');

  const run = () => {
    if (!meta || !prompt.trim() || !model.trim()) return;
    saveModelPref(modelKey, model.trim());
    // Fire and forget: progress (and any error) lives on a canvas placeholder,
    // like text generation — no waiting inside the dialog.
    if (isVideo) generateVideoInBackground(meta, model.trim(), prompt.trim());
    else generateImagesInBackground(meta, model.trim(), prompt.trim(), activeSize, count);
    close();
  };

  return (
    <UiDialog
      title={isVideo ? 'Generate Video' : 'Generate Image'}
      onClose={close}
      className="aimedia-sheet"
      testId="aimedia-dialog"
    >
      <div className="aimedia-body">
        {providers.length === 0 ? (
          <p className="settings-hint" data-testid="aimedia-nokeys">
            No provider keys yet. Add an {isVideo ? 'xAI (Grok)' : 'OpenAI, Google or xAI'} API key
            in Settings → Plugins → AI Image &amp; Video.
          </p>
        ) : (
          <>
            <textarea
              className="aimedia-prompt"
              value={prompt}
              placeholder={isVideo ? 'Describe the video' : 'Describe the image'}
              autoFocus
              data-autofocus
              data-testid="aimedia-prompt"
              onChange={(e) => setPrompt(e.target.value)}
            />
            {providers.length > 1 && (
              <label className="aimedia-field">
                <span>Provider</span>
                <select
                  value={providerIdx}
                  data-testid="aimedia-provider"
                  onChange={(e) => pickProvider(Number(e.target.value))}
                >
                  {providers.map((m, i) => (
                    <option key={m.provider} value={i}>
                      {m.providerLabel}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="aimedia-field">
              <span>Model</span>
              {listState === 'ok' && modelList && modelList.length > 0 ? (
                <select
                  value={model}
                  data-testid="aimedia-model"
                  onChange={(e) => setModel(e.target.value)}
                >
                  {modelList.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  list="aimedia-model-suggestions"
                  value={model}
                  spellCheck={false}
                  placeholder={listState === 'loading' ? 'Loading models' : undefined}
                  data-testid="aimedia-model-input"
                  onChange={(e) => setModel(e.target.value)}
                />
              )}
              <datalist id="aimedia-model-suggestions">
                {(meta?.suggestedModels ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            {listState === 'ok' && modelList && modelList.length === 0 && (
              <p className="sync-error" role="alert" data-testid="aimedia-nomodels">
                Your {meta?.providerLabel} key has no {isVideo ? 'video' : 'image'} generation
                models.
              </p>
            )}
            {!isVideo && sizes.length > 1 && (
              <label className="aimedia-field">
                <span>Size</span>
                <select
                  value={activeSize}
                  data-testid="aimedia-size"
                  onChange={(e) => setSize(e.target.value)}
                >
                  {sizes.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('x', ' × ')}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!isVideo && (
              <label className="aimedia-field">
                <span>Count</span>
                <select
                  value={count}
                  data-testid="aimedia-count"
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isVideo && (
              <p className="settings-hint">
                Video generation runs a background job and can take a minute or two.
              </p>
            )}
            <div className="aimedia-actions">
              <button
                type="button"
                className="sync-primary"
                disabled={!prompt.trim() || !model.trim()}
                data-testid="aimedia-generate"
                onClick={run}
              >
                {isVideo ? 'Generate Video' : 'Generate'}
              </button>
            </div>
          </>
        )}
      </div>
    </UiDialog>
  );
}

/** Bottom-right corner toggle for the Board Assistant chat. */
function ChatCornerButton() {
  const open = useChatStore((s) => s.open);
  // The chat panel lives on the CANVAS only — in the gallery (the lightbox's
  // "All items" index) the toggle would render but do nothing.
  const view = useSessionStore((s) => s.view);
  if (view !== 'canvas') return null;
  return (
    <UiTooltip label={open ? 'Hide Board Assistant' : 'Board Assistant'}>
      <button
        type="button"
        className={`corner-toggle${open ? ' active' : ''}`}
        data-testid="chat-corner-toggle"
        aria-pressed={open}
        aria-label="Board Assistant"
        onClick={() => useChatStore.getState().toggle()}
      >
        <ChatIcon />
      </button>
    </UiTooltip>
  );
}

// --- board tools: the assistant can generate media (text→ or image→) -----------

function toolMeta(
  kind: 'image' | 'video',
  requested: string | undefined,
  needsSource: boolean,
): MediaProviderMeta {
  const pool = kind === 'image' ? IMAGE_PROVIDERS : VIDEO_PROVIDERS;
  // img2img has no xAI path; everything else is any keyed provider, or the
  // Cloud provider alone when that is the source in AI settings.
  const hostedMeta = kind === 'image' ? hostedImageMeta() : null;
  const usable =
    aiSource() === 'hosted'
      ? hostedMeta
        ? [hostedMeta]
        : []
      : pool.filter(
          (m) =>
            providerKey(m.provider) && !(kind === 'image' && needsSource && m.provider === 'xai'),
        );
  if (requested) {
    const hit = usable.find((m) => m.provider === requested);
    if (!hit) {
      throw new Error(
        `Provider "${requested}" is not available for this request. Usable: ${usable.map((m) => m.provider).join(', ') || '(none — the user must add an API key in Settings → Plugins → AI Generation)'}.`,
      );
    }
    return hit;
  }
  if (!usable[0]) {
    throw new Error(
      'No usable provider key. The user must add an OpenAI, Google or xAI API key in Settings → Plugins → AI Generation.',
    );
  }
  return usable[0];
}

function toolModel(
  kind: 'image' | 'video',
  meta: MediaProviderMeta,
  requested: string | undefined,
  needsSource: boolean,
): string {
  let model = requested ?? loadModelPref(`${kind}:${meta.provider}`, meta.defaultModel);
  // Imagen can't edit; silently upgrade a saved Imagen pref to a Gemini image
  // model when a source rides along (an explicit request still errors server-side).
  if (!requested && needsSource && meta.provider === 'google' && /^imagen/i.test(model)) {
    model = 'gemini-2.5-flash-image';
  }
  return model;
}

/** Placeholder center: beside the source item, or the view center. */
function spotBeside(
  sourceItemId: string | undefined,
  w: number,
  h: number,
): { x: number; y: number } | undefined {
  if (!sourceItemId) return undefined;
  const item = useDocumentStore.getState().doc.items[sourceItemId];
  if (!item) return undefined;
  return openSpotNear({ x: item.x + item.width + 28 + w / 2, y: item.y + h / 2 }, w, h);
}

const generationStartedNote = (what: string) =>
  `${what} started — a placeholder is on the canvas and the result lands there when ready (seconds for images, minutes for video). Do not wait or poll; tell the user it is on its way.`;

const GENERATION_TOOLS: BoardTool[] = [
  {
    name: 'generate_image',
    description:
      "Generate one or more images from a text prompt with the user's cloud AI provider (OpenAI, Google or xAI key). Pass source_item_id (an image item on the board) for image-to-image: remixes, style transfers, edits of that image — the conversation's focus item is the natural source. Starts a background job and returns immediately; results land on the canvas next to the source (or at the view center).",
    parameters: z.object({
      prompt: z
        .string()
        .min(1)
        .describe('What to generate; for image-to-image, describe the change or variation.'),
      source_item_id: z
        .string()
        .optional()
        .describe('Image item id to transform (image-to-image).'),
      provider: z
        .enum(['openai', 'google', 'xai'])
        .optional()
        .describe('Defaults to the first provider with a key (xAI cannot do image-to-image).'),
      model: z
        .string()
        .optional()
        .describe("Provider model id; defaults to the user's last-used model."),
      n: z.number().int().min(1).max(4).optional(),
      size: z.string().optional().describe('e.g. 1024x1024, 1536x1024, 1024x1536 (OpenAI only).'),
    }),
    access: 'external',
    execute: async (args) => {
      const meta = toolMeta('image', args.provider, !!args.source_item_id);
      const model = toolModel('image', meta, args.model, !!args.source_item_id);
      const size = args.size ?? meta.sizes[0] ?? '1024x1024';
      const source = args.source_item_id ? await itemSourceImage(args.source_item_id) : undefined;
      const dims = placeholderDims(size);
      const at = spotBeside(args.source_item_id, dims.width, dims.height);
      generateImagesInBackground(meta, model, args.prompt, size, args.n ?? 1, {
        ...(source ? { source } : {}),
        ...(args.source_item_id ? { sourceItemId: args.source_item_id } : {}),
        ...(at ? { at } : {}),
      });
      return {
        started: true,
        provider: meta.provider,
        model,
        note: generationStartedNote('Image generation'),
      };
    },
  },
  {
    name: 'generate_video',
    description:
      "Generate a short video from a text prompt with the user's cloud AI provider (xAI or Google Veo key). Pass source_item_id (an image item on the board) for image-to-video: the image becomes the opening frame and the prompt describes the motion — the conversation's focus item is the natural source. Starts a background job and returns immediately (video takes minutes); the result lands on the canvas next to the source (or at the view center).",
    parameters: z.object({
      prompt: z.string().min(1).describe('The scene / motion to generate.'),
      source_item_id: z.string().optional().describe('Image item id to animate (image-to-video).'),
      provider: z
        .enum(['xai', 'google'])
        .optional()
        .describe('Defaults to the first provider with a key.'),
      model: z
        .string()
        .optional()
        .describe("Provider model id; defaults to the user's last-used model."),
    }),
    access: 'external',
    execute: async (args) => {
      const meta = toolMeta('video', args.provider, !!args.source_item_id);
      const model = toolModel('video', meta, args.model, !!args.source_item_id);
      const source = args.source_item_id ? await itemSourceImage(args.source_item_id) : undefined;
      const at = spotBeside(args.source_item_id, 720, 405);
      generateVideoInBackground(meta, model, args.prompt, {
        ...(source ? { source } : {}),
        ...(args.source_item_id ? { sourceItemId: args.source_item_id } : {}),
        ...(at ? { at } : {}),
      });
      return {
        started: true,
        provider: meta.provider,
        model,
        note: generationStartedNote('Video generation'),
      };
    },
  },
];

registerPlugin({
  manifest: {
    id: 'ai-media',
    order: 60,
    name: 'AI Generation',
    description:
      'Generate text (OpenAI, Anthropic, Google, xAI, Ollama), images (OpenAI, Google, xAI) and video (xAI, Google Veo) from a prompt — or from an existing image (image-to-image, image-to-video). One set of provider keys.',
  },
  addMenu: [
    {
      label: 'Generate Text',
      category: 'documents',
      icon: <SparkleIcon />,
      onSelect: () => useSessionStore.getState().setGenerateTextOpen(true),
    },
    {
      label: 'Generate Image',
      category: 'media',
      icon: <ImageIcon />,
      onSelect: () => useMediaDialog.getState().open('image'),
    },
    {
      label: 'Generate Video',
      category: 'media',
      icon: <VideoIcon />,
      onSelect: () => useMediaDialog.getState().open('video'),
    },
  ],
  Component: AiPluginComponent,
  ItemSidePanel: ItemChat,
  tools: [...GENERATION_TOOLS, threadSearchTool],
  SettingsPanel: AIProvidersPanel,
  CornerButton: ChatCornerButton,
});
