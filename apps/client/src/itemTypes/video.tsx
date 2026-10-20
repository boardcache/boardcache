import type { VideoItem } from '@boardcache/schema';
import { mediaMeta } from '../lib/mediaItems';
import { embedThumbnailUrl, embedIframeSrc } from '../lib/media/videoEmbed';
import { defineItemType } from './registry';
import { useEffect, useState } from 'react';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { applyAudio } from '../lib/media/videoActions';
import { getVideo } from '../lib/media/videoRegistry';
import { activateEmbed, embedSeekTo, embedPause, embedTime } from '../lib/media/embedPlayers';
import { bindPlaybackMemory } from '../lib/media/playbackMemory';
import { VideoMarkers } from '../components/canvas/VideoMarkers';
import { registerLightboxVideo } from '../lib/media/mediaSeek';
import { VideoControlBar } from '../components/canvas/VideoControlBar';
import { VideoContent } from '../components/items/VideoContent';
import { memo, blobToCanvas, drawCover, loadEmbedThumb } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { getAssetBlob } from '../lib/board/assetStore';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import type { MetaOverride } from './registry';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { safeHttpUrl } from '../lib/text/safeUrl';

/** Without a poster: the embed provider's thumbnail, else the type label. */
function VideoCard({ item }: { item: VideoItem }) {
  const src = item.embed ? embedThumbnailUrl(item.embed) : null;
  return src ? (
    <img src={src} alt="" draggable={false} />
  ) : (
    <span className="gallery-generic">{mediaMeta(item).typeLabel}</span>
  );
}

function VideoStage({ item }: { item: VideoItem }) {
  const fileUrl = useAssetUrl(item.assetId);
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    applyAudio(el, item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, item.muted, item.volume, item.playbackRate]);

  // Hand playback between the canvas and lightbox players: take over the canvas
  // video's time + play state and pause it (so only one plays), then hand the
  // state back to the canvas player when the lightbox closes.
  useEffect(() => {
    if (!el || item.embed) return;
    const canvas = getVideo(item.id);
    let startTime = 0;
    let wasPlaying = true;
    if (canvas) {
      startTime = canvas.currentTime;
      wasPlaying = !canvas.paused;
      canvas.pause();
    }
    const apply = () => {
      try {
        el.currentTime = startTime;
      } catch {
        /* not seekable yet */
      }
      if (wasPlaying) void el.play().catch(() => {});
      else el.pause();
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener('loadedmetadata', apply, { once: true });

    return () => {
      el.removeEventListener('loadedmetadata', apply);
      const back = getVideo(item.id);
      if (back) {
        try {
          back.currentTime = el.currentTime;
        } catch {
          /* ignore */
        }
        if (!el.paused) void back.play().catch(() => {});
        else back.pause();
      }
    };
  }, [el, item.id, item.embed]);

  // Keep the device playback memory fresh from the stage element too (the
  // canvas element is paused/stale during the lightbox). No restore here —
  // the canvas handoff already supplies the live position.
  useEffect(() => {
    if (!el || item.embed || !item.assetId) return;
    return bindPlaybackMemory(el, `${item.id}:${item.assetId}`, { restore: false });
  }, [el, item.id, item.assetId, item.embed]);

  // Keyboard on the file video: Space toggles play/pause, ←/→ scrub the
  // timeline (5 s, 15 s with Shift) — the lightbox yields the arrows here.
  useEffect(() => {
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const jump = arrowSeek(e);
      if (jump !== null) {
        e.preventDefault();
        e.stopPropagation();
        const end = Number.isFinite(el.duration) ? el.duration : Infinity;
        el.currentTime = Math.max(0, Math.min(end, el.currentTime + jump));
        return;
      }
      if (e.code !== 'Space' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      if (el.paused) void el.play().catch(() => {});
      else el.pause();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [el]);

  if (item.embed) {
    return <EmbedVideoStage item={item} />;
  }
  // File video: custom controls (same bar as the canvas) instead of native ones.
  return (
    <div className="lightbox-video" onClick={(e) => e.stopPropagation()}>
      {fileUrl ? (
        <video
          ref={(node) => {
            setEl(node);
            registerLightboxVideo(item.id, node);
          }}
          className="lightbox-media"
          src={fileUrl}
          autoPlay
          playsInline
          loop={item.loop}
        />
      ) : (
        <div className="lightbox-loading">Loading</div>
      )}
      <VideoControlBar item={item} el={el} />
      <VideoMarkers
        item={item}
        removable
        onSeek={(t) => {
          if (el) el.currentTime = t;
        }}
      />
    </div>
  );
}

/** Seconds to jump for an arrow key (null for any other key). */
function arrowSeek(e: KeyboardEvent): number | null {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return null;
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  const step = e.shiftKey ? 15 : 5;
  return e.key === 'ArrowRight' ? step : -step;
}

/**
 * Lightbox stage for a provider embed: an empty target box that the item's
 * PERSISTENT floating player (EmbedPlayerLayer) docks onto — same iframe as on
 * the canvas, so playback continues exactly where it was.
 */
function EmbedVideoStage({ item }: { item: VideoItem }) {
  useEffect(() => {
    if (item.embed) activateEmbed(item.id, item.embed);
  }, [item.id, item.embed]);
  // ←/→ scrub the embed through its provider API (the lightbox yields them).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const jump = arrowSeek(e);
      if (jump === null) return;
      e.preventDefault();
      e.stopPropagation();
      embedSeekTo(item.id, Math.max(0, embedTime(item.id) + jump));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [item.id]);
  return (
    <div className="lightbox-video-embed" onClick={(e) => e.stopPropagation()}>
      <div className="lightbox-media lightbox-embed" data-embed-stage={item.id} />
      <VideoMarkers item={item} removable onSeek={(t) => embedSeekTo(item.id, t)} />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
async function paint(item: VideoItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  let drawn = false;
  // 1) The actual current frame, if the video is live on the canvas.
  const live = getVideo(item.id);
  if (live && live.readyState >= 2 && live.videoWidth > 0) {
    try {
      // Cover-fit, like the canvas <video> (object-fit: cover) — a resized
      // box crops the frame, it never stretches it.
      drawCover(ctx, live, live.videoWidth, live.videoHeight, x, y, item.width, item.height);
      drawn = true;
    } catch {
      /* tainted/unavailable — fall through */
    }
  }
  // 2) The generated poster frame.
  if (!drawn && item.posterAssetId) {
    const poster = await memo(p.cache, `blob:${item.posterAssetId}`, async () => {
      const blob = await getAssetBlob(item.posterAssetId!);
      return blob ? blobToCanvas(blob) : null;
    });
    if (poster) {
      drawCover(ctx, poster, poster.width, poster.height, x, y, item.width, item.height);
      drawn = true;
    }
  }
  // 3) Provider embeds (YouTube/Vimeo): the highest-res preview thumbnail.
  if (!drawn && item.embed) {
    const img = await memo(p.cache, `embed:${item.embed.provider}:${item.embed.videoId}`, () =>
      loadEmbedThumb(item.embed!),
    );
    if (img) {
      // Cover-fit the thumbnail (16:9 thumb into the item box).
      drawCover(ctx, img, img.width, img.height, x, y, item.width, item.height);
      drawn = true;
    }
  }
  if (!drawn) {
    ctx.fillStyle = '#0c0c0e';
    ctx.fillRect(x, y, item.width, item.height);
  }
  // play badge (suppressed for the PDF, where it just covers the frame)
  if (p.playBadge) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(
      x + item.width / 2,
      y + item.height / 2,
      Math.min(item.width, item.height) * 0.12,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/** What the board search index sees. */
function searchText(item: VideoItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title, body: join(item.transcript, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: VideoItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  if (item.embed) {
    out.detail = `${item.embed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} embed`;
    if (!item.name) out.title = out.detail;
  } else {
    out.detail = `${item.naturalWidth} × ${item.naturalHeight}`;
  }
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
async function popout(item: VideoItem, p: PopoutContext): Promise<string> {
  const { mintUrl } = p;
  if (item.embed) {
    // Continue where the in-app player left off: read its last position,
    // pause it, and start the pop-out there.
    const t = Math.max(0, Math.floor(embedTime(item.id)));
    embedPause(item.id);
    const base = embedIframeSrc(item.embed, { autoplay: true });
    const src = item.embed.provider === 'youtube' ? `${base}&start=${t}` : `${base}#t=${t}s`;
    return `<iframe src="${escapeHtml(safeHttpUrl(src) ?? 'about:blank')}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>`;
  }
  const blob = item.assetId ? await getAssetBlob(item.assetId) : null;
  if (!blob) return `<div class="msg">Video unavailable</div>`;
  // Whichever element is live (the lightbox stage wins over the canvas):
  // carry its position into the pop-out (media fragment) and pause it.
  const live =
    document.querySelector<HTMLVideoElement>('.lightbox-body video') ?? getVideo(item.id);
  const t = live?.currentTime ?? 0;
  live?.pause();
  const frag = t > 0.05 ? `#t=${t.toFixed(2)}` : '';
  return `<video src="${mintUrl(blob)}${frag}" controls autoplay ${item.loop ? 'loop' : ''}></video>`;
}

export const videoType = defineItemType('video', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: 'video',
  meta,
  label: 'Video',
  searchText,
  thumbnail: paint,
  render: VideoContent,
  card: VideoCard,
  stage: VideoStage,
  cardAspect: null,
  cardAsset: (item) => item.posterAssetId,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: true,
  cardComponent: null,
});
