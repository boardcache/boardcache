import type { GenInfo, ImageItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { putAsset } from '../board/assetStore';
import type { Point } from '../canvas/coords';
import { heicFileToJpeg, heicLibLoaded, isHeicFile } from '../media/heic';
import { sniffPanoXmp } from '../media/pano';
import { addItems, topZIndex } from '../../state/commands';
import { reserveNext } from '../canvas/placeSpot';
import type { ReservedBox } from '../canvas/placeSpot';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/** Longest display side for a freshly imported image, in canvas units. */
const MAX_PLACED_SIZE = 1024;
/** Cascade offset when several files are dropped together. */
/** Placeholder box size while a HEIC converts (canvas units). */
const PENDING_SIZE = { width: 280, height: 190 };

async function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    // Fallback for formats createImageBitmap rejects.
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Not a decodable image'));
      };
      img.src = url;
    });
  }
}

function placedSize(natural: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const longest = Math.max(natural.width, natural.height);
  const scale = longest > MAX_PLACED_SIZE ? MAX_PLACED_SIZE / longest : 1;
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

/**
 * Import image files dropped/pasted/picked at a canvas point: store blobs in
 * the content-addressed asset store, then add all resulting items as ONE
 * command (one undo step per drop). Returns the new item ids.
 */
/** Longest edge of the on-canvas display rendition. */
const PREVIEW_MAX = 2048;

/**
 * Downscaled WebP rendition for canvas/gallery display (the original stays
 * for lightbox + exports). Skipped for images already small enough, and for
 * SVG (vector) / GIF (would lose animation). Returns null when not needed.
 */
async function makePreviewAsset(
  blob: Blob,
  natural: { width: number; height: number },
): Promise<string | null> {
  const longest = Math.max(natural.width, natural.height);
  if (longest <= PREVIEW_MAX) return null;
  if (blob.type === 'image/svg+xml' || blob.type === 'image/gif') return null;
  try {
    const scale = PREVIEW_MAX / longest;
    const bmp = await createImageBitmap(blob, {
      resizeWidth: Math.round(natural.width * scale),
      resizeHeight: Math.round(natural.height * scale),
      resizeQuality: 'high',
    });
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
    if (!webp || webp.size >= blob.size) return null; // no win — use the original
    return await putAsset(webp);
  } catch {
    return null; // previews are an optimization, never a blocker
  }
}

function imageItemFrom(
  file: File,
  assetId: string,
  natural: { width: number; height: number },
  zIndex: number,
  at: Point,
  previewAssetId: string | null = null,
  pano = false,
): ImageItem {
  const { width, height } = placedSize(natural);
  return {
    id: newId(),
    type: 'image',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex,
    locked: false,
    opacity: 1,
    groupId: null,
    name: file.name || undefined,
    assetId,
    ...(previewAssetId ? { previewAssetId } : {}),
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    crop: null,
    filters: null,
    flipH: false,
    flipV: false,
    caption: false,
    captionCorner: 'bl' as const,
    captionPlacement: 'inside',
    captionWrap: true,
    captionOpacity: 0.7,
    ocrText: null,
    description: null,
    // XMP-marked 360 photos force the pano player on; everything else
    // stays on the aspect-ratio auto-detect (field absent).
    ...(pano ? { pano: true } : {}),
  };
}

/**
 * Convert a HEIC/HEIF to JPEG behind a canvas placeholder that reports the
 * stage (downloading the converter, then converting), then add the image.
 */
async function importHeicFile(file: File, at: Point): Promise<void> {
  const session = useSessionStore.getState();
  const pendingId = newId();
  const heicLabel = (stage: 'downloading' | 'converting') =>
    stage === 'downloading' ? 'Downloading HEIC converter' : 'Converting HEIC';
  session.addPendingImport({
    id: pendingId,
    x: at.x - PENDING_SIZE.width / 2,
    y: at.y - PENDING_SIZE.height / 2,
    width: PENDING_SIZE.width,
    height: PENDING_SIZE.height,
    label: heicLabel(heicLibLoaded() ? 'converting' : 'downloading'),
    name: file.name || 'HEIC image',
  });
  // Let the placeholder paint before libheif's (synchronous) decode blocks.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  try {
    const jpeg = await heicFileToJpeg(file, (stage) =>
      useSessionStore.getState().updatePendingImport(pendingId, { label: heicLabel(stage) }),
    );
    const [assetId, natural] = await Promise.all([putAsset(jpeg), imageDimensions(jpeg)]);
    const zIndex = topZIndex(useDocumentStore.getState().doc) + 1;
    const previewAssetId = await makePreviewAsset(jpeg, natural);
    const item = imageItemFrom(jpeg, assetId, natural, zIndex, at, previewAssetId);
    addItems([item], 'Add image');
    useSessionStore.getState().removePendingImport(pendingId);
    useSessionStore.getState().setSelection([item.id]);
  } catch (err) {
    console.error(`boardCache: could not convert HEIC "${file.name}"`, err);
    useSessionStore
      .getState()
      .updatePendingImport(pendingId, { label: 'Couldn’t convert this file', error: true });
    setTimeout(() => useSessionStore.getState().removePendingImport(pendingId), 4500);
  }
}

export interface ImportMediaOpts {
  /** AI-generation provenance to stamp on every created item. */
  genInfo?: GenInfo;
}

export async function importImageFiles(
  files: File[],
  dropPoint: Point,
  opts?: ImportMediaOpts,
): Promise<string[]> {
  const heicFiles = files.filter(isHeicFile);
  const imageFiles = files.filter((f) => f.type.startsWith('image/') && !isHeicFile(f));

  // HEIC conversions run in the background behind their own placeholders, so
  // a mixed drop's normal images appear immediately. Every file gets the
  // nearest open spot at its REAL placed size — no stacking, no overlap.
  const reserved: ReservedBox[] = [];
  for (const file of heicFiles) {
    void importHeicFile(
      file,
      reserveNext(reserved, dropPoint, PENDING_SIZE.width, PENDING_SIZE.height),
    );
  }

  if (imageFiles.length === 0) return [];

  const { doc } = useDocumentStore.getState();
  let z = topZIndex(doc) + 1;
  const items: ImageItem[] = [];
  for (const file of imageFiles) {
    try {
      const [assetId, natural, pano] = await Promise.all([
        putAsset(file),
        imageDimensions(file),
        sniffPanoXmp(file),
      ]);
      const previewAssetId = await makePreviewAsset(file, natural);
      const size = placedSize(natural);
      const at = reserveNext(reserved, dropPoint, size.width, size.height);
      const item = imageItemFrom(file, assetId, natural, z++, at, previewAssetId, pano);
      items.push(opts?.genInfo ? { ...item, genInfo: opts.genInfo } : item);
    } catch (err) {
      console.error(`boardCache: could not import "${file.name}"`, err);
    }
  }

  addItems(items, items.length === 1 ? 'Add image' : `Add ${items.length} images`);
  useSessionStore.getState().setSelection(items.map((i) => i.id));
  return items.map((i) => i.id);
}
