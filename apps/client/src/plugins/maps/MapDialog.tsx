import { useState } from 'react';
import type { MapItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { UiDialog } from '../../components/ui/Dialog';
import { UiSelect } from '../../components/ui/Select';
import { mapEmbedUrl, mapKeys, mapStaticUrl } from '../../lib/integrations/mapEmbed';
import { findOpenSpot } from '../../lib/canvas/placeSpot';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { addItems, topZIndex, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { usePluginSettings } from '../settingsStore';
import { generateMapPoster } from './mapSnapshot';

/**
 * Create/edit dialog for map items: place search (Nominatim geocoding —
 * keyless), a directions tab (Google Embed API), provider/style/zoom
 * controls and a live preview. Provider keys come from the plugin settings.
 */

/** Mid-screen in canvas coords (same as the Add menu's placement). */
const viewCenterCanvas = () => clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);

interface GeoResult {
  lat: number;
  lng: number;
  label: string;
  zoom: number;
}

/** A zoom that roughly fits a geocoder bounding box in a ~480px view. */
function zoomForBbox(bb: [string, string, string, string]): number {
  const s = Number(bb[0]);
  const n = Number(bb[1]);
  const w = Number(bb[2]);
  const e = Number(bb[3]);
  const dLat = Math.max(1e-4, Math.abs(n - s));
  const dLng = Math.max(1e-4, Math.abs(e - w));
  const z = Math.min(Math.log2(360 / dLng), Math.log2(170 / dLat));
  return Math.max(2, Math.min(17, Math.round(z)));
}

async function geocode(query: string): Promise<GeoResult[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const rows = (await res.json()) as {
    lat: string;
    lon: string;
    display_name: string;
    boundingbox: [string, string, string, string];
  }[];
  return rows.map((r) => ({
    lat: Number(r.lat),
    lng: Number(r.lon),
    label: r.display_name,
    zoom: zoomForBbox(r.boundingbox),
  }));
}

type Draft = Pick<
  MapItem,
  | 'provider'
  | 'mapMode'
  | 'style'
  | 'lat'
  | 'lng'
  | 'zoom'
  | 'query'
  | 'marker'
  | 'origin'
  | 'destination'
  | 'travelMode'
  | 'display'
>;

const DEFAULT_DRAFT: Draft = {
  provider: 'osm',
  mapMode: 'view',
  style: 'streets',
  lat: 48.8584,
  lng: 2.2945,
  zoom: 13,
  query: '',
  marker: true,
  origin: '',
  destination: '',
  travelMode: 'driving',
  display: 'interactive',
};

export function MapDialog({ editId, onClose }: { editId: string | null; onClose: () => void }) {
  const editItem = useDocumentStore.getState().doc.items[editId ?? ''];
  const [draft, setDraft] = useState<Draft>(() =>
    editItem?.type === 'map'
      ? {
          provider: editItem.provider,
          mapMode: editItem.mapMode,
          style: editItem.style,
          lat: editItem.lat,
          lng: editItem.lng,
          zoom: editItem.zoom,
          query: editItem.query,
          marker: editItem.marker,
          origin: editItem.origin,
          destination: editItem.destination,
          travelMode: editItem.travelMode,
          display: editItem.display,
        }
      : DEFAULT_DRAFT,
  );
  // Directions force the Google provider; remember what to restore when the
  // user tabs back to a plain map view.
  const [prevProvider, setPrevProvider] = useState<Draft['provider'] | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Subscribe so key edits in Settings reflect here immediately.
  usePluginSettings((s) => s.settings['maps']);
  const keys = mapKeys();

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const runSearch = async () => {
    const q = search.trim();
    if (!q || searching) return;
    setSearching(true);
    setError(null);
    try {
      const rows = await geocode(q);
      setResults(rows);
      if (!rows.length) setError('No places found.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const pick = (r: GeoResult) => {
    patch({ lat: r.lat, lng: r.lng, zoom: r.zoom, query: r.label.split(',')[0] ?? r.label });
    setResults(null);
    setSearch('');
  };

  // The preview mirrors the item renderer at a fixed size (URL building is
  // cheap — no memo; the iframe only reloads when the src string changes).
  const pseudo = {
    ...DEFAULT_DRAFT,
    ...draft,
    id: 'preview',
    type: 'map' as const,
    x: 0,
    y: 0,
    width: 480,
    height: 260,
    rotation: 0,
    zIndex: 0,
    locked: false,
    opacity: 1,
    groupId: null,
    posterAssetId: null,
  };
  const preview = {
    embed: draft.display === 'interactive' ? mapEmbedUrl(pseudo, keys) : null,
    img: mapStaticUrl(pseudo, 480, 260, keys),
  };

  const directions = draft.mapMode === 'directions';
  const needsGoogleKey =
    (directions || draft.provider === 'google') && !keys.google ? 'Google Maps' : null;
  const needsMapboxKey = draft.provider === 'mapbox' && !keys.mapbox ? 'Mapbox' : null;
  const missingKey = needsGoogleKey ?? needsMapboxKey;

  const commit = () => {
    const clean: Draft = {
      ...draft,
      // Mapbox has no live embed; OSM has no satellite layer or directions.
      display: draft.provider === 'mapbox' ? 'static' : draft.display,
      style: draft.provider === 'osm' ? 'streets' : draft.style,
    };
    if (editItem?.type === 'map') {
      updateItems([editItem.id], 'Edit map', (d) => {
        if (d.type === 'map') Object.assign(d, clean, { posterAssetId: null });
      });
      void generateMapPoster(editItem.id);
    } else {
      const { doc } = useDocumentStore.getState();
      const width = 480;
      const height = 360;
      const at = findOpenSpot(doc, viewCenterCanvas(), width, height);
      const item: MapItem = {
        id: newId(),
        type: 'map',
        x: at.x - width / 2,
        y: at.y - height / 2,
        width,
        height,
        rotation: 0,
        zIndex: topZIndex(doc) + 1,
        locked: false,
        opacity: 1,
        groupId: null,
        posterAssetId: null,
        ...clean,
      };
      addItems([item], 'Add map');
      useSessionStore.getState().setSelection([item.id]);
      void generateMapPoster(item.id);
    }
    onClose();
  };

  return (
    <UiDialog
      title={editItem ? 'Edit Map' : 'Add Map'}
      onClose={onClose}
      className="cmty-sheet map-sheet"
      testId="map-dialog"
    >
      <div className="cmty-body">
        <div className="map-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!directions}
            className={`map-tab${directions ? '' : ' active'}`}
            data-testid="map-tab-view"
            onClick={() => {
              patch({ mapMode: 'view', ...(prevProvider ? { provider: prevProvider } : {}) });
              setPrevProvider(null);
            }}
          >
            Map
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={directions}
            className={`map-tab${directions ? ' active' : ''}`}
            data-testid="map-tab-directions"
            onClick={() => {
              if (draft.provider !== 'google') setPrevProvider(draft.provider);
              patch({ mapMode: 'directions', provider: 'google' });
            }}
          >
            Directions
          </button>
        </div>

        {!directions && (
          <>
            <div className="cmty-field">
              <span>Find a place</span>
              <div className="map-search-row">
                <input
                  value={search}
                  placeholder="Search cities, addresses, landmarks"
                  data-testid="map-search"
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void runSearch();
                    }
                  }}
                />
                <button
                  type="button"
                  className="community-preview-btn"
                  disabled={searching || !search.trim()}
                  data-testid="map-search-go"
                  onClick={() => void runSearch()}
                >
                  {searching ? '…' : 'Search'}
                </button>
              </div>
              {results && results.length > 0 && (
                <div className="map-results" data-testid="map-results">
                  {results.map((r, i) => (
                    <button
                      type="button"
                      key={`${r.lat},${r.lng},${i}`}
                      className="map-result"
                      onClick={() => pick(r)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="map-field-row">
              <div className="cmty-field">
                <span>Provider</span>
                <UiSelect
                  ariaLabel="Map provider"
                  testId="map-provider"
                  value={draft.provider}
                  onChange={(v) => patch({ provider: v as Draft['provider'] })}
                  options={[
                    { value: 'osm', label: 'OpenStreetMap' },
                    { value: 'google', label: 'Google Maps' },
                    { value: 'mapbox', label: 'Mapbox — static image' },
                  ]}
                />
              </div>
              <div className="cmty-field">
                <span>Style</span>
                <UiSelect
                  ariaLabel="Map style"
                  testId="map-style"
                  value={draft.provider === 'osm' ? 'streets' : draft.style}
                  onChange={(v) => patch({ style: v as Draft['style'] })}
                  options={[
                    { value: 'streets', label: 'Streets' },
                    ...(draft.provider === 'osm'
                      ? []
                      : [{ value: 'satellite', label: 'Satellite' }]),
                  ]}
                />
              </div>
            </div>
            <div className="map-field-row">
              <label className="cmty-field map-zoom-field">
                <span>Zoom — {Math.round(draft.zoom)}</span>
                <input
                  type="range"
                  min={2}
                  max={20}
                  step={1}
                  value={Math.round(draft.zoom)}
                  data-testid="map-zoom"
                  onChange={(e) => patch({ zoom: Number(e.target.value) })}
                />
              </label>
              <label className="cmty-check map-marker-check">
                <input
                  type="checkbox"
                  checked={draft.marker}
                  data-testid="map-marker"
                  onChange={(e) => patch({ marker: e.target.checked })}
                />
                <span>Drop a pin at the center</span>
              </label>
            </div>
            {draft.provider !== 'mapbox' && (
              <div className="cmty-field">
                <span>Show as</span>
                <UiSelect
                  ariaLabel="Display"
                  testId="map-display"
                  value={draft.display}
                  onChange={(v) => patch({ display: v as Draft['display'] })}
                  options={[
                    { value: 'interactive', label: 'Interactive map (pan & zoom in place)' },
                    { value: 'static', label: 'Static image' },
                  ]}
                />
              </div>
            )}
          </>
        )}

        {directions && (
          <>
            <label className="cmty-field">
              <span>From</span>
              <input
                value={draft.origin}
                placeholder="Origin — address or place"
                data-testid="map-origin"
                onChange={(e) => patch({ origin: e.target.value })}
              />
            </label>
            <label className="cmty-field">
              <span>To</span>
              <input
                value={draft.destination}
                placeholder="Destination — address or place"
                data-testid="map-destination"
                onChange={(e) => patch({ destination: e.target.value })}
              />
            </label>
            <div className="cmty-field">
              <span>Travel mode</span>
              <UiSelect
                ariaLabel="Travel mode"
                testId="map-travel-mode"
                value={draft.travelMode}
                onChange={(v) => patch({ travelMode: v as Draft['travelMode'] })}
                options={[
                  { value: 'driving', label: 'Driving' },
                  { value: 'walking', label: 'Walking' },
                  { value: 'bicycling', label: 'Cycling' },
                  { value: 'transit', label: 'Transit' },
                ]}
              />
            </div>
            <p className="cmty-hint">
              Directions are rendered by the Google Maps Embed API and need a Google key.
            </p>
          </>
        )}

        {missingKey && (
          <p className="cmty-hint map-key-hint" data-testid="map-key-hint">
            Add a {missingKey} API key under Settings → Plugins → Maps to use this provider. Keys
            stay on this device (and in encrypted settings sync).
          </p>
        )}
        {error && <p className="cmty-error">{error}</p>}

        <div className="map-preview" data-testid="map-preview">
          {preview.embed ? (
            <iframe src={preview.embed} title="Map preview" loading="lazy" />
          ) : preview.img ? (
            <img src={preview.img} alt="Map preview" />
          ) : (
            <div className="map-preview-empty">
              {missingKey ? 'Preview needs an API key' : 'Map preview'}
            </div>
          )}
        </div>

        <div className="cmty-actions">
          <button type="button" className="cmty-ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sync-primary"
            data-testid="map-commit"
            disabled={directions && (!draft.origin.trim() || !draft.destination.trim())}
            onClick={commit}
          >
            {editItem ? 'Save' : 'Add to board'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
