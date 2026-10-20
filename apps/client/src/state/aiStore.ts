import { create } from 'zustand';
import { TEXT_PROVIDER_IDS, textProviderMeta, type TextProviderId } from '../lib/ai/providers';
import { syncApi, type HostedAiInfo } from '../lib/sync/syncApi';

/**
 * App-level AI configuration: per-provider API key (+ Ollama URL) and the set of
 * models the user has enabled (made available). The prompt modal selects a
 * subset of those to generate from. Persisted in localStorage and — when signed
 * in — encrypted with the account key and synced (see lib/settingsSync). Keys
 * are never sent anywhere but the chosen provider (via our same-origin proxy).
 */

export interface ProviderState {
  apiKey: string;
  /** Ollama instance URL; empty = server default. */
  baseUrl: string;
  /** Models the user enabled (checked) → available in the prompt. */
  enabledModels: string[];
}

export interface ModelRef {
  providerId: TextProviderId;
  model: string;
}

export const refKey = (r: ModelRef): string => `${r.providerId}::${r.model}`;

export interface AIPersisted {
  providers: Record<TextProviderId, ProviderState>;
  /** Models checked in the prompt modal → generations run for each. */
  promptSelection: ModelRef[];
  /** Let the chat agent use provider-native web search (Anthropic/xAI). */
  webResearch?: boolean;
  /** The model single-model features reach for (Suggest, Wikipedia, OCR fallback); null = automatic. */
  defaultModel?: ModelRef | null;
  /**
   * Where AI runs: boardCache Cloud (credits) or the user's own keys. Null =
   * not chosen: Cloud when it is available to this account, else own keys.
   * An explicit choice wins either way — own keys stay own keys even with
   * credits in the account.
   */
  source?: AISource | null;
}

export type AISource = 'hosted' | 'own';

const STORAGE_KEY = 'refboard.ai.v3';

function emptyProviders(): Record<TextProviderId, ProviderState> {
  const out = {} as Record<TextProviderId, ProviderState>;
  for (const id of TEXT_PROVIDER_IDS) out[id] = { apiKey: '', baseUrl: '', enabledModels: [] };
  return out;
}

/** Fill any provider ids missing from a (possibly older) map so every current
 *  provider always has an entry — the UI dereferences providers[id] directly. */
function normalizeProviders(
  partial: Partial<Record<TextProviderId, ProviderState>> | undefined,
): Record<TextProviderId, ProviderState> {
  const out = emptyProviders();
  for (const id of TEXT_PROVIDER_IDS) {
    const p = partial?.[id];
    if (p) {
      out[id] = {
        apiKey: p.apiKey ?? '',
        baseUrl: p.baseUrl ?? '',
        enabledModels: Array.isArray(p.enabledModels) ? p.enabledModels : [],
      };
    }
  }
  return out;
}

/** Convert older shapes (v2 models list, v1 per-provider) into v3. */
function migrate(): AIPersisted | null {
  const providers = emptyProviders();
  const promptSelection: ModelRef[] = [];
  try {
    const v2 = localStorage.getItem('refboard.ai.v2');
    if (v2) {
      const parsed = JSON.parse(v2) as {
        models?: Array<{ providerId?: string; model?: string; apiKey?: string; baseUrl?: string }>;
        selectedModelId?: string;
      };
      for (const m of parsed.models ?? []) {
        const id = m.providerId as TextProviderId;
        if (!providers[id] || !m.model) continue;
        if (m.apiKey) providers[id].apiKey = m.apiKey;
        if (m.baseUrl) providers[id].baseUrl = m.baseUrl;
        if (!providers[id].enabledModels.includes(m.model))
          providers[id].enabledModels.push(m.model);
      }
      const first = (parsed.models ?? [])[0];
      if (first?.providerId && first.model) {
        promptSelection.push({
          providerId: first.providerId as TextProviderId,
          model: first.model,
        });
      }
      return { providers, promptSelection };
    }
    const v1 = localStorage.getItem('refboard.ai.v1');
    if (v1) {
      const parsed = JSON.parse(v1) as {
        providers?: Record<string, { apiKey?: string; model?: string; baseUrl?: string }>;
      };
      for (const [pid, cfg] of Object.entries(parsed.providers ?? {})) {
        const id = pid as TextProviderId;
        if (!providers[id]) continue;
        if (cfg.apiKey) providers[id].apiKey = cfg.apiKey;
        if (cfg.baseUrl) providers[id].baseUrl = cfg.baseUrl;
        const model = cfg.model?.trim();
        if (model && (cfg.apiKey || textProviderMeta(id).keyless))
          providers[id].enabledModels.push(model);
      }
      return { providers, promptSelection };
    }
  } catch {
    /* ignore corrupt legacy data */
  }
  return null;
}

function load(): AIPersisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AIPersisted>;
      const providers = emptyProviders();
      for (const id of TEXT_PROVIDER_IDS) {
        const p = parsed.providers?.[id];
        if (p) {
          providers[id] = {
            apiKey: p.apiKey ?? '',
            baseUrl: p.baseUrl ?? '',
            enabledModels: Array.isArray(p.enabledModels) ? p.enabledModels : [],
          };
        }
      }
      const promptSelection = Array.isArray(parsed.promptSelection)
        ? parsed.promptSelection.filter((r) => r && providers[r.providerId])
        : [];
      const dm = parsed.defaultModel;
      const defaultModel =
        dm && typeof dm.model === 'string' && providers[dm.providerId] ? dm : null;
      const source = parsed.source === 'hosted' || parsed.source === 'own' ? parsed.source : null;
      return {
        providers,
        promptSelection,
        webResearch: parsed.webResearch === true,
        defaultModel,
        source,
      };
    }
  } catch {
    /* corrupt/disabled storage → fall through */
  }
  return migrate() ?? { providers: emptyProviders(), promptSelection: [] };
}

function save(state: AIPersisted): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        providers: state.providers,
        promptSelection: state.promptSelection,
        webResearch: state.webResearch ?? false,
        defaultModel: state.defaultModel ?? null,
        source: state.source ?? null,
      }),
    );
  } catch {
    /* storage full/disabled — settings just won't persist */
  }
}

interface AIState extends AIPersisted {
  /** Server-billed AI availability + credit state (not persisted). */
  hosted: HostedAiInfo | null;
  setProvider: (id: TextProviderId, patch: Partial<Omit<ProviderState, 'enabledModels'>>) => void;
  setWebResearch: (on: boolean) => void;
  setDefaultModel: (ref: ModelRef | null) => void;
  setSource: (source: AISource | null) => void;
  toggleEnabled: (id: TextProviderId, model: string) => void;
  togglePromptModel: (ref: ModelRef) => void;
  replaceAll: (next: AIPersisted) => void;
}

export const useAIStore = create<AIState>((set, get) => {
  const persist = () => save(get());
  return {
    ...load(),
    hosted: null,
    setWebResearch: (webResearch) => {
      set({ webResearch });
      persist();
    },
    setDefaultModel: (defaultModel) => {
      set({ defaultModel });
      persist();
    },
    setSource: (source) => {
      set({ source });
      persist();
    },
    setProvider: (id, patch) => {
      set((s) => ({ providers: { ...s.providers, [id]: { ...s.providers[id], ...patch } } }));
      persist();
    },
    toggleEnabled: (id, model) => {
      set((s) => {
        const cur = s.providers[id];
        const on = cur.enabledModels.includes(model);
        const enabledModels = on
          ? cur.enabledModels.filter((m) => m !== model)
          : [...cur.enabledModels, model];
        // Drop from the prompt selection if no longer available.
        const promptSelection = on
          ? s.promptSelection.filter((r) => !(r.providerId === id && r.model === model))
          : s.promptSelection;
        return { providers: { ...s.providers, [id]: { ...cur, enabledModels } }, promptSelection };
      });
      persist();
    },
    togglePromptModel: (ref) => {
      set((s) => {
        const on = s.promptSelection.some((r) => refKey(r) === refKey(ref));
        return {
          promptSelection: on
            ? s.promptSelection.filter((r) => refKey(r) !== refKey(ref))
            : [...s.promptSelection, ref],
        };
      });
      persist();
    },
    replaceAll: (next) => {
      const providers = normalizeProviders(next.providers);
      const promptSelection = (next.promptSelection ?? []).filter((r) => providers[r.providerId]);
      const dm = next.defaultModel;
      set({
        providers,
        promptSelection,
        webResearch: next.webResearch ?? false,
        defaultModel: dm && providers[dm.providerId] ? dm : null,
        source: next.source === 'hosted' || next.source === 'own' ? next.source : null,
      });
      persist();
    },
  };
});

let hostedFetch: Promise<void> | null = null;

/**
 * Fetch hosted-AI availability + credits (deduped; call `refreshHostedAi`
 * after purchases or sign-in changes). Safe to call from any surface that
 * offers models — failures just leave hosted off.
 */
export function ensureHostedAi(): Promise<void> {
  hostedFetch ??= syncApi
    .hostedAi()
    .then((info) => useAIStore.setState({ hosted: info }))
    .catch(() => undefined);
  return hostedFetch;
}

export function refreshHostedAi(): Promise<void> {
  hostedFetch = null;
  return ensureHostedAi();
}

/** The hosted pseudo-model, offered when the server hosts AI for this account. */
export function hostedModelRef(): ModelRef | null {
  const { hosted } = useAIStore.getState();
  // credits !== null ⇔ signed in; signed-out users use their own keys.
  if (!hosted?.enabled || hosted.credits === null) return null;
  if (!hosted.ops.chat && !hosted.ops.agent) return null;
  return { providerId: 'hosted', model: 'included' };
}

/** Is boardCache Cloud on offer to this account at all (server hosts AI, signed in)? */
function hostedAvailable(): boolean {
  const { hosted } = useAIStore.getState();
  return Boolean(hosted?.enabled) && hosted?.credits !== null;
}

/** The source in effect: the explicit choice, else Cloud when available, else own keys. */
export function aiSource(): AISource {
  return useAIStore.getState().source ?? (hostedAvailable() ? 'hosted' : 'own');
}

/** Flat list of every enabled (available) model from the source in effect. */
export function enabledModels(): ModelRef[] {
  if (aiSource() === 'hosted') {
    const hosted = hostedModelRef();
    return hosted ? [hosted] : [];
  }
  const { providers } = useAIStore.getState();
  return TEXT_PROVIDER_IDS.filter((id) => id !== 'hosted').flatMap((id) =>
    providers[id].enabledModels.map((model) => ({ providerId: id, model })),
  );
}

/**
 * The one model a single-model feature should use: the default chosen in
 * settings while it is still enabled, else the first prompt model, else the
 * first enabled model. Null when nothing is configured.
 */
export function defaultModel(): ModelRef | null {
  const chosen = useAIStore.getState().defaultModel;
  const enabled = enabledModels();
  if (chosen) {
    const hit = enabled.find((m) => refKey(m) === refKey(chosen));
    if (hit) return hit;
  }
  return promptModels()[0] ?? enabled[0] ?? null;
}

/** How a model reads in a picker: the hosted model by its product name, others as "Provider · model". */
export function modelLabel(ref: ModelRef): string {
  return ref.providerId === 'hosted'
    ? textProviderMeta('hosted').label
    : `${textProviderMeta(ref.providerId).label} · ${ref.model}`;
}

/** Inverse of `refKey` for select values. */
export function parseRefKey(key: string): ModelRef | null {
  const at = key.indexOf('::');
  if (at <= 0) return null;
  return { providerId: key.slice(0, at) as ModelRef['providerId'], model: key.slice(at + 2) };
}

/** The models the prompt is set to generate from (valid + still enabled). */
export function promptModels(): ModelRef[] {
  const { providers, promptSelection } = useAIStore.getState();
  return promptSelection.filter((r) =>
    r.providerId === 'hosted'
      ? hostedModelRef() !== null
      : providers[r.providerId]?.enabledModels.includes(r.model),
  );
}
