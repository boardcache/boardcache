import { getSharedAudio } from './audioRegistry';

/**
 * Seek bridge for transcript click-to-seek: lightbox VIDEO stages register
 * their element here (audio already has a persistent shared element in
 * audioRegistry). Side panels seek by item id without prop-drilling media
 * elements through the lightbox tree.
 */

const videoEls = new Map<string, HTMLVideoElement>();

export function registerLightboxVideo(itemId: string, el: HTMLVideoElement | null): void {
  if (el) videoEls.set(itemId, el);
  else videoEls.delete(itemId);
}

/** Seek the item's live media element and play. False = nothing to drive. */
export function seekMedia(itemId: string, seconds: number): boolean {
  const video = videoEls.get(itemId);
  if (video) {
    video.currentTime = seconds;
    void video.play().catch(() => undefined);
    return true;
  }
  const audio = getSharedAudio(itemId);
  if (audio) {
    audio.currentTime = seconds;
    void audio.play().catch(() => undefined);
    return true;
  }
  return false;
}
