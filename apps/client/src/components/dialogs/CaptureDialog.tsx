import { useEffect, useRef, useState } from 'react';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { importAudioFiles } from '../../lib/import/importAudio';
import { importImageFiles } from '../../lib/import/importImages';
import { importVideoFiles } from '../../lib/import/importVideos';
import { useSessionStore } from '../../state/sessionStore';
import type { CaptureMode } from '../../state/sessionStore';
import { UiDialog } from '../ui/Dialog';
import { UiSelect } from '../ui/Select';
import { MicIcon } from '../icons';

/**
 * Webcam / microphone / screen capture. Results land on the canvas as normal
 * image/video/audio items through the same importers as dropped files.
 *
 * - Camera and microphone sources are selectable when several exist.
 * - Webcam modes offer live filters: previewed with CSS on the <video>, and
 *   baked into the output by drawing frames through a canvas (snap draws one
 *   filtered frame; recording captures the canvas's stream).
 * - Screen recording can optionally mix the microphone in (WebAudio merges
 *   mic + system audio when both exist), and can snap stills any time —
 *   including mid-recording.
 */
export function CaptureDialog() {
  const mode = useSessionStore((s) => s.captureMode);
  return mode ? <CaptureBody key={mode} mode={mode} /> : null;
}

const TITLES: Record<CaptureMode, string> = {
  photo: 'Take Photo',
  video: 'Record Video',
  voice: 'Record Voice Note',
  screen: 'Record Screen',
  screenshot: 'Screenshot Screen',
};

const FILTERS = [
  { value: 'none', label: 'No filter' },
  { value: 'grayscale(1)', label: 'Black & white' },
  { value: 'sepia(0.8)', label: 'Sepia' },
  { value: 'saturate(1.6) contrast(1.08)', label: 'Vivid' },
  { value: 'contrast(1.25) brightness(1.05) sepia(0.22)', label: 'Vintage' },
  { value: 'invert(1)', label: 'Invert' },
  { value: 'blur(4px)', label: 'Soft blur' },
];

const CAM_KEY = 'boardcache:captureCam';
const MIC_KEY = 'boardcache:captureMic';

function loadPref(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function pickMime(candidates: string[]): string | undefined {
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}

function viewCenter() {
  return clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
}

function CaptureBody({ mode }: { mode: CaptureMode }) {
  const close = () => useSessionStore.getState().setCaptureMode(null);
  const usesCamera = mode === 'photo' || mode === 'video';
  const usesMic = mode === 'video' || mode === 'voice';
  const isDisplay = mode === 'screen' || mode === 'screenshot';
  const canSnap = mode !== 'voice';
  const canRecord = mode === 'video' || mode === 'voice' || mode === 'screen';

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState(() => loadPref(CAM_KEY));
  const [micId, setMicId] = useState(() => loadPref(MIC_KEY));
  const [screenMic, setScreenMic] = useState(false);
  const [filter, setFilter] = useState('none');
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null); // mic/mixer/raf teardown

  // Screen shares must not re-acquire when the mic prefs change — the mic is
  // attached at record time. Local devices re-acquire on source switch.
  const acquireKey = isDisplay ? 'display' : `${camId}|${micId}`;

  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;
    const request = isDisplay
      ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: mode === 'screen' })
      : navigator.mediaDevices.getUserMedia({
          video: usesCamera
            ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                ...(camId ? { deviceId: { exact: camId } } : {}),
              }
            : false,
          audio: usesMic ? (micId ? { deviceId: { exact: micId } } : true) : false,
        });
    request
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        acquired = s;
        setStream(s);
        setError(null);
        // A screen share ended from the browser's own UI: wrap up.
        s.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (recordingRef.current) recorderRef.current?.stop();
          else useSessionStore.getState().setCaptureMode(null);
        });
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (cancelled) return;
        setCams(devices.filter((d) => d.kind === 'videoinput'));
        setMics(devices.filter((d) => d.kind === 'audioinput'));
      })
      .catch(() => {
        if (!cancelled)
          setError(
            isDisplay
              ? 'Screen sharing was cancelled or is unavailable.'
              : mode === 'voice'
                ? 'Microphone unavailable — check the browser permission.'
                : 'Camera unavailable — check the browser permission.',
          );
      });
    return () => {
      cancelled = true;
      recorderRef.current?.stop();
      cleanupRef.current?.();
      cleanupRef.current = null;
      acquired?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, acquireKey]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (!recording) return;
    const started = performance.now();
    const timer = setInterval(() => setElapsed((performance.now() - started) / 1000), 250);
    return () => clearInterval(timer);
  }, [recording]);

  const activeFilter = usesCamera && filter !== 'none' ? filter : null;

  /** Draw the current preview frame (with any filter) and import as an image.
   *  Mid-recording snaps leave the dialog open; otherwise it closes. */
  const snap = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const midRecording = recordingRef.current;
    if (!midRecording) setSaving(true);
    const cv = document.createElement('canvas');
    cv.width = video.videoWidth;
    cv.height = video.videoHeight;
    const ctx = cv.getContext('2d')!;
    if (activeFilter) ctx.filter = activeFilter;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => cv.toBlob((b) => r(b), 'image/png'));
    if (blob) {
      const name = isDisplay ? 'screenshot.png' : 'webcam-photo.png';
      await importImageFiles([new File([blob], name, { type: 'image/png' })], viewCenter());
    }
    if (!midRecording) close();
  };

  const startRecording = async () => {
    const video = videoRef.current;
    if (!stream) return;
    const teardown: (() => void)[] = [];

    // Assemble what actually gets recorded (may differ from the preview).
    let videoTracks = stream.getVideoTracks();
    let audioTracks = [...stream.getAudioTracks()];

    // Filtered webcam: pull frames through a canvas and record its stream.
    if (activeFilter && video && mode === 'video') {
      const cv = document.createElement('canvas');
      cv.width = video.videoWidth || 1280;
      cv.height = video.videoHeight || 720;
      const ctx = cv.getContext('2d')!;
      let raf = 0;
      const draw = () => {
        ctx.filter = activeFilter;
        ctx.drawImage(video, 0, 0, cv.width, cv.height);
        raf = requestAnimationFrame(draw);
      };
      draw();
      const canvasStream = cv.captureStream(30);
      videoTracks = canvasStream.getVideoTracks();
      teardown.push(() => {
        cancelAnimationFrame(raf);
        canvasStream.getTracks().forEach((t) => t.stop());
      });
    }

    // Screen recording with the mic mixed in.
    if (mode === 'screen' && screenMic) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: micId ? { deviceId: { exact: micId } } : true,
        });
        teardown.push(() => micStream.getTracks().forEach((t) => t.stop()));
        audioTracks = [...audioTracks, ...micStream.getAudioTracks()];
      } catch {
        /* mic denied — record without it */
      }
    }

    // MediaRecorder only records one audio track; merge via WebAudio if needed.
    if (audioTracks.length > 1) {
      const ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      for (const track of audioTracks) {
        ac.createMediaStreamSource(new MediaStream([track])).connect(dest);
      }
      audioTracks = dest.stream.getAudioTracks();
      teardown.push(() => void ac.close());
    }

    const recordStream = new MediaStream([...videoTracks.slice(0, 1), ...audioTracks.slice(0, 1)]);
    if (mode === 'voice') {
      recordStream.getVideoTracks().forEach((t) => recordStream.removeTrack(t));
    }

    const mimeType =
      mode === 'voice'
        ? pickMime(['audio/webm;codecs=opus', 'audio/webm'])
        : pickMime(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
    const recorder = new MediaRecorder(
      mode === 'voice'
        ? new MediaStream(audioTracks.length ? audioTracks : stream.getTracks())
        : recordStream,
      mimeType ? { mimeType } : undefined,
    );
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      recordingRef.current = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
      void (async () => {
        setSaving(true);
        const type = recorder.mimeType || (mode === 'voice' ? 'audio/webm' : 'video/webm');
        const blob = new Blob(chunks, { type });
        if (blob.size > 0) {
          if (mode === 'voice') {
            await importAudioFiles([new File([blob], 'voice-note.webm', { type })], viewCenter());
          } else {
            const name = mode === 'screen' ? 'screen-recording.webm' : 'webcam-recording.webm';
            await importVideoFiles([new File([blob], name, { type })], viewCenter());
          }
        }
        close();
      })();
    };
    cleanupRef.current = () => teardown.forEach((fn) => fn());
    recorderRef.current = recorder;
    recordingRef.current = true;
    recorder.start();
    setElapsed(0);
    setRecording(true);
  };

  const stopRecording = () => {
    setRecording(false);
    recorderRef.current?.stop();
    recorderRef.current = null;
  };

  const deviceOptions = (devices: MediaDeviceInfo[], fallback: string) =>
    devices.map((d, i) => ({
      value: d.deviceId,
      label: d.label || `${fallback} ${i + 1}`,
    }));

  const mmss = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;

  return (
    <UiDialog
      title={TITLES[mode]}
      onClose={close}
      className="capture-sheet"
      size="wide"
      testId="capture-dialog"
      dismissable={!recording && !saving}
    >
      <div className="capture-body">
        {error ? (
          <p className="sync-error" role="alert" data-testid="capture-error">
            {error}
          </p>
        ) : mode === 'voice' ? (
          <div className="capture-voice" data-testid="capture-voice">
            <span className={`capture-mic${recording ? ' live' : ''}`}>
              <MicIcon size={30} />
            </span>
            <span className="capture-timer">{recording ? mmss : stream ? 'Ready' : '…'}</span>
          </div>
        ) : (
          <div className="capture-stage">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              data-testid="capture-preview"
              style={activeFilter ? { filter: activeFilter } : undefined}
            />
            {recording && (
              <span className="capture-rec">
                <span className="capture-rec-dot" /> {mmss}
              </span>
            )}
          </div>
        )}

        {/* Source + filter pickers (never mid-recording — switching would
            tear down the stream being recorded). */}
        {!error && !recording && (
          <>
            {usesCamera && cams.length > 1 && (
              <label className="capture-source">
                <span>Camera</span>
                <UiSelect
                  value={camId || cams[0]?.deviceId || ''}
                  options={deviceOptions(cams, 'Camera')}
                  ariaLabel="Camera source"
                  testId="capture-cam-select"
                  onChange={(v) => {
                    savePref(CAM_KEY, v);
                    setCamId(v);
                  }}
                />
              </label>
            )}
            {(usesMic || (mode === 'screen' && screenMic)) && mics.length > 1 && (
              <label className="capture-source">
                <span>Microphone</span>
                <UiSelect
                  value={micId || mics[0]?.deviceId || ''}
                  options={deviceOptions(mics, 'Microphone')}
                  ariaLabel="Microphone source"
                  testId="capture-mic-select"
                  onChange={(v) => {
                    savePref(MIC_KEY, v);
                    setMicId(v);
                  }}
                />
              </label>
            )}
            {usesCamera && (
              <label className="capture-source">
                <span>Filter</span>
                <UiSelect
                  value={filter}
                  options={FILTERS}
                  ariaLabel="Video filter"
                  testId="capture-filter-select"
                  onChange={setFilter}
                />
              </label>
            )}
            {mode === 'screen' && (
              <label className="capture-check">
                <input
                  type="checkbox"
                  checked={screenMic}
                  onChange={(e) => setScreenMic(e.target.checked)}
                  data-testid="capture-screen-mic"
                />
                <span>Record microphone narration</span>
              </label>
            )}
          </>
        )}

        <div className="capture-actions">
          {canSnap && (
            <button
              type="button"
              className={canRecord ? 'capture-secondary' : 'sync-primary'}
              disabled={!stream || saving}
              onClick={() => void snap()}
              data-testid="capture-snap"
            >
              {saving && !recording ? 'Adding' : isDisplay ? 'Snap screenshot' : 'Snap photo'}
            </button>
          )}
          {canRecord &&
            (recording ? (
              <button
                type="button"
                className="sync-primary capture-stop"
                onClick={stopRecording}
                data-testid="capture-stop"
              >
                ■ Stop &amp; add
              </button>
            ) : (
              <button
                type="button"
                className="sync-primary"
                disabled={!stream || saving}
                onClick={() => void startRecording()}
                data-testid="capture-record"
              >
                {saving ? 'Adding' : '● Record'}
              </button>
            ))}
        </div>
      </div>
    </UiDialog>
  );
}
