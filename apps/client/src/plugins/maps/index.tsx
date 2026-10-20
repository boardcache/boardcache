import { z } from 'zod';
import type { MapItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { findOpenSpot } from '../../lib/canvas/placeSpot';
import { addItems, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useEffect } from 'react';
import { create } from 'zustand';
import { MapPinIcon } from '../../components/icons';
import { mapExternalUrl } from '../../lib/integrations/mapEmbed';
import { registerPlugin } from '../registry';
import { getPluginSettings, usePluginSettings } from '../settingsStore';
import { MapDialog } from './MapDialog';
import { generateMapPoster, geocodeOne } from './mapSnapshot';
import {
  SecretInput,
  SettingsField,
  SettingsGroup,
  SettingsLink,
} from '../../components/ui/SettingsForm';

/**
 * Maps: embed interactive or static maps (OpenStreetMap keyless; Google Maps
 * and Mapbox with your own keys) and Google directions on the canvas. The
 * `map` item type itself is core/schema — this plugin is the UX around it.
 */

interface MapsUi {
  open: boolean;
  editId: string | null;
  openNew: () => void;
  openEdit: (id: string) => void;
  close: () => void;
}

const useMapsUi = create<MapsUi>((set) => ({
  open: false,
  editId: null,
  openNew: () => set({ open: true, editId: null }),
  openEdit: (id) => set({ open: true, editId: id }),
  close: () => set({ open: false, editId: null }),
}));

function MapsHost() {
  const { open, editId, close } = useMapsUi();
  // Backfill: maps that never got a snapshot (pre-poster boards, failed
  // renders) generate one when their board opens — staggered, history-safe
  // (setMapPoster bypasses undo), keyed no-ops when params changed mid-run.
  const boardId = useDocumentStore((s) => s.doc.id);
  useEffect(() => {
    const doc = useDocumentStore.getState().doc;
    const missing = Object.values(doc.items).filter((i) => i.type === 'map' && !i.posterAssetId);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const item of missing) {
        if (cancelled) return;
        await generateMapPoster(item.id);
        await new Promise((r) => setTimeout(r, 400)); // be polite to tile servers
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);
  if (!open) return null;
  // Remount per target so the draft state reinitializes.
  return <MapDialog key={editId ?? 'new'} editId={editId} onClose={close} />;
}

interface MapsSettings {
  keys?: { google?: string; mapbox?: string };
}

function MapsSettingsPanel() {
  usePluginSettings((s) => s.settings['maps']); // reflect synced updates
  const current = getPluginSettings<MapsSettings>('maps') ?? {};
  const keys = current.keys ?? {};
  const save = (k: 'google' | 'mapbox', v: string) =>
    usePluginSettings.getState().set('maps', {
      ...current,
      keys: { ...keys, [k]: v.trim() || undefined },
    });
  return (
    <div className="plugin-settings-fields">
      <p className="settings-hint">
        OpenStreetMap needs no key. A Google Maps key (Embed + Static Maps APIs, referrer-restrict
        it to your domains) unlocks Google views, satellite imagery, and directions; a Mapbox token
        unlocks Mapbox static styles. Keys are stored on this device and included in encrypted
        settings sync when you're signed in.
      </p>
      <SettingsGroup title="API keys">
        <SettingsField
          label="Google Maps"
          hint={
            <>
              Maps Embed API and Static Maps API.{' '}
              <SettingsLink href="https://console.cloud.google.com/apis/credentials">
                Get a key
              </SettingsLink>
            </>
          }
        >
          <SecretInput
            value={keys.google ?? ''}
            ariaLabel="Google Maps key"
            testId="maps-key-google"
            onChange={(v) => save('google', v)}
          />
        </SettingsField>
        <SettingsField
          label="Mapbox"
          hint={
            <>
              Public access token.{' '}
              <SettingsLink href="https://account.mapbox.com/access-tokens/">
                Get a token
              </SettingsLink>
            </>
          }
        >
          <SecretInput
            value={keys.mapbox ?? ''}
            placeholder="Public token"
            ariaLabel="Mapbox token"
            testId="maps-key-mapbox"
            onChange={(v) => save('mapbox', v)}
          />
        </SettingsField>
      </SettingsGroup>
    </div>
  );
}

registerPlugin({
  manifest: {
    id: 'maps',
    order: 32,
    name: 'Maps',
    description:
      'Embed maps and directions on the canvas — OpenStreetMap (no key), Google Maps, and Mapbox, with place search and interactive or static display.',
  },
  addMenu: [
    {
      label: 'Add Map',
      category: 'misc',
      icon: <MapPinIcon />,
      onSelect: () => useMapsUi.getState().openNew(),
    },
  ],
  Component: MapsHost,
  SettingsPanel: MapsSettingsPanel,
  tools: [
    {
      name: 'add_map',
      description:
        'Add a map card: a place view (lat/lng, or a `query` geocoded through OpenStreetMap) or A→B directions (Google provider). OpenStreetMap needs no key; Google and Mapbox use the keys in the Maps plugin settings. A static snapshot is rendered for thumbnails and exports.',
      parameters: z.object({
        query: z.string().max(200).optional().describe('Place name to geocode and label'),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        zoom: z.number().min(0).max(21).optional().describe('Default 13 (12 when geocoded)'),
        provider: z.enum(['osm', 'google', 'mapbox']).default('osm'),
        style: z.enum(['streets', 'satellite']).default('streets'),
        marker: z.boolean().default(true),
        mapMode: z.enum(['view', 'directions']).default('view'),
        origin: z.string().max(200).optional().describe('directions only'),
        destination: z.string().max(200).optional().describe('directions only'),
        travelMode: z.enum(['driving', 'walking', 'bicycling', 'transit']).default('driving'),
        display: z.enum(['interactive', 'static']).default('interactive'),
        width: z.number().min(200).max(2000).default(480),
        height: z.number().min(150).max(2000).default(360),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      access: 'external',
      execute: async (args, ctx) => {
        let lat = args.lat;
        let lng = args.lng;
        let zoom = args.zoom ?? 13;
        if (args.mapMode === 'directions') {
          if (!args.origin || !args.destination) {
            throw new Error('Directions need `origin` and `destination`.');
          }
          lat ??= 0;
          lng ??= 0;
        } else if (lat === undefined || lng === undefined) {
          if (!args.query) throw new Error('Give lat/lng or a `query` to geocode.');
          const hit = await geocodeOne(args.query);
          if (!hit) throw new Error(`Could not find "${args.query}".`);
          lat = hit.lat;
          lng = hit.lng;
          zoom = args.zoom ?? 12;
        }
        const c = ctx.viewCenter();
        const { doc } = useDocumentStore.getState();
        const at = findOpenSpot(
          doc,
          { x: args.x ?? c.x, y: args.y ?? c.y },
          args.width,
          args.height,
        );
        const item: MapItem = {
          id: newId(),
          type: 'map',
          x: at.x - args.width / 2,
          y: at.y - args.height / 2,
          width: args.width,
          height: args.height,
          rotation: 0,
          zIndex: topZIndex(doc) + 1,
          locked: false,
          opacity: 1,
          groupId: null,
          posterAssetId: null,
          provider: args.provider,
          mapMode: args.mapMode,
          style: args.style,
          lat,
          lng,
          zoom,
          query: args.query ?? '',
          marker: args.marker,
          origin: args.origin ?? '',
          destination: args.destination ?? '',
          travelMode: args.travelMode,
          display: args.display,
        };
        addItems([item], 'Add map');
        void generateMapPoster(item.id);
        return { id: item.id, lat, lng, zoom };
      },
    },
  ],
  itemMenu: (item) =>
    item.type === 'map'
      ? [
          {
            kind: 'action' as const,
            label: 'Edit Map',
            onSelect: () => useMapsUi.getState().openEdit(item.id),
          },
          {
            kind: 'action' as const,
            label: 'Refresh Snapshot',
            onSelect: () => void generateMapPoster(item.id),
          },
          {
            kind: 'action' as const,
            label: 'Open in Maps Site',
            onSelect: () => window.open(mapExternalUrl(item), '_blank', 'noopener,noreferrer'),
          },
        ]
      : [],
});
