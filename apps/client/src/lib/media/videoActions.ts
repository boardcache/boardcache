import type { VideoItem } from '@boardcache/schema';
import { getAssetBlob, putAsset } from '../board/assetStore';
import { importImageFiles } from '../import/importImages';
import { setVideoAudio, updateItems } from '../../state/commands';
import { PLAYBACK_RATES } from './audioActions';

/** Most web video is 24–30fps; we step a nominal frame for forward/back. */
const FRAME_STEP = 1 / 30;

export function togglePlay(el: HTMLVideoElement | null): void {
  if (!el) return;
  if (el.paused) void el.play().catch(() => {});
  else el.pause();
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
