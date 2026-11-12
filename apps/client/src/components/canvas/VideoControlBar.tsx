import { useEffect, useState } from 'react';
import type { VideoItem } from '@boardcache/schema';
import {
  canCutClips,
  captureFrameToImage,
  clearAbPoints,
  cutClip,
  cycleRate,
  fullscreenVideo,
  isReversing,
  rateOf,
  setAbPoint,
  setVolume,
  stepFrame,
  toggleLoop,
  toggleMute,
  togglePlay,
  toggleReverse,
} from '../../lib/media/videoActions';
import {
  transcribeAvailable,
  transcribeItem,
  useTranscribeStore,
} from '../../lib/media/transcribe';
import { showNotice } from '../../lib/notices';
import { VIEWER } from '../../lib/viewerMode';
import { updateItems } from '../../state/commands';
import { useSessionStore } from '../../state/sessionStore';
import {
  CameraIcon,
  CaptionsIcon,
  CloseIcon,
  ExpandIcon,
  FilmIcon,
  FlagIcon,
  LoopIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  ScissorsIcon,
  StepBackIcon,
  StepFwdIcon,
  VolumeIcon,
} from '../icons';
import { promptText } from '../ui/Prompt';

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

  // Reverse runs outside the element's play state; its event redraws the bar.
  const [reverse, setReverse] = useState(false);
  const transcribing = useTranscribeStore((s) => !!s.running[item.id]);
  const canTranscribe = !!item.assetId && transcribeAvailable();

  useEffect(() => {
    if (!el) return;
    const syncPlay = () => setPlaying(!el.paused);
    const syncTime = () => setTime(el.currentTime || 0);
    const syncDur = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const syncReverse = () => setReverse(isReversing(el));
    syncReverse();
    el.addEventListener('play', syncPlay);
    el.addEventListener('pause', syncPlay);
    el.addEventListener('ended', syncPlay);
    el.addEventListener('timeupdate', syncTime);
    el.addEventListener('loadedmetadata', syncDur);
    el.addEventListener('durationchange', syncDur);
    el.addEventListener('bc-reverse', syncReverse);
    return () => {
      el.removeEventListener('play', syncPlay);
      el.removeEventListener('pause', syncPlay);
      el.removeEventListener('ended', syncPlay);
      el.removeEventListener('timeupdate', syncTime);
      el.removeEventListener('loadedmetadata', syncDur);
      el.removeEventListener('durationchange', syncDur);
      el.removeEventListener('bc-reverse', syncReverse);
    };
  }, [el]);

  const ab = item.abLoop;
  const transcribe = () => {
    void transcribeItem(item.id).catch((err: unknown) => {
      showNotice(err instanceof Error ? err.message : 'Transcription failed.', {
        id: 'item-transcribe',
        kind: 'warn',
      });
    });
  };

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
        {duration > 0 && ab && ab.b > ab.a && (
          <span
            className="vc-ab-range"
            data-testid="video-ab-range"
            style={{
              left: `${Math.min(100, (ab.a / duration) * 100)}%`,
              width: `${Math.min(100, ((ab.b - ab.a) / duration) * 100)}%`,
            }}
            aria-hidden
          />
        )}
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
          className={reverse ? 'on' : ''}
          data-testid="video-reverse"
          onClick={() => toggleReverse(item, el)}
          title={reverse ? 'Stop playing backwards' : 'Play backwards'}
          aria-label="Play backwards"
          aria-pressed={reverse}
        >
          <RewindIcon />
        </button>
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
        {/* A/B points: playback stays between them; a clip can be cut from them. */}
        <button
          type="button"
          className={`vc-ab${ab ? ' on' : ''}`}
          data-testid="video-set-a"
          onClick={() => setAbPoint(item, el, 'a')}
          title={ab ? `A point at ${formatTime(ab.a)} (set it here)` : 'Set the A point here'}
          aria-label="Set the A point"
        >
          A
        </button>
        <button
          type="button"
          className={`vc-ab${ab ? ' on' : ''}`}
          data-testid="video-set-b"
          onClick={() => setAbPoint(item, el, 'b')}
          title={ab ? `B point at ${formatTime(ab.b)} (set it here)` : 'Set the B point here'}
          aria-label="Set the B point"
        >
          B
        </button>
        {ab && (
          <>
            <button
              type="button"
              data-testid="video-ab-clear"
              onClick={() => clearAbPoints(item)}
              title="Clear the A/B points"
              aria-label="Clear the A/B points"
            >
              <CloseIcon />
            </button>
            {!VIEWER && item.assetId && canCutClips() && (
              <button
                type="button"
                data-testid="video-cut-clip"
                onClick={() => void cutClip(item)}
                title={`Cut ${formatTime(ab.a)} to ${formatTime(ab.b)} out as a new video`}
                aria-label="Cut the A/B clip as a new video"
              >
                <ScissorsIcon />
              </button>
            )}
          </>
        )}
        <button
          type="button"
          data-testid="video-add-marker"
          onClick={() => {
            if (!el) return;
            const t = el.currentTime;
            void promptText({ title: 'Add marker', label: 'Label', initial: formatTime(t) }).then(
              (label) => {
                if (label === null) return;
                updateItems([item.id], 'Add marker', (it) => {
                  if (it.type !== 'video') return;
                  it.markers = [
                    ...it.markers,
                    { time: t, label: label.trim() || formatTime(t) },
                  ].sort((a, b) => a.time - b.time);
                });
              },
            );
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
        {!VIEWER && (
          <button
            type="button"
            className={`${transcribing ? 'busy' : ''}${item.transcript ? ' on' : ''}`}
            data-testid="video-transcribe"
            disabled={!canTranscribe || transcribing}
            onClick={transcribe}
            title={
              transcribing
                ? 'Transcribing'
                : !item.assetId
                  ? 'Transcription needs a video file'
                  : !canTranscribe
                    ? 'Transcription needs local Whisper, an OpenAI key or hosted AI (Settings → AI)'
                    : item.transcript
                      ? 'Transcribe again (AI)'
                      : 'Transcribe (AI)'
            }
            aria-label="Transcribe"
          >
            <CaptionsIcon />
          </button>
        )}
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
