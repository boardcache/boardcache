/**
 * Extract embedded cover artwork from an audio file, dependency-free. Supports
 * the common containers: ID3v2 (MP3, APIC/PIC), FLAC (PICTURE block), and
 * MP4/M4A ('covr' atom). Returns an image Blob or null if none is present.
 */

const latin1 = new TextDecoder('latin1');

function u32(b: Uint8Array, o: number): number {
  return b[o]! * 0x1000000 + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
}
function synchsafe(b: Uint8Array, o: number): number {
  return (b[o]! << 21) | (b[o + 1]! << 14) | (b[o + 2]! << 7) | b[o + 3]!;
}
function str(b: Uint8Array, start: number, len: number): string {
  return latin1.decode(b.subarray(start, start + len));
}

function normalizeMime(mime: string): string {
  const m = mime.trim().toLowerCase();
  if (m.startsWith('image/')) return m;
  if (m.includes('png')) return 'image/png';
  return 'image/jpeg';
}

/** Skip a null-terminated description field given the text encoding byte. */
function skipDescription(b: Uint8Array, p: number, end: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    while (p + 1 < end && !(b[p] === 0 && b[p + 1] === 0)) p += 1;
    return p + 2;
  }
  while (p < end && b[p] !== 0) p += 1;
  return p + 1;
}

function parseApic(b: Uint8Array, pos: number, size: number): Blob | null {
  const end = pos + size;
  let p = pos;
  const enc = b[p++]!;
  const mimeStart = p;
  while (p < end && b[p] !== 0) p += 1;
  const mime = str(b, mimeStart, p - mimeStart) || 'image/jpeg';
  p += 1; // mime null
  p += 1; // picture type
  p = skipDescription(b, p, end, enc);
  if (p >= end) return null;
  return new Blob([b.subarray(p, end) as BlobPart], { type: normalizeMime(mime) });
}

function parsePic(b: Uint8Array, pos: number, size: number): Blob | null {
  const end = pos + size;
  let p = pos;
  const enc = b[p++]!;
  const fmt = str(b, p, 3);
  p += 3;
  p += 1; // picture type
  p = skipDescription(b, p, end, enc);
  if (p >= end) return null;
  return new Blob([b.subarray(p, end) as BlobPart], {
    type: fmt.toLowerCase().includes('png') ? 'image/png' : 'image/jpeg',
  });
}

function id3v2(b: Uint8Array): Blob | null {
  const ver = b[3]!;
  const end = Math.min(b.length, 10 + synchsafe(b, 6));
  let pos = 10;
  while (pos + 6 <= end) {
    if (ver === 2) {
      const id = str(b, pos, 3);
      const size = (b[pos + 3]! << 16) | (b[pos + 4]! << 8) | b[pos + 5]!;
      pos += 6;
      if (size <= 0 || pos + size > end) break;
      if (id === 'PIC') return parsePic(b, pos, size);
      pos += size;
    } else {
      const id = str(b, pos, 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = ver === 4 ? synchsafe(b, pos + 4) : u32(b, pos + 4);
      pos += 10;
      if (size <= 0 || pos + size > end) break;
      if (id === 'APIC') return parseApic(b, pos, size);
      pos += size;
    }
  }
  return null;
}

function flac(b: Uint8Array): Blob | null {
  let pos = 4;
  while (pos + 4 <= b.length) {
    const header = b[pos]!;
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const len = (b[pos + 1]! << 16) | (b[pos + 2]! << 8) | b[pos + 3]!;
    pos += 4;
    if (type === 6) {
      let p = pos + 4; // picture type
      const mimeLen = u32(b, p);
      p += 4;
      const mime = str(b, p, mimeLen);
      p += mimeLen;
      const descLen = u32(b, p);
      p += 4 + descLen + 16; // desc + width/height/depth/colors
      const dataLen = u32(b, p);
      p += 4;
      if (p + dataLen > b.length) return null;
      return new Blob([b.subarray(p, p + dataLen) as BlobPart], { type: normalizeMime(mime) });
    }
    pos += len;
    if (last) break;
  }
  return null;
}

function findAtom(
  b: Uint8Array,
  start: number,
  end: number,
  type: string,
): { start: number; end: number } | null {
  let pos = start;
  while (pos + 8 <= end) {
    let size = u32(b, pos);
    let header = 8;
    if (size === 1) {
      // 64-bit size: take the low 32 bits (cover art is never that large).
      size = u32(b, pos + 12);
      header = 16;
    }
    if (size < header || pos + size > end) break;
    if (str(b, pos + 4, 4) === type) return { start: pos + header, end: pos + size };
    pos += size;
  }
  return null;
}

function mp4(b: Uint8Array): Blob | null {
  const moov = findAtom(b, 0, b.length, 'moov');
  if (!moov) return null;
  const udta = findAtom(b, moov.start, moov.end, 'udta');
  if (!udta) return null;
  const meta = findAtom(b, udta.start, udta.end, 'meta');
  if (!meta) return null;
  // 'meta' is a full box — skip its 4-byte version/flags before its children.
  const ilst = findAtom(b, meta.start + 4, meta.end, 'ilst');
  if (!ilst) return null;
  const covr = findAtom(b, ilst.start, ilst.end, 'covr');
  if (!covr) return null;
  const data = findAtom(b, covr.start, covr.end, 'data');
  if (!data) return null;
  const flags = u32(b, data.start) & 0xffffff;
  return new Blob([b.subarray(data.start + 8, data.end) as BlobPart], {
    type: flags === 14 ? 'image/png' : 'image/jpeg',
  });
}

export async function extractAudioArtwork(blob: Blob): Promise<Blob | null> {
  try {
    const b = new Uint8Array(await blob.arrayBuffer());
    if (b.length < 16) return null;
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return id3v2(b); // 'ID3'
    if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return flac(b); // 'fLaC'
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return mp4(b); // 'ftyp'
    return null;
  } catch {
    return null;
  }
}
