import { useState } from 'react';
import type { MapItem } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { mapEmbedUrl, mapLabel, mapStaticUrl } from '../../lib/integrations/mapEmbed';
import { MapPinIcon } from '../icons';

/**
 * Embedded map. On the canvas the poster stands in for the map until
 * "Interact" mounts the provider's live iframe — a live map is a whole map
 * runtime, and a handful of them is enough to run an iPhone out of memory
 * while pinching. Done unmounts it again. Without a poster (no snapshot yet,
 * no static-image key) the live frame shows from the start, behind a shield
 * so canvas gestures still win. Static display — and any context that can't
 * build an embed URL (no key, Mapbox, the shared viewer) — renders the
 * poster, falling back to the provider's static image URL, falling back to
 * a labeled placeholder. The lightbox is always live.
 */
export function MapContent({
  item,
  lightbox = false,
}: {
  item: MapItem;
  /** In the lightbox there's no canvas to guard — always live, no shield. */
  lightbox?: boolean;
}) {
  const posterUrl = useAssetUrl(item.posterAssetId);
  const [interactive, setInteractive] = useState(false);
  const isInteractive = lightbox || interactive;
  const embedUrl = item.display === 'interactive' || lightbox ? mapEmbedUrl(item) : null;
  const staticUrl = posterUrl ?? mapStaticUrl(item, item.width, item.height);
  // A poster whose bytes never arrived must not leave a broken image: go live.
  const [posterBroken, setPosterBroken] = useState(false);
  const live = embedUrl !== null && (isInteractive || !staticUrl || posterBroken);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const interact = embedUrl !== null && !lightbox && (
    <button
      type="button"
      className={`map-interact${interactive ? ' active' : ''}`}
      data-testid="map-interact"
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={(e) => {
        e.stopPropagation();
        setInteractive((v) => !v);
      }}
      title={interactive ? 'Stop interacting' : 'Interact with the map'}
    >
      {interactive ? 'Done' : 'Interact'}
    </button>
  );

  if (!live) {
    return (
      <div className="map-embed" data-testid="map-embed">
        {staticUrl ? (
          <img
            className="map-poster"
            src={staticUrl}
            alt={mapLabel(item)}
            draggable={false}
            onError={() => setPosterBroken(true)}
          />
        ) : (
          <div className="map-empty" data-testid="map-empty">
            <span className="map-empty-glyph">
              <MapPinIcon size={26} />
            </span>
            <span>{mapLabel(item)}</span>
            {item.provider !== 'osm' && (
              <span className="map-empty-hint">
                Add a {item.provider === 'google' ? 'Google Maps' : 'Mapbox'} key in Settings →
                Plugins → Maps
              </span>
            )}
          </div>
        )}
        {interact}
      </div>
    );
  }

  return (
    <div className="map-embed" data-testid="map-embed">
      <iframe
        className="map-frame"
        src={embedUrl}
        title={mapLabel(item)}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
      {!isInteractive && <div className="map-shield" data-testid="map-shield" />}
      {interact}
    </div>
  );
}
