import type { ReactNode } from 'react';
import { startPresentation } from '../../lib/canvas/presentation';
import { VIEWER } from '../../lib/viewerMode';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { CommandIcon, LayersIcon, MinimapIcon, PagesIcon, PresentationIcon } from '../icons';
import { UiTooltip } from '../ui/Tooltip';

/**
 * Bottom-right toggle cluster for the layers panel and the minimap.
 * `children` lets the app prepend extra toggles (plugin corner buttons)
 * without this shared component importing the plugin registry (viewer-safe).
 *
 * The read-only viewer shows only what a reader can use: Pages when the
 * board has more than one, Presentation as a Play button when the author
 * ordered steps, and no command palette (it has no commands there).
 */
export function CornerControls({ children }: { children?: ReactNode }) {
  const layersOpen = useSessionStore((s) => s.layersOpen);
  const presentOpen = useSessionStore((s) => s.presentPanelOpen);
  const pagesOpen = useSessionStore((s) => s.pagesOpen);
  const minimapOpen = useSessionStore((s) => s.minimapOpen);
  const pageCount = useDocumentStore((s) => s.doc.pages.length);
  const stepCount = useDocumentStore((s) => s.doc.presentation.steps.length);
  return (
    <div className="corner-controls">
      {/* Phones have no Ctrl+P — surface the palette as a corner toggle
          (mobile-only via CSS), stacked above the plugin/chat buttons. */}
      {!VIEWER && (
        <UiTooltip label="Command palette (Ctrl+P)">
          <button
            type="button"
            className="corner-toggle corner-palette"
            data-testid="palette-toggle"
            aria-label="Command palette"
            onClick={() => useSessionStore.getState().setPaletteOpen(true)}
          >
            <CommandIcon />
          </button>
        </UiTooltip>
      )}
      {children}
      {(!VIEWER || pageCount > 1) && (
        <UiTooltip label={pagesOpen ? 'Hide pages' : 'Pages'}>
          <button
            type="button"
            className={`corner-toggle${pagesOpen ? ' active' : ''}`}
            data-testid="pages-toggle"
            aria-pressed={pagesOpen}
            aria-label="Pages"
            onClick={() => useSessionStore.getState().setPagesOpen(!pagesOpen)}
          >
            <PagesIcon />
          </button>
        </UiTooltip>
      )}
      {VIEWER ? (
        stepCount > 0 && (
          <UiTooltip label="Play presentation">
            <button
              type="button"
              className="corner-toggle"
              data-testid="presentation-toggle"
              aria-label="Play presentation"
              onClick={() => startPresentation()}
            >
              <PresentationIcon />
            </button>
          </UiTooltip>
        )
      ) : (
        <UiTooltip label={presentOpen ? 'Hide presentation' : 'Presentation'}>
          <button
            type="button"
            className={`corner-toggle${presentOpen ? ' active' : ''}`}
            data-testid="presentation-toggle"
            aria-pressed={presentOpen}
            aria-label="Presentation"
            onClick={() => useSessionStore.getState().setPresentPanelOpen(!presentOpen)}
          >
            <PresentationIcon />
          </button>
        </UiTooltip>
      )}
      <UiTooltip label={layersOpen ? 'Hide layers' : 'Show layers'}>
        <button
          type="button"
          className={`corner-toggle${layersOpen ? ' active' : ''}`}
          data-testid="layers-toggle"
          aria-pressed={layersOpen}
          aria-label="Layers"
          onClick={() => useSessionStore.getState().setLayersOpen(!layersOpen)}
        >
          <LayersIcon />
        </button>
      </UiTooltip>
      <UiTooltip label={minimapOpen ? 'Hide minimap' : 'Show minimap'}>
        <button
          type="button"
          className={`corner-toggle${minimapOpen ? ' active' : ''}`}
          data-testid="minimap-toggle"
          aria-pressed={minimapOpen}
          aria-label="Minimap"
          onClick={() => useSessionStore.getState().setMinimapOpen(!minimapOpen)}
        >
          <MinimapIcon />
        </button>
      </UiTooltip>
    </div>
  );
}
