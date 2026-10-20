import { rgbToHex } from './color';
import { getAssetBlob } from '../board/assetStore';

/**
 * Palette extraction via median-cut quantization. The quantizer is pure
 * (unit-tested); the asset loader downscales through a canvas first.
 */

type Pixel = [number, number, number];

function channelRange(pixels: Pixel[], channel: 0 | 1 | 2): number {
  let min = 255;
  let max = 0;
  for (const p of pixels) {
    if (p[channel] < min) min = p[channel];
    if (p[channel] > max) max = p[channel];
  }
  return max - min;
}

function averageColor(pixels: Pixel[]): Pixel {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pixels) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = pixels.length || 1;
  return [r / n, g / n, b / n];
}

/**
 * Median-cut: repeatedly split the bucket with the widest channel range at
 * its median until we have `count` buckets, then average each bucket.
 */
export function medianCut(rgba: Uint8ClampedArray, count: number): string[] {
  const pixels: Pixel[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue; // skip transparent
    pixels.push([rgba[i]!, rgba[i + 1]!, rgba[i + 2]!]);
  }
  if (pixels.length === 0) return [];

  let buckets: Pixel[][] = [pixels];
  while (buckets.length < count) {
    let widest = -1;
    let widestRange = -1;
    let widestChannel: 0 | 1 | 2 = 0;
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]!;
      if (bucket.length < 2) continue;
      for (const channel of [0, 1, 2] as const) {
        const range = channelRange(bucket, channel);
        if (range > widestRange) {
          widestRange = range;
          widest = i;
          widestChannel = channel;
        }
      }
    }
    if (widest === -1) break; // nothing splittable left
    const bucket = buckets[widest]!;
    const sorted = [...bucket].sort((a, b) => a[widestChannel] - b[widestChannel]);
    const mid = Math.floor(sorted.length / 2);
    buckets = [
      ...buckets.slice(0, widest),
      sorted.slice(0, mid),
      sorted.slice(mid),
      ...buckets.slice(widest + 1),
    ];
  }

  return buckets
    .filter((b) => b.length > 0)
    .sort((a, b) => b.length - a.length) // dominant colors first
    .map((bucket) => {
      const [r, g, b] = averageColor(bucket);
      return rgbToHex({ r, g, b });
    });
}

const SAMPLE_SIZE = 64;

/** Extract `count` dominant colors from a stored image asset. */
export async function extractPaletteFromAsset(assetId: string, count = 6): Promise<string[]> {
  const blob = await getAssetBlob(assetId);
  if (!blob) throw new Error(`Asset ${assetId} not found`);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, SAMPLE_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return medianCut(ctx.getImageData(0, 0, w, h).data, count);
}
