import { apiFetch } from './apiBase';
import { decryptBytes, encryptBytes, fromBase64, toBase64 } from '@boardcache/e2ee';
import { requireAdk, useSyncStore } from '../../state/syncStore';
import { useAIStore, type AIPersisted } from '../../state/aiStore';
import { usePluginSettings } from '../../plugins/settingsStore';
import { usePluginPrefs } from '../../plugins/registry';
import { loadCustomThemes, onCustomThemesChanged, replaceCustomThemes } from '../themes';
import type { ThemeFamily } from '../themes';
import { useSessionStore } from '../../state/sessionStore';
import {
  loadLibraryMeta,
  mergeRemoteLibraryMeta,
  normalizeLibraryMeta,
  onLibraryMetaChanged,
  type LibraryMeta,
} from '../board/libraryMeta';

/**
 * Encrypted sync of app settings (AI provider config + per-plugin settings,
 * e.g. stock API keys). When signed in, everything is encrypted with the
 * account data key and stored on the server as one opaque blob — the same key
 * that protects board content, so the server never sees the keys.
 * Last-write-wins; localStorage remains the offline copy.
 */

function signedIn(): boolean {
  const s = useSyncStore.getState();
  return s.status === 'signedIn' && s.adk !== null;
}

/** Account-level app preferences. Device-appropriate settings (light/dark
 *  mode, wheel/zoom behavior, panel positions, the local-model opt-ins —
 *  they gate per-device downloads) deliberately stay per-device. */
interface AppPrefs {
  themeId?: string;
  customThemes?: ThemeFamily[];
  textDefaults?: { fontFamily: string; fontSize: number; align: 'left' | 'center' | 'right' };
  pluginsEnabled?: Record<string, boolean>;
  /** Auto-hide canvas controls (user decision 2026-08-25: follows the account). */
  autoHideChrome?: boolean;
  /** Zoom fraction below which the canvas draws low-detail sprites. */
  lodThreshold?: number;
}

interface SyncedSettings extends AIPersisted {
  pluginSettings?: Record<string, unknown>;
  appPrefs?: AppPrefs;
  /** The board index's folders, board→folder, tags and manual order (user decision 2026-09-15). */
  library?: LibraryMeta;
}

function gatherAppPrefs(): AppPrefs {
  const session = useSessionStore.getState();
  return {
    themeId: session.themeId,
    lodThreshold: session.lodThreshold,
    customThemes: loadCustomThemes(),
    textDefaults: session.textDefaults,
    pluginsEnabled: usePluginPrefs.getState().enabled,
    autoHideChrome: session.autoHideChrome,
  };
}

function applyAppPrefs(prefs: AppPrefs): void {
  const session = useSessionStore.getState();
  // Custom themes first — a synced themeId may reference one of them.
  if (prefs.customThemes) replaceCustomThemes(prefs.customThemes);
  if (prefs.themeId && prefs.themeId !== session.themeId) session.setThemeId(prefs.themeId);
  if (prefs.textDefaults) session.setTextDefaults(prefs.textDefaults);
  if (prefs.pluginsEnabled) usePluginPrefs.getState().replaceEnabled(prefs.pluginsEnabled);
  if (prefs.lodThreshold !== undefined && prefs.lodThreshold !== session.lodThreshold) {
    session.setLodThreshold(prefs.lodThreshold);
  }
  if (prefs.autoHideChrome !== undefined && prefs.autoHideChrome !== session.autoHideChrome) {
    session.setAutoHideChrome(prefs.autoHideChrome);
  }
}

function serialize(p: SyncedSettings): string {
  return JSON.stringify({
    providers: p.providers,
    promptSelection: p.promptSelection,
    defaultModel: p.defaultModel ?? null,
    source: p.source ?? null,
    pluginSettings: p.pluginSettings ?? {},
    appPrefs: p.appPrefs ?? {},
    library: p.library ? normalizeLibraryMeta(p.library) : null,
  });
}

// The last blob we pushed/pulled, to skip redundant writes and avoid loops.
let lastSynced = '';
/** This sign-in has read the account's copy (or found none): only then may a
 *  push carry this device's library, which would otherwise replace folders
 *  made elsewhere with whatever this device last saw. */
let pulled = false;

/** null = the account has no settings yet; undefined = could not ask. */
async function fetchCiphertext(): Promise<string | null | undefined> {
  const res = await apiFetch('/api/settings');
  if (!res.ok) return undefined;
  const data = (await res.json()) as { ciphertext?: string | null };
  return data.ciphertext ?? null;
}

/** Pull and apply synced settings; if the server has none, seed it from local. */
async function pullAISettings(): Promise<void> {
  if (!signedIn()) return;
  const ciphertext = await fetchCiphertext().catch(() => undefined);
  if (ciphertext === undefined) return; // offline or refused: nothing is known, so nothing is seeded
  pulled = true;
  if (ciphertext === null) {
    await pushAISettings(true);
    return;
  }
  try {
    const json = new TextDecoder().decode(await decryptBytes(requireAdk(), fromBase64(ciphertext)));
    const parsed = JSON.parse(json) as SyncedSettings;
    if (!parsed.providers) return;
    const incoming = serialize(parsed);
    if (incoming === lastSynced) return; // our own last push, or nothing new
    lastSynced = incoming;
    useAIStore.getState().replaceAll(parsed);
    // Blobs from before plugin settings existed leave local values alone.
    if (parsed.pluginSettings) usePluginSettings.getState().replaceAll(parsed.pluginSettings);
    if (parsed.appPrefs) applyAppPrefs(parsed.appPrefs);
    if (parsed.library) {
      // Entry by entry, so what this device organised meanwhile survives;
      // when the merge adds to the account's copy, the account gets it back.
      const { differs } = await mergeRemoteLibraryMeta(parsed.library);
      if (differs) void pushAISettings();
    }
  } catch {
    /* can't decrypt (different account) — leave local settings as-is */
  }
}

/** Encrypt the current settings and push them to the server. */
async function pushAISettings(force = false): Promise<void> {
  if (!signedIn()) return;
  if (!pulled) {
    // A change before the first read of this sign-in: read first, so the
    // library that goes up is the account's (with this device's change
    // applied on top by the next push), never this device's stale copy.
    await pullAISettings();
    if (!pulled) return; // still unreachable: the change waits for the next pass
  }
  const { providers, promptSelection, defaultModel, source } = useAIStore.getState();
  const library = await loadLibraryMeta().catch(() => null);
  const json = serialize({
    providers,
    promptSelection,
    defaultModel: defaultModel ?? null,
    source: source ?? null,
    pluginSettings: usePluginSettings.getState().settings,
    appPrefs: gatherAppPrefs(),
    ...(library ? { library } : {}),
  });
  if (!force && json === lastSynced) return;
  lastSynced = json;
  const ciphertext = toBase64(await encryptBytes(requireAdk(), new TextEncoder().encode(json)));
  await apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ciphertext }),
  }).catch(() => {});
}

/** Wire push-on-change and pull-on-sign-in. Returns a teardown function. */
export function initSettingsSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const push = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void pushAISettings();
    }, 800);
  };
  const unsubLibrary = onLibraryMetaChanged((source) => {
    if (source === 'local') push();
  });
  const unsubAI = useAIStore.subscribe(push);
  const unsubPlugins = usePluginSettings.subscribe(push);
  const unsubPrefs = usePluginPrefs.subscribe(push);
  const unsubThemes = onCustomThemesChanged(push);
  // Theme family + text defaults: push when they change (selector-scoped so
  // ephemeral session churn doesn't schedule writes).
  const unsubSession = useSessionStore.subscribe(
    (s) => `${s.themeId}|${JSON.stringify(s.textDefaults)}|${s.autoHideChrome}|${s.lodThreshold}`,
    push,
  );
  const unsubSync = useSyncStore.subscribe((s, prev) => {
    if (s.status !== 'signedIn' && prev.status === 'signedIn') pulled = false;
    if (s.status === 'signedIn' && prev.status !== 'signedIn') void pullAISettings();
    // Every sync pass also re-reads the account's settings so folders made on
    // another device show up here — unless this device has a push in flight.
    else if (s.status === 'signedIn' && s.lastSyncedAt !== prev.lastSyncedAt && timer === undefined)
      void pullAISettings();
  });
  if (signedIn()) void pullAISettings();
  return () => {
    unsubLibrary();
    unsubAI();
    unsubPlugins();
    unsubPrefs();
    unsubThemes();
    unsubSession();
    unsubSync();
    clearTimeout(timer);
  };
}
