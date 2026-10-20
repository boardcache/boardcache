import type { MapItem } from '@boardcache/schema';

/**
 * Provider URL builders for map items. Keys come from the Maps plugin's
 * settings (client-side, referrer-restricted keys by design) and are read
 * straight from localStorage so this module stays viewer-safe — item
 * rendering must never import plugin code, and a context without keys (the
 * shared viewer, another person's browser) simply gets `null` and falls back
 * to the poster asset.
 */

export interface MapKeys {
  google?: string;
  mapbox?: string;
}

interface MapsPluginSettings {
  keys?: MapKeys;
}

export function mapKeys(): MapKeys {
  try {
    const all = JSON.parse(localStorage.getItem('boardcache:pluginSettings') ?? '{}') as Record<
      string,
      unknown
    >;
    return (all['maps'] as MapsPluginSettings | undefined)?.keys ?? {};
  } catch {
    return {};
  }
}

// --- Web Mercator helpers (shared by the OSM embed bbox + tile snapshots) ----

/** Tile-space coordinates (fractional) of a lon/lat at a zoom level. */
export function lngLatToTile(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

function tileToLngLat(x: number, y: number, zoom: number): { lng: number; lat: number } {
  const n = 2 ** zoom;
  const lng = (x / n) * 360 - 180;
  const rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lng, lat: (rad * 180) / Math.PI };
}

/** Geographic bbox covering wPx×hPx screen pixels around a center. */
function bboxAround(
  lat: number,
  lng: number,
  zoom: number,
  wPx: number,
  hPx: number,
): { west: number; south: number; east: number; north: number } {
  const c = lngLatToTile(lng, lat, zoom);
  const dx = wPx / 2 / 256;
  const dy = hPx / 2 / 256;
  const nw = tileToLngLat(c.x - dx, c.y - dy, zoom);
  const se = tileToLngLat(c.x + dx, c.y + dy, zoom);
  return { west: nw.lng, south: se.lat, east: se.lng, north: nw.lat };
}

// --- embed / static / external URLs ------------------------------------------

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The live embed URL for an interactive map iframe, or null when this
 * provider/context can't render live (Mapbox is static-only; Google needs a
 * key). Callers fall back to the poster.
 */
export function mapEmbedUrl(item: MapItem, keys: MapKeys = mapKeys()): string | null {
  if (item.provider === 'osm') {
    if (item.mapMode === 'directions') return null; // OSM has no directions embed
    const b = bboxAround(item.lat, item.lng, item.zoom, item.width, item.height);
    const marker = item.marker ? `&marker=${round(item.lat)}%2C${round(item.lng)}` : '';
    return (
      `https://www.openstreetmap.org/export/embed.html?bbox=` +
      `${round(b.west)}%2C${round(b.south)}%2C${round(b.east)}%2C${round(b.north)}` +
      `&layer=mapnik${marker}`
    );
  }
  if (item.provider === 'google') {
    if (!keys.google) return null;
    const key = encodeURIComponent(keys.google);
    if (item.mapMode === 'directions') {
      if (!item.origin || !item.destination) return null;
      return (
        `https://www.google.com/maps/embed/v1/directions?key=${key}` +
        `&origin=${encodeURIComponent(item.origin)}` +
        `&destination=${encodeURIComponent(item.destination)}` +
        `&mode=${item.travelMode}`
      );
    }
    const maptype = item.style === 'satellite' ? 'satellite' : 'roadmap';
    const center = `${round(item.lat)},${round(item.lng)}`;
    // place mode shows a pin + info card for the searched place; view mode is
    // a bare centered map.
    if (item.marker && item.query) {
      return (
        `https://www.google.com/maps/embed/v1/place?key=${key}` +
        `&q=${encodeURIComponent(item.query)}` +
        `&center=${center}&zoom=${Math.round(item.zoom)}&maptype=${maptype}`
      );
    }
    return (
      `https://www.google.com/maps/embed/v1/view?key=${key}` +
      `&center=${center}&zoom=${Math.round(item.zoom)}&maptype=${maptype}`
    );
  }
  return null; // mapbox: static images only
}

/**
 * A static map image URL at roughly wPx×hPx (retina where supported), or null
 * when the provider has no static API / no key. OSM static images are
 * stitched from tiles instead (see the plugin's snapshot module).
 */
export function mapStaticUrl(
  item: MapItem,
  wPx: number,
  hPx: number,
  keys: MapKeys = mapKeys(),
): string | null {
  const w = Math.max(1, Math.min(1280, Math.round(wPx)));
  const h = Math.max(1, Math.min(1280, Math.round(hPx)));
  const center = `${round(item.lat)},${round(item.lng)}`;
  if (item.provider === 'google' && keys.google) {
    if (item.mapMode === 'directions') return null; // needs a routes polyline
    const maptype = item.style === 'satellite' ? 'satellite' : 'roadmap';
    const marker = item.marker ? `&markers=color:red%7C${center}` : '';
    return (
      `https://maps.googleapis.com/maps/api/staticmap?center=${center}` +
      `&zoom=${Math.round(item.zoom)}&size=${Math.min(640, w)}x${Math.min(640, h)}&scale=2` +
      `&maptype=${maptype}${marker}&key=${encodeURIComponent(keys.google)}`
    );
  }
  if (item.provider === 'mapbox' && keys.mapbox) {
    if (item.mapMode === 'directions') return null;
    const style = item.style === 'satellite' ? 'satellite-streets-v12' : 'streets-v12';
    const pin = item.marker ? `pin-s+e63946(${round(item.lng)},${round(item.lat)})/` : '';
    return (
      `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${pin}` +
      `${round(item.lng)},${round(item.lat)},${item.zoom}/${w}x${h}@2x` +
      `?access_token=${encodeURIComponent(keys.mapbox)}`
    );
  }
  return null;
}

/** Where "open this map in the provider's site" should go (always works, keyless). */
export function mapExternalUrl(item: MapItem): string {
  if (item.mapMode === 'directions') {
    return (
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${encodeURIComponent(item.origin)}` +
      `&destination=${encodeURIComponent(item.destination)}` +
      `&travelmode=${item.travelMode}`
    );
  }
  if (item.provider === 'google') {
    return `https://www.google.com/maps/search/?api=1&query=${round(item.lat)}%2C${round(item.lng)}`;
  }
  const marker = item.marker ? `?mlat=${round(item.lat)}&mlon=${round(item.lng)}` : '';
  return `https://www.openstreetmap.org/${marker}#map=${Math.round(item.zoom)}/${round(item.lat)}/${round(item.lng)}`;
}

/**
 * Signature of everything a snapshot depends on — an async poster only lands
 * if the map hasn't been edited meanwhile (see setMapPoster).
 */
export const mapPosterKey = (item: MapItem): string =>
  [
    item.provider,
    item.mapMode,
    item.style,
    round(item.lat),
    round(item.lng),
    item.zoom,
    item.marker,
    item.origin,
    item.destination,
    item.travelMode,
  ].join('|');

/** Short human label for gallery cards / exports / assistant output. */
export function mapLabel(item: MapItem): string {
  if (item.name?.trim()) return item.name.trim();
  if (item.mapMode === 'directions') {
    return item.origin && item.destination ? `${item.origin} → ${item.destination}` : 'Directions';
  }
  return item.query || `${round(item.lat)}, ${round(item.lng)}`;
}
