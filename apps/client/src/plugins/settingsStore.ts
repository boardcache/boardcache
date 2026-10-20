import { create } from 'zustand';

/**
 * Per-plugin settings: one JSON value per plugin id, persisted locally and —
 * when signed in — included in the encrypted settings sync blob (see
 * lib/settingsSync), so API keys and preferences follow the account without
 * the server ever reading them.
 */

const PREF_KEY = 'boardcache:pluginSettings';

function loadAll(): Record<string, unknown> {
  try {
    const map =
      (JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Record<string, unknown>) ?? {};
    // One-time migration: stock API keys predate plugin settings.
    if (!map['stock-photos']) {
      const legacy = localStorage.getItem('boardcache:stockKeys');
      if (legacy) map['stock-photos'] = { keys: JSON.parse(legacy) as Record<string, string> };
    }
    return map;
  } catch {
    return {};
  }
}

function persist(settings: Record<string, unknown>): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

interface PluginSettingsState {
  settings: Record<string, unknown>;
  set: (pluginId: string, value: unknown) => void;
  /** Replace everything (applying a pulled sync blob). */
  replaceAll: (settings: Record<string, unknown>) => void;
}

export const usePluginSettings = create<PluginSettingsState>((set) => ({
  settings: loadAll(),
  set: (pluginId, value) =>
    set((s) => {
      const settings = { ...s.settings, [pluginId]: value };
      persist(settings);
      return { settings };
    }),
  replaceAll: (settings) => {
    persist(settings);
    set({ settings });
  },
}));

/** Current settings value for one plugin (non-reactive read). */
export function getPluginSettings<T>(pluginId: string): T | undefined {
  return usePluginSettings.getState().settings[pluginId] as T | undefined;
}
