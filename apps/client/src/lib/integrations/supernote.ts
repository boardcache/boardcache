/**
 * Supernote .note parser + renderer (X-series, RATTA_RLE protocol).
 *
 * A TypeScript port of the file-format handling in supernotelib
 * (https://github.com/jya-dev/supernote-tool, Copyright (c) 2020 jya),
 * used under the Apache License 2.0. Reduced to what importing needs:
 * parse the block structure, RLE-decode each layer, flatten to a canvas.
 *
 * File layout: [4B type]["SN_FILE_VER_XXXXXXXX"][blocks...][4B footer addr
 * as the last 4 bytes]. Every block is 4B LE length + payload; metadata
 * payloads are `<KEY:VALUE>` runs. The footer indexes pages, pages index
 * layers (MAINLAYER/LAYER1-3/BGLAYER), layers point at RLE bitmaps.
 */

interface SnLayer {
  name: string;
  protocol: string;
  bitmap: Uint8Array | null;
}

interface SnPage {
  style: string | null;
  /** Bottom-most last, as stored in LAYERSEQ. */
  layerOrder: string[];
  /** Layer name → visible (from LAYERINFO json). */
  visibility: Record<string, boolean>;
  layers: SnLayer[];
  horizontal: boolean;
}

export interface SnNotebook {
  signature: string;
  width: number;
  height: number;
  /** X2-series color codes (firmware >= Chauvet 3.14). */
  highresGrayscale: boolean;
  pages: SnPage[];
}

const SIGNATURE_RE = /^SN_FILE_VER_\d{8}$/;
const LAYER_KEYS = ['MAINLAYER', 'LAYER1', 'LAYER2', 'LAYER3', 'BGLAYER'];

type Meta = Record<string, string | string[]>;

function readBlock(view: DataView, bytes: Uint8Array, address: number): Uint8Array | null {
  if (!address || address <= 0 || address + 4 > bytes.length) return null;
  const len = view.getUint32(address, true);
  if (address + 4 + len > bytes.length) return null;
  return bytes.subarray(address + 4, address + 4 + len);
}

function parseMeta(payload: Uint8Array | null): Meta {
  if (!payload) return {};
  const text = new TextDecoder().decode(payload);
  const params: Meta = {};
  for (const m of text.matchAll(/<([^:<>]+):(.*?)>/g)) {
    const key = m[1]!;
    const value = m[2]!;
    const prev = params[key];
    if (prev === undefined) params[key] = value;
    else if (Array.isArray(prev)) prev.push(value);
    else params[key] = [prev, value];
  }
  return params;
}

const single = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/** Parse the .note container. Throws with a readable message on non-X files. */
export function parseNote(buffer: ArrayBuffer): SnNotebook {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 32) throw new Error('Not a Supernote .note file (too small).');
  const signature = new TextDecoder().decode(bytes.subarray(4, 24));
  if (!SIGNATURE_RE.test(signature)) {
    throw new Error('Not a Supernote X-series .note file (unrecognized signature).');
  }
  const footerAddr = view.getUint32(bytes.length - 4, true);
  const footer = parseMeta(readBlock(view, bytes, footerAddr));
  const header = parseMeta(readBlock(view, bytes, Number(single(footer['FILE_FEATURE']) ?? 0)));

  // Manta/A5X2 devices write 1920x2560 pages; everything else 1404x1872.
  const isA5X2 = single(header['APPLY_EQUIPMENT']) === 'N5';
  const width = isA5X2 ? 1920 : 1404;
  const height = isA5X2 ? 2560 : 1872;
  const highresGrayscale = Number(signature.slice(-8)) >= 20230015;

  const pages: SnPage[] = [];
  const pageKeys = Object.keys(footer)
    .filter((k) => /^PAGE\d+$/.test(k))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  for (const key of pageKeys) {
    const pageMeta = parseMeta(readBlock(view, bytes, Number(single(footer[key]) ?? 0)));
    const layers: SnLayer[] = [];
    let mainSeen = false;
    for (const layerKey of LAYER_KEYS) {
      const addr = Number(single(pageMeta[layerKey]) ?? 0);
      if (!addr) continue;
      const layerMeta = parseMeta(readBlock(view, bytes, addr));
      let name = single(layerMeta['LAYERNAME']) ?? layerKey;
      // Device quirk: some files name two layers MAINLAYER; the second is
      // really the background (same workaround as supernotelib).
      if (name === 'MAINLAYER') {
        if (mainSeen) name = 'BGLAYER';
        else mainSeen = true;
      }
      layers.push({
        name,
        protocol: single(layerMeta['LAYERPROTOCOL']) ?? 'RATTA_RLE',
        bitmap: readBlock(view, bytes, Number(single(layerMeta['LAYERBITMAP']) ?? 0)),
      });
    }
    pages.push({
      style: single(pageMeta['PAGESTYLE']) ?? null,
      layerOrder: (single(pageMeta['LAYERSEQ']) ?? 'MAINLAYER,BGLAYER').split(','),
      visibility: parseVisibility(single(pageMeta['LAYERINFO'])),
      layers,
      horizontal: single(pageMeta['ORIENTATION']) === '1090',
    });
  }
  if (!pages.length) throw new Error('No pages found in the .note file.');
  return { signature, width, height, highresGrayscale, pages };
}

function parseVisibility(info: string | undefined): Record<string, boolean> {
  const visibility: Record<string, boolean> = {};
  if (info && info !== 'none') {
    try {
      // LAYERINFO stores json with ':' escaped as '#'; some firmwares base64 it.
      let json = info.replace(/#/g, ':');
      if (!json.trim().startsWith('[')) json = atob(json).replace(/#/g, ':');
      const entries = JSON.parse(json) as {
        layerId?: number;
        isBackgroundLayer?: boolean;
        isVisible?: boolean;
      }[];
      for (const e of entries) {
        const name = e.isBackgroundLayer
          ? 'BGLAYER'
          : e.layerId === 0
            ? 'MAINLAYER'
            : `LAYER${e.layerId}`;
        visibility[name] = e.isVisible !== false;
      }
    } catch {
      /* fall through to default-visible */
    }
  }
  if (visibility['MAINLAYER'] === undefined) visibility['MAINLAYER'] = true;
  return visibility;
}

// --- RATTA_RLE decoding ---------------------------------------------------

const TRANSPARENT = 0xff;
/** Grayscale values (black, darkgray, gray, white) shared with supernotelib. */
const GRAY_LEVELS = { black: 0x00, darkgray: 0x9d, gray: 0xc9, white: 0xfe };

function colormap(highres: boolean): Map<number, number> {
  const m = new Map<number, number>([
    [0x61, GRAY_LEVELS.black],
    [0x62, TRANSPARENT],
    [0x65, GRAY_LEVELS.white],
    [0x66, GRAY_LEVELS.black], // marker pens share the pen colors
  ]);
  if (highres) {
    m.set(0x9d, GRAY_LEVELS.darkgray).set(0xc9, GRAY_LEVELS.gray);
    m.set(0x9e, GRAY_LEVELS.darkgray).set(0xca, GRAY_LEVELS.gray);
    m.set(0x63, 0x30).set(0x64, 0x50); // X-series compat colors
  } else {
    m.set(0x63, GRAY_LEVELS.darkgray).set(0x64, GRAY_LEVELS.gray);
    m.set(0x67, GRAY_LEVELS.darkgray).set(0x68, GRAY_LEVELS.gray);
  }
  return m;
}

/**
 * Decode a RATTA_RLE bitmap into one grayscale byte per pixel (0xff =
 * transparent). Runs are (colorcode, length) byte pairs; length 0xff means a
 * 0x4000 run (0x400 for the all-blank white template); a length with the
 * high bit set holds until the next pair to form a 14-bit run.
 */
export function decodeRattaRle(
  data: Uint8Array,
  pixels: number,
  highres: boolean,
  allBlank = false,
): Uint8Array {
  const out = new Uint8Array(pixels).fill(TRANSPARENT);
  const map = colormap(highres);
  let pos = 0;
  let holder: [number, number] | null = null;

  const emit = (code: number, length: number) => {
    // Unknown codes carry their own gray value (X2 firmware behavior).
    const gray = map.get(code) ?? code;
    if (gray !== TRANSPARENT) out.fill(gray, pos, Math.min(pos + length, pixels));
    pos += length;
  };

  for (let i = 0; i + 1 < data.length; i += 2) {
    const code = data[i]!;
    const length = data[i + 1]!;
    if (holder) {
      const prevCode: number = holder[0];
      const prevLength: number = holder[1];
      holder = null;
      if (code === prevCode) {
        emit(code, 1 + length + (((prevLength & 0x7f) + 1) << 7));
        continue;
      }
      emit(prevCode, ((prevLength & 0x7f) + 1) << 7);
    }
    if (length === 0xff) {
      emit(code, allBlank ? 0x400 : 0x4000);
    } else if (length & 0x80) {
      holder = [code, length];
    } else {
      emit(code, length + 1);
    }
  }
  if (holder) {
    // Tail run: pick the largest power-of-two scaling that fits the gap.
    const [code, tailLength] = holder;
    const gap = pixels - pos;
    for (let i = 7; i >= 0; i--) {
      const l = ((tailLength & 0x7f) + 1) << i;
      if (l <= gap) {
        emit(code, l);
        break;
      }
    }
  }
  if (pos < pixels && pos > 0) {
    // Tolerate slightly short streams (blank remainder) rather than failing.
    pos = pixels;
  }
  return out;
}

// --- Page rendering --------------------------------------------------------

/** Special block size that marks the built-in blank white template. */
const WHITE_STYLE_BLOCK_SIZE = 0x140e;

async function decodePngLayer(
  bitmap: Uint8Array,
  width: number,
  height: number,
): Promise<ImageData | null> {
  try {
    const copy = new Uint8Array(bitmap); // detach from the file buffer
    const img = await createImageBitmap(
      new Blob([copy.buffer as ArrayBuffer], { type: 'image/png' }),
    );
    // Works on the main thread and in Web Workers (OffscreenCanvas).
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    if (typeof document === 'undefined') {
      ctx = new OffscreenCanvas(width, height).getContext('2d')!;
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      ctx = canvas.getContext('2d')!;
    }
    ctx.drawImage(img, 0, 0, width, height);
    img.close();
    return ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  }
}

/**
 * Flatten a page to one grayscale byte per pixel (white ground 0xfe), the
 * shared compositing behind both the raster and vector exports. Custom PNG
 * backgrounds are folded in as luma.
 */
export async function flattenPageGray(
  note: SnNotebook,
  pageIndex: number,
): Promise<{ gray: Uint8Array; width: number; height: number }> {
  const page = note.pages[pageIndex];
  if (!page) throw new Error(`Page ${pageIndex + 1} out of range.`);
  const width = page.horizontal ? note.height : note.width;
  const height = page.horizontal ? note.width : note.height;
  const pixels = width * height;
  const out = new Uint8Array(pixels).fill(GRAY_LEVELS.white);

  const byName = new Map(page.layers.map((l) => [l.name, l]));
  const order = page.layerOrder.length ? page.layerOrder : ['MAINLAYER', 'BGLAYER'];
  for (const name of [...order].reverse()) {
    if (!page.visibility[name]) continue;
    const layer = byName.get(name);
    if (!layer?.bitmap?.length) continue;

    const isBg = name === 'BGLAYER';
    if (isBg && (page.style?.startsWith('user_') ?? false)) {
      const imgData = await decodePngLayer(layer.bitmap, width, height);
      if (imgData) {
        const src = imgData.data;
        for (let i = 0; i < pixels; i++) {
          if (src[i * 4 + 3]! > 0) {
            out[i] = Math.round(
              0.299 * src[i * 4]! + 0.587 * src[i * 4 + 1]! + 0.114 * src[i * 4 + 2]!,
            );
          }
        }
      }
      continue;
    }
    if (layer.protocol !== 'RATTA_RLE') continue;
    const allBlank =
      isBg && page.style === 'style_white' && layer.bitmap.length === WHITE_STYLE_BLOCK_SIZE;
    const decoded = decodeRattaRle(layer.bitmap, pixels, note.highresGrayscale, allBlank);
    for (let i = 0; i < pixels; i++) {
      const v = decoded[i]!;
      if (v !== TRANSPARENT) out[i] = v;
    }
  }
  return { gray: out, width, height };
}

export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0-255 gray level of the fill. */
  gray: number;
}

/**
 * Vectorize a flattened page into filled rectangles: horizontal runs of
 * non-white ink, greedily merged with identical runs on following rows.
 * Lossless — drawing the rects on white reproduces the raster exactly.
 */
export function extractPageRects(gray: Uint8Array, width: number, height: number): PageRect[] {
  const rects: PageRect[] = [];
  // Open rects from the previous row, keyed "x:w:gray" for O(1) continuation.
  let open = new Map<string, PageRect>();
  for (let y = 0; y < height; y++) {
    const next = new Map<string, PageRect>();
    const row = y * width;
    let x = 0;
    while (x < width) {
      const v = gray[row + x]!;
      if (v >= GRAY_LEVELS.white) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < width && gray[row + end] === v) end++;
      const key = `${x}:${end - x}:${v}`;
      const prev = open.get(key);
      if (prev && prev.y + prev.h === y) {
        prev.h += 1;
        next.set(key, prev);
      } else {
        const rect = { x, y, w: end - x, h: 1, gray: v };
        rects.push(rect);
        next.set(key, rect);
      }
      x = end;
    }
    open = next;
  }
  return rects;
}
