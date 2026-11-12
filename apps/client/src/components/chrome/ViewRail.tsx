import type { ReactNode } from 'react';
import { enabledPluginViews, openPluginView, useEnabledPlugins } from '../../plugins/registry';
import { useSessionStore } from '../../state/sessionStore';
import { GalleryIcon } from '../icons';
import { UiTooltip } from '../ui/Tooltip';

/** The order the plugin views take on the rail; others follow as registered. */
const RAIL_ORDER = ['notes', 'calendar', 'contacts', 'feeds', 'email', 'projects', 'graph'];

interface RailEntry {
  id: string;
  label: string;
  icon: ReactNode;
  open: () => void;
}

/**
 * The views of the board, as a vertical rail of icons on the left edge of
 * the canvas, centred on the window: the gallery, then the plugin views
 * (Notes, Calendar, Projects, any others, Graph View last). The same
 * entries as the View menu, one click away.
 */
export function ViewRail() {
  useEnabledPlugins(); // the rail follows the plugins that are switched on
  const views = enabledPluginViews();
  const rank = (id: string) => {
    const at = RAIL_ORDER.indexOf(id);
    return at < 0 ? RAIL_ORDER.length : at;
  };
  const entries: RailEntry[] = [
    {
      id: 'gallery',
      label: 'Gallery',
      icon: <GalleryIcon />,
      open: () => useSessionStore.getState().setView('gallery'),
    },
    ...[...views]
      .sort((a, b) => rank(a.id) - rank(b.id))
      .map((v) => ({
        id: v.id,
        label: v.label,
        icon: v.icon ?? <GalleryIcon />,
        open: () => openPluginView(v.id),
      })),
  ];
  return (
    <div
      className="chrome-cluster view-rail"
      role="toolbar"
      aria-label="Views"
      data-testid="view-rail"
    >
      {entries.map((e) => (
        <UiTooltip key={e.id} label={e.label} side="right">
          <button
            type="button"
            aria-label={e.label}
            data-testid={`view-rail-${e.id}`}
            onClick={e.open}
          >
            {e.icon}
          </button>
        </UiTooltip>
      ))}
    </div>
  );
}
