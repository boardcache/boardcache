import qrcode from 'qrcode-generator';
import type { QrItem } from '@boardcache/schema';
import { downloadBlob } from '../export/download';

// UTF-8 so URLs/text with non-ASCII characters encode correctly (the library
// default truncates char codes to one byte, which garbles unicode).
qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));

/** Quiet-zone padding, in modules, inside the containing square. */
export const QR_PAD = 3;

export interface QrCode {
  /** Modules per side (excluding the quiet zone). */
  size: number;
  /** dark[row][col] */
  dark: boolean[][];
}

const cache = new Map<string, QrCode | null>();

/** Encode text into a QR module matrix; null when empty or too long. */
export function qrCode(text: string): QrCode | null {
  const key = text;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let result: QrCode | null = null;
  if (text.trim()) {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text, 'Byte');
      qr.make();
      const size = qr.getModuleCount();
      const dark: boolean[][] = [];
      for (let r = 0; r < size; r++) {
        const row: boolean[] = [];
        for (let c = 0; c < size; c++) row.push(qr.isDark(r, c));
        dark.push(row);
      }
      result = { size, dark };
    } catch {
      result = null; // content too long for a QR code
    }
  }
  if (cache.size > 100) cache.clear();
  cache.set(key, result);
  return result;
}

/** A single SVG path covering all dark modules, offset by the quiet zone. */
export function qrPathData(code: QrCode): string {
  const parts: string[] = [];
  for (let r = 0; r < code.size; r++) {
    // Merge horizontal runs so the path stays compact.
    let run = -1;
    for (let c = 0; c <= code.size; c++) {
      const dark = c < code.size && code.dark[r]![c]!;
      if (dark && run < 0) run = c;
      else if (!dark && run >= 0) {
        parts.push(`M${run + QR_PAD} ${r + QR_PAD}h${c - run}v1h-${c - run}z`);
        run = -1;
      }
    }
  }
  return parts.join('');
}

/** A standalone SVG document for the QR (vector export / PDF embedding). */
export function qrSvgString(item: Pick<QrItem, 'text' | 'color' | 'background'>): string | null {
  const code = qrCode(item.text);
  if (!code) return null;
  const total = code.size + QR_PAD * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${item.background}"/>` +
    `<path d="${qrPathData(code)}" fill="${item.color}"/>` +
    `</svg>`
  );
}

/**
 * Draw the QR into a canvas context: background square + modules, contain-fit
 * and centered in the given box. Module edges are rounded to whole pixels so
 * they stay crisp (no antialiased seams).
 */
export function drawQr(
  ctx: CanvasRenderingContext2D,
  item: Pick<QrItem, 'text' | 'color' | 'background'>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = item.background;
  ctx.fillRect(x, y, w, h);
  const code = qrCode(item.text);
  if (!code) return;
  const total = code.size + QR_PAD * 2;
  const side = Math.min(w, h);
  const s = side / total;
  const ox = x + (w - side) / 2 + QR_PAD * s;
  const oy = y + (h - side) / 2 + QR_PAD * s;
  ctx.fillStyle = item.color;
  for (let r = 0; r < code.size; r++) {
    for (let c = 0; c < code.size; c++) {
      if (!code.dark[r]![c]!) continue;
      const x0 = Math.round(ox + c * s);
      const y0 = Math.round(oy + r * s);
      ctx.fillRect(x0, y0, Math.round(ox + (c + 1) * s) - x0, Math.round(oy + (r + 1) * s) - y0);
    }
  }
}

function safeName(item: { text: string; name?: string | undefined }): string {
  const raw = (item.name?.trim() || item.text.slice(0, 24) || 'qr-code').replace(/[^\w.-]+/g, '_');
  return raw || 'qr-code';
}

/** Download the QR as a standalone vector SVG file. */
export function downloadQrSvg(item: QrItem): void {
  const svg = qrSvgString(item);
  if (!svg) return;
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeName(item)}.svg`);
}

/** Download the QR as a PNG at the given pixel resolution (square). */
export async function downloadQrPng(item: QrItem, sizePx: number): Promise<void> {
  const size = Math.min(8192, Math.max(64, Math.round(sizePx)));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  drawQr(canvas.getContext('2d')!, item, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
  if (blob) downloadBlob(blob, `${safeName(item)}.png`);
}
