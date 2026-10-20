import { useDocumentStore } from '../../state/documentStore';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { bgImageCss } from '../../lib/canvas/bgImage';

/**
 * Board wallpaper: the settings' background image, fixed to the viewport
 * (it does not pan or zoom with the world). Sits under everything and never
 * takes pointer events.
 */
export function CanvasBackgroundLayer() {
  const bg = useDocumentStore((s) => s.doc.settings.backgroundImage);
  const url = useAssetUrl(bg?.assetId ?? null);
  if (!bg || !url) return null;
  return (
    <div
      className="canvas-bg-image"
      data-testid="canvas-bg-image"
      aria-hidden
      style={{
        backgroundImage: `url(${url})`,
        opacity: bg.opacity,
        ...bgImageCss(bg.mode),
      }}
    />
  );
}
