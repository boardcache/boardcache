import { useEffect, useRef, useState } from 'react';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { importAudioFiles } from '../../lib/import/importAudio';
import { importImageFiles } from '../../lib/import/importImages';
import { importVideoFiles } from '../../lib/import/importVideos';
import { desktopOs } from '../../lib/platform';
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
 * - Audio recording takes the microphone, the system's audio, or both: the
 *   system's audio comes through the screen-share picker (the only road a
 *   browser has to it; the desktop shell on Windows hands it over as
 *   loopback without a picker), mixed into one file or saved as two.
 */
export function CaptureDialog() {
  const mode = useSessionStore((s) => s.captureMode);
  return mode ? <CaptureBody key={mode} mode={mode} /> : null;
}

const TITLES: Record<CaptureMode, string> = {
  photo: 'Take Photo',
  video: 'Record Video',
  audio: 'Record Audio',
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
const AUDIO_MIC_KEY = 'boardcache:captureAudioMic';
const AUDIO_SEPARATE_KEY = 'boardcache:captureAudioSeparate';

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
  const isAudio = mode === 'audio';
  // Audio: the microphone is one of two sources, each its own switch.
  const [useMic, setUseMic] = useState(() => loadPref(AUDIO_MIC_KEY) !== 'off');
  const [useSystem, setUseSystem] = useState(false);
  const [separate, setSeparate] = useState(() => loadPref(AUDIO_SEPARATE_KEY) === 'on');
  const [systemStream, setSystemStream] = useState<MediaStream | null>(null);
  const [systemBusy, setSystemBusy] = useState(false);
  const [systemError, setSystemError] = useState<string | null>(null);
  const usesMic = mode === 'video' || (isAudio && useMic);
  const isDisplay = mode === 'screen' || mode === 'screenshot';
  const canSnap = !isAudio;
  const canRecord = mode === 'video' || isAudio || mode === 'screen';
  // The desktop shell on macOS and Linux has no system-audio loopback.
  const os = desktopOs();
  const noSystemAudio = os === 'darwin' || os === 'linux';

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
  const recordersRef = useRef<MediaRecorder[]>([]); // separate audio tracks
  const recordingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null); // mic/mixer/raf teardown
  const systemRef = useRef<MediaStream | null>(null);

  // Screen shares must not re-acquire when the mic prefs change — the mic is
  // attached at record time. Local devices re-acquire on source switch.
  const acquireKey = isDisplay ? 'display' : `${camId}|${micId}|${usesMic}`;

  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;
    // Audio with the microphone off: nothing to open here (the system's
    // audio is opened by its own switch); every reader of `stream` and
    // `error` is gated by `useMic`, so the stale ones do no harm.
    if (isAudio && !usesMic) return;
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
              : isAudio
                ? 'Microphone unavailable — check the browser permission.'
                : 'Camera unavailable — check the browser permission.',
          );
      });
    return () => {
      cancelled = true;
      recorderRef.current?.stop();
      recordersRef.current.forEach((r) => r.stop());
      recordersRef.current = [];
      cleanupRef.current?.();
      cleanupRef.current = null;
      acquired?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, acquireKey]);

  // The system's audio share ends with the dialog.
  useEffect(
    () => () => {
      systemRef.current?.getTracks().forEach((t) => t.stop());
      systemRef.current = null;
    },
    [],
  );

  /** The System audio switch: the share picker opens on the way in (the
   *  browser's only road to the system's sound; the desktop shell on
   *  Windows answers without one), the share ends on the way out. */
  const toggleSystem = async (on: boolean) => {
    setSystemError(null);
    if (!on) {
      systemRef.current?.getTracks().forEach((t) => t.stop());
      systemRef.current = null;
      setSystemStream(null);
      setUseSystem(false);
      return;
    }
    setUseSystem(true);
    setSystemBusy(true);
    try {
      // Browsers refuse audio-only display requests: ask for the video too
      // and let it go once the audio is in hand.
      const share = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const audio = share.getAudioTracks();
      share.getVideoTracks().forEach((t) => t.stop());
      if (audio.length === 0) {
        share.getTracks().forEach((t) => t.stop());
        setUseSystem(false);
        setSystemError('That share had no audio. Pick a tab, or share a screen with its audio.');
        return;
      }
      const only = new MediaStream(audio);
      // Stopped from the browser's own sharing bar: the source is gone.
      audio[0]!.addEventListener('ended', () => {
        if (systemRef.current !== only) return;
        systemRef.current = null;
        setSystemStream(null);
        setUseSystem(false);
        if (recordingRef.current) stopRecording();
      });
      systemRef.current = only;
      setSystemStream(only);
    } catch {
      setUseSystem(false);
      setSystemError('System audio was cancelled or is unavailable.');
    } finally {
      setSystemBusy(false);
    }
  };

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

  /** Audio: the microphone, the system's audio, or both — mixed into one
   *  file, or each its own file when asked. */
  const startAudioRecording = () => {
    const mic = useMic && stream ? stream.getAudioTracks() : [];
    const sys = systemStream?.getAudioTracks() ?? [];
    if (mic.length === 0 && sys.length === 0) return;
    const teardown: (() => void)[] = [];
    const mimeType = pickMime(['audio/webm;codecs=opus', 'audio/webm']);
    const type = mimeType ?? 'audio/webm';
    const sources: { name: string; tracks: MediaStreamTrack[] }[] =
      separate && mic.length && sys.length
        ? [
            { name: 'microphone.webm', tracks: mic },
            { name: 'system-audio.webm', tracks: sys },
          ]
        : [{ name: 'audio-recording.webm', tracks: [...mic, ...sys] }];
    const files: File[] = [];
    let open = sources.length;
    const recorders = sources.map(({ name, tracks }) => {
      let audioTracks = tracks;
      // MediaRecorder records one audio track; merge several via WebAudio.
      if (audioTracks.length > 1) {
        const ac = new AudioContext();
        const dest = ac.createMediaStreamDestination();
        for (const track of audioTracks)
          ac.createMediaStreamSource(new MediaStream([track])).connect(dest);
        audioTracks = dest.stream.getAudioTracks();
        teardown.push(() => void ac.close());
      }
      const recorder = new MediaRecorder(
        new MediaStream(audioTracks),
        mimeType ? { mimeType } : undefined,
      );
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || type });
        if (blob.size > 0) files.push(new File([blob], name, { type: blob.type }));
        if (--open > 0) return;
        // The last recorder done: tear down and add what was taken.
        recordingRef.current = false;
        cleanupRef.current?.();
        cleanupRef.current = null;
        void (async () => {
          setSaving(true);
          if (files.length) await importAudioFiles(files, viewCenter());
          close();
        })();
      };
      return recorder;
    });
    cleanupRef.current = () => teardown.forEach((fn) => fn());
    recordersRef.current = recorders;
    recordingRef.current = true;
    recorders.forEach((r) => r.start());
    setElapsed(0);
    setRecording(true);
  };

  const startRecording = async () => {
    if (isAudio) {
      startAudioRecording();
      return;
    }
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

    const mimeType = pickMime([
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ]);
    const recorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
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
        const type = recorder.mimeType || 'video/webm';
        const blob = new Blob(chunks, { type });
        if (blob.size > 0) {
          const name = mode === 'screen' ? 'screen-recording.webm' : 'webcam-recording.webm';
          await importVideoFiles([new File([blob], name, { type })], viewCenter());
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
    recordersRef.current.forEach((r) => r.stop());
    recordersRef.current = [];
  };

  // What the Record button needs: a source that is open.
  const ready = isAudio ? (useMic && !!stream) || !!systemStream : !!stream;

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
        {error && !isAudio ? (
          <p className="sync-error" role="alert" data-testid="capture-error">
            {error}
          </p>
        ) : isAudio ? (
          <div className="capture-voice" data-testid="capture-audio">
            <span className={`capture-mic${recording ? ' live' : ''}`}>
              <MicIcon size={30} />
            </span>
            <span className="capture-timer" data-testid="capture-audio-status">
              {recording
                ? mmss
                : ready
                  ? 'Ready'
                  : useMic && !error
                    ? 'Opening the microphone'
                    : 'Pick a source'}
            </span>
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
        {(!error || isAudio) && !recording && (
          <>
            {isAudio && (
              <>
                <label className="capture-check">
                  <input
                    type="checkbox"
                    checked={useMic}
                    data-testid="capture-audio-mic"
                    onChange={(e) => {
                      savePref(AUDIO_MIC_KEY, e.target.checked ? 'on' : 'off');
                      setUseMic(e.target.checked);
                    }}
                  />
                  <span>Microphone</span>
                </label>
                {useMic && mics.length > 1 && (
                  <label className="capture-source capture-sub">
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
                {error && useMic && (
                  <p className="sync-error capture-note" role="alert" data-testid="capture-error">
                    {error}
                  </p>
                )}
                <label className="capture-check">
                  <input
                    type="checkbox"
                    checked={useSystem}
                    disabled={noSystemAudio || systemBusy}
                    data-testid="capture-audio-system"
                    onChange={(e) => void toggleSystem(e.target.checked)}
                  />
                  <span>System audio</span>
                </label>
                {noSystemAudio ? (
                  <p className="capture-note" data-testid="capture-audio-note">
                    {os === 'darwin' ? 'macOS' : 'Linux'} gives apps no way to record the system’s
                    audio. Install a loopback device, such as BlackHole, and pick it as the
                    microphone.
                  </p>
                ) : systemError ? (
                  <p className="sync-error capture-note" role="alert" data-testid="capture-error">
                    {systemError}
                  </p>
                ) : useSystem && !systemStream ? (
                  <p className="capture-note" data-testid="capture-audio-note">
                    Pick a tab, or a screen, and turn on its audio in the picker.
                  </p>
                ) : systemStream ? (
                  <p className="capture-note" data-testid="capture-audio-note">
                    System audio is ready.
                  </p>
                ) : null}
                {useMic && systemStream && (
                  <label className="capture-check">
                    <input
                      type="checkbox"
                      checked={separate}
                      data-testid="capture-audio-separate"
                      onChange={(e) => {
                        savePref(AUDIO_SEPARATE_KEY, e.target.checked ? 'on' : 'off');
                        setSeparate(e.target.checked);
                      }}
                    />
                    <span>Save as separate tracks</span>
                  </label>
                )}
              </>
            )}
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
            {!isAudio && (usesMic || (mode === 'screen' && screenMic)) && mics.length > 1 && (
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
              disabled={!ready || saving}
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
                disabled={!ready || saving}
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
