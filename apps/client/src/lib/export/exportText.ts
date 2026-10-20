import { textCardDefaults } from '../themes';
import type { TextItem } from '@boardcache/schema';
import { readableTextColor, splitHexAlpha } from '../color/color';

/**
 * Draws a text item's markdown into a 2D context, formatted — headings, bold,
 * italic, inline code, lists, blockquotes, and rules — with real word-wrap and
 * alignment. Used by the PNG/board exports (rule 3.1: render from data, never
 * the DOM, so it can't taint the canvas).
 */

const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
// Mirrors .text-item's CSS padding (16px 20px) so thumbnails/PDF match.
const PAD_X = 20;
const PAD_Y = 16;
const LINE = 1.4;
// Heading scale relative to the body font size (h1..h6), matching the editor.
/** Heading size multipliers (h1..h6), relative to the body font size. */
const MARKDOWN_HEADING = [1.7, 1.45, 1.25, 1.12, 1.0, 1.0];
const HEADING = MARKDOWN_HEADING;

interface Span {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
}
type BlockKind = 'h' | 'p' | 'li' | 'quote' | 'code' | 'hr' | 'table';
interface Block {
  kind: BlockKind;
  level: number;
  marker: string | null;
  spans: Span[];
  /** GFM table: the header row, then the body rows (cells as spans). */
  table?: { header: Span[][]; rows: Span[][][] };
}

/** A GFM table row "| a | b |" → its cells (outer pipes optional). */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Split a line of inline markdown into styled spans (links → their text). */
function parseInline(src: string): Span[] {
  const s = src.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const spans: Span[] = [];
  let bold = false;
  let italic = false;
  let code = false;
  let buf = '';
  const flush = () => {
    if (buf) spans.push({ text: buf, bold, italic, code });
    buf = '';
  };
  for (let i = 0; i < s.length; ) {
    const two = s.slice(i, i + 2);
    const ch = s[i]!;
    if (!code && (two === '**' || two === '__')) {
      flush();
      bold = !bold;
      i += 2;
    } else if (!code && two === '~~') {
      flush();
      i += 2; // strikethrough → plain text
    } else if (!code && (ch === '*' || ch === '_')) {
      flush();
      italic = !italic;
      i += 1;
    } else if (ch === '`') {
      flush();
      code = !code;
      i += 1;
    } else {
      buf += ch;
      i += 1;
    }
  }
  flush();
  return spans;
}

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  const lines = src.replace(/\r/g, '').split('\n');
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]!;
    // A header row followed by the separator row opens a table; rows run
    // until a line without a pipe.
    if (
      !inCode &&
      raw.includes('|') &&
      n + 1 < lines.length &&
      TABLE_SEPARATOR.test(lines[n + 1]!) &&
      lines[n + 1]!.includes('|')
    ) {
      const header = splitRow(raw).map(parseInline);
      const rows: Span[][][] = [];
      let k = n + 2;
      while (k < lines.length && lines[k]!.includes('|') && lines[k]!.trim() !== '') {
        const cells = splitRow(lines[k]!).map(parseInline);
        while (cells.length < header.length) cells.push([]);
        rows.push(cells.slice(0, header.length));
        k++;
      }
      blocks.push({ kind: 'table', level: 0, marker: null, spans: [], table: { header, rows } });
      n = k - 1;
      continue;
    }
    if (raw.trim().startsWith('```')) {
      if (inCode) {
        blocks.push({
          kind: 'code',
          level: 0,
          marker: null,
          spans: [{ text: codeLines.join('\n'), bold: false, italic: false, code: true }],
        });
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(raw);
      continue;
    }
    if (raw.trim() === '') {
      blocks.push({ kind: 'p', level: 0, marker: null, spans: [] });
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = raw.match(/^(#{1,6})\s+(.*)$/))) {
      blocks.push({ kind: 'h', level: m[1]!.length, marker: null, spans: parseInline(m[2]!) });
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      blocks.push({ kind: 'hr', level: 0, marker: null, spans: [] });
    } else if ((m = raw.match(/^\s*>\s?(.*)$/))) {
      blocks.push({ kind: 'quote', level: 0, marker: null, spans: parseInline(m[1]!) });
    } else if ((m = raw.match(/^\s*[-*+]\s+(.*)$/))) {
      blocks.push({
        kind: 'li',
        level: 0,
        marker: '•',
        spans: parseInline(m[1]!.replace(/^\[[ xX/]\]\s*/, '')),
      });
    } else if ((m = raw.match(/^\s*(\d+)\.\s+(.*)$/))) {
      blocks.push({ kind: 'li', level: 0, marker: `${m[1]}.`, spans: parseInline(m[2]!) });
    } else {
      blocks.push({ kind: 'p', level: 0, marker: null, spans: parseInline(raw) });
    }
  }
  return blocks;
}

interface Word {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  code: boolean;
  /** No space before this word (it abutted the previous span, e.g. "bold,"). */
  attached: boolean;
}
interface Line {
  words: Word[];
  size: number;
}

function fontFor(family: string, w: Word): string {
  const style = w.italic ? 'italic ' : '';
  const weight = w.bold ? '700 ' : '400 ';
  return `${style}${weight}${w.size}px ${w.code ? MONO : family}`;
}

function blockWords(block: Block, base: number): Word[] {
  const size = block.kind === 'h' ? base * (HEADING[block.level - 1] ?? 1) : base;
  const headingBold = block.kind === 'h';
  const out: Word[] = [];
  let prevEndedSpace = true; // the first word never takes a leading space
  for (const span of block.spans) {
    const leadSpace = /^\s/.test(span.text);
    const trailSpace = /\s$/.test(span.text);
    const parts = span.text.split(/\s+/).filter(Boolean);
    parts.forEach((part, i) => {
      out.push({
        text: part,
        size,
        bold: span.bold || headingBold,
        italic: span.italic || block.kind === 'quote',
        code: span.code,
        attached: i === 0 && !prevEndedSpace && !leadSpace,
      });
    });
    if (parts.length) prevEndedSpace = trailSpace;
    else if (leadSpace || trailSpace) prevEndedSpace = true;
  }
  return out;
}

/** Render formatted markdown into the box at (ox, oy) sized (w, h). */
export function drawMarkdownText(
  ctx: CanvasRenderingContext2D,
  item: TextItem,
  ox: number,
  oy: number,
  forceDark?: boolean,
): void {
  const { width: w, height: h } = item;
  const dark = forceDark ?? document.documentElement.dataset.theme === 'dark';
  const auto = textCardDefaults(dark);
  const bg =
    item.background === 'auto'
      ? auto.background
      : (item.background ?? (dark ? '#16181d' : '#ffffff'));
  // Default ink mirrors textColor(): card ink over the auto card; over a
  // mostly-transparent or missing card, the canvas ink; else readable vs the
  // card's solid part (bg may carry #rrggbbaa alpha).
  const bgSplit = splitHexAlpha(bg);
  const fg =
    item.color === 'default'
      ? item.background === 'auto'
        ? auto.color
        : item.background === null || bgSplit.alpha < 0.5
          ? dark
            ? '#f0f0f1'
            : '#16181d'
          : readableTextColor(bgSplit.hex)
      : item.color;
  const family = item.fontFamily || 'sans-serif';
  const base = item.fontSize;
  const innerW = Math.max(1, w - PAD_X * 2);

  if (item.background) {
    ctx.fillStyle = bg;
    ctx.fillRect(ox, oy, w, h);
  }

  const laid = layoutLines(ctx, item.text, base, family, innerW);
  const rawTotal = laid.reduce((sum, ln) => sum + ln.gapBefore + lineHeight(ln), 0);
  // The box height was auto-fit to the editor's DOM metrics; if our canvas
  // metrics run a touch taller, compress line spacing so nothing spills past
  // the box's bottom (which is the edge of the exported region).
  const availH = h - PAD_Y * 2;
  const fit = rawTotal > availH ? Math.max(0.78, availH / rawTotal) : 1;
  const totalH = rawTotal * fit;

  let yStart = oy + PAD_Y;
  if (item.verticalAlign === 'middle') yStart = oy + Math.max(PAD_Y, (h - totalH) / 2);
  else if (item.verticalAlign === 'bottom') yStart = oy + Math.max(PAD_Y, h - PAD_Y - totalH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, w, h);
  ctx.clip();
  paintLines(ctx, laid, {
    family,
    base,
    fg,
    codeColor: dark ? '#e6b673' : '#b3531d',
    align: item.align,
    ox,
    innerW,
    w,
    yStart,
    lineScale: fit,
  });
  ctx.restore();
}

// ── Shared layout + paint, reused by the box renderer and the paginated one ──

/** A laid-out table: column widths and, per row, the wrapped lines of each cell. */
interface LaidTable {
  colWidths: number[];
  rows: { header: boolean; cells: Line[][]; height: number }[];
  height: number;
}

interface LaidLine extends Line {
  indent: number;
  marker: string | null;
  rule: boolean;
  gapBefore: number;
  /** Set for a table block; `size * LINE` is then not its height. */
  table?: LaidTable;
}

/** The height a laid line takes, lines or table. */
function lineHeight(ln: LaidLine): number {
  return ln.table ? ln.table.height : ln.size * LINE;
}

/** Word-wrap words into lines no wider than maxW (one word per line at least). */
function wrapWords(
  ctx: CanvasRenderingContext2D,
  words: Word[],
  family: string,
  maxW: number,
  base: number,
): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [];
  let curW = 0;
  for (const word of words) {
    ctx.font = fontFor(family, word);
    const ww = ctx.measureText(word.text).width;
    const sp = cur.length && !word.attached ? spaceWidth(ctx, family, word) : 0;
    if (cur.length && curW + sp + ww > maxW) {
      lines.push({ words: cur, size: Math.max(...cur.map((x) => x.size)) });
      cur = [word];
      curW = ww;
    } else {
      cur.push(word);
      curW += sp + ww;
    }
  }
  if (cur.length) lines.push({ words: cur, size: Math.max(...cur.map((x) => x.size)) });
  if (!lines.length) lines.push({ words: [], size: base });
  return lines;
}

const CELL_PAD_X = 8;
const CELL_PAD_Y = 4;

/**
 * Lay a table out at width innerW: columns get their natural width when it
 * all fits, else shrink in proportion (never below ~4 characters); cells
 * wrap inside their column.
 */
function layoutTable(
  ctx: CanvasRenderingContext2D,
  table: NonNullable<Block['table']>,
  base: number,
  family: string,
  innerW: number,
): LaidTable {
  const cellWords = (spans: Span[], header: boolean): Word[] =>
    blockWords({ kind: 'p', level: 0, marker: null, spans }, base).map((w) =>
      header ? { ...w, bold: true } : w,
    );
  // A header of empty cells (a "| | |" label table) takes no row of its own.
  const headerBlank = table.header.every((spans) => spans.every((sp) => !sp.text.trim()));
  const allRows = [
    ...(headerBlank ? [] : [{ header: true, cells: table.header }]),
    ...table.rows.map((cells) => ({ header: false, cells })),
  ];
  const cols = table.header.length;
  const natural = new Array<number>(cols).fill(0);
  // The narrowest a column can go: its longest single word still fits.
  const floor = new Array<number>(cols).fill(CELL_PAD_X * 2);
  const wordsByRow = allRows.map((row) =>
    row.cells.map((spans, c) => {
      const words = cellWords(spans, row.header);
      let w = 0;
      words.forEach((wd, i) => {
        ctx.font = fontFor(family, wd);
        const ww = ctx.measureText(wd.text).width;
        w += ww + (i && !wd.attached ? spaceWidth(ctx, family, wd) : 0);
        floor[c] = Math.max(floor[c]!, ww + CELL_PAD_X * 2);
      });
      natural[c] = Math.max(natural[c]!, w + CELL_PAD_X * 2);
      return words;
    }),
  );
  const total = natural.reduce((a, b) => a + b, 0);
  let colWidths = natural.slice();
  if (total > innerW) {
    // Every column keeps its floor; the rest of the width goes to columns in
    // proportion to how much more than their floor they asked for.
    const floors = floor.reduce((a, b) => a + b, 0);
    if (floors >= innerW) {
      colWidths = floor.map((w) => (w * innerW) / floors);
    } else {
      const wants = natural.map((w, c) => Math.max(0, w - floor[c]!));
      const wantTotal = wants.reduce((a, b) => a + b, 0) || 1;
      const spare = innerW - floors;
      colWidths = floor.map((w, c) => w + (spare * wants[c]!) / wantTotal);
    }
  }
  const rows = allRows.map((row, r) => {
    const cells = row.cells.map((_, c) =>
      wrapWords(ctx, wordsByRow[r]![c]!, family, colWidths[c]! - CELL_PAD_X * 2, base),
    );
    const height =
      Math.max(...cells.map((lines) => lines.reduce((h, ln) => h + ln.size * LINE, 0))) +
      CELL_PAD_Y * 2;
    return { header: row.header, cells, height };
  });
  return { colWidths, rows, height: rows.reduce((h, r) => h + r.height, 0) };
}

function spaceWidth(ctx: CanvasRenderingContext2D, family: string, word: Word): number {
  ctx.font = fontFor(family, word);
  return ctx.measureText(' ').width;
}

/** Parse markdown and wrap every block into laid-out lines at width innerW. */
function layoutLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  base: number,
  family: string,
  innerW: number,
): LaidLine[] {
  const laid: LaidLine[] = [];
  // A blank line adds a paragraph gap rather than a full empty line (which was
  // doubling the spacing); carry it onto the next real line.
  let pendingGap = 0;
  for (const block of parseBlocks(text)) {
    if (block.kind === 'hr') {
      laid.push({
        words: [],
        size: base,
        indent: 0,
        marker: null,
        rule: true,
        gapBefore: pendingGap + base * 0.6,
      });
      pendingGap = 0;
      continue;
    }
    if (block.kind === 'p' && block.spans.length === 0) {
      pendingGap = Math.max(pendingGap, base * 0.6);
      continue;
    }
    if (block.kind === 'table' && block.table) {
      laid.push({
        words: [],
        size: base,
        indent: 0,
        marker: null,
        rule: false,
        gapBefore: pendingGap + base * 0.3,
        table: layoutTable(ctx, block.table, base, family, innerW),
      });
      pendingGap = base * 0.3;
      continue;
    }
    const indent = block.kind === 'li' ? base * 1.4 : block.kind === 'quote' ? base * 0.8 : 0;
    const words = blockWords(block, base);
    const lines = wrapWords(ctx, words, family, innerW - indent, base);

    const headGap = block.kind === 'h' ? base * 0.45 : 0;
    lines.forEach((ln, i) => {
      laid.push({
        ...ln,
        indent,
        marker: i === 0 ? block.marker : null,
        rule: false,
        gapBefore: i === 0 ? pendingGap + headGap : 0,
      });
    });
    pendingGap = 0;
  }
  return laid;
}

interface PaintOpts {
  family: string;
  base: number;
  fg: string;
  codeColor: string;
  align: 'left' | 'center' | 'right';
  ox: number;
  innerW: number;
  w: number;
  yStart: number;
  lineScale: number;
}

/** Paint a laid table at (left, top); returns the height used. Rules under
 *  the header and between rows, like the rendered markdown. */
function paintTable(
  ctx: CanvasRenderingContext2D,
  table: LaidTable,
  o: PaintOpts,
  left: number,
  top: number,
): number {
  const tableW = table.colWidths.reduce((a, b) => a + b, 0);
  let y = top;
  const rule = (yy: number, alpha: number) => {
    ctx.strokeStyle = o.fg;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1, o.base * 0.06);
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(left + tableW, yy);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  for (const row of table.rows) {
    const rowH = row.height * o.lineScale;
    let cx = left;
    row.cells.forEach((lines, c) => {
      let ly = y + CELL_PAD_Y * o.lineScale;
      for (const ln of lines) {
        const baseline = ly + ln.size;
        let x = cx + CELL_PAD_X;
        ln.words.forEach((wd, i) => {
          ctx.font = fontFor(o.family, wd);
          if (i && !wd.attached) x += spaceWidth(ctx, o.family, wd);
          ctx.fillStyle = wd.code ? o.codeColor : o.fg;
          ctx.fillText(wd.text, x, baseline);
          x += ctx.measureText(wd.text).width;
        });
        ly += ln.size * LINE * o.lineScale;
      }
      cx += table.colWidths[c]!;
    });
    y += rowH;
    rule(y, row.header ? 0.45 : 0.18);
  }
  return y - top;
}

function paintLines(ctx: CanvasRenderingContext2D, laid: LaidLine[], o: PaintOpts): void {
  ctx.textBaseline = 'alphabetic';
  let y = o.yStart;
  for (const ln of laid) {
    y += ln.gapBefore * o.lineScale;
    const lh = ln.size * LINE * o.lineScale;
    const left = o.ox + PAD_X + ln.indent;
    const avail = o.innerW - ln.indent;

    if (ln.rule) {
      ctx.strokeStyle = o.fg;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = Math.max(1, o.base * 0.08);
      ctx.beginPath();
      ctx.moveTo(o.ox + PAD_X, y + lh / 2);
      ctx.lineTo(o.ox + o.w - PAD_X, y + lh / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      y += lh;
      continue;
    }
    if (ln.table) {
      y += paintTable(ctx, ln.table, o, left, y);
      continue;
    }

    const baseline = y + ln.size;
    let lineW = 0;
    ln.words.forEach((wd, i) => {
      ctx.font = fontFor(o.family, wd);
      lineW +=
        ctx.measureText(wd.text).width + (i && !wd.attached ? spaceWidth(ctx, o.family, wd) : 0);
    });
    let cx =
      o.align === 'center'
        ? left + (avail - lineW) / 2
        : o.align === 'right'
          ? left + avail - lineW
          : left;

    if (ln.marker) {
      ctx.font = `400 ${ln.size}px ${o.family}`;
      ctx.fillStyle = o.fg;
      ctx.fillText(ln.marker, o.ox + PAD_X + (ln.indent - o.base * 1.2), baseline);
    }

    ln.words.forEach((wd, i) => {
      ctx.font = fontFor(o.family, wd);
      if (i && !wd.attached) cx += spaceWidth(ctx, o.family, wd);
      ctx.fillStyle = wd.code ? o.codeColor : o.fg;
      ctx.fillText(wd.text, cx, baseline);
      cx += ctx.measureText(wd.text).width;
    });
    y += lh;
  }
}
