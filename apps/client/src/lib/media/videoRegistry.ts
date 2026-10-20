/**
 * Maps a video item id to its on-canvas <video> element so the screen-space
 * control bar and the context menu can drive playback without threading refs
 * through the component tree. Populated by VideoContent's ref callback.
 */
const registry = new Map<string, HTMLVideoElement>();

export function registerVideo(id: string, el: HTMLVideoElement | null): void {
  if (el) registry.set(id, el);
  else registry.delete(id);
}

export function getVideo(id: string): HTMLVideoElement | null {
  return registry.get(id) ?? null;
}
