import type { MapItem } from '@boardcache/schema';
import { putAsset } from '../../lib/board/assetStore';
import { lngLatToTile, mapPosterKey, mapStaticUrl } from '../../lib/integrations/mapEmbed';
import { setMapPoster } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Best-effort rasterized snapshot of a map item, stored as an asset and set
 * as the item's poster. The poster is what thumbnails, the gallery, PDF
 * export, static display, and keyless contexts (shared viewer) show — the
 * live iframe can't be captured, so the snapshot is rendered from the same
 * parameters instead: provider static-image APIs where a key exists, stitched
 * OSM tiles otherwise. Directions have no client-renderable static form (the
 * route polyline needs a server-side API) — they keep a placeholder.
 */

const SNAP_W = 640;
const TILE = 256;
const inFlight = new Set<string>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 12_000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const r = 10;
  ctx.beginPath();
  ctx.arc(x, y - r * 1.2, r * 0.85, Math.PI * 0.85, Math.PI * 2.15);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = '#e63946';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y - r * 1.2, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

/** Stitch OSM tiles for a centered viewport; returns tiles drawn (0 = all
 *  failed). cpx/cpy are the center in world pixels at `zoom`. */
async function stitchOsmTiles(
  ctx: CanvasRenderingContext2D,
  cpx: number,
  cpy: number,
  zoom: number,
  w: number,
  h: number,
): Promise<number> {
  const n = 2 ** zoom;
  const x0 = Math.floor((cpx - w / 2) / TILE);
  const x1 = Math.floor((cpx + w / 2) / TILE);
  const y0 = Math.floor((cpy - h / 2) / TILE);
  const y1 = Math.floor((cpy + h / 2) / TILE);
  ctx.fillStyle = '#e8ecef';
  ctx.fillRect(0, 0, w, h);
  let drawn = 0;
  const jobs: Promise<void>[] = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue; // off the mercator map
      const wrapped = ((tx % n) + n) % n;
      jobs.push(
        loadImage(`https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`).then((img) => {
          if (!img) return;
          drawn += 1;
          ctx.drawImage(img, tx * TILE - (cpx - w / 2), ty * TILE - (cpy - h / 2));
        }),
      );
    }
  }
  await Promise.all(jobs);
  return drawn;
}

/** OSM tile policy requires visible attribution on derived images. */
function drawAttribution(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.font = '10px sans-serif';
  const credit = '© OpenStreetMap contributors';
  const tw = ctx.measureText(credit).width;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(w - tw - 10, h - 16, tw + 10, 16);
  ctx.fillStyle = '#333';
  ctx.fillText(credit, w - tw - 5, h - 5);
}

/** Stitch OSM raster tiles around the center — keyless, works for any view. */
async function renderOsmSnapshot(item: MapItem, w: number, h: number): Promise<Blob | null> {
  const zoom = Math.max(0, Math.min(19, Math.round(item.zoom)));
  const c = lngLatToTile(item.lng, item.lat, zoom);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Every tile failed (offline, blocked) → a blank gray "poster" would be
  // WORSE than the pin placeholder. Skip; the board-open backfill retries.
  if ((await stitchOsmTiles(ctx, c.x * TILE, c.y * TILE, zoom, w, h)) === 0) return null;
  if (item.marker) drawPin(ctx, w / 2, h / 2);
  drawAttribution(ctx, w, h);
  try {
    return await toBlob(canvas); // taints if the tile server ever drops CORS
  } catch {
    return null;
  }
}

async function renderStaticApiSnapshot(item: MapItem, w: number, h: number): Promise<Blob | null> {
  const url = mapStaticUrl(item, w, h);
  if (!url) return null;
  const img = await loadImage(url);
  if (!img) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  try {
    return await toBlob(canvas);
  } catch {
    return null; // CORS-tainted — skip the poster rather than fail the save
  }
}

/** First Nominatim hit for a free-text place (the dialog's search API). */
export async function geocodeOne(query: string): Promise<{ lat: number; lng: number } | null> {
  if (!query.trim()) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
      { headers: { accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { lat: string; lon: string }[];
    const hit = rows[0];
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch {
    return null;
  }
}

/** Route geometry from the public OSRM server (keyless; driving profile
 *  approximates every travel mode well enough for a thumbnail). */
async function osrmRoute(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): Promise<[number, number][] | null> {
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`,
      { headers: { accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: { geometry?: { coordinates?: [number, number][] } }[];
    };
    const coords = json.routes?.[0]?.geometry?.coordinates;
    return Array.isArray(coords) && coords.length >= 2 ? coords : null;
  } catch {
    return null;
  }
}

/**
 * Directions poster: geocode both endpoints, route via OSRM (straight dashed
 * line as the fallback), fit the whole route in frame over stitched OSM
 * tiles, and draw the path with endpoint pins. Keyless — used for every
 * provider (the poster is a preview, not the live embed).
 */
async function renderDirectionsSnapshot(item: MapItem, w: number, h: number): Promise<Blob | null> {
  const [a, b] = await Promise.all([geocodeOne(item.origin), geocodeOne(item.destination)]);
  if (!a || !b) return null;
  const routed = await osrmRoute(a, b);
  const path: [number, number][] = routed ?? [
    [a.lng, a.lat],
    [b.lng, b.lat],
  ];

  // Max zoom (≤17) where the whole path fits with padding.
  const PAD = 60;
  let zoom = 17;
  for (; zoom > 2; zoom--) {
    const px = path.map(([lng, lat]) => lngLatToTile(lng, lat, zoom));
    const xs = px.map((p) => p.x * TILE);
    const ys = px.map((p) => p.y * TILE);
    if (
      Math.max(...xs) - Math.min(...xs) <= w - PAD * 2 &&
      Math.max(...ys) - Math.min(...ys) <= h - PAD * 2
    ) {
      break;
    }
  }
  const px = path.map(([lng, lat]) => lngLatToTile(lng, lat, zoom));
  const xs = px.map((p) => p.x * TILE);
  const ys = px.map((p) => p.y * TILE);
  const cpx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cpy = (Math.max(...ys) + Math.min(...ys)) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if ((await stitchOsmTiles(ctx, cpx, cpy, zoom, w, h)) === 0) return null;

  // The route: white casing under an accent stroke; dashed = unrouted.
  const toCanvas = (p: { x: number; y: number }) => ({
    x: p.x * TILE - (cpx - w / 2),
    y: p.y * TILE - (cpy - h / 2),
  });
  const pts = px.map(toCanvas);
  const trace = () => {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (!routed) ctx.setLineDash([8, 6]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  trace();
  ctx.stroke();
  ctx.strokeStyle = '#4263eb';
  ctx.lineWidth = 3.5;
  trace();
  ctx.stroke();
  ctx.setLineDash([]);

  // Origin dot + destination pin.
  const start = pts[0]!;
  const end = pts[pts.length - 1]!;
  ctx.beginPath();
  ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#4263eb';
  ctx.stroke();
  drawPin(ctx, end.x, end.y);

  drawAttribution(ctx, w, h);
  try {
    return await toBlob(canvas);
  } catch {
    return null;
  }
}

/** Render + store the poster for a map item (no-op if it's mid-flight or gone). */
export async function generateMapPoster(itemId: string): Promise<void> {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || item.type !== 'map' || inFlight.has(itemId)) return;
  inFlight.add(itemId);
  const key = mapPosterKey(item);
  try {
    const w = SNAP_W;
    const h = Math.max(160, Math.min(1280, Math.round((SNAP_W * item.height) / item.width)));
    const blob =
      item.mapMode === 'directions'
        ? await renderDirectionsSnapshot(item, w, h)
        : item.provider === 'osm'
          ? await renderOsmSnapshot(item, w, h)
          : ((await renderStaticApiSnapshot(item, w, h)) ?? (await renderOsmSnapshot(item, w, h)));
    if (!blob) return;
    const assetId = await putAsset(blob);
    setMapPoster(itemId, assetId, key);
  } catch {
    /* best-effort — the placeholder stays */
  } finally {
    inFlight.delete(itemId);
  }
}
