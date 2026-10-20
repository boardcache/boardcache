import type { AudioItem } from '@boardcache/schema';
import { setAudioPlayback } from '../../state/commands';

/** Selectable playback speeds, cycled by the speed button. */
/** The speeds a player's rate button cycles through (audio and video alike). */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const AUDIO_RATES = PLAYBACK_RATES;

/** Min height (canvas units) below which the player's content would clip. */
export const AUDIO_MIN_HEIGHT = 104;

/** Push the item's stored playback settings onto an <audio> element. */
export function applyAudioProps(el: HTMLAudioElement | null, item: AudioItem): void {
  if (!el) return;
  el.volume = item.volume;
  el.muted = item.muted;
  el.loop = item.loop;
  el.playbackRate = item.playbackRate;
}

export function togglePlay(el: HTMLAudioElement | null): void {
  if (!el) return;
  if (el.paused) void el.play().catch(() => {});
  else el.pause();
}

export function toggleLoop(item: AudioItem, el: HTMLAudioElement | null): void {
  const loop = !item.loop;
  if (el) el.loop = loop;
  setAudioPlayback(item.id, { loop });
}

export function toggleMute(item: AudioItem, el: HTMLAudioElement | null): void {
  const muted = !item.muted;
  const patch: { muted: boolean; volume?: number } = { muted };
  // Un-muting at zero volume would be silent — give it some level.
  if (!muted && item.volume === 0) patch.volume = 1;
  if (el) {
    el.muted = muted;
    if (patch.volume !== undefined) el.volume = patch.volume;
  }
  setAudioPlayback(item.id, patch);
}

/** Set volume (0 also mutes); applies live and persists without an undo step. */
export function setVolume(item: AudioItem, el: HTMLAudioElement | null, volume: number): void {
  const v = Math.max(0, Math.min(1, volume));
  const muted = v === 0;
  if (el) {
    el.volume = v;
    el.muted = muted;
  }
  setAudioPlayback(item.id, { volume: v, muted });
}

/** Advance to the next playback speed (wraps). */
export function cycleRate(item: AudioItem, el: HTMLAudioElement | null): void {
  const idx = AUDIO_RATES.indexOf(item.playbackRate as (typeof AUDIO_RATES)[number]);
  const rate = AUDIO_RATES[(idx + 1) % AUDIO_RATES.length] ?? 1;
  if (el) el.playbackRate = rate;
  setAudioPlayback(item.id, { playbackRate: rate });
}
