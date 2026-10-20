import { AudioCard } from './audioCard';
import { defineItemType } from './registry';
import type { AudioItem } from '@boardcache/schema';
import { useEffect } from 'react';
import { activateAudioEmbed } from '../lib/media/embedPlayers';
import { VideoMarkers } from '../components/canvas/VideoMarkers';
import { seekMedia } from '../lib/media/mediaSeek';
import { showNotice } from '../lib/notices';
import { AudioPlayer, AudioContent } from '../components/items/AudioContent';
import { memo, blobToCanvas } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { getAssetBlob } from '../lib/board/assetStore';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import type { MetaOverride } from './registry';

function AudioStage({ item }: { item: AudioItem }) {
  if (item.embed) {
    return <AudioEmbedStage key={item.id} item={item} />;
  }
  return (
    <div className="lightbox-audio" onClick={(e) => e.stopPropagation()}>
      <AudioPlayer key={item.id} item={item} variant="stage" />
      <VideoMarkers item={item} removable onSeek={(t) => seekMedia(item.id, t)} />
      {item.markers.length > 0 && (
        <button
          type="button"
          className="community-preview-btn audio-copy-chapters"
          data-testid="audio-copy-chapters"
          onClick={() => {
            const lines = item.markers
              .map((m) => {
                const mm = Math.floor(m.time / 60);
                const ss = String(Math.floor(m.time % 60)).padStart(2, '0');
                return `${mm}:${ss} ${m.label}`;
              })
              .join('\n');
            void navigator.clipboard.writeText(lines).then(() => {
              showNotice('Chapters copied — paste into your podcast host.', {
                id: 'chapters-copied',
              });
            });
          }}
        >
          Copy chapters
        </button>
      )}
    </div>
  );
}

/** Lightbox stage for a Spotify/SoundCloud embed: an empty target the item's
 *  persistent floating player docks onto — same iframe as on the canvas. */
function AudioEmbedStage({ item }: { item: AudioItem }) {
  useEffect(() => {
    if (item.embed) activateAudioEmbed(item.id, item.embed);
  }, [item.id, item.embed]);
  return (
    <div className="lightbox-audio-embed" onClick={(e) => e.stopPropagation()}>
      <div
        className={`lightbox-audio-embed-stage lightbox-audio-embed-${item.embed?.provider ?? ''}`}
        data-embed-stage={item.id}
      />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
async function paint(item: AudioItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  // Embedded cover art, if present, fills the box.
  if (item.coverAssetId) {
    const bm = await memo(p.cache, `blob:${item.coverAssetId}`, async () => {
      const blob = await getAssetBlob(item.coverAssetId!);
      return blob ? blobToCanvas(blob) : null;
    });
    if (bm) {
      const fit = Math.max(item.width / bm.width, item.height / bm.height);
      const dw = bm.width * fit;
      const dh = bm.height * fit;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, item.width, item.height);
      ctx.clip();
      ctx.drawImage(bm, x + (item.width - dw) / 2, y + (item.height - dh) / 2, dw, dh);
      ctx.restore();
      return;
    }
  }
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const cx = x + item.width / 2;
  const r = Math.min(item.width, item.height) * 0.18;
  const cy = y + item.height * 0.4;
  // Simple music-note glyph.
  ctx.strokeStyle = p.dark ? '#aeb6c2' : '#5b6470';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(1.5, r * 0.16);
  ctx.beginPath();
  ctx.arc(cx - r * 0.7, cy + r * 0.5, r * 0.35, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.6, cy + r * 0.2, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.35, cy + r * 0.5);
  ctx.lineTo(cx - r * 0.35, cy - r);
  ctx.lineTo(cx + r * 0.95, cy - r * 1.3);
  ctx.lineTo(cx + r * 0.95, cy + r * 0.2);
  ctx.stroke();
  const title = item.title ?? item.name ?? 'Audio';
  ctx.fillStyle = p.card.text;
  ctx.font = `600 ${Math.max(11, Math.min(item.width, item.height) * 0.12)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(title, cx, y + item.height * 0.62, item.width - 16);
  if (item.artist) {
    ctx.fillStyle = p.card.sub;
    ctx.font = `${Math.max(9, Math.min(item.width, item.height) * 0.09)}px sans-serif`;
    ctx.fillText(
      item.artist,
      cx,
      y + item.height * 0.62 + Math.min(item.width, item.height) * 0.14,
      item.width - 16,
    );
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: AudioItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title: title || (item.title ?? ''), body: join(item.transcript, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: AudioItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.title ?? item.name ?? 'Audio';
  out.detail = [item.artist, item.album].filter(Boolean).join(' · ') || null;
  if (item.embed && !out.detail) {
    out.detail = item.embed.provider === 'spotify' ? 'Spotify embed' : 'SoundCloud embed';
  }
  return out;
}

export const audioType = defineItemType('audio', {
  popout: null,
  edit: { kind: 'plugin' },
  pdfCategory: 'audio',
  meta,
  label: 'Audio',
  searchText,
  thumbnail: paint,
  render: AudioContent,
  card: AudioCard,
  stage: AudioStage,
  cardAspect: () => 1, // square album art
  cardAsset: (item) => item.coverAssetId,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: true,
  cardComponent: null,
});
