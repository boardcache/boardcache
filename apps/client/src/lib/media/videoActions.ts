import type { VideoItem } from '@boardcache/schema';
import { getAssetBlob, putAsset } from '../board/assetStore';
import { importImageFiles } from '../import/importImages';
import { importVideoFiles } from '../import/importVideos';
import { showNotice } from '../notices';
import { setVideoAudio, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { PLAYBACK_RATES } from './audioActions';

/** Most web video is 24–30fps; we step a nominal frame for forward/back. */
const FRAME_STEP = 1 / 30;

export function togglePlay(el: HTMLVideoElement | null): void {
  if (!el) return;
  // Play forward out of a reverse run.
  if (isReversing(el)) {
    stopReverse(el);
    void el.play().catch(() => {});
    return;
  }
  if (el.paused) void el.play().catch(() => {});
  else el.pause();
}

// --- reverse playback --------------------------------------------------------
// Browsers refuse a negative playbackRate, so reverse is the element paused
// with its time stepped back on every frame (silent, like a scrub). The
// `bc-reverse` event on the element tells the control bar to redraw.

const reversing = new Map<HTMLVideoElement, number>();

export function isReversing(el: HTMLVideoElement | null): boolean {
  return !!el && reversing.has(el);
}

function stopReverse(el: HTMLVideoElement | null): void {
  if (!el) return;
  const raf = reversing.get(el);
  if (raf === undefined) return;
  cancelAnimationFrame(raf);
  reversing.delete(el);
  el.dispatchEvent(new Event('bc-reverse'));
}

/** Start (or stop) playing backwards at the item's speed; at the start it
 *  wraps to the end when the video loops (or to B inside an A/B loop), else stops. */
export function toggleReverse(item: VideoItem, el: HTMLVideoElement | null): void {
  if (!el) return;
  if (isReversing(el)) {
    stopReverse(el);
    return;
  }
  el.pause();
  let last = performance.now();
  const tick = (now: number) => {
    const live = useDocumentStore.getState().doc.items[item.id];
    const it = live?.type === 'video' ? live : item;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const lo = it.abLoop ? it.abLoop.a : 0;
    const hi = it.abLoop ? it.abLoop.b : Number.isFinite(el.duration) ? el.duration : 0;
    let t = el.currentTime - dt * rateOf(it);
    if (t <= lo) {
      if (it.loop || it.abLoop) t = hi;
      else {
        el.currentTime = lo;
        stopReverse(el);
        return;
      }
    }
    el.currentTime = t;
    reversing.set(el, requestAnimationFrame(tick));
  };
  reversing.set(el, requestAnimationFrame(tick));
  el.dispatchEvent(new Event('bc-reverse'));
}

// --- A/B points -------------------------------------------------------------

/** Set the A or B point at the element's time (the other end defaults to the
 *  start or the end); A and B keep their order. */
export function setAbPoint(item: VideoItem, el: HTMLVideoElement | null, which: 'a' | 'b'): void {
  if (!el) return;
  const t = el.currentTime;
  const end = Number.isFinite(el.duration) ? el.duration : t;
  const prev = item.abLoop ?? { a: 0, b: end };
  const next = which === 'a' ? { a: t, b: prev.b } : { a: prev.a, b: t };
  if (next.b < next.a) [next.a, next.b] = [next.b, next.a];
  updateItems([item.id], which === 'a' ? 'Set A point' : 'Set B point', (it) => {
    if (it.type === 'video') it.abLoop = next;
  });
}

export function clearAbPoints(item: VideoItem): void {
  updateItems([item.id], 'Clear A/B points', (it) => {
    if (it.type === 'video') it.abLoop = null;
  });
}

/** Keep forward playback between the item's A/B points; returns the cleanup.
 *  Reads the live item on every tick, so a change of points applies at once. */
export function attachAbLoop(el: HTMLVideoElement, itemId: string): () => void {
  const onTime = () => {
    const it = useDocumentStore.getState().doc.items[itemId];
    if (it?.type !== 'video' || !it.abLoop || el.paused || isReversing(el)) return;
    const { a, b } = it.abLoop;
    if (b <= a) return;
    if (el.currentTime >= b || el.currentTime < a - 0.5) el.currentTime = a;
  };
  el.addEventListener('timeupdate', onTime);
  return () => el.removeEventListener('timeupdate', onTime);
}

// --- cut a clip -------------------------------------------------------------

type CaptureVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

/** Can this browser record a video element's output (the clip cutter's way)? */
export function canCutClips(): boolean {
  const proto = HTMLVideoElement.prototype as unknown as CaptureVideo;
  return (
    typeof MediaRecorder !== 'undefined' &&
    (typeof proto.captureStream === 'function' || typeof proto.mozCaptureStream === 'function')
  );
}

function once(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve) => el.addEventListener(event, () => resolve(), { once: true }));
}

const mmss = (s: number) => `${Math.floor(s / 60)}-${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Cut the A/B range out as a new video beside this one. The browser has no
 * cutter, so the range is played once, offscreen and silent, and recorded
 * from the element's output (picture and sound) — it takes as long as the
 * clip does.
 */
export async function cutClip(item: VideoItem): Promise<string | null> {
  const ab = item.abLoop;
  if (!ab || ab.b <= ab.a || !item.assetId || !canCutClips()) return null;
  const blob = await getAssetBlob(item.assetId);
  if (!blob) throw new Error('The video file is unavailable.');
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video') as CaptureVideo;
  v.src = url;
  v.muted = true; // the capture carries the sound; the page stays quiet
  v.playsInline = true;
  v.preload = 'auto';
  v.style.cssText = 'position:fixed;left:-9999px;top:0;width:4px;height:4px;opacity:0';
  document.body.appendChild(v);
  showNotice('Cutting the clip', { id: `cut-${item.id}`, kind: 'info', sticky: true });
  try {
    await once(v, 'loadedmetadata');
    v.currentTime = ab.a;
    await once(v, 'seeked');
    const stream = (v.captureStream ?? v.mozCaptureStream)!.call(v);
    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      v.pause();
      if (rec.state !== 'inactive') rec.stop();
    };
    v.addEventListener('timeupdate', () => {
      if (v.currentTime >= ab.b) stop();
    });
    v.addEventListener('ended', stop);
    rec.start(200);
    await v.play();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    const type = rec.mimeType || 'video/webm';
    const out = new Blob(chunks, { type });
    if (out.size === 0) throw new Error('Nothing was recorded.');
    const base = (item.name?.trim() || 'clip').replace(/\.[a-z0-9]+$/i, '');
    const file = new File([out], `${base} ${mmss(ab.a)} to ${mmss(ab.b)}.webm`, { type });
    const [id] = await importVideoFiles([file], {
      x: item.x + item.width + 40,
      y: item.y,
    });
    showNotice('Clip added beside the video', { id: `cut-${item.id}`, kind: 'info' });
    return id ?? null;
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'The clip could not be cut.', {
      id: `cut-${item.id}`,
      kind: 'warn',
    });
    return null;
  } finally {
    v.remove();
    URL.revokeObjectURL(url);
  }
}

/** Pause and nudge one nominal frame forward (1) or back (-1). */
export function stepFrame(el: HTMLVideoElement | null, dir: 1 | -1): void {
  if (!el) return;
  el.pause();
  const max = Number.isFinite(el.duration) ? el.duration : el.currentTime + FRAME_STEP;
  el.currentTime = Math.max(0, Math.min(max, el.currentTime + dir * FRAME_STEP));
}

/** Toggle loop on the element AND persist it on the item. */
export function toggleLoop(item: VideoItem, el: HTMLVideoElement | null): void {
  const loop = !item.loop;
  if (el) el.loop = loop;
  updateItems([item.id], loop ? 'Loop on' : 'Loop off', (it) => {
    if (it.type === 'video') it.loop = loop;
  });
}

/** Push the item's stored muted/volume onto a <video> element. */
/** The item's speed, 1 for a video made before the field existed (items
 *  built in-session skip schema defaults). */
export function rateOf(item: VideoItem): number {
  return Number.isFinite(item.playbackRate) ? item.playbackRate : 1;
}

export function applyAudio(el: HTMLVideoElement | null, item: VideoItem): void {
  if (!el) return;
  el.muted = item.muted;
  el.volume = item.volume;
  el.playbackRate = rateOf(item);
}

/** Advance to the next playback speed (wraps) — same steps as audio. */
export function cycleRate(item: VideoItem, el: HTMLVideoElement | null): void {
  const idx = PLAYBACK_RATES.indexOf(rateOf(item) as (typeof PLAYBACK_RATES)[number]);
  const rate = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length] ?? 1;
  if (el) el.playbackRate = rate;
  setVideoAudio(item.id, { playbackRate: rate });
}

export function toggleMute(item: VideoItem, el: HTMLVideoElement | null): void {
  const muted = !item.muted;
  if (el) el.muted = muted;
  const patch: { muted: boolean; volume?: number } = { muted };
  // Un-muting at zero volume would be silent — bump it so there's sound.
  if (!muted && item.volume === 0) {
    if (el) el.volume = 1;
    patch.volume = 1;
  }
  setVideoAudio(item.id, patch);
}

/** Set volume (0 also mutes); applies live and persists without an undo step. */
export function setVolume(item: VideoItem, el: HTMLVideoElement | null, volume: number): void {
  const v = Math.max(0, Math.min(1, volume));
  const muted = v === 0;
  if (el) {
    el.volume = v;
    el.muted = muted;
  }
  setVideoAudio(item.id, { volume: v, muted });
}

/** Fullscreen the video, enabling native controls only while fullscreen. */
export function fullscreenVideo(el: HTMLVideoElement | null): void {
  if (!el?.requestFullscreen) return;
  el.controls = true;
  const onChange = () => {
    if (!document.fullscreenElement) {
      el.controls = false;
      document.removeEventListener('fullscreenchange', onChange);
    }
  };
  document.addEventListener('fullscreenchange', onChange);
  void el.requestFullscreen().catch(() => {
    el.controls = false;
    document.removeEventListener('fullscreenchange', onChange);
  });
}

function frameBlob(
  el: HTMLVideoElement,
  type = 'image/png',
  quality?: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = el.videoWidth || 640;
  canvas.height = el.videoHeight || 360;
  canvas.getContext('2d')!.drawImage(el, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b), type, quality));
}

/** Add a new image item to the canvas from the video's current frame. */
export async function captureFrameToImage(
  item: VideoItem,
  el: HTMLVideoElement | null,
): Promise<void> {
  if (!el || !el.videoWidth) return;
  const blob = await frameBlob(el, 'image/png');
  if (!blob) return;
  const file = new File([blob], `${item.name ?? 'frame'}.png`, { type: 'image/png' });
  // Drop it just to the right of the video.
  const placed = Math.min(item.width, 1024);
  await importImageFiles([file], {
    x: item.x + item.width + 24 + placed / 2,
    y: item.y + item.height / 2,
  });
}

export async function setPosterFromBlob(item: VideoItem, blob: Blob): Promise<void> {
  const assetId = await putAsset(blob);
  updateItems([item.id], 'Set poster', (it) => {
    if (it.type === 'video') it.posterAssetId = assetId;
  });
}

/** Pull one JPEG frame at each requested time (offscreen element; playback
 *  on the canvas is untouched). Times clamp into the video's duration. */
export async function framesAtTimes(item: VideoItem, times: number[]): Promise<Blob[]> {
  if (!item.assetId || times.length === 0) return [];
  const blob = await getAssetBlob(item.assetId);
  if (!blob) return [];
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.src = url;
  v.muted = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  try {
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('Cannot decode video'));
    });
    // MediaRecorder webms often report Infinity — seek raw times there.
    const dur = Number.isFinite(v.duration) ? v.duration : null;
    const out: Blob[] = [];
    for (const t of times) {
      await new Promise<void>((res) => {
        v.onseeked = () => res();
        const clamped =
          dur === null ? Math.max(0, t) : Math.min(Math.max(0, t), Math.max(0, dur - 0.05));
        v.currentTime = clamped;
      });
      const b = await frameBlob(v, 'image/jpeg', 0.85);
      if (b) out.push(b);
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
    v.load();
  }
}

export interface PosterFrame {
  time: number;
  previewUrl: string;
  blob: Blob;
}

/**
 * Pull `count` evenly-spaced frames from the video (via an offscreen element,
 * so on-canvas playback isn't disturbed) for the poster picker. Caller revokes
 * the returned previewUrls.
 */
export async function extractPosterFrames(item: VideoItem, count = 6): Promise<PosterFrame[]> {
  if (!item.assetId) return [];
  const blob = await getAssetBlob(item.assetId);
  if (!blob) return [];
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.src = url;
  v.muted = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  try {
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('Cannot decode video'));
    });
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    const frames: PosterFrame[] = [];
    for (let i = 0; i < count; i++) {
      const t = (dur * (i + 1)) / (count + 1);
      await new Promise<void>((res) => {
        v.onseeked = () => res();
        v.currentTime = Math.min(t, Math.max(0, dur - 0.05));
      });
      const b = await frameBlob(v, 'image/jpeg', 0.85);
      if (b) frames.push({ time: t, previewUrl: URL.createObjectURL(b), blob: b });
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
    v.load();
  }
}
