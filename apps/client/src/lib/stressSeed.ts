import type { ImageItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { putAsset } from './board/assetStore';
import { addItems } from '../state/commands';
import { useSessionStore } from '../state/sessionStore';

/**
 * Seeded stress-board generator (perf budget tooling, brief §6).
 * Dev console: `await __boardcacheStress(1000)` then pan/zoom and watch fps.
 */

/** Deterministic PRNG so stress runs are comparable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SWATCH_COLORS = ['#0f4c5c', '#e36414', '#fb8b24', '#5f0f40', '#9a031e', '#4f8ef7'];

async function makePngBlob(color: string, size: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `${size / 4}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(color, size / 2, size / 2);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

export async function seedStressBoard(count = 1000, seed = 1337): Promise<void> {
  const rand = mulberry32(seed);
  const assetIds: string[] = [];
  for (const color of SWATCH_COLORS) {
    assetIds.push(await putAsset(await makePngBlob(color, 256)));
  }

  const span = Math.ceil(Math.sqrt(count)) * 320;
  const items: ImageItem[] = [];
  for (let i = 0; i < count; i++) {
    const width = 120 + Math.round(rand() * 240);
    items.push({
      id: newId(),
      type: 'image',
      x: Math.round((rand() - 0.5) * span),
      y: Math.round((rand() - 0.5) * span),
      width,
      height: width,
      rotation: Math.round((rand() - 0.5) * 60),
      zIndex: i + 1,
      locked: false,
      opacity: 1,
      groupId: null,
      assetId: assetIds[i % assetIds.length]!,
      naturalWidth: 256,
      naturalHeight: 256,
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
    });
  }
  addItems(items, `Seed ${count} stress items`);
  useSessionStore.getState().clearSelection();
}

/**
 * Media-heavy stress seed: imports `count` large (~6MP) JPEGs through the
 * REAL import pipeline (so display renditions are generated exactly as for
 * user media), laid out in a grid. Deterministic per index.
 */
export async function seedMediaBoard(count = 40): Promise<void> {
  const { importImageFiles } = await import('./import/importImages');
  for (let i = 0; i < count; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = 2800;
    canvas.height = 2100;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 2800, 2100);
    g.addColorStop(0, `hsl(${(i * 47) % 360}, 65%, 45%)`);
    g.addColorStop(1, `hsl(${(i * 47 + 120) % 360}, 65%, 60%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2800, 2100);
    for (let c = 0; c < 24; c++) {
      ctx.fillStyle = `hsla(${(i * 31 + c * 15) % 360}, 70%, 70%, 0.5)`;
      ctx.beginPath();
      ctx.arc(
        (c * 733 + i * 97) % 2800,
        (c * 421 + i * 53) % 2100,
        120 + (c % 5) * 60,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.85,
      ),
    );
    const file = new File([blob], `stress-${i}.jpg`, { type: 'image/jpeg' });
    await importImageFiles([file], { x: (i % 8) * 700, y: Math.floor(i / 8) * 560 });
  }
  useSessionStore.getState().clearSelection();
}
