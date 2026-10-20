import { useEffect, useState } from 'react';
import { updateBoardSettings } from '../state/commands';
import { useDocumentStore } from '../state/documentStore';
import { resolveTheme, useSessionStore } from '../state/sessionStore';
import { zoomToFit } from '../lib/canvas/viewportActions';
import { ExpandIcon, FitIcon, GalleryIcon, GridIcon, MoonIcon, SunIcon } from '../components/icons';
import { FRAMED_VIEWER } from '../lib/viewerMode';

/** Slim top bar for the offline viewer: name + grid/gallery/theme/fullscreen. */
export function ViewerToolbar() {
  const name = useDocumentStore((s) => s.doc.name);
  const gridVisible = useDocumentStore((s) => s.doc.settings.gridVisible);
  const theme = useSessionStore((s) => s.theme);
  const resolved = resolveTheme(theme);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  return (
    <header className="viewer-toolbar" role="toolbar" aria-label="Viewer">
      <div className="viewer-title" title={FRAMED_VIEWER ? undefined : name}>
        {!FRAMED_VIEWER && name}
        <span className="viewer-badge">view-only</span>
      </div>
      <div className="viewer-actions">
        <button
          type="button"
          onClick={() => zoomToFit(document.querySelector<HTMLElement>('.canvas-viewport'))}
          title="Fit all content"
          data-testid="viewer-fit"
        >
          <FitIcon />
        </button>
        <button
          type="button"
          className={gridVisible ? 'active' : ''}
          onClick={() => updateBoardSettings({ gridVisible: !gridVisible })}
          title={gridVisible ? 'Hide grid' : 'Show grid'}
          aria-pressed={gridVisible}
          data-testid="viewer-grid"
        >
          <GridIcon />
        </button>
        <button
          type="button"
          onClick={() => useSessionStore.getState().setView('gallery')}
          title="Browse all items"
          data-testid="viewer-gallery"
        >
          <GalleryIcon />
        </button>
        <button
          type="button"
          onClick={() =>
            useSessionStore.getState().setTheme(resolved === 'dark' ? 'light' : 'dark')
          }
          title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
          data-testid="viewer-theme"
        >
          {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          type="button"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen();
          }}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          data-testid="viewer-fullscreen"
        >
          <ExpandIcon />
        </button>
      </div>
    </header>
  );
}
