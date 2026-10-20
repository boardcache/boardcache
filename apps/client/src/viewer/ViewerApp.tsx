import { useCallback, useEffect } from 'react';
import { CanvasViewport } from '../components/canvas/CanvasViewport';
import { EmbedPlayerLayer } from '../components/canvas/EmbedPlayerLayer';
import { ZoomPill } from '../components/chrome/ChromeClusters';
import { ContextMenu } from '../components/chrome/ContextMenu';
import { CornerControls } from '../components/canvas/CornerControls';
import { GalleryScreen } from '../components/library/GalleryScreen';
import { LayersPanel } from '../components/panels/LayersPanel';
import { PagesPanel } from '../components/panels/PagesPanel';
import { Lightbox } from '../components/lightbox/Lightbox';
import { Minimap } from '../components/canvas/Minimap';
import { PresentationHud } from '../components/canvas/PresentationHud';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import { useTheme } from '../hooks/useTheme';
import { syncBoardFonts } from '../lib/media/fontRegistry';
import { zoomToFit } from '../lib/canvas/viewportActions';
import { useDocumentStore } from '../state/documentStore';
import { useSessionStore } from '../state/sessionStore';
import { ViewerToolbar } from './ViewerToolbar';

/**
 * The offline-viewer shell: the same interactive canvas, gallery, and lightbox
 * as the app, but with a slim toolbar and none of the editing chrome, sync, or
 * persistence. It is read-only: nothing can be added, deleted or edited —
 * the context menus, shortcuts and double-click all know (`VIEWER`).
 */
export function ViewerApp() {
  useTheme();
  useGlobalShortcuts(
    useCallback(() => document.querySelector<HTMLElement>('.canvas-viewport'), []),
  );

  const view = useSessionStore((s) => s.view);

  useEffect(() => {
    // The session boots on the library view; the viewer IS the canvas, and
    // canvas gestures (the document-level pinch) check for it.
    useSessionStore.getState().setView('canvas');
    syncBoardFonts(useDocumentStore.getState().doc);
  }, []);

  // Open with everything in view: the published viewport is the author's
  // last edit position, which means little on a stranger's screen (and less
  // on a phone). Double rAF: the canvas viewport must have its layout size.
  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() =>
        zoomToFit(document.querySelector<HTMLElement>('.canvas-viewport')),
      );
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  if (view === 'gallery') {
    return (
      <div className="app-shell viewer-shell">
        <GalleryScreen />
        <Lightbox />
      </div>
    );
  }

  return (
    <div className="app-shell viewer-shell">
      <CanvasViewport />
      <ViewerToolbar />
      <ZoomPill />
      <Minimap />
      <LayersPanel />
      <PagesPanel />
      <CornerControls />
      <PresentationHud />
      <EmbedPlayerLayer />
      <ContextMenu />
      <Lightbox />
    </div>
  );
}
