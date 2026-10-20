/**
 * reMarkable .rm (lines v6) parser + renderer.
 *
 * A TypeScript port of the format handling in rmscene
 * (https://github.com/ricklupton/rmscene, Copyright (c) 2022 Rick Lupton,
 * MIT license), reduced to what importing needs: walk the tagged-block
 * stream, collect layers and pen strokes, draw them onto a canvas.
 *
 * File layout: 43-byte header "reMarkable .lines file, version=6", then
 * length-prefixed blocks. Values inside blocks are tagged (index<<4 | type)
 * varuints. Strokes live in SceneLineItemBlocks (0x05); layers are groups
 * in the scene tree anchored under the root node (0,1).
 */

const HEADER = 'reMarkable .lines file, version=6          ';

interface RmPoint {
  x: number;
  y: number;
  /** Device units ×4 (divide by 4 for pixels at 226dpi). */
  width: number;
  pressure: number;
}

interface RmLine {
  tool: number;
  color: number;
  /** RGBA override (newer highlight/shader colors). */
  colorRgba: [number, number, number, number] | null;
  thicknessScale: number;
  points: RmPoint[];
}

interface RmLayer {
  label: string;
  visible: boolean;
  lines: RmLine[];
}

export interface RmPage {
  width: number;
  height: number;
  layers: RmLayer[];
}

// Tag types (low nibble of the tag varuint).
const TAG_ID = 0xf;
const TAG_LEN4 = 0xc;
const TAG_BYTE8 = 0x8;
const TAG_BYTE4 = 0x4;
const TAG_BYTE1 = 0x1;

type CrdtId = string; // "part1:part2" — only used as a map key here

class Reader {
  private view: DataView;
  pos = 0;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get length(): number {
    return this.bytes.length;
  }
  u8(): number {
    return this.bytes[this.pos++]!;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  varuint(): number {
    let shift = 0;
    let result = 0;
    for (;;) {
      const b = this.u8();
      result += (b & 0x7f) * 2 ** shift; // avoids 32-bit overflow of <<
      shift += 7;
      if (!(b & 0x80)) return result;
    }
  }
  crdtId(): CrdtId {
    const part1 = this.u8();
    const part2 = this.varuint();
    return `${part1}:${part2}`;
  }
  /** Peek the next tag without consuming it. */
  peekTag(): { index: number; type: number } | null {
    const start = this.pos;
    try {
      const x = this.varuint();
      this.pos = start;
      return { index: x >> 4, type: x & 0xf };
    } catch {
      this.pos = start;
      return null;
    }
  }
  /** Consume a tag, throwing if it isn't the expected index/type. */
  tag(index: number, type: number): void {
    const t = this.peekTag();
    if (!t || t.index !== index || t.type !== type) {
      throw new Error(`Expected tag ${index}/${type.toString(16)} at ${this.pos}`);
    }
    this.varuint();
  }
  hasTag(index: number, type: number): boolean {
    const t = this.peekTag();
    return t !== null && t.index === index && t.type === type;
  }
  taggedId(index: number): CrdtId {
    this.tag(index, TAG_ID);
    return this.crdtId();
  }
  taggedBool(index: number): boolean {
    this.tag(index, TAG_BYTE1);
    return this.u8() !== 0;
  }
  taggedU32(index: number): number {
    this.tag(index, TAG_BYTE4);
    return this.u32();
  }
  taggedF64(index: number): number {
    this.tag(index, TAG_BYTE8);
    return this.f64();
  }
  taggedF32(index: number): number {
    this.tag(index, TAG_BYTE4);
    return this.f32();
  }
  /** Enter a length-prefixed subblock; returns its end offset. */
  subblock(index: number): number {
    this.tag(index, TAG_LEN4);
    const len = this.u32();
    return this.pos + len;
  }
  /** LWW wrappers: subblock { 1: timestamp id, 2: value }. */
  lwwString(index: number): string {
    const end = this.subblock(index);
    this.taggedId(1);
    const strEnd = this.subblock(2);
    const len = this.varuint();
    this.u8(); // is-ascii flag
    const text = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos = strEnd;
    this.pos = end;
    return text;
  }
  lwwBool(index: number): boolean {
    const end = this.subblock(index);
    this.taggedId(1);
    const v = this.taggedBool(2);
    this.pos = end;
    return v;
  }
}

const ROOT_ID = '0:1';

/** Parse one .rm v6 page file. Throws on other versions/formats. */
export function parseRmPage(buffer: ArrayBuffer): RmPage {
  const bytes = new Uint8Array(buffer);
  const header = new TextDecoder().decode(bytes.subarray(0, HEADER.length));
  if (!header.startsWith('reMarkable .lines file, version=6')) {
    if (header.startsWith('reMarkable .lines file')) {
      throw new Error('Only .rm files from firmware 3.x (lines v6) are supported.');
    }
    throw new Error('Not a reMarkable .rm page file.');
  }
  const r = new Reader(bytes.subarray(HEADER.length));

  // Collected while walking blocks:
  const nodeMeta = new Map<CrdtId, { label: string; visible: boolean }>();
  const parentOf = new Map<CrdtId, CrdtId>();
  const layerOrder: CrdtId[] = []; // group items anchored under root, file order
  const linesByParent = new Map<CrdtId, RmLine[]>();
  let paperSize: [number, number] | null = null;

  while (r.pos + 8 <= r.length) {
    const blockLength = r.u32();
    r.u8(); // unknown, always 0
    r.u8(); // min version
    const currentVersion = r.u8();
    const blockType = r.u8();
    const end = r.pos + blockLength;
    try {
      switch (blockType) {
        case 0x01: {
          // SceneTreeBlock: tree_id + parent
          const treeId = r.taggedId(1);
          r.taggedId(2);
          r.taggedBool(3);
          const sub = r.subblock(4);
          const parentId = r.taggedId(1);
          r.pos = sub;
          parentOf.set(treeId, parentId);
          break;
        }
        case 0x02: {
          // TreeNodeBlock: group metadata
          const nodeId = r.taggedId(1);
          const label = r.lwwString(2);
          const visible = r.lwwBool(3);
          nodeMeta.set(nodeId, { label, visible });
          break;
        }
        case 0x04: {
          // SceneGroupItemBlock: ordering of child groups (layers under root)
          const parentId = r.taggedId(1);
          r.taggedId(2);
          r.taggedId(3);
          r.taggedId(4);
          r.taggedU32(5);
          if (r.pos < end && r.hasTag(6, TAG_LEN4)) {
            const sub = r.subblock(6);
            const itemType = r.u8();
            if (itemType === 0x02) {
              const childId = r.taggedId(2);
              if (parentId === ROOT_ID) layerOrder.push(childId);
            }
            r.pos = sub;
          }
          break;
        }
        case 0x05: {
          // SceneLineItemBlock: a stroke (or its tombstone)
          const parentId = r.taggedId(1);
          r.taggedId(2);
          r.taggedId(3);
          r.taggedId(4);
          r.taggedU32(5); // deleted length
          if (r.pos < end && r.hasTag(6, TAG_LEN4)) {
            const sub = r.subblock(6);
            const itemType = r.u8();
            if (itemType === 0x03) {
              const line = readLine(r, currentVersion);
              const list = linesByParent.get(parentId) ?? [];
              list.push(line);
              linesByParent.set(parentId, list);
            }
            r.pos = sub;
          }
          break;
        }
        case 0x0d: {
          // SceneInfo: current layer + optional paper size
          const sub = r.subblock(1);
          r.pos = sub;
          for (const idx of [2, 3] as const) {
            if (r.pos < end && r.hasTag(idx, TAG_LEN4)) {
              const b = r.subblock(idx);
              r.pos = b;
            }
          }
          if (r.pos < end && r.hasTag(5, TAG_LEN4)) {
            const b = r.subblock(5);
            paperSize = [r.u32(), r.u32()];
            r.pos = b;
          }
          break;
        }
        default:
          break; // MigrationInfo, PageInfo, text, glyphs not needed to draw
      }
    } catch {
      /* tolerate unknown layouts inside a block — skip to its end */
    }
    r.pos = end;
  }

  const layerIds = layerOrder.length
    ? layerOrder
    : [...parentOf.entries()].filter(([, p]) => p === ROOT_ID).map(([id]) => id);
  const layers: RmLayer[] = layerIds.map((id, i) => ({
    label: nodeMeta.get(id)?.label || `Layer ${i + 1}`,
    visible: nodeMeta.get(id)?.visible ?? true,
    lines: linesByParent.get(id) ?? [],
  }));
  // Strokes whose parent group we didn't resolve still deserve rendering.
  const known = new Set(layerIds);
  const orphans = [...linesByParent.entries()]
    .filter(([id]) => !known.has(id))
    .flatMap(([, lines]) => lines);
  if (orphans.length) layers.push({ label: 'Other', visible: true, lines: orphans });

  return {
    width: paperSize?.[0] ?? 1404,
    height: paperSize?.[1] ?? 1872,
    layers,
  };
}

function readLine(r: Reader, blockVersion: number): RmLine {
  const tool = r.taggedU32(1);
  const color = r.taggedU32(2);
  const thicknessScale = r.taggedF64(3);
  r.taggedF32(4); // starting length
  const sub = r.subblock(5);
  const pointSize = blockVersion === 1 ? 0x18 : 0x0e;
  const count = Math.floor((sub - r.pos) / pointSize);
  const points: RmPoint[] = [];
  for (let i = 0; i < count; i++) {
    const x = r.f32();
    const y = r.f32();
    let width: number;
    let pressure: number;
    if (blockVersion === 1) {
      r.f32(); // speed
      r.f32(); // direction
      width = Math.round(r.f32() * 4);
      pressure = r.f32() * 255;
    } else {
      r.u16(); // speed
      width = r.u16();
      r.u8(); // direction
      pressure = r.u8();
    }
    points.push({ x, y, width, pressure });
  }
  r.pos = sub;
  // timestamp id (6), optional move id (7), optional rgba color (8)
  let colorRgba: RmLine['colorRgba'] = null;
  try {
    r.taggedId(6);
    if (r.hasTag(7, TAG_ID)) r.taggedId(7);
    if (r.hasTag(8, TAG_BYTE4)) {
      const packed = r.taggedU32(8);
      colorRgba = [
        (packed >> 16) & 0xff,
        (packed >> 8) & 0xff,
        packed & 0xff,
        (packed >> 24) & 0xff,
      ];
    }
  } catch {
    /* trailing fields are optional */
  }
  return { tool, color, colorRgba, thicknessScale, points };
}

// --- rendering --------------------------------------------------------------

/** Palette from the community renderers (rmc / remt). Index = PenColor. */
const COLORS: Record<number, string> = {
  0: '#000000', // black
  1: '#7d7d7d', // gray
  2: '#ffffff', // white
  3: '#fbec5d', // yellow (highlight)
  4: '#2e7d32', // green
  5: '#e04a8a', // pink
  6: '#0062cc', // blue
  7: '#d90707', // red
  8: '#bfbfbf', // gray overlap
  9: '#fbec5d', // highlight (rgba override usually present)
  10: '#4caf50', // green 2
  11: '#00bcd4', // cyan
  12: '#c051c9', // magenta
  13: '#ffd54f', // yellow 2
};

const HIGHLIGHTERS = new Set([5, 18]);
const ERASERS = new Set([6, 8]);

function strokeStyle(line: RmLine): { color: string; alpha: number } {
  if (ERASERS.has(line.tool)) return { color: '#ffffff', alpha: 1 };
  if (line.colorRgba) {
    const [red, green, blue, alpha] = line.colorRgba;
    return {
      color: `rgb(${red},${green},${blue})`,
      alpha: HIGHLIGHTERS.has(line.tool) ? 0.45 : alpha / 255,
    };
  }
  return { color: COLORS[line.color] ?? '#000000', alpha: HIGHLIGHTERS.has(line.tool) ? 0.45 : 1 };
}

/**
 * Draw a page onto a canvas at `scale`. Newer firmware stores x centred on
 * 0 — detected via negative x values and shifted by half the page width.
 */
export function renderRmPage(page: RmPage, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * scale);
  canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let centred = false;
  for (const layer of page.layers) {
    for (const line of layer.lines) {
      if (line.points.some((p) => p.x < -1)) {
        centred = true;
        break;
      }
    }
    if (centred) break;
  }
  const xoff = centred ? page.width / 2 : 0;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const layer of page.layers) {
    if (!layer.visible) continue;
    for (const line of layer.lines) {
      if (line.tool === 8) continue; // area eraser: already applied on-device
      const pts = line.points;
      if (pts.length < 2) continue;
      const { color, alpha } = strokeStyle(line);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        ctx.lineWidth = Math.max(0.5, ((a.width + b.width) / 8) * scale);
        ctx.beginPath();
        ctx.moveTo((a.x + xoff) * scale, a.y * scale);
        ctx.lineTo((b.x + xoff) * scale, b.y * scale);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  return canvas;
}
