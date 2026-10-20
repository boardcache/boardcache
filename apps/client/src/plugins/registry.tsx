import type { ComponentType, ReactNode } from 'react';
import type { Item } from '@boardcache/schema';
import type { BoardTool } from '../lib/tools/registry';
import type { MenuEntry } from '../lib/menuBuilders';
import { useSessionStore } from '../state/sessionStore';
import { setPluginToolSource } from '../lib/tools/registry';
import { create } from 'zustand';

/**
 * Internal plugin system. A plugin is a self-contained feature that registers
 * what it contributes — Add-menu entries and root-mounted components — instead
 * of being hardwired into MenuBar/App. Users toggle plugins in Settings →
 * Plugins; disabled plugins contribute nothing.
 *
 * The interface is deliberately narrow and designed as if it were public:
 * plugins act through contributions and the normal command/import paths, and
 * never introduce new item types (those are bound to the versioned schema).
 * If third-party plugins ever happen, this registry becomes the internal half
 * of a sandboxed bridge — see the plugins discussion in the repo history.
 */

interface PluginManifest {
  /** Stable id, also the prefs key ('stock-photos'). */
  id: string;
  name: string;
  description: string;
  /** Enabled for fresh profiles unless set false. */
  defaultEnabled?: boolean;
  /** Add-menu / settings-list position (ascending; unset sorts last). */
  order?: number;
  /**
   * A platform plugin: present only where this returns true, switched on
   * there by itself, and never listed under Settings → Plugins (nothing for
   * the user to decide; the platform decided it).
   */
  platform?: () => boolean;
}

/**
 * Fixed + Add menu categories. System entries and plugin entries share them:
 * a plugin files each entry under the category matching what it creates
 * (default 'misc').
 */
export type AddMenuCategory = 'media' | 'colors' | 'links' | 'documents' | 'structure' | 'misc';

export const ADD_CATEGORY_ORDER: AddMenuCategory[] = [
  'media',
  'documents',
  'links',
  'structure',
  'colors',
  'misc',
];

export const ADD_CATEGORY_LABELS: Record<AddMenuCategory, string> = {
  media: 'Media',
  colors: 'Colors',
  links: 'Links',
  documents: 'Documents',
  structure: 'Structure', // items with an internal schema: timelines, projects, charts, recipes
  misc: 'Misc',
};

interface PluginAddMenuEntry {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Which Add-menu category this entry lands in (default 'misc'). */
  category?: AddMenuCategory;
  /** Evaluated when the menu builds; false hides the entry (e.g. polls
   *  only make sense on live team boards). */
  when?: () => boolean;
}

export interface BoardPlugin {
  manifest: PluginManifest;
  /** Entries contributed to the + Add menu while enabled. */
  addMenu?: PluginAddMenuEntry[];
  /** Component mounted at the app root while enabled (dialogs, overlays). */
  Component?: ComponentType;
  /** Rendered on the plugin's own page under Settings → Plugins. */
  SettingsPanel?: ComponentType;
  /** Board tools contributed while the plugin is enabled (see lib/tools). */
  tools?: BoardTool[];
  /** Rendered in the lightbox sidebar's Assistant tab for the open item. */
  ItemSidePanel?: ComponentType<{ itemId: string }>;
  /**
   * Toggle button rendered in the bottom-right corner cluster (next to
   * layers/minimap) while enabled. The plugin owns the button markup — use
   * className "corner-toggle" (+" active") to match the cluster.
   */
  CornerButton?: ComponentType;
  /**
   * Extra context-menu entries for a single right-clicked item (return []
   * for items the plugin doesn't apply to). Appended after the built-ins.
   */
  itemMenu?: (item: Item) => MenuEntry[];
  /**
   * Full-screen views on the gallery chassis, routed at /b/:boardId/<id>
   * (e.g. the Projects suite). Open one with `openPluginView(id)`.
   */
  views?: PluginView[];
}

export interface PluginView {
  /** Stable id — also the URL segment under /b/:boardId/. */
  id: string;
  label: string;
  /** Shown beside the label where views are listed (View menu). */
  icon?: ReactNode;
  Component: ComponentType;
  /** Route segments after /b/:boardId/<id> that describe the view's state
   *  (e.g. a project, its mode, an open detail) — call `syncUrl()` from
   *  lib/router when that state changes. */
  subPath?: () => string[];
  /** Apply route segments (deep link, back/forward). Empty = the view's root. */
  applySubPath?: (segments: string[]) => void;
}

/** Every enabled plugin's full-screen views, in plugin order. */
export function enabledPluginViews(): PluginView[] {
  const overrides = usePluginPrefs.getState().enabled;
  return registry.filter((p) => isPluginEnabled(p, overrides)).flatMap((p) => p.views ?? []);
}

const registry: BoardPlugin[] = [];

// Enabled plugins feed their tools into the core tool registry (lazy source
// avoids an import cycle registry↔tools).
setPluginToolSource(() =>
  registry
    .filter((p) => isPluginEnabled(p, usePluginPrefs.getState().enabled))
    .flatMap((p) => p.tools ?? []),
);

export function registerPlugin(plugin: BoardPlugin): void {
  if (registry.some((p) => p.manifest.id === plugin.manifest.id)) return; // HMR double-run
  registry.push(plugin);
  // Discovery order is alphabetical (glob) — manifests declare display order.
  registry.sort((a, b) => (a.manifest.order ?? 1000) - (b.manifest.order ?? 1000));
}

export function allPlugins(): BoardPlugin[] {
  return registry;
}

// --- enabled state (persisted) ------------------------------------------------

const PREF_KEY = 'boardcache:plugins';

function loadEnabledMap(): Record<string, boolean> {
  try {
    return (JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Record<string, boolean>) ?? {};
  } catch {
    return {};
  }
}

interface PluginPrefs {
  /** Explicit overrides only; anything absent falls back to defaultEnabled. */
  enabled: Record<string, boolean>;
  setEnabled: (id: string, on: boolean) => void;
  /** Replace everything (applying a pulled settings-sync blob). */
  replaceEnabled: (enabled: Record<string, boolean>) => void;
}

export const usePluginPrefs = create<PluginPrefs>((set) => ({
  enabled: loadEnabledMap(),
  setEnabled: (id, on) =>
    set((s) => {
      const enabled = { ...s.enabled, [id]: on };
      try {
        localStorage.setItem(PREF_KEY, JSON.stringify(enabled));
      } catch {
        /* storage unavailable */
      }
      return { enabled };
    }),
  replaceEnabled: (enabled) => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(enabled));
    } catch {
      /* storage unavailable */
    }
    set({ enabled });
  },
}));

export function isPluginEnabled(plugin: BoardPlugin, overrides: Record<string, boolean>): boolean {
  if (plugin.manifest.platform) return plugin.manifest.platform();
  return overrides[plugin.manifest.id] ?? plugin.manifest.defaultEnabled ?? true;
}

/** The plugins a person may switch on and off (platform plugins are not among them). */
export function listedPlugins(): BoardPlugin[] {
  return registry.filter((p) => !p.manifest.platform);
}

/** Reactive list of currently-enabled plugins. */
export function useEnabledPlugins(): BoardPlugin[] {
  const overrides = usePluginPrefs((s) => s.enabled);
  return registry.filter((p) => isPluginEnabled(p, overrides));
}

/** The first enabled plugin offering a lightbox item side panel (assistant). */
export function usePluginItemSidePanel(): ComponentType<{ itemId: string }> | null {
  const plugins = useEnabledPlugins();
  return plugins.find((p) => p.ItemSidePanel)?.ItemSidePanel ?? null;
}

/** A registered (and enabled) plugin view by id, or null. */
export function pluginViewById(id: string): PluginView | null {
  const overrides = usePluginPrefs.getState().enabled;
  for (const p of registry) {
    if (!isPluginEnabled(p, overrides)) continue;
    const v = p.views?.find((x) => x.id === id);
    if (v) return v;
  }
  return null;
}

/** Switch the app to a plugin's full-screen view (routes to /b/:id/<viewId>). */
export function openPluginView(id: string): void {
  if (!pluginViewById(id)) return;
  const session = useSessionStore.getState();
  session.setPluginView(id);
  session.setView('plugin');
}

/** App-root outlet: renders the active plugin view (falls back to nothing). */
export function PluginViewOutlet() {
  const id = useSessionStore((s) => s.pluginView);
  useEnabledPlugins(); // re-resolve when plugins are toggled
  const view = id ? pluginViewById(id) : null;
  if (!view) return null;
  const { Component } = view;
  return <Component />;
}

/** Context-menu entries every enabled plugin contributes for this item. */
export function pluginItemMenuEntries(item: Item): MenuEntry[] {
  const overrides = usePluginPrefs.getState().enabled;
  return registry
    .filter((p) => isPluginEnabled(p, overrides))
    .flatMap((p) => p.itemMenu?.(item) ?? []);
}

/** Corner-cluster outlet: every enabled plugin's corner toggle, in order. */
export function PluginCornerButtons() {
  const plugins = useEnabledPlugins();
  return (
    <>
      {plugins.map(
        ({ manifest, CornerButton }) => CornerButton && <CornerButton key={manifest.id} />,
      )}
    </>
  );
}

/** Root outlet: mounts every enabled plugin's component. */
export function PluginOutlet() {
  const plugins = useEnabledPlugins();
  return (
    <>{plugins.map(({ manifest, Component }) => Component && <Component key={manifest.id} />)}</>
  );
}
