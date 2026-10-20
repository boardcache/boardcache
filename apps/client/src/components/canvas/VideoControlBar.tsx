import { useEffect, useState } from 'react';
import type { VideoItem } from '@boardcache/schema';
import {
  captureFrameToImage,
  cycleRate,
  fullscreenVideo,
  rateOf,
  setVolume,
  stepFrame,
  toggleLoop,
  toggleMute,
  togglePlay,
} from '../../lib/media/videoActions';
import { updateItems } from '../../state/commands';
import { useSessionStore } from '../../state/sessionStore';
import {
  CameraIcon,
  ExpandIcon,
  FilmIcon,
  FlagIcon,
  LoopIcon,
  PauseIcon,
  PlayIcon,
  StepBackIcon,
  StepFwdIcon,
  VolumeIcon,
} from '../icons';

/** Seconds → m:ss. */
function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Custom video controls reused on the canvas (screen-space, below the
 * selected video) and in the lightbox. Drives the passed <video> element;
 * loop/poster/capture also touch the document.
 */
export function VideoControlBar({ item, el }: { item: VideoItem; el: HTMLVideoElement | null }) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // A different element (or none) re-seeds the mirrored state during render;
  // the effect below only listens for changes.
  const [seenEl, setSeenEl] = useState<HTMLVideoElement | null>();
  if (el !== seenEl) {
    setSeenEl(el);
    setPlaying(el ? !el.paused : false);
    setTime(el?.currentTime || 0);
    setDuration(el && Number.isFinite(el.duration) ? el.duration : 0);
  }

  useEffect(() => {
    if (!el) return;
    const syncPlay = () => setPlaying(!el.paused);
    const syncTime = () => setTime(el.currentTime || 0);
    const syncDur = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    el.addEventListener('play', syncPlay);
    el.addEventListener('pause', syncPlay);
    el.addEventListener('ended', syncPlay);
    el.addEventListener('timeupdate', syncTime);
    el.addEventListener('loadedmetadata', syncDur);
    el.addEventListener('durationchange', syncDur);
    return () => {
      el.removeEventListener('play', syncPlay);
      el.removeEventListener('pause', syncPlay);
      el.removeEventListener('ended', syncPlay);
      el.removeEventListener('timeupdate', syncTime);
      el.removeEventListener('loadedmetadata', syncDur);
      el.removeEventListener('durationchange', syncDur);
    };
  }, [el]);

  const seek = (t: number) => {
    if (el) el.currentTime = t;
    setTime(t);
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="video-controls"
      data-testid="video-controls"
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {/* Timeline: its own row, spanning the full control-bar (video) width.
          Marker ticks overlay it; clicking a tick jumps to its time. */}
      <div className="vc-seek-wrap">
        <input
          type="range"
          className="vc-slider vc-seek-bar"
          data-testid="video-seek"
          min={0}
          max={duration || 0}
          step={0.05}
          value={Math.min(time, duration || 0)}
          disabled={duration === 0}
          onChange={(e) => seek(Number(e.target.value))}
          title="Seek"
          aria-label="Seek"
        />
        {duration > 0 &&
          item.markers.map((m, i) => (
            <button
              key={`${m.time}-${i}`}
              type="button"
              className="vc-marker-tick"
              style={{ left: `${Math.min(100, (m.time / duration) * 100)}%` }}
              title={`${m.label} (${formatTime(m.time)})`}
              data-testid="video-marker-tick"
              onClick={() => seek(m.time)}
            />
          ))}
      </div>

      <div className="vc-row">
        <button
          type="button"
          onClick={() => stepFrame(el, -1)}
          title="Previous frame"
          aria-label="Previous frame"
        >
          <StepBackIcon />
        </button>
        <button
          type="button"
          className="vc-play"
          data-testid="video-play"
          onClick={() => togglePlay(el)}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          onClick={() => stepFrame(el, 1)}
          title="Next frame"
          aria-label="Next frame"
        >
          <StepFwdIcon />
        </button>
        <span className="vc-time" data-testid="video-time">
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <span className="vc-sep" />
        <button
          type="button"
          className="vc-rate"
          data-testid="video-rate"
          onClick={() => cycleRate(item, el)}
          title="Playback speed"
          aria-label="Playback speed"
        >
          {rateOf(item)}&times;
        </button>
        <button
          type="button"
          className={item.loop ? 'on' : ''}
          onClick={() => toggleLoop(item, el)}
          title="Loop"
          aria-label="Toggle loop"
          aria-pressed={item.loop}
        >
          <LoopIcon />
        </button>
        <button
          type="button"
          data-testid="video-add-marker"
          onClick={() => {
            if (!el) return;
            const t = el.currentTime;
            const label = window.prompt('Marker label:', formatTime(t));
            if (label === null) return;
            updateItems([item.id], 'Add marker', (it) => {
              if (it.type !== 'video') return;
              it.markers = [...it.markers, { time: t, label: label.trim() || formatTime(t) }].sort(
                (a, b) => a.time - b.time,
              );
            });
          }}
          title="Add a time marker here"
          aria-label="Add a time marker"
        >
          <FlagIcon />
        </button>
        <button
          type="button"
          data-testid="video-poster"
          onClick={() => useSessionStore.getState().setVideoPosterPickerId(item.id)}
          title="Choose poster frame"
          aria-label="Choose poster frame"
        >
          <FilmIcon />
        </button>
        <button
          type="button"
          data-testid="video-capture"
          onClick={() => void captureFrameToImage(item, el)}
          title="New image from current frame"
          aria-label="Capture frame as image"
        >
          <CameraIcon />
        </button>
        <span className="vc-sep" />
        <div className="vc-volume" data-testid="video-volume">
          <button
            type="button"
            data-testid="video-mute"
            className={item.muted ? 'on' : ''}
            onClick={() => toggleMute(item, el)}
            title={item.muted ? 'Unmute' : 'Mute'}
            aria-label={item.muted ? 'Unmute' : 'Mute'}
            aria-pressed={item.muted}
          >
            <VolumeIcon level={item.muted ? 0 : item.volume} />
          </button>
          <input
            type="range"
            className="vc-slider"
            data-testid="video-volume-slider"
            min={0}
            max={1}
            step={0.05}
            value={item.muted ? 0 : item.volume}
            onChange={(e) => setVolume(item, el, Number(e.target.value))}
            title="Volume"
            aria-label="Volume"
          />
        </div>
        <span className="vc-sep" />
        <button
          type="button"
          onClick={() => fullscreenVideo(el)}
          title="Fullscreen"
          aria-label="Fullscreen"
        >
          <ExpandIcon />
        </button>
      </div>
    </div>
  );
}
