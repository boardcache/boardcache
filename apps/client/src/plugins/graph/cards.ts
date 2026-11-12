import type { Item } from '@boardcache/schema';
import { acquireAssetUrl, releaseAssetUrl } from '../../lib/board/assetStore';
import { renderItemCanvas } from '../../lib/media/thumbnail';

/**
 * A node's preview card: the item drawn on a rounded panel with a tinted
 * border, at up to CARD_MAX pixels on its long side, so a card stays sharp
 * when the camera comes close. Pictures come from their own bytes rather
 * than the board thumbnail rasterizer; everything else (text, PDFs,
 * swatches, maps) goes through the same rasterizer that draws board
 * thumbnails, at twice the item's size.
 */

const CARD_MAX = 1024;
const PAD = 14;
const RADIUS = 22;

export interface CardStyle {
  panel: string;
  border: string | null;
}

async function imageSource(item: Item): Promise<HTMLImageElement | HTMLCanvasElement> {
  if (item.type === 'image') {
    const assetId = item.previewAssetId ?? item.assetId;
    const url = assetId ? await acquireAssetUrl(assetId) : null;
    if (url) {
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return img;
      } catch {
        /* fall through to the rasterizer */
      } finally {
        releaseAssetUrl(assetId!);
      }
    }
  }
  return renderItemCanvas(item, 2);
}

export async function renderNodeCard(item: Item, style: CardStyle): Promise<HTMLCanvasElement> {
  const src = await imageSource(item);
  const sw = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
  const sh = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
  const ar = sw / Math.max(1, sh);
  const long = Math.min(CARD_MAX, Math.max(192, Math.max(sw, sh)));
  const w = ar >= 1 ? long : Math.max(64, Math.round(long * ar));
  const h = ar >= 1 ? Math.max(64, Math.round(long / ar)) : long;
  const c = document.createElement('canvas');
  c.width = w + PAD * 2;
  c.height = h + PAD * 2;
  const x = c.getContext('2d')!;
  x.beginPath();
  x.roundRect(2, 2, c.width - 4, c.height - 4, RADIUS);
  x.fillStyle = style.panel;
  x.fill();
  x.save();
  x.clip();
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, PAD, PAD, w, h);
  x.restore();
  x.strokeStyle = style.border ?? 'rgba(127, 127, 127, 0.45)';
  x.lineWidth = style.border ? 6 : 3;
  x.stroke();
  return c;
}
