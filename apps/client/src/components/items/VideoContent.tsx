import { useEffect, useRef, useSyncExternalStore } from 'react';
import { PlayIcon } from '../icons';
import type { VideoItem } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { AssetLoadingBox, useTeamAssetFetching } from '../canvas/AssetLoading';
import { embedThumbnailUrl } from '../../lib/media/videoEmbed';
import {
  activateEmbed,
  embedPlayersSnapshot,
  subscribeEmbedPlayers,
} from '../../lib/media/embedPlayers';
import { bindPlaybackMemory } from '../../lib/media/playbackMemory';
import { applyAudio } from '../../lib/media/videoActions';
import { registerVideo } from '../../lib/media/videoRegistry';

/**
 * Provider embed facade: a poster with a play button. Play activates the
 * persistent floating player (EmbedPlayerLayer) positioned over this item —
 * playback then survives lightbox opens, selections, and re-renders.
 */
function EmbedFacade({ item }: { item: VideoItem }) {
  const posterUrl = useAssetUrl(item.posterAssetId);
  const poster = posterUrl ?? (item.embed ? embedThumbnailUrl(item.embed) : null);
  const players = useSyncExternalStore(subscribeEmbedPlayers, embedPlayersSnapshot);
  const active = players.some((p) => p.itemId === item.id);
  return (
    <div className="video-item">
      {poster ? (
        <img src={poster} alt={item.name ?? ''} draggable={false} className="video-poster" />
      ) : (
        <div className="video-poster video-poster-empty" />
      )}
      {!active && (
        <div className="video-overlay">
          {/* Only the badge itself is clickable — everywhere else on the
              poster still selects/drags the item like any other. */}
          <button
            type="button"
            className="video-play-badge video-play-badge-btn"
            data-testid="embed-play"
            data-view-ok=""
            title="Play here on the canvas"
            onClick={(e) => {
              e.stopPropagation();
              if (item.embed) activateEmbed(item.id, item.embed);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <PlayIcon size={16} />
          </button>
        </div>
      )}
      {item.embed && <span className="video-provider-tag">{item.embed.provider}</span>}
    </div>
  );
}

/**
 * File-backed video plays inline on the canvas. It autoplays muted by default
 * (muted is required for autoplay), so a board reads like a video wall — but
 * a clip the user paused stays paused the next time the board opens (device
 * playback memory). Clicking the video only selects/drags it — play/pause
 * lives in the screen-space CanvasVideoControls; double-click opens the
 * lightbox.
 */
function FileVideo({ item }: { item: VideoItem }) {
  const url = useAssetUrl(item.assetId);
  const posterUrl = useAssetUrl(item.posterAssetId);
  const fetching = useTeamAssetFetching([item.assetId]);
  const elRef = useRef<HTMLVideoElement | null>(null);

  // The `muted`/`volume` props on <video> are unreliable in React — set them
  // imperatively from the stored item state.
  useEffect(() => {
    applyAudio(elRef.current, item);
    // Only the playback fields matter here; re-running on every item change is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.muted, item.volume, item.playbackRate]);

  // Resume where this video last left off, playing unless it was left paused;
  // keep saving as it plays (device memory — leaving the board and coming
  // back picks up here).
  useEffect(() => {
    const el = elRef.current;
    if (!el || !item.assetId) return;
    return bindPlaybackMemory(el, `${item.id}:${item.assetId}`, { autoplay: true });
  }, [item.id, item.assetId, url]);

  // Decoder hygiene: pause videos panned far off-screen and resume them when
  // they come back. Only touches videos WE paused — a user's pause sticks.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && !el.paused) {
            el.dataset.autoPaused = '1'; // before pause(): the memory skips it
            el.pause();
          } else if (entry.isIntersecting && el.dataset.autoPaused) {
            delete el.dataset.autoPaused;
            void el.play().catch(() => {});
          }
        }
      },
      { rootMargin: '75%' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [url]);

  // After all hooks: a peer's upload still downloading shows as such.
  if (!url && fetching) return <AssetLoadingBox label="video" />;

  return (
    <div className="video-item">
      <video
        ref={(el) => {
          elRef.current = el;
          registerVideo(item.id, el);
          applyAudio(el, item);
        }}
        className="video-el"
        src={url ?? undefined}
        poster={posterUrl ?? undefined}
        loop={item.loop}
        playsInline
        preload="metadata"
      />
    </div>
  );
}

export function VideoContent({ item }: { item: VideoItem }) {
  return item.embed ? <EmbedFacade item={item} /> : <FileVideo item={item} />;
}
