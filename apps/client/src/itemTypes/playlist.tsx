import { AudioCard } from './audioCard';
import { defineItemType } from './registry';
import { PlaylistPlayer, PlaylistContent } from '../components/items/PlaylistContent';
import type { StageProps, MetaOverride } from './registry';
import type { PlaylistItem } from '@boardcache/schema';
import { memo, blobToCanvas } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { getAssetBlob } from '../lib/board/assetStore';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';

function Stage({ item }: StageProps<PlaylistItem>) {
  return (
    <div className="lightbox-audio" onClick={(e) => e.stopPropagation()}>
      <PlaylistPlayer item={item} variant="stage" />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
async function paint(item: PlaylistItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const cover = item.tracks[item.current]?.coverAssetId ?? item.tracks[0]?.coverAssetId;
  if (cover) {
    const bm = await memo(p.cache, `blob:${cover}`, async () => {
      const blob = await getAssetBlob(cover);
      return blob ? blobToCanvas(blob) : null;
    });
    if (bm) {
      const fit = Math.max(item.width / bm.width, item.height / bm.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, item.width, item.height);
      ctx.clip();
      ctx.globalAlpha = 0.45;
      ctx.drawImage(bm, x + (item.width - bm.width * fit) / 2, y, bm.width * fit, bm.height * fit);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }
  const cx = x + item.width / 2;
  ctx.fillStyle = p.card.text;
  ctx.font = `600 ${Math.max(12, Math.min(item.width, item.height) * 0.11)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.name ?? 'Playlist', cx, y + item.height * 0.42, item.width - 16);
  ctx.fillStyle = p.card.sub;
  ctx.font = `${Math.max(10, Math.min(item.width, item.height) * 0.08)}px sans-serif`;
  ctx.fillText(
    `${item.tracks.length} track${item.tracks.length === 1 ? '' : 's'}`,
    cx,
    y + item.height * 0.58,
    item.width - 16,
  );
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: PlaylistItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title,
    body: join(...item.tracks.map((t) => join(t.title, t.artist)), baseText(item)),
  };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: PlaylistItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.name ?? 'Playlist';
  out.detail = `${item.tracks.length} track${item.tracks.length === 1 ? '' : 's'}`;
  return out;
}

export const playlistType = defineItemType('playlist', {
  popout: null,
  edit: { kind: 'plugin' },
  pdfCategory: 'audio',
  meta,
  label: 'Playlist',
  searchText,
  thumbnail: paint,
  render: PlaylistContent,
  card: AudioCard,
  stage: Stage,
  cardAspect: () => 1, // square album art
  cardAsset: (item) => item.tracks[0]?.coverAssetId ?? null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
