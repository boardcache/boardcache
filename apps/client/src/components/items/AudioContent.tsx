import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AudioItem } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import {
  applyAudioProps,
  cycleRate,
  setVolume,
  toggleLoop,
  toggleMute,
  togglePlay,
} from '../../lib/media/audioActions';
import {
  activateAudioEmbed,
  embedPlayersSnapshot,
  subscribeEmbedPlayers,
} from '../../lib/media/embedPlayers';
import { sharedAudio } from '../../lib/media/audioRegistry';
import { updateItems } from '../../state/commands';
import { FlagIcon, LoopIcon, MusicNoteIcon, PauseIcon, PlayIcon, VolumeIcon } from '../icons';

function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Inline label editor — commits to item.title on blur/Enter (one undo step). */
function AudioLabel({ item }: { item: AudioItem }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? item.title ?? '';
  const commit = () => {
    if (draft === null) return;
    const title = draft.trim() || null;
    setDraft(null);
    if (title !== (item.title ?? null)) {
      updateItems([item.id], 'Rename audio', (it) => {
        if (it.type === 'audio') it.title = title;
      });
    }
  };
  return (
    <input
      className="audio-title"
      value={value}
      placeholder="Untitled"
      data-testid="audio-label"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

/**
 * A controller UI for an item's SHARED audio element (see audioRegistry): the
 * canvas card and the lightbox stage both drive the same element, so playback
 * never restarts or pauses when views mount/unmount, both stay in sync, and
 * several items can sound at once. Settings (volume/mute/repeat/speed) persist
 * on the item.
 */
export function AudioPlayer({ item, variant }: { item: AudioItem; variant: 'card' | 'stage' }) {
  const coverUrl = useAssetUrl(item.coverAssetId);
  const el = useMemo(() => sharedAudio(item.id, item.assetId ?? ''), [item.id, item.assetId]);
  const [playing, setPlaying] = useState(() => !el.paused);
  const [cur, setCur] = useState(() => el.currentTime);
  const [dur, setDur] = useState(() => (Number.isFinite(el.duration) ? el.duration : 0));

  // Mirror the stored playback settings onto the shared element.
  useEffect(() => {
    applyAudioProps(el, item);
  }, [el, item]);

  // Reflect the shared element's state (whoever changes it — this view, the
  // other view, or auto-advance).
  useEffect(() => {
    const sync = () => {
      setPlaying(!el.paused);
      setCur(el.currentTime);
      setDur(Number.isFinite(el.duration) ? el.duration : 0);
    };
    sync();
    const events = ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange'];
    for (const ev of events) el.addEventListener(ev, sync);
    return () => {
      for (const ev of events) el.removeEventListener(ev, sync);
    };
  }, [el]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!el || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    el.currentTime = Math.max(0, Math.min(1, frac)) * dur;
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const pct = dur ? (cur / dur) * 100 : 0;

  return (
    <div className={`audio-player audio-${variant}`}>
      <div className="audio-cover" aria-hidden>
        {coverUrl ? (
          <img src={coverUrl} alt="" draggable={false} />
        ) : (
          <MusicNoteIcon size={variant === 'stage' ? 56 : 28} />
        )}
      </div>
      <div className="audio-body">
        <div className="audio-meta">
          <AudioLabel item={item} />
          {item.artist && <span className="audio-artist">{item.artist}</span>}
        </div>

        <div className="audio-seek" onClick={seek} onPointerDown={stop} data-testid="audio-seek">
          <div className="audio-track">
            <div className="audio-progress" style={{ width: `${pct}%` }} />
            {dur > 0 &&
              item.markers.map((m, i) => (
                <button
                  key={`${m.time}-${i}`}
                  type="button"
                  className="audio-marker-tick"
                  style={{ left: `${Math.min(100, (m.time / dur) * 100)}%` }}
                  title={`${m.label} (${formatTime(m.time)})`}
                  data-testid="audio-marker-tick"
                  onClick={(e) => {
                    e.stopPropagation();
                    el.currentTime = m.time;
                  }}
                />
              ))}
          </div>
          <span className="audio-time">
            {formatTime(cur)}
            <span className="audio-time-sep"> / </span>
            {formatTime(dur)}
          </span>
        </div>

        <div className="audio-controls" onPointerDown={stop} onClick={stop}>
          <button
            type="button"
            className="audio-play"
            data-testid="audio-play"
            onClick={() => togglePlay(el)}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>
          <button
            type="button"
            className={`audio-btn${item.loop ? ' on' : ''}`}
            data-testid="audio-loop"
            onClick={() => toggleLoop(item, el)}
            aria-pressed={item.loop}
            aria-label="Repeat"
            title="Repeat"
          >
            <LoopIcon />
          </button>
          {variant === 'stage' && (
            <button
              type="button"
              className="audio-btn"
              data-testid="audio-add-marker"
              data-edit=""
              onClick={() => {
                const t = el.currentTime;
                const label = window.prompt('Chapter label:', formatTime(t));
                if (label === null) return;
                updateItems([item.id], 'Add marker', (it) => {
                  if (it.type !== 'audio') return;
                  it.markers = [
                    ...it.markers,
                    { time: t, label: label.trim() || formatTime(t) },
                  ].sort((a, b) => a.time - b.time);
                });
              }}
              title="Add a chapter marker here"
              aria-label="Add a chapter marker"
            >
              <FlagIcon />
            </button>
          )}
          <button
            type="button"
            className="audio-btn audio-rate"
            data-testid="audio-rate"
            onClick={() => cycleRate(item, el)}
            title="Playback speed"
            aria-label="Playback speed"
          >
            {item.playbackRate}&times;
          </button>
          <div className="audio-volume">
            <button
              type="button"
              className={`audio-btn${item.muted ? ' on' : ''}`}
              data-testid="audio-mute"
              onClick={() => toggleMute(item, el)}
              aria-label={item.muted ? 'Unmute' : 'Mute'}
              title={item.muted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon level={item.muted ? 0 : item.volume} />
            </button>
            <input
              type="range"
              className="audio-vol-slider"
              data-testid="audio-volume"
              min={0}
              max={1}
              step={0.05}
              value={item.muted ? 0 : item.volume}
              onChange={(e) => setVolume(item, el, Number(e.target.value))}
              aria-label="Volume"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Spotify/SoundCloud facade: the artwork (from oEmbed) with a play badge.
 * Play activates the item's PERSISTENT floating provider player
 * (EmbedPlayerLayer) — the same iframe then just repositions between the
 * canvas and the lightbox stage, so playback is never interrupted and both
 * views are inherently the same player.
 */
function AudioEmbedFacade({ item }: { item: AudioItem }) {
  const coverUrl = useAssetUrl(item.coverAssetId);
  const players = useSyncExternalStore(subscribeEmbedPlayers, embedPlayersSnapshot);
  const active = players.some((p) => p.itemId === item.id);
  if (!item.embed) return null;
  return (
    <div
      className={`audio-embed-facade audio-embed-${item.embed.provider}`}
      data-testid="audio-embed"
    >
      {coverUrl ? (
        <img className="audio-embed-art" src={coverUrl} alt="" draggable={false} />
      ) : (
        <div className="audio-embed-art audio-embed-art-empty" aria-hidden>
          <MusicNoteIcon size={34} />
        </div>
      )}
      <div className="audio-embed-meta">
        <span className="audio-embed-title">{item.title ?? item.embed.url}</span>
        <span className="audio-embed-provider">{item.embed.provider}</span>
      </div>
      {!active && (
        <div className="video-overlay">
          <button
            type="button"
            className="video-play-badge video-play-badge-btn audio-embed-play"
            data-testid="audio-embed-play"
            data-view-ok=""
            title="Open the player here"
            onClick={(e) => {
              e.stopPropagation();
              if (item.embed) activateAudioEmbed(item.id, item.embed);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <PlayIcon size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export function AudioContent({ item }: { item: AudioItem }) {
  if (item.embed) return <AudioEmbedFacade item={item} />;
  return <AudioPlayer item={item} variant="card" />;
}
