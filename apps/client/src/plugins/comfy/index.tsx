import './style.css';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { z } from 'zod';
import * as RadixSelect from '@radix-ui/react-select';
import type { ImageItem } from '@boardcache/schema';
import { ChevronDownIcon, ImageIcon, TrashIcon, VideoIcon } from '../../components/icons';
import { UiSelect } from '../../components/ui/Select';
import {
  SettingsActions,
  SettingsField,
  SettingsGroup,
  SettingsInput,
  SettingsTextarea,
} from '../../components/ui/SettingsForm';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { UiDialog } from '../../components/ui/Dialog';
import { useDocumentStore } from '../../state/documentStore';
import { registerPlugin } from '../registry';
import { usePluginSettings } from '../settingsStore';
import {
  COMPONENT_FAMILY,
  comfyServerUrl,
  comfyTemplates,
  detectWanModels,
  familyDefaults,
  generateComfyWanInBackground,
  imageFamily,
  isAudioFamily,
  isVideoFamily,
  wanComponents,
  fetchComfyModels,
  generateComfyImageInBackground,
  generateComfyTemplateInBackground,
  generateComfyVideoInBackground,
  guessClipType,
  guessTextEncoders,
  guessVae,
  parseTemplateGraph,
  templateNeedsImage,
} from './comfyGen';
import type { ComfyModels, ComfySettings, ComfyTemplate, WanModel } from './comfyGen';

/**
 * ComfyUI plugin: image + video generation on the user's own ComfyUI server.
 * Classic checkpoints AND component models (FLUX/SD3/Wan/… via UNETLoader +
 * text encoders + VAE) for images; SVD for built-in image-to-video; saved
 * workflow templates (API-format export) for anything else — including
 * modern video architectures. The Board Assistant drives it through board
 * tools; canvas images get right-click generate entries.
 */

type Mode = 'image' | 'video';

/** Model choice encoding for the unified dropdown. */
type Choice =
  | { kind: 'ckpt'; name: string }
  | { kind: 'unet'; name: string }
  | { kind: 'svd'; name: string }
  | { kind: 'wan'; wan: WanModel }
  | { kind: 'tpl'; template: ComfyTemplate };

const choiceValue = (c: Choice) =>
  c.kind === 'tpl'
    ? `tpl:${c.template.id}`
    : c.kind === 'wan'
      ? `wan:${c.wan.key}`
      : `${c.kind}:${c.name}`;

interface ComfyDialogState {
  open: boolean;
  mode: Mode;
  sourceItemId: string | null;
  show: (mode: Mode, sourceItemId?: string) => void;
  close: () => void;
}

export const useComfyDialog = create<ComfyDialogState>((set) => ({
  open: false,
  mode: 'image',
  sourceItemId: null,
  show: (mode, sourceItemId) => set({ open: true, mode, sourceItemId: sourceItemId ?? null }),
  close: () => set({ open: false, sourceItemId: null }),
}));

const IMAGE_SIZES = [
  '1024x1024',
  '768x768',
  '512x512',
  '832x1216',
  '1216x832',
  '1024x1536',
  '1536x1024',
];

function ComfyPluginComponent() {
  const open = useComfyDialog((s) => s.open);
  return open ? <ComfyDialogBody /> : null;
}

/** Source-image picker with thumbnails (native <select> can't show images). */
function SourceThumb({ item }: { item: ImageItem }) {
  const url = useAssetUrl(item.previewAssetId ?? item.assetId);
  return url ? (
    <img className="comfy-src-thumb" src={url} alt="" draggable={false} />
  ) : (
    <span className="comfy-src-thumb" />
  );
}

function SourceSelect({
  items,
  value,
  placeholder,
  onChange,
}: {
  items: ImageItem[];
  value: string | null;
  placeholder: string;
  onChange: (id: string | null) => void;
}) {
  return (
    <RadixSelect.Root
      value={value ?? 'none'}
      onValueChange={(v) => onChange(v === 'none' ? null : v)}
    >
      <RadixSelect.Trigger
        className="ui-select-trigger comfy-source-trigger"
        aria-label="Source image"
        data-testid="comfy-source"
      >
        <RadixSelect.Value />
        <RadixSelect.Icon className="ui-select-caret">
          <ChevronDownIcon size={16} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="ui-select-content" position="popper" sideOffset={6}>
          <RadixSelect.Viewport className="ui-select-viewport">
            <RadixSelect.Item value="none" className="ui-select-item">
              <RadixSelect.ItemText>{placeholder}</RadixSelect.ItemText>
            </RadixSelect.Item>
            {items.map((i) => (
              <RadixSelect.Item
                key={i.id}
                value={i.id}
                className="ui-select-item"
                data-testid={`comfy-source-opt-${i.id}`}
              >
                <RadixSelect.ItemText>
                  <span className="comfy-source-option">
                    <SourceThumb item={i} />
                    <span className="comfy-source-name">
                      {i.name || `image-${i.id.slice(0, 4)}`}
                    </span>
                  </span>
                </RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function ComfyDialogBody() {
  const close = () => useComfyDialog.getState().close();
  const mode = useComfyDialog((s) => s.mode);
  const sourceItemId = useComfyDialog((s) => s.sourceItemId);
  usePluginSettings((s) => s.settings['comfyui']); // re-render as settings change
  const isVideo = mode === 'video';

  const doc = useDocumentStore((s) => s.doc);

  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [choiceKey, setChoiceKey] = useState('');
  const [clip1, setClip1] = useState('');
  const [clip2, setClip2] = useState('');
  const [clipType, setClipType] = useState('');
  const [vae, setVae] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [steps, setSteps] = useState(20);
  const [cfg, setCfg] = useState(7);
  const [sampler, setSampler] = useState('euler');
  const [denoise, setDenoise] = useState(0.6);
  const [frames, setFrames] = useState(14);
  const [fps, setFps] = useState(6);
  const [motion, setMotion] = useState(127);
  const [models, setModels] = useState<ComfyModels | null>(null);
  const [listState, setListState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [listError, setListError] = useState('');

  const configured = comfyServerUrl().length > 0;
  const templates = comfyTemplates().filter((t) => t.kind === mode);
  const otherTemplates = comfyTemplates().filter((t) => t.kind !== mode).length;

  // All selectable "models" for a tab.
  const buildChoices = (list: ComfyModels | null, m: Mode): Choice[] => {
    const tpl = comfyTemplates()
      .filter((t) => t.kind === m)
      .map((template): Choice => ({ kind: 'tpl', template }));
    return m === 'video'
      ? [
          ...tpl,
          ...detectWanModels(list?.unets ?? [], list?.vaes ?? []).map(
            (wan): Choice => ({ kind: 'wan', wan }),
          ),
          ...(list?.videoCheckpoints ?? []).map((name): Choice => ({ kind: 'svd', name })),
        ]
      : [
          ...tpl,
          ...(list?.checkpoints ?? [])
            .filter((n) => !isVideoFamily(n) && !isAudioFamily(n))
            .map((name): Choice => ({ kind: 'ckpt', name })),
          ...(list?.unets ?? [])
            .filter((n) => !isVideoFamily(n) && !isAudioFamily(n))
            .map((name): Choice => ({ kind: 'unet', name })),
        ];
  };
  const choices = buildChoices(models, mode);
  // Video-architecture files can't run through the generic image graph —
  // they're hidden from the image tab and need a saved workflow instead.
  const wanNames = new Set(
    detectWanModels(models?.unets ?? [], models?.vaes ?? []).flatMap((w) =>
      w.low ? [w.high, w.low] : [w.high],
    ),
  );
  const excluded = isVideo
    ? []
    : [...(models?.checkpoints ?? []), ...(models?.unets ?? [])].filter(
        (n) => isVideoFamily(n) && !wanNames.has(n),
      );
  const active = choices.find((c) => choiceValue(c) === choiceKey) ?? choices[0] ?? null;

  /** Auto-fill the component pickers for a selected model. Checkpoints whose
   *  filename looks like a component family (LTX, FLUX without embedded
   *  CLIP) get a text-encoder override pre-filled too. */
  const autoComponents = (c: Choice | null, list: ComfyModels) => {
    const componentCkpt = c?.kind === 'ckpt' && COMPONENT_FAMILY.test(c.name);
    if (!c || (c.kind !== 'unet' && !componentCkpt)) {
      setClip1('');
      setClip2('');
      setVae('');
      setClipType('');
      return;
    }
    const enc = guessTextEncoders(c.name, list.clips);
    setClip1(enc.clip1 ?? '');
    setClip2(enc.clip2 ?? '');
    setClipType(guessClipType(c.name, list.clipTypes));
    // Component checkpoints usually still embed their VAE — leave it.
    setVae(c.kind === 'unet' ? (guessVae(c.name, list.vaes) ?? '') : '');
  };

  /** Per-family sampling defaults so the model "just works" untouched. */
  const applyDefaults = (c: Choice | null) => {
    if (c && (c.kind === 'ckpt' || c.kind === 'unet')) {
      const d = familyDefaults(imageFamily(c.name));
      setSteps(d.steps);
      setCfg(d.cfg);
    }
  };

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setListState('loading');
    });
    fetchComfyModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setListState('ok');
        if (list.samplers.length && !list.samplers.includes('euler')) {
          setSampler(list.samplers[0]!);
        }
        // Auto-fill components for whatever choice becomes active.
        const cs = buildChoices(list, mode);
        const act = cs.find((c) => choiceValue(c) === choiceKey) ?? cs[0] ?? null;
        autoComponents(act, list);
        applyDefaults(act);
      })
      .catch((err) => {
        if (cancelled) return;
        setListState('error');
        setListError(err instanceof Error ? err.message : 'Could not reach the server.');
      });
    return () => {
      cancelled = true;
    };
    // Fetch once per dialog open; the list covers both tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  const isTemplate = active?.kind === 'tpl';
  const isWan = active?.kind === 'wan';
  const needsSource =
    (isTemplate && active.template.needsImage) ||
    (isVideo && active?.kind === 'svd') ||
    (isWan && active.wan.mode === 'i2v');
  // t2v models cannot take a start image — the Source field is ignored there.
  const sourceIgnored = isWan && active.wan.mode === 't2v' && !!sourceItemId;
  const promptRequired = (!isVideo && !isTemplate) || isWan;

  const canRun =
    configured &&
    listState === 'ok' &&
    active !== null &&
    (!promptRequired || prompt.trim().length > 0) &&
    (!needsSource || !!sourceItemId) &&
    (active.kind !== 'unet' || (clip1.length > 0 && vae.length > 0)) &&
    (!isWan ||
      (!!models &&
        !!wanComponents(models, active.wan).clip &&
        !!wanComponents(models, active.wan).vae));

  const run = () => {
    if (!canRun || !active) return;
    if (active.kind === 'wan') {
      if (!models) return;
      const parts = wanComponents(models, active.wan);
      if (!parts.clip || !parts.vae) return;
      generateComfyWanInBackground({
        wan: active.wan,
        clip: parts.clip,
        vae: parts.vae,
        clipVision: parts.clipVision,
        prompt: prompt.trim(),
        negative: negative.trim(),
        width: 832,
        height: 480,
        length: frames,
        fps: 16,
        steps: 20,
        ...(active.wan.mode !== 't2v' && sourceItemId ? { sourceItemId } : {}),
      });
    } else if (active.kind === 'tpl') {
      generateComfyTemplateInBackground({
        template: active.template,
        prompt: prompt.trim(),
        negative: negative.trim(),
        ...(sourceItemId ? { sourceItemId } : {}),
      });
    } else if (active.kind === 'svd') {
      generateComfyVideoInBackground({
        checkpoint: active.name,
        sourceItemId: sourceItemId!,
        frames,
        fps,
        motion,
      });
    } else {
      const m = /^(\d+)x(\d+)$/.exec(size)!;
      generateComfyImageInBackground({
        prompt: prompt.trim(),
        negative: negative.trim(),
        modelKind: active.kind === 'unet' ? 'unet' : 'checkpoint',
        model: active.name,
        ...(clip1 ? { clip1 } : {}),
        ...(clip2 ? { clip2 } : {}),
        ...(clipType ? { clipType } : {}),
        ...(vae ? { vae } : {}),
        width: Number(m[1]),
        height: Number(m[2]),
        steps,
        cfg,
        sampler,
        denoise,
        ...(sourceItemId ? { sourceItemId } : {}),
      });
    }
    close();
  };

  const showImageParams = !isVideo && !isTemplate && active !== null;

  const switchTab = (m: Mode) => {
    if (m === mode) return;
    useComfyDialog.setState({ mode: m });
    setChoiceKey('');
    if (models) {
      const cs = buildChoices(models, m);
      autoComponents(cs[0] ?? null, models);
      applyDefaults(cs[0] ?? null);
      if (cs[0]?.kind === 'wan') setFrames(49);
      else if (cs[0]?.kind === 'svd') setFrames(14);
    }
  };

  const imageItems = Object.values(doc.items).filter((i) => i.type === 'image');

  return (
    <UiDialog
      title="Generate with ComfyUI"
      onClose={close}
      className="aimedia-sheet"
      testId="comfy-dialog"
    >
      <div className="aimedia-body">
        <div className="comfy-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!isVideo}
            className={`comfy-tab${isVideo ? '' : ' active'}`}
            data-testid="comfy-tab-image"
            onClick={() => switchTab('image')}
          >
            Image
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isVideo}
            className={`comfy-tab${isVideo ? ' active' : ''}`}
            data-testid="comfy-tab-video"
            onClick={() => switchTab('video')}
          >
            Video
          </button>
        </div>
        {!configured ? (
          <p className="settings-hint" data-testid="comfy-nourl">
            Set your ComfyUI server address first (Settings → Plugins → ComfyUI).
          </p>
        ) : listState === 'error' ? (
          <p className="sync-error" role="alert" data-testid="comfy-error">
            {listError}
          </p>
        ) : (
          <>
            {imageItems.length > 0 && (
              <label className="aimedia-field">
                <span>Source</span>
                <SourceSelect
                  items={imageItems as ImageItem[]}
                  value={sourceItemId}
                  placeholder={isVideo ? '— choose an image to animate —' : 'None (text to image)'}
                  onChange={(id) => useComfyDialog.setState({ sourceItemId: id })}
                />
              </label>
            )}
            {(!isVideo || isTemplate || isWan) && (
              <>
                <textarea
                  className="aimedia-prompt"
                  value={prompt}
                  placeholder={
                    isTemplate ? 'Prompt (injected into the workflow)…' : 'Describe the image'
                  }
                  autoFocus
                  data-autofocus
                  data-testid="comfy-prompt"
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <label className="aimedia-field">
                  <span>Negative</span>
                  <input
                    type="text"
                    value={negative}
                    placeholder="What to avoid (optional)"
                    data-testid="comfy-negative"
                    onChange={(e) => setNegative(e.target.value)}
                  />
                </label>
              </>
            )}
            <label className="aimedia-field">
              <span>Model</span>
              <select
                value={active ? choiceValue(active) : ''}
                disabled={listState === 'loading'}
                data-testid="comfy-model"
                onChange={(e) => {
                  setChoiceKey(e.target.value);
                  const next = choices.find((c) => choiceValue(c) === e.target.value) ?? null;
                  if (models) autoComponents(next, models);
                  applyDefaults(next);
                  // Wan lengths must be 4k+1; SVD wants its own short counts.
                  if (next?.kind === 'wan') setFrames(49);
                  else if (next?.kind === 'svd') setFrames(14);
                }}
              >
                {listState === 'loading' && <option value="">Loading models</option>}
                {templates.length > 0 && (
                  <optgroup label="Saved workflows">
                    {templates.map((t) => (
                      <option key={t.id} value={`tpl:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {!isVideo && choices.some((c) => c.kind === 'ckpt' || c.kind === 'unet') && (
                  <optgroup label="Image models">
                    {choices
                      .filter((c) => c.kind === 'ckpt' || c.kind === 'unet')
                      .map((c) =>
                        c.kind === 'ckpt' || c.kind === 'unet' ? (
                          <option key={c.name} value={`${c.kind}:${c.name}`}>
                            {c.name}
                          </option>
                        ) : null,
                      )}
                  </optgroup>
                )}
                {isVideo && choices.some((c) => c.kind === 'wan' || c.kind === 'svd') && (
                  <optgroup label="Video models">
                    {choices.map((c) =>
                      c.kind === 'wan' ? (
                        <option key={c.wan.key} value={`wan:${c.wan.key}`}>
                          {c.wan.label}
                          {c.wan.mode === 'i2v'
                            ? ' (image to video)'
                            : c.wan.mode === 't2v'
                              ? ' (text to video)'
                              : ''}
                        </option>
                      ) : c.kind === 'svd' ? (
                        <option key={c.name} value={`svd:${c.name}`}>
                          {c.name} (image to video)
                        </option>
                      ) : null,
                    )}
                  </optgroup>
                )}
              </select>
            </label>
            {(templates.length > 0 || otherTemplates > 0) && (
              <p className="settings-hint" data-testid="comfy-tpl-hint">
                {templates.length > 0 &&
                  'Imported workflows are at the top of the Model list under “Saved workflows”. '}
                {otherTemplates > 0 &&
                  `${otherTemplates} imported ${isVideo ? 'image' : 'video'} workflow${
                    otherTemplates === 1 ? ' is' : 's are'
                  } on the ${isVideo ? 'Image' : 'Video'} tab.`}
              </p>
            )}
            {listState === 'ok' && choices.length === 0 && (
              <p className="sync-error" role="alert" data-testid="comfy-nomodels">
                {isVideo
                  ? 'No video path available: add an SVD checkpoint to the server, or save a video workflow template in the plugin settings (Settings → Plugins → ComfyUI).'
                  : 'No usable image models found on the server.'}
              </p>
            )}
            {listState === 'ok' && !isVideo && (wanNames.size > 0 || excluded.length > 0) && (
              <p className="settings-hint" data-testid="comfy-excluded">
                {wanNames.size > 0 && 'Your Wan video models are on the Video tab. '}
                {excluded.length > 0 && (
                  <>
                    {excluded.length === 1
                      ? `${excluded[0]} is a video model`
                      : `${excluded.slice(0, 3).join(', ')}${excluded.length > 3 ? '…' : ''} are video models`}{' '}
                    without built-in support — export its workflow from ComfyUI (Workflow → Export
                    API) and add it in the plugin settings to use it.
                  </>
                )}
              </p>
            )}
            {!isTemplate && (active?.kind === 'unet' || active?.kind === 'ckpt') && (
              <details
                className="comfy-components"
                open={active.kind === 'unet' && (clip1 === '' || vae === '')}
                data-testid="comfy-components"
              >
                <summary>
                  Text encoder &amp; VAE {active.kind === 'unet' ? '(required)' : '(override)'}
                </summary>
                <p className="settings-hint">
                  {active.kind === 'unet'
                    ? 'Component model — text encoder and VAE load separately (auto-detected, adjust if needed).'
                    : 'For checkpoints without an embedded text encoder (LTX, FLUX) — pick one here instead of using the checkpoint\u2019s.'}
                </p>
                <label className="aimedia-field">
                  <span>Text encoder</span>
                  <select
                    value={clip1}
                    data-testid="comfy-clip1"
                    onChange={(e) => setClip1(e.target.value)}
                  >
                    <option value="">
                      {active.kind === 'unet' ? '— required —' : 'From checkpoint'}
                    </option>
                    {(models?.clips ?? []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="aimedia-field">
                  <span>Encoder 2</span>
                  <select value={clip2} onChange={(e) => setClip2(e.target.value)}>
                    <option value="">— none —</option>
                    {(models?.clips ?? []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="aimedia-field">
                  <span>CLIP type</span>
                  <select value={clipType} onChange={(e) => setClipType(e.target.value)}>
                    {(models?.clipTypes ?? []).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="aimedia-field">
                  <span>VAE</span>
                  <select
                    value={vae}
                    data-testid="comfy-vae"
                    onChange={(e) => setVae(e.target.value)}
                  >
                    <option value="">
                      {active.kind === 'unet' ? '— required —' : 'From checkpoint'}
                    </option>
                    {(models?.vaes ?? []).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </details>
            )}
            {showImageParams && (
              <>
                {!sourceItemId && (
                  <label className="aimedia-field">
                    <span>Size</span>
                    <select
                      value={size}
                      data-testid="comfy-size"
                      onChange={(e) => setSize(e.target.value)}
                    >
                      {IMAGE_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace('x', ' × ')}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <details className="comfy-components" data-testid="comfy-advanced">
                  <summary>Advanced</summary>
                  <label className="aimedia-field">
                    <span>Steps</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={steps}
                      data-testid="comfy-steps"
                      onChange={(e) => setSteps(Math.max(1, Math.min(100, Number(e.target.value))))}
                    />
                  </label>
                  <label className="aimedia-field">
                    <span>CFG</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      step={0.5}
                      value={cfg}
                      data-testid="comfy-cfg"
                      onChange={(e) => setCfg(Math.max(1, Math.min(30, Number(e.target.value))))}
                    />
                  </label>
                  {(models?.samplers.length ?? 0) > 0 && (
                    <label className="aimedia-field">
                      <span>Sampler</span>
                      <select value={sampler} onChange={(e) => setSampler(e.target.value)}>
                        {models!.samplers.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </details>
                {sourceItemId && (
                  <label className="aimedia-field">
                    <span>Strength ({Math.round(denoise * 100)}%)</span>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={Math.round(denoise * 100)}
                      data-testid="comfy-denoise"
                      onChange={(e) => setDenoise(Number(e.target.value) / 100)}
                    />
                  </label>
                )}
              </>
            )}
            {isWan && (
              <label className="aimedia-field">
                <span>Length</span>
                <select
                  value={frames}
                  data-testid="comfy-frames"
                  onChange={(e) => setFrames(Number(e.target.value))}
                >
                  {[
                    [33, '~2s'],
                    [49, '~3s'],
                    [81, '~5s'],
                  ].map(([n, label]) => (
                    <option key={n} value={n}>
                      {n} frames ({label})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {sourceIgnored && (
              <p className="settings-hint">
                This is a text-to-video model — the source image is ignored. Pick an image-to-video
                model to animate it.
              </p>
            )}
            {isVideo && active?.kind === 'svd' && (
              <>
                <label className="aimedia-field">
                  <span>Frames</span>
                  <select
                    value={frames}
                    data-testid="comfy-frames"
                    onChange={(e) => setFrames(Number(e.target.value))}
                  >
                    {[14, 25].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <details className="comfy-components" data-testid="comfy-advanced">
                  <summary>Advanced</summary>
                  <label className="aimedia-field">
                    <span>FPS</span>
                    <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                      {[6, 8, 12].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="aimedia-field">
                    <span>Motion ({motion})</span>
                    <input
                      type="range"
                      min={1}
                      max={255}
                      value={motion}
                      onChange={(e) => setMotion(Number(e.target.value))}
                    />
                  </label>
                </details>
              </>
            )}
            {needsSource && !sourceItemId && (
              <p className="settings-hint" data-testid="comfy-needs-source">
                {imageItems.length > 0
                  ? 'This needs a source image — pick one in the Source field above.'
                  : 'This needs a source image — add an image to the board first.'}
              </p>
            )}
            <div className="aimedia-actions">
              <button
                type="button"
                className="sync-primary"
                disabled={!canRun}
                data-testid="comfy-generate"
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

// --- settings --------------------------------------------------------------------

function newTemplateId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `w-${Math.random().toString(36).slice(2)}`;
}

function ComfySettingsPanel() {
  const settings =
    (usePluginSettings((s) => s.settings['comfyui']) as ComfySettings | undefined) ?? {};
  const templates = settings.templates ?? [];
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplKind, setTplKind] = useState<'image' | 'video'>('video');
  const [tplJson, setTplJson] = useState('');
  const [tplError, setTplError] = useState<string | null>(null);

  const save = (patch: Partial<ComfySettings>) =>
    usePluginSettings.getState().set('comfyui', { ...settings, ...patch });

  const check = () => {
    setChecking(true);
    setStatus(null);
    fetchComfyModels()
      .then((m) => {
        const image = [...m.checkpoints, ...m.unets].filter(
          (n) => !isVideoFamily(n) && !isAudioFamily(n),
        ).length;
        const video = detectWanModels(m.unets, m.vaes).length + m.videoCheckpoints.length;
        setStatus(
          `Connected — ${image} image model${image === 1 ? '' : 's'}, ` +
            `${video} video model${video === 1 ? '' : 's'}.`,
        );
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not connect.'))
      .finally(() => setChecking(false));
  };

  const addTemplate = () => {
    setTplError(null);
    try {
      parseTemplateGraph(tplJson);
    } catch (err) {
      setTplError(err instanceof Error ? err.message : 'Invalid workflow.');
      return;
    }
    const template: ComfyTemplate = {
      id: newTemplateId(),
      name: tplName.trim() || `Workflow ${templates.length + 1}`,
      kind: tplKind,
      needsImage: templateNeedsImage(tplJson),
      json: tplJson,
    };
    save({ templates: [...templates, template] });
    setTplName('');
    setTplJson('');
  };

  return (
    <div className="plugin-settings-fields">
      <SettingsGroup
        title="Server"
        hint="Requests are relayed through this site's server; models are listed straight from ComfyUI."
      >
        <SettingsField label="Server URL" hint="The address of your ComfyUI server.">
          <SettingsInput
            type="url"
            value={settings.serverUrl ?? ''}
            placeholder="http://127.0.0.1:8188"
            spellCheck={false}
            testId="comfy-url"
            onChange={(e) => save({ serverUrl: e.target.value })}
          />
        </SettingsField>
        <SettingsActions>
          {status && (
            <p className="settings-hint" data-testid="comfy-status">
              {status}
            </p>
          )}
          <button
            type="button"
            disabled={!comfyServerUrl() || checking}
            data-testid="comfy-check"
            onClick={check}
          >
            {checking ? 'Checking' : 'Test connection'}
          </button>
        </SettingsActions>
      </SettingsGroup>

      <SettingsGroup
        title="Workflow templates"
        hint="For anything the built-in workflows do not cover: newer video models (Wan, Hunyuan, LTX), upscalers, custom pipelines. In ComfyUI choose Workflow, then Export (API), and paste it here. Prompts, source image and seed are filled in per run."
      >
        {templates.map((t) => (
          <div className="comfy-tpl-row" key={t.id} data-testid="comfy-tpl-row">
            <span className="comfy-tpl-name">{t.name}</span>
            <span className="comfy-tpl-meta">
              {t.kind}
              {t.needsImage ? ' · needs source image' : ''}
            </span>
            <button
              type="button"
              aria-label={`Delete ${t.name}`}
              title="Delete workflow"
              data-testid="comfy-tpl-delete"
              onClick={() => save({ templates: templates.filter((x) => x.id !== t.id) })}
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
        <SettingsField label="Name">
          <SettingsInput
            type="text"
            value={tplName}
            placeholder="Wan 2.2 text-to-video"
            testId="comfy-tpl-name"
            onChange={(e) => setTplName(e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Type">
          <UiSelect
            value={tplKind}
            ariaLabel="Workflow type"
            testId="comfy-tpl-kind"
            options={[
              { value: 'video', label: 'Video' },
              { value: 'image', label: 'Image' },
            ]}
            onChange={(v) => setTplKind(v as 'image' | 'video')}
          />
        </SettingsField>
        <SettingsField label="Workflow JSON" hint="API format, as ComfyUI exports it." wide>
          <SettingsTextarea
            value={tplJson}
            placeholder='{"1": {"class_type": "KSampler", "inputs": {}}}'
            spellCheck={false}
            testId="comfy-tpl-json"
            onChange={(e) => setTplJson(e.target.value)}
          />
        </SettingsField>
        {tplError && (
          <p className="sync-error" role="alert" data-testid="comfy-tpl-error">
            {tplError}
          </p>
        )}
        <SettingsActions>
          <button
            type="button"
            disabled={!tplJson.trim()}
            data-testid="comfy-tpl-add"
            onClick={addTemplate}
          >
            Add workflow
          </button>
        </SettingsActions>
      </SettingsGroup>
    </div>
  );
}

// --- board tools (Board Assistant integration) ------------------------------------

const imageToolSchema = z.object({
  prompt: z.string().min(1).describe('What to generate'),
  negative: z.string().optional().describe('What to avoid'),
  model: z
    .string()
    .optional()
    .describe('Checkpoint or diffusion-model filename; omit for the server default'),
  workflow: z
    .string()
    .optional()
    .describe('Name of a saved ComfyUI workflow template to run instead of the built-in graph'),
  size: z
    .string()
    .regex(/^\d+x\d+$/)
    .optional()
    .describe('e.g. 1024x1024'),
  source_item_id: z
    .string()
    .optional()
    .describe('Existing image item to transform (image-to-image)'),
  denoise: z.number().min(0.1).max(1).optional().describe('img2img strength, default 0.6'),
});

const videoToolSchema = z.object({
  source_item_id: z
    .string()
    .optional()
    .describe('Image item to animate (required for SVD and image-based workflows)'),
  prompt: z.string().optional().describe('Prompt (used by workflow templates)'),
  model: z.string().optional().describe('SVD checkpoint filename; omit for the server default'),
  workflow: z
    .string()
    .optional()
    .describe('Name of a saved video workflow template (Wan/Hunyuan/LTX) to run'),
  frames: z
    .number()
    .int()
    .min(2)
    .max(121)
    .optional()
    .describe('Video length in frames (Wan wants 4k+1, e.g. 49; SVD 14/25)'),
});

function requireConfigured(): void {
  if (!comfyServerUrl()) {
    throw new Error('ComfyUI is not configured — the user must set the server URL in settings.');
  }
}

function findTemplate(kind: 'image' | 'video', name: string): ComfyTemplate {
  const pool = comfyTemplates().filter((t) => t.kind === kind);
  const hit = pool.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (!hit) {
    throw new Error(
      pool.length
        ? `No ${kind} workflow named "${name}". Saved ${kind} workflows: ${pool.map((t) => t.name).join(', ')}`
        : `The user has no saved ${kind} workflow templates.`,
    );
  }
  return hit;
}

function requireImageItem(id: string): void {
  const item = useDocumentStore.getState().doc.items[id];
  if (!item || item.type !== 'image') {
    throw new Error(`"${id}" is not an image item on this board.`);
  }
}

const startedNote = (what: string) =>
  `${what} started on ComfyUI — the result will appear on the canvas when ready (this can take a while). Do not wait for it.`;

// --- registration ------------------------------------------------------------------

registerPlugin({
  manifest: {
    id: 'comfyui',
    order: 90,
    name: 'ComfyUI',
    description:
      'Generate images and videos on your own ComfyUI server — checkpoints, component models (FLUX/SD3/Wan), SVD image-to-video, and your own saved workflows. Models are listed live from the server.',
    defaultEnabled: false,
  },
  addMenu: [
    {
      label: 'Generate with ComfyUI',
      category: 'media',
      icon: <ImageIcon />,
      onSelect: () => useComfyDialog.getState().show('image'),
    },
  ],
  Component: ComfyPluginComponent,
  SettingsPanel: ComfySettingsPanel,
  itemMenu: (item) =>
    item.type === 'image'
      ? [
          {
            kind: 'action',
            label: 'Generate image from this (ComfyUI)',
            icon: <ImageIcon />,
            onSelect: () => useComfyDialog.getState().show('image', item.id),
          },
          {
            kind: 'action',
            label: 'Generate video from this (ComfyUI)',
            icon: <VideoIcon />,
            onSelect: () => useComfyDialog.getState().show('video', item.id),
          },
        ]
      : [],
  tools: [
    {
      name: 'comfy_generate_image',
      description:
        "Generate an image with the user's ComfyUI server (optionally transforming an existing image item, or running a saved workflow template by name). Starts a background job — the result lands on the canvas when ready; a placeholder shows progress. Returns immediately.",
      parameters: imageToolSchema,
      access: 'external',
      execute: async (args) => {
        requireConfigured();
        if (args.source_item_id) requireImageItem(args.source_item_id);
        if (args.workflow) {
          const template = findTemplate('image', args.workflow);
          if (template.needsImage && !args.source_item_id) {
            throw new Error(`Workflow "${template.name}" needs source_item_id (an image item).`);
          }
          generateComfyTemplateInBackground({
            template,
            prompt: args.prompt,
            negative: args.negative ?? '',
            ...(args.source_item_id ? { sourceItemId: args.source_item_id } : {}),
          });
          return { started: true, workflow: template.name, note: startedNote('Generation') };
        }
        const models = await fetchComfyModels();
        let modelKind: 'checkpoint' | 'unet';
        let model: string;
        const usableCkpt = models.checkpoints.filter((m) => !isVideoFamily(m));
        const usableUnet = models.unets.filter((m) => !isVideoFamily(m));
        if (args.model) {
          if (isVideoFamily(args.model)) {
            throw new Error(
              `"${args.model}" is a video-architecture model and cannot run through the built-in image workflow — the user must save its workflow as a template (plugin settings) and you can then pass workflow=<name>.`,
            );
          }
          if (models.checkpoints.includes(args.model)) {
            modelKind = 'checkpoint';
            model = args.model;
          } else if (models.unets.includes(args.model)) {
            modelKind = 'unet';
            model = args.model;
          } else {
            throw new Error(
              `Model "${args.model}" is not on the server. Checkpoints: ${usableCkpt.join(', ') || '(none)'}. Diffusion models: ${usableUnet.join(', ') || '(none)'}.`,
            );
          }
        } else if (usableCkpt[0]) {
          modelKind = 'checkpoint';
          model = usableCkpt[0];
        } else if (usableUnet[0]) {
          modelKind = 'unet';
          model = usableUnet[0];
        } else {
          throw new Error(
            'The server has no usable image models (video-architecture files need a saved workflow template).',
          );
        }
        const defaults = familyDefaults(imageFamily(model));
        const componentModel = modelKind === 'unet' || COMPONENT_FAMILY.test(model);
        const enc = componentModel ? guessTextEncoders(model, models.clips) : {};
        const m = /^(\d+)x(\d+)$/.exec(args.size ?? '1024x1024')!;
        generateComfyImageInBackground({
          prompt: args.prompt,
          negative: args.negative ?? '',
          modelKind,
          model,
          ...(enc.clip1 ? { clip1: enc.clip1 } : {}),
          ...(enc.clip2 ? { clip2: enc.clip2 } : {}),
          ...(componentModel ? { clipType: guessClipType(model, models.clipTypes) } : {}),
          ...(modelKind === 'unet' && guessVae(model, models.vaes)
            ? { vae: guessVae(model, models.vaes)! }
            : {}),
          width: Number(m[1]),
          height: Number(m[2]),
          steps: defaults.steps,
          cfg: defaults.cfg,
          sampler: 'euler',
          denoise: args.denoise ?? 0.6,
          ...(args.source_item_id ? { sourceItemId: args.source_item_id } : {}),
        });
        return { started: true, model, note: startedNote('Generation') };
      },
    },
    {
      name: 'comfy_generate_video',
      description:
        "Generate a video on the user's ComfyUI server: either animate an existing image item with SVD, or run a saved video workflow template by name (Wan/Hunyuan/LTX). Starts a background job; the result lands on the canvas when ready. Returns immediately.",
      parameters: videoToolSchema,
      access: 'external',
      execute: async (args) => {
        requireConfigured();
        if (args.source_item_id) requireImageItem(args.source_item_id);
        if (args.workflow) {
          const template = findTemplate('video', args.workflow);
          if (template.needsImage && !args.source_item_id) {
            throw new Error(`Workflow "${template.name}" needs source_item_id (an image item).`);
          }
          generateComfyTemplateInBackground({
            template,
            prompt: args.prompt ?? '',
            negative: '',
            ...(args.source_item_id ? { sourceItemId: args.source_item_id } : {}),
          });
          return { started: true, workflow: template.name, note: startedNote('Video generation') };
        }
        const models = await fetchComfyModels();
        const wans = detectWanModels(models.unets, models.vaes);
        const wanByName = (name: string) =>
          wans.find(
            (w) =>
              w.key === name || w.high === name || w.label.toLowerCase() === name.toLowerCase(),
          );
        const describeOptions = () => {
          const tplNames = comfyTemplates()
            .filter((t) => t.kind === 'video')
            .map((t) => t.name);
          return `Video models: ${[...wans.map((w) => `${w.label} (${w.mode})`), ...models.videoCheckpoints].join(', ') || '(none)'}${tplNames.length ? `. Saved workflows: ${tplNames.join(', ')}` : ''}`;
        };

        // Explicit model: Wan entry or SVD checkpoint.
        let wan = args.model ? wanByName(args.model) : undefined;
        let svd =
          args.model && models.videoCheckpoints.includes(args.model) ? args.model : undefined;
        if (args.model && !wan && !svd) {
          throw new Error(`"${args.model}" is not a usable video model. ${describeOptions()}`);
        }
        // Default: prefer Wan (i2v with a source, t2v without), then SVD.
        if (!wan && !svd) {
          wan = args.source_item_id
            ? (wans.find((w) => w.mode === 'i2v') ?? wans.find((w) => w.mode === 'ti2v'))
            : (wans.find((w) => w.mode === 't2v') ?? wans.find((w) => w.mode === 'ti2v'));
          if (!wan) svd = models.videoCheckpoints[0];
        }
        if (wan) {
          if (wan.mode === 'i2v' && !args.source_item_id) {
            throw new Error(
              `${wan.label} is image-to-video — pass source_item_id (an image item).`,
            );
          }
          if (wan.mode === 't2v' && !args.prompt?.trim()) {
            throw new Error(`${wan.label} is text-to-video — pass a prompt.`);
          }
          const parts = wanComponents(models, wan);
          if (!parts.clip || !parts.vae) {
            throw new Error('The server is missing the Wan text encoder (umt5) or VAE.');
          }
          generateComfyWanInBackground({
            wan,
            clip: parts.clip,
            vae: parts.vae,
            clipVision: parts.clipVision,
            prompt: args.prompt ?? '',
            negative: '',
            width: 832,
            height: 480,
            length: args.frames && args.frames % 4 === 1 ? args.frames : 49,
            fps: 16,
            steps: 20,
            ...(wan.mode !== 't2v' && args.source_item_id
              ? { sourceItemId: args.source_item_id }
              : {}),
          });
          return { started: true, model: wan.label, note: startedNote('Video generation') };
        }
        if (!svd) {
          throw new Error(`No usable video model. ${describeOptions()}`);
        }
        if (!args.source_item_id) {
          throw new Error(
            `SVD is image-to-video — pass source_item_id (an image item). ${describeOptions()}`,
          );
        }
        generateComfyVideoInBackground({
          checkpoint: svd,
          sourceItemId: args.source_item_id,
          frames: args.frames ?? 14,
          fps: 6,
          motion: 127,
        });
        return { started: true, checkpoint: svd, note: startedNote('Video generation') };
      },
    },
  ],
});
