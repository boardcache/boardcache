import { useEffect, useState } from 'react';
import { fetchProviderModels } from '../../lib/ai/fetchModels';
import { TEXT_PROVIDERS, textProviderMeta, type TextProviderId } from '../../lib/ai/providers';
import {
  aiSource,
  enabledModels,
  ensureHostedAi,
  modelLabel,
  parseRefKey,
  refKey,
  useAIStore,
} from '../../state/aiStore';
import { useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';
import { useChatStore } from './aiChat/ChatPanel';
import { UiDialog } from '../../components/ui/Dialog';
import { UiSelect } from '../../components/ui/Select';
import { BuyCreditsDialog } from '../../components/account/BuyCreditsDialog';
import { canPurchase } from '../../lib/mobile';

/**
 * Settings → AI Providers. Enter an API key per provider; once it validates we
 * fetch the provider's model list and let you check which models to make
 * available. Keys are stored in this browser and — when signed in — encrypted
 * with your account key and synced.
 */
export function AIProvidersDialog() {
  const open = useSessionStore((s) => s.aiProvidersOpen);
  return open ? <AIProvidersBody /> : null;
}

function AIProvidersBody() {
  const close = () => useSessionStore.getState().setAiProvidersOpen(false);

  return (
    <UiDialog
      title="AI Providers"
      onClose={close}
      className="ai-sheet"
      size="wide"
      testId="ai-providers-dialog"
    >
      <AIProvidersPanel />
    </UiDialog>
  );
}

/** The provider list itself — embedded in Settings → AI and in the dialog. */
export function AIProvidersPanel() {
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const hosted = useAIStore((s) => s.hosted);
  useAIStore((s) => s.source);
  useEffect(() => void ensureHostedAi(), []);
  // One source or the other. Servers without hosted AI have no choice to make.
  const source = aiSource();
  const choice = Boolean(hosted?.enabled);

  return (
    <div className="ai-body">
      {choice && (
        <div className="seg ai-source" role="radiogroup" aria-label="AI source">
          {(
            [
              ['hosted', 'boardCache Cloud'],
              ['own', 'Use my own keys'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={source === k}
              className={source === k ? 'active' : ''}
              data-testid={`ai-source-${k}`}
              onClick={() => useAIStore.getState().setSource(k)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {source === 'hosted' ? (
        <>
          <p className="ai-note">
            Chat, the assistant and image generation run on boardCache Cloud and spend credits; no
            keys to manage.
          </p>
          <HostedRow />
        </>
      ) : (
        <>
          <p className="ai-note">
            {signedIn
              ? 'Keys are encrypted with your account password and synced across your devices.'
              : 'Keys are stored in this browser. Sign in to sync to encrypt and sync them.'}
          </p>
          {TEXT_PROVIDERS.filter((m) => m.id !== 'hosted').map((meta) => (
            <ProviderRow key={meta.id} providerId={meta.id} />
          ))}
          <p className="ai-note muted">
            These keys also power image and video generation (Add → Generate Image / Video); model
            lists are fetched per key there.
          </p>
          <DefaultModelSettings />
        </>
      )}
      <AssistantPanelSettings />
    </div>
  );
}

/**
 * The model that single-model features use (Suggest a presentation, Wikipedia
 * imports, OCR when nothing else is chosen). "Automatic" = the first prompt
 * model, else the first enabled one.
 */
function DefaultModelSettings() {
  const chosen = useAIStore((s) => s.defaultModel ?? null);
  useAIStore((s) => s.providers);
  useAIStore((s) => s.hosted);
  const models = enabledModels();
  const current =
    chosen && models.some((m) => refKey(m) === refKey(chosen)) ? refKey(chosen) : 'auto';
  return (
    <div className="ai-assistant-settings">
      <h3>Default model</h3>
      <label className="ai-assist-row">
        <span>Used when a feature needs one model</span>
        <UiSelect
          ariaLabel="Default model"
          testId="ai-default-model"
          value={current}
          onChange={(v) =>
            useAIStore.getState().setDefaultModel(v === 'auto' ? null : parseRefKey(v))
          }
          options={[
            { value: 'auto', label: 'Automatic — first enabled model' },
            ...models.map((m) => ({ value: refKey(m), label: modelLabel(m) })),
          ]}
        />
      </label>
      <p className="ai-note muted">
        Suggesting a presentation order, Wikipedia imports and other one-shot features start from
        this model. Chat and Generate keep their own pickers.
      </p>
    </div>
  );
}

/**
 * Server-billed AI ("boardCache Cloud"): no key to enter — shows credit state
 * and a pack-purchase button. Hidden entirely on servers without hosted AI.
 */
function HostedRow() {
  const hosted = useAIStore((s) => s.hosted);
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const [buying, setBuying] = useState(false);
  useEffect(() => void ensureHostedAi(), []);
  if (!hosted?.enabled) return null;
  const c = hosted.credits;
  const summary =
    !signedIn || !c
      ? 'Sign in to use AI without any API keys.'
      : c.available === null
        ? 'Included with this server — no key needed.'
        : `${c.available} credits available` +
          (c.monthlyAllowance
            ? ` (${Math.max(0, c.monthlyAllowance - c.monthlyUsed)} of ${c.monthlyAllowance} monthly left)`
            : '');
  return (
    <div className="ai-provider ai-provider-hosted" data-testid="ai-provider-hosted">
      <div className="ai-provider-head">
        <span className="ai-provider-name">boardCache Cloud</span>
        <span
          className={`ai-status${c && (c.available === null || c.available > 0) ? ' ready' : ''}`}
        >
          {c ? (c.available === null ? 'Included' : `${c.available} credits`) : 'Sign in'}
        </span>
      </div>
      <p className="ai-hint" data-testid="hosted-credits-summary">
        {summary}
      </p>
      {c && hosted.pack.purchasable && canPurchase() && (
        <div className="plan-actions">
          <button
            type="button"
            className="plan-btn"
            data-testid="hosted-buy-credits"
            onClick={() => setBuying(true)}
          >
            Buy credits
          </button>
        </div>
      )}
      {buying && <BuyCreditsDialog pack={hosted.pack} onClose={() => setBuying(false)} />}
    </div>
  );
}

/** Appearance settings for the Board Assistant chat panel. */
function AssistantPanelSettings() {
  const opacity = useChatStore((s) => s.opacity);
  const webResearch = useAIStore((s) => s.webResearch === true);
  useAIStore((s) => s.source);
  useAIStore((s) => s.hosted);
  const ownKeys = aiSource() === 'own';
  const pct = Math.round(opacity * 100);
  return (
    <div className="ai-assistant-settings">
      <h3>Board Assistant</h3>
      {ownKeys && (
        <>
          <label className="ai-assist-row">
            <span>Web research</span>
            <input
              type="checkbox"
              checked={webResearch}
              data-testid="ai-web-research"
              aria-label="Allow provider-native web search"
              onChange={(e) => useAIStore.getState().setWebResearch(e.target.checked)}
            />
          </label>
          <p className="ai-note muted">
            Lets the assistant search the web during chat where the provider supports it (Anthropic,
            OpenAI, xAI) — searches run on your API key. It can always read pages you point it at
            with the read_webpage tool.
          </p>
        </>
      )}
      <label className="ai-assist-row">
        <span>Chat panel opacity</span>
        <input
          type="range"
          className="chat-opacity"
          min={35}
          max={100}
          step={5}
          value={pct}
          aria-label="Chat panel opacity"
          data-testid="chat-opacity"
          onChange={(e) => useChatStore.getState().setOpacity(Number(e.target.value) / 100)}
        />
        <span className="ai-assist-val">{pct}%</span>
      </label>
      <p className="ai-note muted">
        A translucent panel turns opaque while you hover or type in it.
      </p>
    </div>
  );
}

type Status = 'idle' | 'loading' | 'ok' | 'error';

function ProviderRow({ providerId }: { providerId: TextProviderId }) {
  const meta = textProviderMeta(providerId);
  const provider = useAIStore((s) => s.providers[providerId]) ?? {
    apiKey: '',
    baseUrl: '',
    enabledModels: [],
  };
  const setProvider = useAIStore((s) => s.setProvider);
  const toggleEnabled = useAIStore((s) => s.toggleEnabled);

  const [status, setStatus] = useState<Status>('idle');
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [openList, setOpenList] = useState(false);

  const canFetch = meta.keyless || provider.apiKey.trim().length > 0;

  // Validate + fetch models whenever the key/URL settles.
  useEffect(() => {
    let cancelled = false;
    // Reset in a microtask so the effect body stays pure (no sync setState).
    void Promise.resolve().then(() => {
      if (!cancelled) setStatus(canFetch ? 'loading' : 'idle');
    });
    if (!canFetch) {
      void Promise.resolve().then(() => {
        if (!cancelled) setModels([]);
      });
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(async () => {
      try {
        const list = await fetchProviderModels(providerId, provider.apiKey, provider.baseUrl);
        if (cancelled) return;
        setModels(list);
        setError('');
        setStatus('ok');
      } catch (e) {
        if (cancelled) return;
        setModels([]);
        setError(e instanceof Error ? e.message : 'Failed to load models.');
        setStatus('error');
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [providerId, provider.apiKey, provider.baseUrl, canFetch]);

  const badge =
    status === 'loading'
      ? 'Checking'
      : status === 'ok'
        ? `${provider.enabledModels.length} enabled`
        : status === 'error'
          ? 'Invalid'
          : meta.keyless
            ? 'Set URL'
            : 'Needs key';

  return (
    <div className="ai-provider" data-testid={`ai-provider-${providerId}`}>
      <div className="ai-provider-head">
        <span className="ai-provider-name">{meta.label}</span>
        <span className={`ai-status${status === 'ok' ? ' ready' : ''}`}>{badge}</span>
      </div>

      {!meta.keyless && (
        <label className="ai-field">
          <span>API key</span>
          <input
            type="password"
            autoComplete="off"
            value={provider.apiKey}
            placeholder="sk-…"
            onChange={(e) => setProvider(providerId, { apiKey: e.target.value })}
            data-testid={`ai-key-${providerId}`}
          />
        </label>
      )}
      {meta.hasUrl && (
        <label className="ai-field">
          <span>URL</span>
          <input
            type="text"
            value={provider.baseUrl}
            placeholder="http://localhost:11434"
            onChange={(e) => setProvider(providerId, { baseUrl: e.target.value })}
            data-testid={`ai-url-${providerId}`}
          />
        </label>
      )}

      {status === 'error' && <p className="ai-hint ai-error">{error}</p>}
      {status === 'ok' && models.length > 0 && (
        <div className="ai-models">
          <button
            type="button"
            className="ai-models-toggle"
            onClick={() => setOpenList((v) => !v)}
            data-testid={`ai-models-toggle-${providerId}`}
          >
            {provider.enabledModels.length} of {models.length} models {openList ? '▴' : '▾'}
          </button>
          {openList && (
            <div className="ai-models-list" data-testid={`ai-models-list-${providerId}`}>
              {models.map((m) => (
                <label key={m} className="ai-model-check">
                  <input
                    type="checkbox"
                    checked={provider.enabledModels.includes(m)}
                    onChange={() => toggleEnabled(providerId, m)}
                    data-testid={`ai-model-check-${providerId}-${m}`}
                  />
                  <span>{m}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {meta.keyHint && status !== 'ok' && <p className="ai-hint">{meta.keyHint}</p>}
    </div>
  );
}
