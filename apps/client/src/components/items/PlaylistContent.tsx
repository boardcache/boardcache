import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlaylistItem } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { sharedAudio } from '../../lib/media/audioRegistry';
import { setPlaylistPlayback, updateItems } from '../../state/commands';
import {
  LoopIcon,
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  StepBackIcon,
  StepFwdIcon,
  VolumeIcon,
} from '../icons';

function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Resolve play() once the (possibly still-loading) shared element is ready. */
function playWhenReady(el: HTMLAudioElement): void {
  const attempt = () => void el.play().catch(() => {});
  if (el.readyState >= 2) attempt();
  else el.addEventListener('canplay', attempt, { once: true });
}

/**
 * One player for several audio files. Tracks play through the item's SHARED
 * audio element (see audioRegistry) — switching tracks swaps the element's
 * source; playback state stays in sync across the canvas and the lightbox.
 * Auto-advances at the end of a track; `loop` cycles the whole list.
 */
export function PlaylistPlayer({
  item,
  variant,
}: {
  item: PlaylistItem;
  variant: 'card' | 'stage';
}) {
  const track = item.tracks[Math.min(item.current, item.tracks.length - 1)] ?? null;
  const el = useMemo(() => sharedAudio(item.id, track?.assetId ?? ''), [item.id, track?.assetId]);
  const coverUrl = useAssetUrl(track?.coverAssetId ?? null);
  const [playing, setPlaying] = useState(() => !el.paused);
  const [cur, setCur] = useState(() => el.currentTime);
  const [dur, setDur] = useState(() => (Number.isFinite(el.duration) ? el.duration : 0));
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const wantsPlay = useRef(false);

  useEffect(() => {
    el.volume = item.volume;
    el.muted = item.muted;
  }, [el, item.volume, item.muted]);

  // Reflect the shared element's state.
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

  // A track switch produced a fresh element — resume if we intended to play.
  useEffect(() => {
    if (wantsPlay.current) {
      wantsPlay.current = false;
      playWhenReady(el);
    }
  }, [el]);

  const goTo = (index: number, play: boolean) => {
    if (index === item.current) {
      if (play) playWhenReady(el);
      return;
    }
    wantsPlay.current = play;
    setPlaylistPlayback(item.id, { current: index });
  };

  // Auto-advance; loop cycles back to the first track.
  useEffect(() => {
    const onEnded = () => {
      const n = item.tracks.length;
      if (item.current + 1 < n) goTo(item.current + 1, true);
      else if (item.loop && n > 0) goTo(0, true);
    };
    el.addEventListener('ended', onEnded);
    return () => el.removeEventListener('ended', onEnded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, item.id, item.current, item.tracks.length, item.loop]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    el.currentTime = Math.max(0, Math.min(1, frac)) * dur;
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const pct = dur ? (cur / dur) * 100 : 0;
  const name = nameDraft ?? item.name ?? '';

  return (
    <div className={`playlist-player playlist-${variant}`} data-testid="playlist-player">
      <div className="playlist-head">
        <div className="playlist-cover" aria-hidden>
          {coverUrl ? (
            <img src={coverUrl} alt="" draggable={false} />
          ) : (
            <MusicNoteIcon size={variant === 'stage' ? 40 : 24} />
          )}
        </div>
        <div className="playlist-meta">
          <input
            className="audio-title"
            value={name}
            placeholder="Playlist"
            data-testid="playlist-name"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              if (nameDraft === null) return;
              const trimmed = nameDraft.trim();
              setNameDraft(null);
              if (trimmed !== (item.name ?? '')) {
                updateItems([item.id], 'Rename playlist', (it) => {
                  it.name = trimmed || undefined;
                });
              }
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              else if (e.key === 'Escape') {
                setNameDraft(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            onPointerDown={stop}
            onClick={stop}
            onDoubleClick={stop}
          />
          <span className="playlist-now">
            {track
              ? `${item.current + 1}/${item.tracks.length} · ${track.title}`
              : 'Empty playlist'}
          </span>
        </div>
      </div>

      <div className="audio-seek" onClick={seek} onPointerDown={stop} data-testid="playlist-seek">
        <div className="audio-track">
          <div className="audio-progress" style={{ width: `${pct}%` }} />
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
          className="audio-btn"
          data-testid="playlist-prev"
          onClick={() => goTo(Math.max(0, item.current - 1), playing)}
          aria-label="Previous track"
          title="Previous track"
        >
          <StepBackIcon />
        </button>
        <button
          type="button"
          className="audio-play"
          data-testid="playlist-play"
          onClick={() => {
            if (el.paused) playWhenReady(el);
            else el.pause();
          }}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </button>
        <button
          type="button"
          className="audio-btn"
          data-testid="playlist-next"
          onClick={() => goTo(Math.min(item.tracks.length - 1, item.current + 1), playing)}
          aria-label="Next track"
          title="Next track"
        >
          <StepFwdIcon />
        </button>
        <button
          type="button"
          className={`audio-btn${item.loop ? ' on' : ''}`}
          data-testid="playlist-loop"
          onClick={() => setPlaylistPlayback(item.id, { loop: !item.loop })}
          aria-pressed={item.loop}
          aria-label="Loop playlist"
          title="Loop playlist"
        >
          <LoopIcon />
        </button>
        <div className="audio-volume">
          <button
            type="button"
            className={`audio-btn${item.muted ? ' on' : ''}`}
            data-testid="playlist-mute"
            onClick={() => setPlaylistPlayback(item.id, { muted: !item.muted })}
            aria-label={item.muted ? 'Unmute' : 'Mute'}
            title={item.muted ? 'Unmute' : 'Mute'}
          >
            <VolumeIcon level={item.muted ? 0 : item.volume} />
          </button>
          <input
            type="range"
            className="audio-vol-slider"
            min={0}
            max={1}
            step={0.05}
            value={item.muted ? 0 : item.volume}
            onChange={(e) =>
              setPlaylistPlayback(item.id, { volume: Number(e.target.value), muted: false })
            }
            aria-label="Volume"
          />
        </div>
      </div>

      <ol className="playlist-tracks" onPointerDown={stop}>
        {item.tracks.map((t, i) => (
          <li key={`${t.assetId}-${i}`}>
            <button
              type="button"
              className={`playlist-track${i === item.current ? ' current' : ''}`}
              data-testid="playlist-track"
              onClick={(e) => {
                e.stopPropagation();
                goTo(i, true);
              }}
              onDoubleClick={stop}
            >
              <span className="playlist-track-num">
                {i === item.current && playing ? '▸' : i + 1}
              </span>
              <span className="playlist-track-title">{t.title}</span>
              {t.artist && <span className="playlist-track-artist">{t.artist}</span>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PlaylistContent({ item }: { item: PlaylistItem }) {
  return <PlaylistPlayer item={item} variant="card" />;
}
