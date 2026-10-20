import { useEffect } from 'react';
import type { MapItem } from '@boardcache/schema';
import { MapPinIcon } from '../components/icons';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { defineItemType } from './registry';
import { MapContent } from '../components/items/MapContent';
import type { StageProps, MetaOverride } from './registry';
import { memo, blobToCanvas, scheduleMapPosterHeal } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { getAssetBlob } from '../lib/board/assetStore';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { mapLabel, mapEmbedUrl } from '../lib/integrations/mapEmbed';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { safeHttpUrl } from '../lib/text/safeUrl';

/** Map card: the rasterized poster (generated on demand) or a pin fallback. */
function MapCard({ item }: { item: MapItem }) {
  const url = useAssetUrl(item.posterAssetId);
  useEffect(() => {
    if (item.posterAssetId) return;
    // Heal older maps that never got a snapshot — history-safe commit.
    void import('../plugins/maps/mapSnapshot').then((m) => m.generateMapPoster(item.id));
  }, [item.id, item.posterAssetId, item.mapMode]);
  if (!url) {
    return (
      <span className="gallery-audio gallery-webpage">
        <MapPinIcon />
      </span>
    );
  }
  return (
    <img
      className="gallery-map-poster"
      src={url}
      alt=""
      loading="lazy"
      data-testid="gallery-map-poster"
    />
  );
}

function Stage({ item }: StageProps<MapItem>) {
  return (
    <div className="lightbox-iframe" onClick={(e) => e.stopPropagation()}>
      <MapContent item={item} lightbox />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
async function paint(item: MapItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  // The rasterized snapshot, cover-fit; placeholder is a pin + label.
  let posterCanvas: HTMLCanvasElement | null = null;
  if (item.posterAssetId) {
    posterCanvas = await memo(p.cache, `blob:${item.posterAssetId}`, async () => {
      const blob = await getAssetBlob(item.posterAssetId!);
      return blob ? blobToCanvas(blob) : null;
    });
  }
  if (!posterCanvas) {
    // Heal: no poster (backfill hadn't run, generation failed once, or the
    // asset never synced here) — regenerate off-thread. When it lands, the
    // doc changes and every cached render (LOD sprite, board thumb,
    // gallery) rebuilds with the real map. No-op for items of other docs.
    scheduleMapPosterHeal(item.id);
  }
  if (posterCanvas) {
    const bm = posterCanvas;
    {
      const fit = Math.max(item.width / bm.width, item.height / bm.height);
      const dw = bm.width * fit;
      const dh = bm.height * fit;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, item.width, item.height);
      ctx.clip();
      ctx.fillStyle = '#e8ecef';
      ctx.fillRect(x, y, item.width, item.height);
      ctx.drawImage(bm, x + (item.width - dw) / 2, y + (item.height - dh) / 2, dw, dh);
      ctx.restore();
      return;
    }
  }
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const cx = x + item.width / 2;
  const cy = y + item.height * 0.4;
  const r = Math.min(item.width, item.height) * 0.14;
  // Pin: a circle head on a tapering tail.
  ctx.strokeStyle = p.card.glyph;
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.4, r * 0.8, Math.PI * 0.9, Math.PI * 2.1);
  ctx.lineTo(cx, cy + r * 1.1);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.4, r * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = p.card.text;
  ctx.font = `600 ${Math.max(11, Math.min(item.width, item.height) * 0.1)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const label =
    (item.name?.trim() ?? '') ||
    (item.mapMode === 'directions' ? `${item.origin} → ${item.destination}` : item.query || 'Map');
  ctx.fillText(label, cx, y + item.height * 0.64, item.width - 16);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: MapItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.query,
    body: join(item.provider, item.origin, item.destination, baseText(item)),
  };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: MapItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = mapLabel(item);
  out.detail =
    item.mapMode === 'directions'
      ? `${item.travelMode} directions`
      : `${item.provider === 'osm' ? 'OpenStreetMap' : item.provider === 'google' ? 'Google Maps' : 'Mapbox'} · zoom ${Math.round(item.zoom)}`;
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
async function popout(item: MapItem, p: PopoutContext): Promise<string> {
  const { mintUrl } = p;
  // Live embed when this browser can build one; else the poster snapshot.
  const embed = mapEmbedUrl(item);
  if (embed) {
    return `<iframe src="${escapeHtml(safeHttpUrl(embed) ?? 'about:blank')}" allowfullscreen style="width:100%;height:100%;border:0;background:#e8ecef"></iframe>`;
  }
  const poster = item.posterAssetId ? await getAssetBlob(item.posterAssetId) : null;
  if (!poster) return `<div class="msg">Map unavailable</div>`;
  return `<img src="${mintUrl(poster)}" alt="${escapeHtml(mapLabel(item))}">`;
}

export const mapType = defineItemType('map', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: 'webpage',
  meta,
  label: 'Map',
  searchText,
  thumbnail: paint,
  render: MapContent,
  card: MapCard,
  stage: Stage,
  cardAspect: null,
  cardAsset: (item) => item.posterAssetId,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
