import './style.css';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { MusicNoteIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { hasSyncServer } from '../../lib/sync/apiBase';
import { getPlatformCaps } from '../../lib/platform';
import { useSessionStore } from '../../state/sessionStore';
import {
  anyProviderReady,
  cloneVoice,
  fetchModels,
  fetchVoices,
  providerConfig,
  providerReady,
  setProviderConfig,
  speakInBackground,
  TTS_PROVIDERS,
  ttsProviderMeta,
} from './ttsGen';
import type { TtsProviderId } from './ttsGen';
import { usePluginSettings } from '../settingsStore';
import { registerPlugin } from '../registry';
import {
  SecretInput,
  SettingsBadge,
  SettingsField,
  SettingsGroup,
  SettingsInput,
} from '../../components/ui/SettingsForm';

/** Text-to-speech: ElevenLabs, SGLang-Omni and Chatterbox. */

const useTtsDialog = create<{ open: boolean; toggle: (v: boolean) => void }>((set) => ({
  open: false,
  toggle: (open) => set({ open }),
}));

function TtsDialog() {
  const open = useTtsDialog((s) => s.open);
  return open ? <TtsDialogBody /> : null;
}

/** Tunable synthesis parameters, per provider. */
interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
}
const PROVIDER_PARAMS: Partial<Record<TtsProviderId, ParamDef[]>> = {
  // https://elevenlabs.io/docs/api-reference/text-to-speech/convert
  elevenlabs: [
    { key: 'stability', label: 'Stability', min: 0, max: 1, step: 0.05, def: 0.5 },
    { key: 'similarity', label: 'Similarity', min: 0, max: 1, step: 0.05, def: 0.75 },
    { key: 'style', label: 'Style', min: 0, max: 1, step: 0.05, def: 0 },
    { key: 'speed', label: 'Speed', min: 0.7, max: 1.2, step: 0.05, def: 1 },
  ],
  chatterbox: [
    { key: 'exaggeration', label: 'Exaggeration', min: 0.25, max: 2, step: 0.05, def: 0.5 },
    { key: 'cfgWeight', label: 'CFG / pace', min: 0, max: 1, step: 0.05, def: 0.5 },
    { key: 'temperature', label: 'Temperature', min: 0.05, max: 2, step: 0.05, def: 0.8 },
    { key: 'speed', label: 'Speed', min: 0.25, max: 2, step: 0.05, def: 1 },
  ],
};
const paramDefaults = (defs: ParamDef[]) => Object.fromEntries(defs.map((d) => [d.key, d.def]));

function TtsDialogBody() {
  const close = () => useTtsDialog.getState().toggle(false);
  // Re-render as keys/URLs are entered elsewhere.
  usePluginSettings((s) => s.settings['tts']);
  const ready = TTS_PROVIDERS.filter((p) => providerReady(p.id));

  const [providerId, setProviderId] = useState<TtsProviderId>(ready[0]?.id ?? 'elevenlabs');
  const meta = ttsProviderMeta(providerId);
  const paramDefs = PROVIDER_PARAMS[providerId] ?? [];
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [voice, setVoice] = useState('');
  const [model, setModel] = useState('');
  const [params, setParams] = useState<Record<string, number>>(() =>
    paramDefaults(PROVIDER_PARAMS[ready[0]?.id ?? 'elevenlabs'] ?? []),
  );
  const [speakerBoost, setSpeakerBoost] = useState(true);
  const [reference, setReference] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refInput = useRef<HTMLInputElement>(null);

  // Provider switch: clear the other provider's lists/choices during render
  // (a stale ElevenLabs model id means nothing to Chatterbox) — the React
  // "adjust state from the previous render" pattern.
  const [prevProvider, setPrevProvider] = useState(providerId);
  if (prevProvider !== providerId) {
    setPrevProvider(providerId);
    setVoices([]);
    setModels([]);
    setVoice('');
    setModel('');
    setParams(paramDefaults(PROVIDER_PARAMS[providerId] ?? []));
    setSpeakerBoost(true);
  }

  // Load the selected provider's voices + models.
  useEffect(() => {
    if (!providerReady(providerId)) return;
    let cancelled = false;
    void fetchVoices(providerId)
      .then((list) => {
        if (cancelled) return;
        setVoices(list);
        // ElevenLabs requires a voice; self-hosted defaults to the server's.
        if (providerId === 'elevenlabs') setVoice((v) => v || (list[0]?.id ?? v));
      })
      .catch(() => {});
    void fetchModels(providerId)
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setModel((m) => (list.includes(m) ? m : (list[0] ?? '')));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  // The model box only matters when there's a real choice: always for
  // ElevenLabs; for self-hosted servers only when they list models.
  const showModel = providerId === 'elevenlabs' || models.length > 0;

  const run = async () => {
    if (!text.trim() || busy) return;
    setError(null);
    try {
      let useVoice = voice.trim();
      // ElevenLabs: a reference clip creates a persistent voice first.
      if (reference && meta.persistentClone) {
        setBusy('Cloning voice');
        useVoice = await cloneVoice(providerId, cloneName.trim() || 'Cloned voice', [reference]);
      }
      speakInBackground({
        provider: providerId,
        model: model.trim(),
        voice: useVoice,
        text: text.trim(),
        params: providerId === 'elevenlabs' ? { ...params, speakerBoost } : { ...params },
        ...(reference && meta.referenceClone ? { reference } : {}),
      });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
      setBusy(null);
    }
  };

  return (
    <UiDialog
      title="Generate Speech"
      onClose={close}
      className="tts-sheet"
      size="wide"
      testId="tts-dialog"
    >
      <div className="tts-body">
        {ready.length === 0 ? (
          <p className="settings-hint" data-testid="tts-nokeys">
            No TTS provider is set up. Add a key or server URL in Settings → Plugins → Text to
            Speech.
          </p>
        ) : (
          <>
            <textarea
              className="tts-prompt"
              value={text}
              placeholder="Text to speak"
              autoFocus
              data-autofocus
              data-testid="tts-text"
              onChange={(e) => setText(e.target.value)}
            />
            {ready.length > 1 && (
              <label className="tts-field">
                <span>Provider</span>
                <select
                  value={providerId}
                  data-testid="tts-provider"
                  onChange={(e) => setProviderId(e.target.value as TtsProviderId)}
                >
                  {ready.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {showModel && (
              <label className="tts-field">
                <span>Model</span>
                {models.length > 0 ? (
                  <select
                    value={model}
                    data-testid="tts-model"
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={model}
                    placeholder="Model id (optional)"
                    data-testid="tts-model-input"
                    onChange={(e) => setModel(e.target.value)}
                  />
                )}
              </label>
            )}
            <label className="tts-field">
              <span>Voice</span>
              {voices.length > 0 ? (
                <select
                  value={voice}
                  data-testid="tts-voice"
                  onChange={(e) => setVoice(e.target.value)}
                >
                  {/* Self-hosted servers speak fine with no voice at all. */}
                  {meta.id !== 'elevenlabs' && <option value="">Server default</option>}
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={voice}
                  placeholder={meta.referenceClone ? 'Voice id (or clone below)' : 'Voice id'}
                  data-testid="tts-voice-input"
                  onChange={(e) => setVoice(e.target.value)}
                />
              )}
            </label>

            {paramDefs.length > 0 && (
              <div className="tts-params" data-testid="tts-params">
                {paramDefs.map((d) => (
                  <label className="tts-param" key={d.key}>
                    <span>{d.label}</span>
                    <input
                      type="range"
                      min={d.min}
                      max={d.max}
                      step={d.step}
                      value={params[d.key] ?? d.def}
                      data-testid={`tts-param-${d.key}`}
                      onChange={(e) =>
                        setParams((p) => ({ ...p, [d.key]: Number(e.target.value) }))
                      }
                    />
                    <em>{(params[d.key] ?? d.def).toFixed(2)}</em>
                  </label>
                ))}
                {providerId === 'elevenlabs' && (
                  <label className="tts-param tts-param-check">
                    <input
                      type="checkbox"
                      checked={speakerBoost}
                      data-testid="tts-param-speakerBoost"
                      onChange={(e) => setSpeakerBoost(e.target.checked)}
                    />
                    <span>Speaker boost</span>
                  </label>
                )}
              </div>
            )}

            {(meta.persistentClone || meta.referenceClone) && (
              <div className="tts-clone">
                <button
                  type="button"
                  className="tts-clone-pick"
                  data-testid="tts-clone-pick"
                  onClick={() => refInput.current?.click()}
                >
                  {reference ? `🎙 ${reference.name}` : '🎙 Clone from audio'}
                </button>
                {reference && (
                  <>
                    {meta.persistentClone && (
                      <input
                        className="tts-clone-name"
                        value={cloneName}
                        placeholder="New voice name"
                        data-testid="tts-clone-name"
                        onChange={(e) => setCloneName(e.target.value)}
                      />
                    )}
                    <button
                      type="button"
                      className="tts-clone-clear"
                      data-testid="tts-clone-clear"
                      onClick={() => setReference(null)}
                    >
                      ✕
                    </button>
                  </>
                )}
                <input
                  ref={refInput}
                  type="file"
                  accept="audio/*"
                  hidden
                  data-testid="tts-clone-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    setReference(f);
                  }}
                />
              </div>
            )}
            <p className="settings-hint">
              {meta.persistentClone
                ? 'Cloning creates a new ElevenLabs voice from your sample, then speaks with it.'
                : 'Attach a short clip to clone its voice for this line (zero-shot).'}
            </p>
            {error && (
              <p className="sync-error" role="alert" data-testid="tts-error">
                {error}
              </p>
            )}
            <div className="tts-actions">
              <button
                type="button"
                className="sync-primary"
                disabled={!text.trim() || busy !== null}
                data-testid="tts-generate"
                onClick={() => void run()}
              >
                {busy ?? 'Generate'}
              </button>
            </div>
          </>
        )}
      </div>
    </UiDialog>
  );
}

function TtsSettings() {
  usePluginSettings((s) => s.settings['tts']);
  return (
    <div className="plugin-settings-fields">
      <p className="settings-hint">
        Cloud keys and self-hosted server URLs. Stored on this device and included in encrypted
        settings sync when you're signed in.
      </p>
      {TTS_PROVIDERS.map((p) => {
        const cfg = providerConfig(p.id);
        return (
          <SettingsGroup title={p.label} key={p.id}>
            {p.needsUrl && (
              <SettingsField label="Server URL" hint={p.urlHint}>
                <SettingsInput
                  type="url"
                  value={cfg.baseUrl ?? ''}
                  placeholder="http://host:port"
                  spellCheck={false}
                  testId={`tts-url-${p.id}`}
                  onChange={(e) => setProviderConfig(p.id, { baseUrl: e.target.value })}
                />
              </SettingsField>
            )}
            <SettingsField
              label="API key"
              badges={p.needsKey ? null : <SettingsBadge>Optional</SettingsBadge>}
              hint={p.keyHint}
            >
              <SecretInput
                value={cfg.apiKey ?? ''}
                ariaLabel={`${p.label} API key`}
                testId={`tts-key-${p.id}`}
                onChange={(v) => setProviderConfig(p.id, { apiKey: v })}
              />
            </SettingsField>
          </SettingsGroup>
        );
      })}
    </div>
  );
}

registerPlugin({
  manifest: {
    id: 'tts',
    defaultEnabled: false,
    order: 70,
    name: 'Text to Speech',
    description:
      'Generate speech from text with ElevenLabs, SGLang-Omni or Chatterbox — model + voice selection and voice cloning from an audio file.',
  },
  addMenu: [
    {
      label: 'Generate Speech',
      category: 'media',
      icon: <MusicNoteIcon />,
      onSelect: () => {
        if (!getPlatformCaps().ai) {
          window.alert(
            hasSyncServer()
              ? 'Speech generation runs through your sync server, which isn’t reachable.'
              : 'This deployment has no sync server, so speech generation isn’t available.',
          );
          return;
        }
        if (!anyProviderReady()) {
          window.alert('Set up a TTS provider in Settings → Plugins → Text to Speech first.');
          useSessionStore.getState().setSettingsOpen(true);
          return;
        }
        useTtsDialog.getState().toggle(true);
      },
    },
  ],
  Component: TtsDialog,
  SettingsPanel: TtsSettings,
});
