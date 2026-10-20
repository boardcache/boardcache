import type { GenInfo, VideoEmbed, VideoItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { putAsset } from '../board/assetStore';
import type { Point } from '../canvas/coords';
import { addItems, topZIndex, updateItems } from '../../state/commands';
import { openSpotNear, reserveNext } from '../canvas/placeSpot';
import type { ReservedBox } from '../canvas/placeSpot';
import { fetchEmbedTitle } from '../media/videoEmbed';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/** Longest display side for a freshly placed video, in canvas units. */
const MAX_PLACED_SIZE = 720;
const DEFAULT_EMBED_SIZE = { width: 560, height: 315 };

interface VideoMeta {
  width: number;
  height: number;
  /** First-frame poster as a JPEG blob, or null if it couldn't be captured. */
  poster: Blob | null;
}

/** A wait the browser might never end (a seek in a file with no index) gives up instead. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms)),
  ]);
}

/**
 * Probe a video blob for dimensions and capture a poster frame. Every wait
 * is bounded: a MediaRecorder file (webcam, screen, voice) has no duration
 * or seek index yet, and a seek into one can hang forever — the item must
 * still land, poster or not.
 */
async function probeVideo(blob: Blob): Promise<VideoMeta> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.crossOrigin = 'anonymous';
  video.src = url;
  try {
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('Cannot decode video'));
        }),
        10_000,
        'decode',
      );
    } catch (err) {
      // Undecodable: give up. Merely slow: carry on with what the element knows.
      if (!(err instanceof Error && err.message.endsWith('timed out'))) throw err;
    }
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;

    let poster: Blob | null = null;
    try {
      const seek = (t: number) =>
        withTimeout(
          new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = () => reject(new Error('seek failed'));
            video.currentTime = t;
          }),
          1500,
          'seek',
        );
      // Reels and trailers often fade in from black — walk a few timestamps
      // and take the first frame with real content (cheap 32px luma check).
      const probe = document.createElement('canvas');
      probe.width = 32;
      probe.height = 32;
      const pctx = probe.getContext('2d', { willReadFrequently: true })!;
      const meanLuma = () => {
        pctx.drawImage(video, 0, 0, 32, 32);
        const d = pctx.getImageData(0, 0, 32, 32).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          sum += d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
        }
        return sum / (d.length / 4);
      };
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      // No known duration (a fresh recording): the first decoded frame is
      // the poster — seeking such a file is what used to hang.
      const candidates = dur > 0.5 ? [Math.min(1, dur * 0.1), dur * 0.25, dur * 0.5] : [];
      for (const t of candidates) {
        try {
          await seek(t);
        } catch {
          break; // keep whatever frame is showing
        }
        if (meanLuma() > 10) break; // found a lit frame; else keep walking
      }
      if (video.readyState < 2) throw new Error('no frame to draw');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(video, 0, 0, width, height);
      poster = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), 'image/jpeg', 0.82),
      );
    } catch {
      /* poster is cosmetic — proceed without it */
    }
    return { width, height, poster };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
  }
}

function placedSize(w: number, h: number) {
  const longest = Math.max(w, h);
  const scale = longest > MAX_PLACED_SIZE ? MAX_PLACED_SIZE / longest : 1;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Import local video files: store the blob + a generated poster, place items. */
/** Placeholder box size while a video probes (16:9, in canvas units). */
const PENDING_VIDEO = { width: 320, height: 180 };

/**
 * Show a placeholder immediately, then probe (load metadata + grab a poster —
 * the slow part) in the background and swap in the real video item. Without
 * this the video wouldn't appear until probing finished, sometimes seconds.
 */
async function importOneVideo(file: File, at: Point, genInfo?: GenInfo): Promise<void> {
  const pendingId = newId();
  useSessionStore.getState().addPendingImport({
    id: pendingId,
    x: at.x - PENDING_VIDEO.width / 2,
    y: at.y - PENDING_VIDEO.height / 2,
    width: PENDING_VIDEO.width,
    height: PENDING_VIDEO.height,
    label: 'Loading video',
    name: file.name || 'video',
  });
  // Let the placeholder paint before the (potentially heavy) decode begins.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  try {
    const assetId = await putAsset(file);
    const meta = await probeVideo(file);
    const posterAssetId = meta.poster ? await putAsset(meta.poster) : null;
    const { width, height } = placedSize(meta.width, meta.height);
    const { doc } = useDocumentStore.getState();
    // The placeholder reserved a 16:9 guess — settle at the real size.
    const spot = openSpotNear(at, width, height);
    const item: VideoItem = {
      id: newId(),
      type: 'video',
      x: spot.x - width / 2,
      y: spot.y - height / 2,
      width,
      height,
      rotation: 0,
      zIndex: topZIndex(doc) + 1,
      locked: false,
      opacity: 1,
      groupId: null,
      name: file.name || undefined,
      assetId,
      posterAssetId,
      embed: null,
      naturalWidth: meta.width,
      naturalHeight: meta.height,
      // Autoplay on the canvas only works muted; loop so it keeps going.
      muted: true,
      volume: 1,
      loop: true,
      playbackRate: 1,
      transcript: null,
      transcriptSegments: null,
      markers: [],
      ...(genInfo ? { genInfo } : {}),
    };
    addItems([item], 'Add video');
    useSessionStore.getState().removePendingImport(pendingId);
    useSessionStore.getState().setSelection([item.id]);
  } catch (err) {
    console.error(`boardCache: could not import video "${file.name}"`, err);
    useSessionStore
      .getState()
      .updatePendingImport(pendingId, { label: 'Couldn’t load video', error: true });
    setTimeout(() => useSessionStore.getState().removePendingImport(pendingId), 4500);
  }
}

export async function importVideoFiles(
  files: File[],
  dropPoint: Point,
  opts?: { genInfo?: GenInfo },
): Promise<string[]> {
  const videoFiles = files.filter((f) => f.type.startsWith('video/'));
  if (videoFiles.length === 0) return [];

  // Each video probes in the background behind its own placeholder, so a mixed
  // drop's images/PDFs aren't held up and the video boxes appear immediately.
  const reserved: ReservedBox[] = [];
  for (const file of videoFiles) {
    void importOneVideo(
      file,
      reserveNext(reserved, dropPoint, PENDING_VIDEO.width, PENDING_VIDEO.height),
      opts?.genInfo,
    );
  }
  return [];
}

/** Create a provider-embed (YouTube/Vimeo) video item at a canvas point. */
export function createVideoEmbed(embed: VideoEmbed, at: Point, name?: string): string {
  const { doc } = useDocumentStore.getState();
  const { width, height } = DEFAULT_EMBED_SIZE;
  at = openSpotNear(at, width, height);
  const item: VideoItem = {
    id: newId(),
    type: 'video',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    ...(name !== undefined ? { name } : {}),
    assetId: null,
    posterAssetId: null,
    embed,
    naturalWidth: 1280,
    naturalHeight: 720,
    muted: false,
    volume: 1,
    loop: false,
    playbackRate: 1,
    transcript: null,
    transcriptSegments: null,
    markers: [],
  };
  addItems([item], 'Add video embed');
  useSessionStore.getState().setSelection([item.id]);
  // Default the label to the real video title (best-effort, async).
  if (name === undefined) {
    void fetchEmbedTitle(embed).then((title) => {
      if (title) {
        updateItems([item.id], 'Set video title', (it) => {
          if (it.type === 'video' && !it.name) it.name = title;
        });
      }
    });
  }
  return item.id;
}
