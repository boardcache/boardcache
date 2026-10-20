import type { Point } from '../canvas/coords';
import { computeCropFromBox, uncroppedRect } from './crop';
import { acquireAssetUrl, getAssetBlob, putAsset, releaseAssetUrl } from '../board/assetStore';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/** Crop an image to the drag box (two canvas-space corners). One undo step. */
export function cropImageToBox(itemId: string, p1: Point, p2: Point): void {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || item.type !== 'image' || item.locked) return;
  const result = computeCropFromBox(item, p1, p2);
  if (!result) return;
  updateItems([itemId], 'Crop image', (it) => {
    if (it.type !== 'image') return;
    it.crop = result.crop;
    it.x = result.rect.x;
    it.y = result.rect.y;
    it.width = result.rect.width;
    it.height = result.rect.height;
  });
}

/** Mirror an image horizontally. */
export function flipImageH(itemId: string): void {
  updateItems([itemId], 'Flip horizontal', (it) => {
    if (it.type === 'image') it.flipH = !it.flipH;
  });
}

/** Mirror an image vertically. */
export function flipImageV(itemId: string): void {
  updateItems([itemId], 'Flip vertical', (it) => {
    if (it.type === 'image') it.flipV = !it.flipV;
  });
}

/** Drop the crop, restoring the full image (at the current scale/position). */
export function restoreImageCrop(itemId: string): void {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || item.type !== 'image' || !item.crop) return;
  const rect = uncroppedRect(item);
  updateItems([itemId], 'Restore image', (it) => {
    if (it.type !== 'image') return;
    it.crop = null;
    it.x = rect.x;
    it.y = rect.y;
    it.width = rect.width;
    it.height = rect.height;
  });
}

/**
 * Bake a rotated image into a new, axis-aligned source ("Reset Bounding
 * Box"): renders exactly what's on screen — crop region, flips, rotation —
 * into a fresh asset at source resolution, then swaps the item to it with
 * rotation 0 and the rotated bounding box. The visual result is unchanged;
 * the bounding box finally matches what you see, so cropping works again.
 */
export async function rasterizeRotation(itemId: string): Promise<void> {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || item.type !== 'image' || !item.rotation) return;
  const blob = await getAssetBlob(item.assetId);
  if (!blob) return;
  const bmp = await createImageBitmap(blob);
  try {
    // Displayed source region (fractional crop → pixels).
    const sx = (item.crop?.x ?? 0) * bmp.width;
    const sy = (item.crop?.y ?? 0) * bmp.height;
    const sw = (item.crop?.width ?? 1) * bmp.width;
    const sh = (item.crop?.height ?? 1) * bmp.height;
    // Render at source resolution for the displayed rect (no quality loss).
    const k = Math.max(sw / item.width, sh / item.height, 1e-6);
    const pw = item.width * k;
    const ph = item.height * k;
    const rad = (item.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const outW = Math.max(1, Math.round(pw * cos + ph * sin));
    const outH = Math.max(1, Math.round(pw * sin + ph * cos));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(rad);
    ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
    ctx.drawImage(bmp, sx, sy, sw, sh, -pw / 2, -ph / 2, pw, ph);
    const outBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!outBlob) return;
    const newAssetId = await putAsset(outBlob);

    // Warm the URL cache AND the bitmap decode before swapping, so the item
    // repaints with the baked pixels in the same frame (no flash of the
    // un-rotated original). The reference is handed off to the item's own
    // acquire; release ours after it has had ample time to attach.
    const warmUrl = await acquireAssetUrl(newAssetId);
    if (warmUrl) {
      const im = new Image();
      im.src = warmUrl;
      await im.decode().catch(() => undefined);
    }
    setTimeout(() => releaseAssetUrl(newAssetId), 10_000);

    // New display box: same center, axis-aligned rotated extents.
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const newW = item.width * cos + item.height * sin;
    const newH = item.width * sin + item.height * cos;
    updateItems([itemId], 'Reset bounding box', (it) => {
      if (it.type !== 'image') return;
      it.assetId = newAssetId;
      delete it.previewAssetId;
      it.naturalWidth = outW;
      it.naturalHeight = outH;
      it.crop = null;
      it.flipH = false;
      it.flipV = false;
      it.rotation = 0;
      it.x = cx - newW / 2;
      it.y = cy - newH / 2;
      it.width = newW;
      it.height = newH;
    });
  } finally {
    bmp.close();
  }
}
