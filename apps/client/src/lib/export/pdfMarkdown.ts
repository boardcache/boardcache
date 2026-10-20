import type { jsPDF as Pdf } from 'jspdf';
/**
 * Robust markdown → real (vector) PDF text for the Asset PDF export: headings,
 * bold/italic/code, lists, blockquotes (with a rule), fenced code blocks,
 * tables, horizontal rules, and inline emoji (rasterized, since the built-in
 * PDF fonts have no emoji glyphs).
 */

type Rgb = [number, number, number];

const HEADING = [1.7, 1.45, 1.25, 1.12, 1.0, 1.0];
const LINE = 1.34;
const CODE_PAD = 6;
const CELL_PAD = 5;

export interface PdfTextStyle {
  base: number;
  width: number; // text column width (pt)
  marginX: number; // left margin (pt)
  pageW: number;
  fg: Rgb;
  codeColor: Rgb;
  align: 'left' | 'center' | 'right';
  /** jsPDF font name for body text (core or embedded); default helvetica. */
  fontName?: string;
}

// Active body font for measurement + drawing. layoutMarkdown/drawUnitsPage
// set it from their style so per-item fonts stay consistent between the two.
let BODY_FONT = 'helvetica';

let PDF_DARK = false;
export function setPdfDark(dark: boolean): void {
  PDF_DARK = dark;
}

// ── Inline parsing ──

interface Span {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
}
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
      i += 2;
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

// ── Blocks ──

type Block =
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'para'; spans: Span[] }
  | { kind: 'list'; marker: string; spans: Span[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'hr' }
  | { kind: 'blank' }
  | { kind: 'table'; rows: Span[][][]; headerRows: number };

const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) code.push(lines[i++]!);
      blocks.push({ kind: 'code', lines: code });
      continue;
    }
    // Table: a row line followed by a separator row.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const rows: Span[][][] = [splitRow(line).map(parseInline)];
      i += 2; // skip header + separator
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(splitRow(lines[i]!).map(parseInline));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'table', rows, headerRows: 1 });
      continue;
    }
    if (line.trim() === '') {
      blocks.push({ kind: 'blank' });
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/)))
      blocks.push({ kind: 'heading', level: m[1]!.length, spans: parseInline(m[2]!) });
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) blocks.push({ kind: 'hr' });
    else if ((m = line.match(/^\s*>\s?(.*)$/)))
      blocks.push({ kind: 'quote', spans: parseInline(m[1]!) });
    else if ((m = line.match(/^\s*[-*+]\s+(.*)$/)))
      blocks.push({
        kind: 'list',
        marker: '•',
        spans: parseInline(m[1]!.replace(/^\[[ xX/]\]\s*/, '')),
      });
    else if ((m = line.match(/^\s*(\d+)\.\s+(.*)$/)))
      blocks.push({ kind: 'list', marker: `${m[1]}.`, spans: parseInline(m[2]!) });
    else blocks.push({ kind: 'para', spans: parseInline(line) });
  }
  return blocks;
}

// ── Words + measurement ──

interface PWord {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  code: boolean;
  emoji: boolean;
  attached: boolean;
}
const EMOJI_RE =
  /(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*|[\u{1F1E6}-\u{1F1FF}]{2})/gu;

function setFont(
  pdf: Pdf,
  w: { size: number; bold: boolean; italic: boolean; code: boolean },
): void {
  if (w.code) pdf.setFont('courier', w.bold ? 'bold' : 'normal');
  else
    pdf.setFont(
      BODY_FONT,
      w.bold && w.italic ? 'bolditalic' : w.bold ? 'bold' : w.italic ? 'italic' : 'normal',
    );
  pdf.setFontSize(w.size);
}
function wordWidth(pdf: Pdf, w: PWord): number {
  if (w.emoji) return w.size;
  setFont(pdf, w);
  return pdf.getTextWidth(w.text);
}
function spaceWidth(pdf: Pdf, w: PWord): number {
  setFont(pdf, w);
  return pdf.getTextWidth(' ');
}

/** Split a whitespace-free token into text / emoji runs. */
function splitEmoji(tok: string): { text: string; emoji: boolean }[] {
  const parts: { text: string; emoji: boolean }[] = [];
  EMOJI_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = EMOJI_RE.exec(tok)) !== null) {
    if (m.index > last) parts.push({ text: tok.slice(last, m.index), emoji: false });
    parts.push({ text: m[0], emoji: true });
    last = m.index + m[0].length;
    if (m.index === EMOJI_RE.lastIndex) EMOJI_RE.lastIndex += 1;
  }
  if (last < tok.length) parts.push({ text: tok.slice(last), emoji: false });
  if (!parts.length) parts.push({ text: tok, emoji: false });
  return parts;
}

/** Inline spans → words; emoji become their own words; `attached` = no leading space. */
function spansToWords(spans: Span[], size: number, headingBold: boolean, quote: boolean): PWord[] {
  const out: PWord[] = [];
  let prevSpace = true;
  for (const span of spans) {
    const lead = /^\s/.test(span.text);
    const trail = /\s$/.test(span.text);
    const tokens = span.text.split(/\s+/).filter(Boolean);
    tokens.forEach((tok, ti) => {
      const spaceBefore = ti === 0 ? prevSpace || lead : true;
      splitEmoji(tok).forEach((part, pi) => {
        out.push({
          text: part.text,
          size,
          bold: span.bold || headingBold,
          italic: span.italic || quote,
          code: span.code,
          emoji: part.emoji,
          attached: pi === 0 ? !spaceBefore : true,
        });
      });
    });
    if (tokens.length) prevSpace = trail;
    else prevSpace = lead || trail;
  }
  if (out[0]) out[0].attached = true;
  return out;
}

/** Break a word that's wider than maxW into pieces that fit (at hyphens, else
 *  per character) so narrow table cells don't overflow. */
function breakWord(pdf: Pdf, w: PWord, maxW: number): PWord[] {
  if (w.emoji || maxW <= 0) return [w];
  setFont(pdf, w);
  if (pdf.getTextWidth(w.text) <= maxW) return [w];
  const pieces: string[] = [];
  let cur = '';
  for (const seg of w.text.split(/(?<=-)/)) {
    for (const ch of seg) {
      if (cur && pdf.getTextWidth(cur + ch) > maxW) {
        pieces.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
  }
  if (cur) pieces.push(cur);
  return pieces.map((text, i) => ({ ...w, text, attached: i === 0 ? w.attached : true }));
}

function wrap(pdf: Pdf, rawWords: PWord[], maxW: number): PWord[][] {
  const words = rawWords.flatMap((w) => breakWord(pdf, w, maxW));
  const lines: PWord[][] = [];
  let cur: PWord[] = [];
  let curW = 0;
  for (const w of words) {
    const ww = wordWidth(pdf, w);
    const sp = cur.length && !w.attached ? spaceWidth(pdf, w) : 0;
    if (cur.length && curW + sp + ww > maxW) {
      lines.push(cur);
      cur = [w];
      curW = ww;
    } else {
      cur.push(w);
      curW += sp + ww;
    }
  }
  if (cur.length) lines.push(cur);
  if (!lines.length) lines.push([]);
  return lines;
}

// ── Layout units ──

export type Unit =
  | {
      kind: 'line';
      gapBefore: number;
      height: number;
      size: number;
      words: PWord[];
      indent: number;
      marker: string | null;
      quote: boolean;
    }
  | {
      kind: 'code';
      gapBefore: number;
      height: number;
      size: number;
      text: string;
      firstLine: boolean;
      lastLine: boolean;
    }
  | {
      kind: 'codetoks';
      gapBefore: number;
      height: number;
      size: number;
      tokens: { text: string; color: Rgb }[];
    }
  | { kind: 'hr'; gapBefore: number; height: number; size: number }
  | {
      kind: 'tablerow';
      gapBefore: number;
      height: number;
      cells: PWord[][][];
      colW: number[];
      header: boolean;
    };

export function layoutMarkdown(pdf: Pdf, text: string, style: PdfTextStyle): Unit[] {
  BODY_FONT = style.fontName ?? 'helvetica';
  const { base, width } = style;
  const units: Unit[] = [];
  let pendingGap = 0;
  const blocks = parseBlocks(text);

  for (const block of blocks) {
    if (block.kind === 'blank') {
      pendingGap = Math.max(pendingGap, base * 0.6);
      continue;
    }
    if (block.kind === 'hr') {
      units.push({
        kind: 'hr',
        gapBefore: pendingGap + base * 0.4,
        height: base * LINE,
        size: base,
      });
      pendingGap = 0;
      continue;
    }
    if (block.kind === 'code') {
      const size = base * 0.92;
      block.lines.forEach((ln, i) => {
        units.push({
          kind: 'code',
          gapBefore: i === 0 ? pendingGap + base * 0.4 : 0,
          height: size * 1.5,
          size,
          text: ln,
          firstLine: i === 0,
          lastLine: i === block.lines.length - 1,
        });
      });
      if (!block.lines.length)
        units.push({
          kind: 'code',
          gapBefore: pendingGap + base * 0.4,
          height: size * 1.5,
          size,
          text: '',
          firstLine: true,
          lastLine: true,
        });
      pendingGap = base * 0.3;
      continue;
    }
    if (block.kind === 'table') {
      layoutTable(pdf, block, style, pendingGap + base * 0.4).forEach((u) => units.push(u));
      pendingGap = base * 0.3;
      continue;
    }
    const size = block.kind === 'heading' ? base * (HEADING[block.level - 1] ?? 1) : base;
    const indent = block.kind === 'list' ? base * 1.4 : block.kind === 'quote' ? base * 0.9 : 0;
    const quote = block.kind === 'quote';
    const marker = block.kind === 'list' ? block.marker : null;
    const words = spansToWords(block.spans, size, block.kind === 'heading', quote);
    const lines = wrap(pdf, words, width - indent);
    const headGap = block.kind === 'heading' ? base * 0.55 : 0;
    lines.forEach((ws, i) => {
      units.push({
        kind: 'line',
        gapBefore: i === 0 ? pendingGap + headGap : 0,
        height: (ws.length ? Math.max(...ws.map((x) => x.size)) : size) * LINE,
        size: ws.length ? Math.max(...ws.map((x) => x.size)) : size,
        words: ws,
        indent,
        marker: i === 0 ? marker : null,
        quote,
      });
    });
    // A little extra space after a heading before its content.
    pendingGap = block.kind === 'heading' ? base * 0.3 : 0;
  }
  return units;
}

function layoutTable(
  pdf: Pdf,
  block: { rows: Span[][][]; headerRows: number },
  style: PdfTextStyle,
  gapBefore: number,
): Unit[] {
  const { base, width } = style;
  const size = base * 0.95;
  const cols = Math.max(...block.rows.map((r) => r.length));
  // Natural (unwrapped) width per column.
  const natural = new Array(cols).fill(20);
  for (const row of block.rows) {
    row.forEach((cell, c) => {
      const words = spansToWords(cell, size, false, false);
      let w = 2 * CELL_PAD;
      words.forEach((wd, i) => (w += wordWidth(pdf, wd) + (i ? spaceWidth(pdf, wd) : 0)));
      natural[c] = Math.max(natural[c], w);
    });
  }
  const sum = natural.reduce((a: number, b: number) => a + b, 0);
  const colW: number[] =
    sum > width
      ? natural.map((n: number) => (n / sum) * width)
      : natural.map((n: number) => n + (width - sum) / cols);

  const units: Unit[] = [];
  block.rows.forEach((row, ri) => {
    const header = ri < block.headerRows;
    const cells: PWord[][][] = [];
    let maxLines = 1;
    for (let c = 0; c < cols; c++) {
      const cell = row[c] ?? [];
      const words = spansToWords(cell, size, header, false);
      const lines = wrap(pdf, words, colW[c]! - 2 * CELL_PAD);
      cells.push(lines);
      maxLines = Math.max(maxLines, lines.length);
    }
    units.push({
      kind: 'tablerow',
      gapBefore: ri === 0 ? gapBefore : 0,
      height: maxLines * size * LINE + 2 * CELL_PAD,
      cells,
      colW,
      header,
    });
  });
  return units;
}

// ── Pagination + drawing ──

function drawEmoji(pdf: Pdf, ch: string, x: number, baseline: number, size: number): void {
  const px = Math.max(8, Math.round(size * 4));
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const ctx = c.getContext('2d')!;
  ctx.font = `${Math.round(px * 0.82)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(ch, px * 0.05, px * 0.84);
  try {
    pdf.addImage(c.toDataURL('image/png'), 'PNG', x, baseline - size * 0.82, size, size);
  } catch {
    /* ignore */
  }
}

function drawWords(
  pdf: Pdf,
  words: PWord[],
  startX: number,
  baseline: number,
  style: PdfTextStyle,
  color: Rgb,
): void {
  let cx = startX;
  words.forEach((w, i) => {
    if (i && !w.attached) cx += spaceWidth(pdf, w);
    if (w.emoji) {
      drawEmoji(pdf, w.text, cx, baseline, w.size);
    } else {
      setFont(pdf, w);
      const c = w.code ? style.codeColor : color;
      pdf.setTextColor(c[0], c[1], c[2]);
      pdf.text(w.text, cx, baseline);
    }
    cx += wordWidth(pdf, w);
  });
}
function lineWidth(pdf: Pdf, words: PWord[]): number {
  let w = 0;
  words.forEach(
    (wd, i) => (w += wordWidth(pdf, wd) + (i && !wd.attached ? spaceWidth(pdf, wd) : 0)),
  );
  return w;
}

/** Draw one page of units starting at top y. */
export function drawUnitsPage(pdf: Pdf, units: Unit[], top: number, style: PdfTextStyle): void {
  BODY_FONT = style.fontName ?? 'helvetica';
  const { base, width, marginX, pageW, fg } = style;
  let y = top;
  for (const u of units) {
    y += u.gapBefore;
    if (u.kind === 'hr') {
      pdf.setDrawColor(fg[0], fg[1], fg[2]);
      pdf.setLineWidth(Math.max(0.6, u.size * 0.06));
      pdf.line(marginX, y + u.size * 0.6, pageW - marginX, y + u.size * 0.6);
      y += u.height;
      continue;
    }
    if (u.kind === 'codetoks') {
      // Syntax-colored code line: monospace runs on the code band.
      if (PDF_DARK) pdf.setFillColor(32, 34, 40);
      else pdf.setFillColor(244, 245, 248);
      pdf.rect(marginX, y, width, u.height, 'F');
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(u.size);
      let x = marginX + CODE_PAD;
      const baseline = y + u.height - u.size * 0.4;
      for (const t of u.tokens) {
        pdf.setTextColor(t.color[0], t.color[1], t.color[2]);
        pdf.text(t.text, x, baseline);
        x += pdf.getTextWidth(t.text);
      }
      y += u.height;
      continue;
    }
    if (u.kind === 'code') {
      if (PDF_DARK) pdf.setFillColor(32, 34, 40);
      else pdf.setFillColor(244, 245, 248);
      pdf.rect(marginX, y, width, u.height, 'F');
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(u.size);
      if (PDF_DARK) pdf.setTextColor(202, 207, 216);
      else pdf.setTextColor(60, 64, 72);
      pdf.text(u.text || ' ', marginX + CODE_PAD, y + u.height - u.size * 0.4, {
        maxWidth: width - CODE_PAD * 2,
      });
      y += u.height;
      continue;
    }
    if (u.kind === 'tablerow') {
      let x = marginX;
      for (let c = 0; c < u.cells.length; c++) {
        const cw = u.colW[c]!;
        if (u.header) {
          if (PDF_DARK) pdf.setFillColor(34, 36, 42);
          else pdf.setFillColor(238, 240, 244);
          pdf.rect(x, y, cw, u.height, 'F');
        }
        if (PDF_DARK) pdf.setDrawColor(70, 74, 82);
        else pdf.setDrawColor(205, 208, 214);
        pdf.setLineWidth(0.5);
        pdf.rect(x, y, cw, u.height, 'S');
        const lines = u.cells[c]!;
        let ly = y + CELL_PAD;
        for (const ln of lines) {
          const size = ln.length ? Math.max(...ln.map((w) => w.size)) : u.height;
          drawWords(pdf, ln, x + CELL_PAD, ly + size, style, fg);
          ly += size * LINE;
        }
        x += cw;
      }
      y += u.height;
      continue;
    }
    // line
    const baseline = y + u.size;
    if (u.quote) {
      if (PDF_DARK) pdf.setFillColor(86, 90, 98);
      else pdf.setFillColor(190, 194, 200);
      pdf.rect(marginX, y, 3, u.height, 'F');
    }
    const lw = lineWidth(pdf, u.words);
    const avail = width - u.indent;
    const startX =
      style.align === 'center'
        ? marginX + u.indent + (avail - lw) / 2
        : style.align === 'right'
          ? marginX + u.indent + avail - lw
          : marginX + u.indent;
    if (u.marker) {
      pdf.setFont(BODY_FONT, 'normal');
      pdf.setFontSize(base);
      pdf.setTextColor(fg[0], fg[1], fg[2]);
      pdf.text(u.marker, marginX + u.indent - base * 1.15, baseline);
    }
    drawWords(pdf, u.words, startX, baseline, style, u.quote ? [110, 114, 122] : fg);
    y += u.height;
  }
}
