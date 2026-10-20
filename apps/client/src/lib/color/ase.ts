import { hexToRgb, rgbToHex } from './color';

/**
 * Adobe Swatch Exchange (.ase) encode/decode — RGB entries only, which is
 * what every major tool reads. Format: big-endian; 'ASEF' magic; u16 major/
 * minor version; u32 block count; blocks of [u16 type][u32 length][payload].
 * Color block payload: [u16 nameLen incl. NUL][UTF-16BE name][4cc model]
 * ['RGB ' → 3×f32][u16 colorType].
 */

export interface AseEntry {
  name: string;
  hex: string;
}

const BLOCK_COLOR = 0x0001;

export function encodeAse(entries: AseEntry[]): ArrayBuffer {
  const chunks: Uint8Array[] = [];

  for (const entry of entries) {
    const rgb = hexToRgb(entry.hex) ?? { r: 0, g: 0, b: 0 };
    const name = entry.name || entry.hex;
    const nameUnits = name.length + 1; // + NUL
    const payloadLen = 2 + nameUnits * 2 + 4 + 12 + 2;
    const block = new DataView(new ArrayBuffer(2 + 4 + payloadLen));
    let o = 0;
    block.setUint16(o, BLOCK_COLOR);
    o += 2;
    block.setUint32(o, payloadLen);
    o += 4;
    block.setUint16(o, nameUnits);
    o += 2;
    for (let i = 0; i < name.length; i++) {
      block.setUint16(o, name.charCodeAt(i));
      o += 2;
    }
    block.setUint16(o, 0); // NUL
    o += 2;
    block.setUint8(o++, 0x52); // 'R'
    block.setUint8(o++, 0x47); // 'G'
    block.setUint8(o++, 0x42); // 'B'
    block.setUint8(o++, 0x20); // ' '
    block.setFloat32(o, rgb.r / 255);
    o += 4;
    block.setFloat32(o, rgb.g / 255);
    o += 4;
    block.setFloat32(o, rgb.b / 255);
    o += 4;
    block.setUint16(o, 0); // global color
    chunks.push(new Uint8Array(block.buffer));
  }

  const body = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new DataView(new ArrayBuffer(12 + body));
  out.setUint8(0, 0x41); // 'A'
  out.setUint8(1, 0x53); // 'S'
  out.setUint8(2, 0x45); // 'E'
  out.setUint8(3, 0x46); // 'F'
  out.setUint16(4, 1); // major
  out.setUint16(6, 0); // minor
  out.setUint32(8, entries.length);
  let offset = 12;
  const bytes = new Uint8Array(out.buffer);
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export function decodeAse(buffer: ArrayBuffer): AseEntry[] {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 12 ||
    view.getUint8(0) !== 0x41 ||
    view.getUint8(1) !== 0x53 ||
    view.getUint8(2) !== 0x45 ||
    view.getUint8(3) !== 0x46
  ) {
    throw new Error('Not an ASE file');
  }
  const blockCount = view.getUint32(8);
  const entries: AseEntry[] = [];
  let offset = 12;

  for (let i = 0; i < blockCount && offset + 6 <= buffer.byteLength; i++) {
    const type = view.getUint16(offset);
    const length = view.getUint32(offset + 2);
    const payloadStart = offset + 6;
    offset = payloadStart + length;

    if (type !== BLOCK_COLOR) continue; // skip groups
    let o = payloadStart;
    const nameUnits = view.getUint16(o);
    o += 2;
    let name = '';
    for (let c = 0; c < nameUnits - 1; c++) {
      name += String.fromCharCode(view.getUint16(o));
      o += 2;
    }
    o += 2; // NUL
    const model = String.fromCharCode(
      view.getUint8(o),
      view.getUint8(o + 1),
      view.getUint8(o + 2),
      view.getUint8(o + 3),
    );
    o += 4;
    if (model !== 'RGB ') continue; // only RGB supported
    const r = view.getFloat32(o) * 255;
    const g = view.getFloat32(o + 4) * 255;
    const b = view.getFloat32(o + 8) * 255;
    entries.push({ name, hex: rgbToHex({ r, g, b }) });
  }
  return entries;
}
