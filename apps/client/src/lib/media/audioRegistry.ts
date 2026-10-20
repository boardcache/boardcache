import { acquireAssetUrl, releaseAssetUrl } from '../board/assetStore';
import { VIEWER, viewerAssetUrl } from '../viewerMode';
import { bindPlaybackMemory } from './playbackMemory';

/**
 * Shared audio elements, one per audio item, owned by this registry rather
 * than any React component. The canvas card and the lightbox stage are both
 * just *controllers* of the same element, so:
 *
 * - playback survives opening/closing the lightbox, selection changes, and
 *   re-renders — nothing but the play/pause button (or deleting the item /
 *   leaving the board) interrupts it;
 * - several clips can play at once (no one-at-a-time arbitration);
 * - every view of an item is inherently in sync — same element, same events.
 *
 * Elements live detached from the DOM (media elements keep playing without a
 * DOM parent). The registry owns the object-URL lease so playback keeps its
 * source even when every component using the asset has unmounted.
 */
interface SharedAudio {
  el: HTMLAudioElement;
  assetId: string;
  unbindMemory: () => void;
}

const shared = new Map<string, SharedAudio>();

/**
 * The shared element for an item, created (and its source loaded) on first
 * use. When `assetId` changes for the same item (playlists switching tracks),
 * the old element is disposed and a fresh one returned.
 */
export function sharedAudio(itemId: string, assetId: string): HTMLAudioElement {
  const existing = shared.get(itemId);
  if (existing && existing.assetId === assetId) return existing.el;
  if (existing) disposeSharedAudio(itemId);
  const el = new Audio();
  el.preload = 'metadata';
  // Resume where this item/track last left off (per device).
  const unbindMemory = bindPlaybackMemory(el, `${itemId}:${assetId}`);
  const entry: SharedAudio = { el, assetId, unbindMemory };
  shared.set(itemId, entry);
  // The read-only viewer has no asset store: its assets are plain URLs.
  if (VIEWER) {
    const url = viewerAssetUrl(assetId);
    if (url) el.src = url;
    return el;
  }
  void acquireAssetUrl(assetId).then((url) => {
    if (shared.get(itemId) !== entry) {
      if (url) releaseAssetUrl(assetId);
      return;
    }
    if (url) el.src = url;
  });
  return el;
}

export function getSharedAudio(itemId: string): HTMLAudioElement | null {
  return shared.get(itemId)?.el ?? null;
}

function disposeSharedAudio(itemId: string): void {
  const entry = shared.get(itemId);
  if (!entry) return;
  entry.unbindMemory(); // saves the final position
  entry.el.pause();
  entry.el.removeAttribute('src');
  if (!VIEWER) releaseAssetUrl(entry.assetId);
  shared.delete(itemId);
}

/** Drop elements whose items no longer exist; `null` disposes everything
 *  (board switch). Called from the document-store subscription. */
export function pruneSharedAudio(liveIds: Set<string> | null): void {
  for (const id of [...shared.keys()]) {
    if (!liveIds || !liveIds.has(id)) disposeSharedAudio(id);
  }
}
