import type { jsPDF as Pdf } from 'jspdf';
import type { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { activePageId } from '../board/pages';
import { PDF_CATEGORY_LABEL, PDF_CATEGORY_ORDER } from './pdfCategories';
import type { PdfCategory } from './pdfCategories';
import { itemType } from '../../itemTypes';
import type {
  CodeItem,
  RecipeItem,
  CanvasDocument,
  FontItem,
  Item,
  TextItem,
  StoryboardItem,
  StoryboardPanel,
} from '@boardcache/schema';
import { getAssetBlob } from '../board/assetStore';
import { readableTextColor } from '../color/color';
import { parseHex, pdfTextColors } from './pdfTextColors';
import { downloadBlob } from './download';
import { renderImageBlob } from '../media/imageExport';
import { ensureFont } from '../media/fontRegistry';
import { effectiveUrl } from '../text/itemUrl';
import { mapExternalUrl } from '../integrations/mapEmbed';
import { colorSetFor, lightboxList, mediaMeta } from '../mediaItems';
import {
  layoutMarkdown,
  drawUnitsPage,
  setPdfDark,
  type PdfTextStyle,
  type Unit,
} from './pdfMarkdown';
import { qrSvgString } from '../media/qr';
import { decodeImageCanvas, renderPdfPage } from '../media/paint';
import { renderItemCanvas } from '../media/thumbnail';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * "Asset PDF": a Letter presentation document — a title page, a table of
 * contents, then a section per asset type. Text notes are real (vector) PDF
 * text and embedded PDFs are merged as their actual source pages.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36; // 0.5in
const IMAGE_MARGIN = 18; // 0.25in for full-bleed image pages
const CONTENT_W = PAGE_W - MARGIN * 2;
const CONTENT_BOTTOM = PAGE_H - MARGIN - 14;
const HEADING_BOTTOM = MARGIN + 52;
const TEXT_BASE = 11.5;

const categoryOf = (item: Item): PdfCategory | null => itemType(item).pdfCategory;

/** Bare host for a URL, www-stripped; the raw string if it doesn't parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export interface AssetPdfCategory {
  cat: PdfCategory;
  label: string;
  count: number;
}
export function assetPdfCategories(doc: CanvasDocument): AssetPdfCategory[] {
  const counts = new Map<PdfCategory, number>();
  for (const it of Object.values(doc.items)) {
    const c = categoryOf(it);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return PDF_CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({
    cat: c,
    label: PDF_CATEGORY_LABEL[c],
    count: counts.get(c)!,
  }));
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'board';
}
function hexToRgb(hex: string): [number, number, number] {
  return parseHex(hex) ?? [200, 200, 200];
}
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
/**
 * High-quality downscale: repeated halving with high-quality smoothing. A
 * single drawImage from a large photo straight to thumbnail size decimates
 * (skips pixels) and looks jagged; stepping down ≤2× at a time keeps it smooth.
 */
function downscale(src: HTMLCanvasElement, maxPx: number): HTMLCanvasElement {
  const fit = Math.min(1, maxPx / Math.max(src.width, src.height));
  if (fit >= 1) return src;
  let cur = src;
  let w = src.width;
  let h = src.height;
  const targetW = Math.max(1, Math.round(src.width * fit));
  const targetH = Math.max(1, Math.round(src.height * fit));
  while (w / 2 > targetW && h / 2 > targetH) {
    w = Math.max(targetW, Math.round(w / 2));
    h = Math.max(targetH, Math.round(h / 2));
    const step = document.createElement('canvas');
    step.width = w;
    step.height = h;
    const sc = step.getContext('2d')!;
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(cur, 0, 0, w, h);
    cur = step;
  }
  const c = document.createElement('canvas');
  c.width = targetW;
  c.height = targetH;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, targetW, targetH);
  return c;
}

// ── Document theme + typography (set per export) ──

let DOC_FONT = 'helvetica';
let DARK = false;

/** setTextColor with dark-mode awareness: grays invert; the link blue maps
 *  to a readable light blue; other colors pass through. */
function ink(pdf: Pdf, r: number, g?: number, b?: number): void {
  if (g === undefined || b === undefined) {
    pdf.setTextColor(DARK ? Math.max(0, Math.min(255, 255 - r)) : r);
  } else if (DARK && r === 40 && g === 90 && b === 200) {
    pdf.setTextColor(130, 170, 255);
  } else {
    pdf.setTextColor(r, g, b);
  }
}

/** setFillColor: light-gray chrome fills become dark surfaces; real colors
 *  (swatches, item backgrounds) pass through untouched. */
function fillInk(pdf: Pdf, r: number, g?: number, b?: number): void {
  if (g === undefined || b === undefined) {
    const v = DARK ? Math.max(0, 255 - r) : r;
    pdf.setFillColor(v, v, v);
    return;
  }
  const grayish = Math.max(r, g, b) - Math.min(r, g, b) < 12;
  if (DARK && grayish && r >= 180) pdf.setFillColor(40, 42, 48);
  else pdf.setFillColor(r, g, b);
}

function drawInk(pdf: Pdf, r: number, g?: number, b?: number): void {
  if (g === undefined || b === undefined) {
    const v = DARK ? Math.max(0, 255 - r) : r;
    pdf.setDrawColor(v, v, v);
    return;
  }
  const grayish = Math.max(r, g, b) - Math.min(r, g, b) < 12;
  if (DARK && grayish && r >= 160) pdf.setDrawColor(72, 76, 84);
  else pdf.setDrawColor(r, g, b);
}

/** Dark pages need their own background — PDF pages are white by default. */
function paintPageBg(pdf: Pdf): void {
  if (!DARK) return;
  pdf.setFillColor(19, 19, 24);
  pdf.rect(-2, -2, PAGE_W + 4, PAGE_H + 4, 'F');
}

// ── Custom font embedding (TrueType only — jsPDF can't take woff/woff2) ──

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

function coreFallbackFont(css: string): string {
  if (
    /georgia|times|serif|garamond|playfair|merriweather|lora|libre|crimson|cormorant|bitter/i.test(
      css,
    )
  )
    return 'times';
  if (/courier|mono/i.test(css)) return 'courier';
  return 'helvetica';
}

/** Resolve a CSS font-family to a jsPDF font name, embedding board-font
 *  TrueType assets on first use; anything else maps to a core font. */
async function resolvePdfFont(
  pdf: Pdf,
  css: string,
  boardFonts: Map<string, string>,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(css);
  if (cached) return cached;
  const first = (css.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '');
  const assetId = boardFonts.get(first);
  if (assetId) {
    try {
      const blob = await getAssetBlob(assetId);
      if (blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const tag = String.fromCharCode(...bytes.subarray(0, 4));
        if (tag === '\u0000\u0001\u0000\u0000' || tag === 'true') {
          const file = `${first.replace(/\W+/g, '')}.ttf`;
          pdf.addFileToVFS(file, bytesToBase64(bytes));
          for (const style of ['normal', 'bold', 'italic', 'bolditalic']) {
            pdf.addFont(file, first, style);
          }
          cache.set(css, first);
          return first;
        }
      }
    } catch {
      /* unembeddable — fall through to a core font */
    }
    console.warn(
      `boardCache: board font "${first}" isn’t TrueType (woff2/otf) — the PDF falls back to a core font. Re-import from Google Fonts to get an embeddable TTF.`,
    );
  }
  const fallback = coreFallbackFont(css);
  cache.set(css, fallback);
  return fallback;
}
interface PdfPageMapping {
  pageIndex: number;
  srcId: string;
  srcPage: number;
}
interface Ctx {
  doc: CanvasDocument;
  pdfMap: Map<string, { srcDoc: PdfLibDocument | null; numPages: number }>;
  mappings: PdfPageMapping[];
  /** Resolved jsPDF font name per CSS font-family (text notes). */
  fontFor: Map<string, string>;
  /** Syntax-colored, pre-wrapped code lines per code item id. */
  codeUnits: Map<string, Unit[]>;
}
type Job = (pdf: Pdf, pageNum: number, total: number) => void | Promise<void>;

// Page numbers were removed by request.
function drawFooter(_pdf: Pdf, _pageNum: number, _total: number): void {
  /* no footer */
}
function drawHeading(pdf: Pdf, label: string, first: boolean): void {
  if (!first) return;
  pdf.setFont(DOC_FONT, 'bold');
  pdf.setFontSize(20);
  ink(pdf, 25);
  pdf.text(label, MARGIN, MARGIN + 20);
}
function placeContain(
  pdf: Pdf,
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  jpeg = true,
): void {
  if (canvas.width === 0 || canvas.height === 0) return;
  const fit = Math.min(w / canvas.width, h / canvas.height);
  const dw = canvas.width * fit;
  const dh = canvas.height * fit;
  let src = canvas;
  if (jpeg) {
    // JPEG has no alpha — transparent regions (SVGs, PNGs) would turn black.
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const fc = flat.getContext('2d')!;
    fc.fillStyle = '#ffffff';
    fc.fillRect(0, 0, flat.width, flat.height);
    fc.drawImage(canvas, 0, 0);
    src = flat;
  }
  pdf.addImage(
    src.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9),
    jpeg ? 'JPEG' : 'PNG',
    x + (w - dw) / 2,
    y + (h - dh) / 2,
    dw,
    dh,
  );
}

// ── Title + contents ──

function drawTitlePage(pdf: Pdf, doc: CanvasDocument): void {
  pdf.setFont(DOC_FONT, 'bold');
  pdf.setFontSize(46);
  ink(pdf, 20);
  const lines = pdf.splitTextToSize(doc.name || 'Untitled board', CONTENT_W);
  const lh = 54;
  pdf.text(lines, PAGE_W / 2, (PAGE_H - lines.length * lh) / 2 + lh * 0.72, { align: 'center' });
  const now = new Date();
  const stamp = `${now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} at ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  pdf.setFont(DOC_FONT, 'normal');
  pdf.setFontSize(11);
  ink(pdf, 120);
  pdf.text(stamp, PAGE_W / 2, PAGE_H - MARGIN - 10, { align: 'center' });
}

function drawTocPage(
  pdf: Pdf,
  sections: { cat: PdfCategory; count: number; page: number }[],
  pageNum: number,
  total: number,
): void {
  pdf.setFont(DOC_FONT, 'bold');
  pdf.setFontSize(24);
  ink(pdf, 20);
  pdf.text('Contents', MARGIN, MARGIN + 30);
  let y = MARGIN + 76;
  for (const s of sections) {
    const label = `${PDF_CATEGORY_LABEL[s.cat]} (${s.count})`;
    const pageText = `Page ${s.page}`;
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(13);
    ink(pdf, 35);
    pdf.text(label, MARGIN, y);
    ink(pdf, 90);
    pdf.text(pageText, PAGE_W - MARGIN, y, { align: 'right' });
    const startX = MARGIN + pdf.getTextWidth(label) + 6;
    const endX = PAGE_W - MARGIN - pdf.getTextWidth(pageText) - 6;
    if (endX > startX) {
      const dotW = pdf.getTextWidth('.') || 2;
      const count = Math.floor((endX - startX) / dotW);
      if (count > 0) {
        ink(pdf, 195);
        pdf.text('.'.repeat(count), startX, y);
      }
    }
    pdf.link(MARGIN, y - 14, CONTENT_W, 22, { pageNumber: s.page });
    y += 30;
  }
  drawFooter(pdf, pageNum, total);
}

// ── Vector text notes (rich markdown) ──

/** The page a text note prints on (see paintPageBg for the dark document). */
const textPageBase = () => (DARK ? '#131318' : '#ffffff');

function textStyle(item: TextItem, fontName?: string): PdfTextStyle {
  // The box's own settings: an unstyled ('auto') or transparent box prints
  // on the page; explicit fills and inks are kept.
  const { fill: bg, ink } = pdfTextColors(item, textPageBase());
  return {
    base: TEXT_BASE,
    width: CONTENT_W,
    marginX: MARGIN,
    pageW: PAGE_W,
    fg: hexToRgb(ink),
    codeColor: bg ? hexToRgb(readableTextColor(bg)) : DARK ? [235, 152, 96] : [179, 83, 29],
    align: item.align,
    ...(fontName ? { fontName } : {}),
  };
}
function drawTextPage(
  pdf: Pdf,
  item: TextItem,
  units: Unit[],
  style: PdfTextStyle,
  headerH = 0,
): void {
  const { fill } = pdfTextColors(item, textPageBase());
  if (fill) {
    const [r, g, b] = hexToRgb(fill);
    pdf.setFillColor(r, g, b); // the user's colour, exactly — no dark-mode remap
    pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');
  }
  if (headerH) drawItemHeader(pdf, item, MARGIN, fill ? { fg: style.fg } : {});
  drawUnitsPage(pdf, units, MARGIN + headerH, style);
}

// Text-note index: first-line titles with dotted leaders → each note's page.
const TEXT_INDEX_ROW = 26;
function textIndexPerPage(): number {
  return Math.max(1, Math.floor((CONTENT_BOTTOM - HEADING_BOTTOM) / TEXT_INDEX_ROW));
}
function drawTextIndexPage(
  pdf: Pdf,
  group: { title: string; page: number }[],
  first: boolean,
  heading = 'Text notes',
): void {
  drawHeading(pdf, heading, first);
  let y = (first ? HEADING_BOTTOM : MARGIN) + 10;
  for (const entry of group) {
    const label = truncate(entry.title, 72);
    const pageText = `Page ${entry.page}`;
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(12);
    ink(pdf, 35);
    pdf.text(label, MARGIN, y);
    ink(pdf, 90);
    pdf.text(pageText, PAGE_W - MARGIN, y, { align: 'right' });
    const startX = MARGIN + pdf.getTextWidth(label) + 6;
    const endX = PAGE_W - MARGIN - pdf.getTextWidth(pageText) - 6;
    if (endX > startX) {
      const dotW = pdf.getTextWidth('.') || 2;
      const count = Math.floor((endX - startX) / dotW);
      if (count > 0) {
        ink(pdf, 195);
        pdf.text('.'.repeat(count), startX, y);
      }
    }
    pdf.link(MARGIN, y - 12, CONTENT_W, 18, { pageNumber: entry.page });
    y += TEXT_INDEX_ROW;
  }
}

// ── Fonts: TOC + one specimen page per face ──

function drawFontIndexPage(
  pdf: Pdf,
  group: { title: string; page: number }[],
  first: boolean,
): void {
  drawHeading(pdf, 'Fonts', first);
  let y = (first ? HEADING_BOTTOM : MARGIN) + 10;
  for (const entry of group) {
    const label = truncate(entry.title, 72);
    const pageText = `Page ${entry.page}`;
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(12);
    ink(pdf, 35);
    pdf.text(label, MARGIN, y);
    ink(pdf, 90);
    pdf.text(pageText, PAGE_W - MARGIN, y, { align: 'right' });
    const startX = MARGIN + pdf.getTextWidth(label) + 6;
    const endX = PAGE_W - MARGIN - pdf.getTextWidth(pageText) - 6;
    if (endX > startX) {
      const dotW = pdf.getTextWidth('.') || 2;
      const count = Math.floor((endX - startX) / dotW);
      if (count > 0) {
        ink(pdf, 195);
        pdf.text('.'.repeat(count), startX, y);
      }
    }
    pdf.link(MARGIN, y - 12, CONTENT_W, 18, { pageNumber: entry.page });
    y += TEXT_INDEX_ROW;
  }
}

/** Specimen rendered to a canvas with the loaded FontFace (works for every
 *  format, woff2 included — jsPDF itself can only embed TTFs). */
const SPECIMEN_PARAGRAPH =
  'Typography is the craft of endowing human language with a durable visual ' +
  'form. A well-drawn typeface balances rhythm and proportion so that words ' +
  'settle quietly on the page, letting ideas move from writer to reader ' +
  'without friction. Notice the color of this paragraph as a block: its ' +
  'evenness of texture, the fit of letter against letter, and the way ' +
  'ascenders and descenders shape each line.';

/** Word-wrap `text` at `maxW` using the current canvas font. */
function wrapCanvasText(ctx2: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const probe = cur ? `${cur} ${w}` : w;
    if (cur && ctx2.measureText(probe).width > maxW) {
      lines.push(cur);
      cur = w;
    } else {
      cur = probe;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function fontSpecimenCanvas(item: FontItem): HTMLCanvasElement {
  const SCALE = 2;
  const W = 1200;
  const family = `'${item.family.replace(/'/g, '')}'`;
  const ramp = [16, 22, 30, 42, 58];
  const line = 'The quick brown fox jumps over the lazy dog';
  const glyphs = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789'];
  const bg = DARK ? '#141419' : '#ffffff';
  const inkMain = DARK ? '#e8eaee' : '#16181d';
  const inkSub = DARK ? '#9aa0a8' : '#8a8f95';
  const inkSoft = DARK ? '#c3c8d0' : '#3a3f45';

  // Measure paragraph lines with a throwaway context first.
  const probeCtx = document.createElement('canvas').getContext('2d')!;
  probeCtx.font = `17px ${family}`;
  const paragraph = wrapCanvasText(probeCtx, SPECIMEN_PARAGRAPH, W);

  let h = 40;
  for (const px of ramp) h += px * 1.5 + 18;
  h += 26 + paragraph.length * 26 + 26; // paragraph block
  h += glyphs.length * 34 + 20;

  const cv = document.createElement('canvas');
  cv.width = W * SCALE;
  cv.height = Math.round(h) * SCALE;
  const ctx2 = cv.getContext('2d')!;
  ctx2.scale(SCALE, SCALE);
  ctx2.fillStyle = bg;
  ctx2.fillRect(0, 0, W, h);
  let y = 40;
  for (const px of ramp) {
    ctx2.fillStyle = inkSub;
    ctx2.font = '11px sans-serif';
    ctx2.fillText(`${px}px`, 0, y);
    ctx2.fillStyle = inkMain;
    ctx2.font = `${px}px ${family}`;
    ctx2.fillText(line, 56, y, W - 60);
    y += px * 1.5 + 18;
  }
  // Full paragraph — the texture of the face at reading size.
  y += 26;
  ctx2.fillStyle = inkMain;
  ctx2.font = `17px ${family}`;
  for (const pline of paragraph) {
    ctx2.fillText(pline, 0, y, W);
    y += 26;
  }
  y += 26;
  ctx2.fillStyle = inkSoft;
  ctx2.font = `20px ${family}`;
  for (const g of glyphs) {
    ctx2.fillText(g, 0, y, W);
    y += 34;
  }
  return cv;
}

function drawFontPage(pdf: Pdf, item: FontItem, pageNum: number, total: number): void {
  pdf.setFont(DOC_FONT, 'bold');
  pdf.setFontSize(16);
  ink(pdf, 20);
  pdf.text(truncate(item.family, 64), MARGIN, MARGIN + 6);
  const cv = fontSpecimenCanvas(item);
  const top = MARGIN + 24;
  placeContain(pdf, cv, MARGIN, top, CONTENT_W, CONTENT_BOTTOM - top, false);
  drawFooter(pdf, pageNum, total);
}

// ── Images: gallery + individual ──

const GALLERY_COLS = 4;
const GALLERY_GAP = 15;
function galleryMetrics() {
  const cellW = (CONTENT_W - GALLERY_GAP * (GALLERY_COLS - 1)) / GALLERY_COLS;
  const cellH = cellW + 14;
  const rows = Math.max(1, Math.floor((CONTENT_BOTTOM - HEADING_BOTTOM) / (cellH + GALLERY_GAP)));
  return { cellW, cellH, perPage: rows * GALLERY_COLS };
}
async function imageCanvas(item: Item): Promise<HTMLCanvasElement | null> {
  if (item.type !== 'image') return null;
  const edited = item.crop !== null || item.flipH || item.flipV;
  const blob = edited ? await renderImageBlob(item) : await getAssetBlob(item.assetId);
  if (!blob) return null;
  return decodeImageCanvas(blob, 2400);
}

/**
 * Draw an SVG asset as real vector art into the PDF (svg2pdf), contain-fit in
 * the given box. Returns false when the blob isn't drawable as SVG, so the
 * caller can fall back to a raster.
 */
async function drawSvgVector(
  pdf: Pdf,
  blob: Blob,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<boolean> {
  try {
    const { svg2pdf } = await import('svg2pdf.js');
    const parsed = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
    const el = parsed.documentElement;
    if (el.nodeName.toLowerCase() !== 'svg') return false;
    const vb = el
      .getAttribute('viewBox')
      ?.split(/[\s,]+/)
      .map(Number);
    const iw = (vb && vb[2]) || Number.parseFloat(el.getAttribute('width') ?? '') || 1;
    const ih = (vb && vb[3]) || Number.parseFloat(el.getAttribute('height') ?? '') || 1;
    const fit = Math.min(w / iw, h / ih);
    const dw = iw * fit;
    const dh = ih * fit;
    // Attach off-screen so styles/classes inside the SVG resolve.
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;';
    holder.appendChild(el);
    document.body.appendChild(holder);
    try {
      await svg2pdf(el as unknown as SVGElement, pdf, {
        x: x + (w - dw) / 2,
        y: y + (h - dh) / 2,
        width: dw,
        height: dh,
      });
    } finally {
      holder.remove();
    }
    return true;
  } catch {
    return false;
  }
}
async function drawImageGalleryPage(
  pdf: Pdf,
  group: Item[],
  baseIndex: number,
  individualStart: number,
  first: boolean,
  pageNum: number,
  total: number,
): Promise<void> {
  drawHeading(pdf, 'Images', first);
  const { cellW, cellH } = galleryMetrics();
  const top = first ? HEADING_BOTTOM : MARGIN;
  for (let j = 0; j < group.length; j++) {
    const col = j % GALLERY_COLS;
    const row = Math.floor(j / GALLERY_COLS);
    const x = MARGIN + col * (cellW + GALLERY_GAP);
    const y = top + row * (cellH + GALLERY_GAP);
    const src = (await imageCanvas(group[j]!)) ?? (await renderItemCanvas(group[j]!, 1));
    // ~4× the ~124pt cell so thumbnails stay smooth when zoomed/printed.
    placeContain(pdf, downscale(src, 500), x, y, cellW, cellW);
    const page = individualStart + baseIndex + j;
    pdf.link(x, y, cellW, cellW, { pageNumber: page });
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(8);
    ink(pdf, 140);
    pdf.text(`Page ${page}`, x + cellW / 2, y + cellW + 10, { align: 'center' });
  }
  drawFooter(pdf, pageNum, total);
}
async function drawIndividualImagePage(
  pdf: Pdf,
  item: Item,
  pageNum: number,
  total: number,
): Promise<void> {
  const headerH = drawItemHeader(pdf, item, IMAGE_MARGIN, { measureOnly: true });
  const areaTop = IMAGE_MARGIN + headerH;
  const areaH = PAGE_H - areaTop - IMAGE_MARGIN;
  // Unedited SVG assets and QR codes go in as true vector art; everything
  // else rasterizes.
  let drawn = false;
  if (item.type === 'image' && item.crop === null && !item.flipH && !item.flipV) {
    const blob = await getAssetBlob(item.assetId);
    if (blob?.type === 'image/svg+xml') {
      drawn = await drawSvgVector(
        pdf,
        blob,
        IMAGE_MARGIN,
        areaTop,
        PAGE_W - IMAGE_MARGIN * 2,
        areaH,
      );
    }
  } else if (item.type === 'qr') {
    const svg = qrSvgString(item);
    if (svg) {
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      drawn = await drawSvgVector(
        pdf,
        blob,
        IMAGE_MARGIN,
        areaTop,
        PAGE_W - IMAGE_MARGIN * 2,
        areaH,
      );
    }
  }
  if (!drawn) {
    const canvas = (await imageCanvas(item)) ?? (await renderItemCanvas(item, 2));
    placeContain(pdf, canvas, IMAGE_MARGIN, areaTop, PAGE_W - IMAGE_MARGIN * 2, areaH, true);
  }
  drawItemHeader(pdf, item, IMAGE_MARGIN);
  drawFooter(pdf, pageNum, total);
}

// ── PDF index (cover-thumbnail grid, like the image gallery) ──

function pdfIndexMetrics() {
  const cols = GALLERY_COLS;
  const cellW = (CONTENT_W - GALLERY_GAP * (cols - 1)) / cols;
  const thumbH = cellW * 1.3; // portrait-ish cover
  const cellH = thumbH + 16; // + filename
  const rows = Math.max(1, Math.floor((CONTENT_BOTTOM - HEADING_BOTTOM) / (cellH + GALLERY_GAP)));
  return { cols, cellW, thumbH, cellH, perPage: rows * cols };
}

/**
 * An index page for embedded PDFs: a grid of first-page (cover) thumbnails with
 * the filename centered below each, mirroring the image gallery. Each cover
 * links to the page where that PDF's real content starts. These pages sit right
 * before the merged PDF documents.
 */
async function drawPdfIndexPage(
  pdf: Pdf,
  group: Item[],
  baseIndex: number,
  startPages: number[],
  first: boolean,
  pageNum: number,
  total: number,
): Promise<void> {
  drawHeading(pdf, 'PDFs', first);
  const { cols, cellW, thumbH, cellH } = pdfIndexMetrics();
  const top = first ? HEADING_BOTTOM : MARGIN;
  for (let j = 0; j < group.length; j++) {
    const item = group[j]!;
    const x = MARGIN + (j % cols) * (cellW + GALLERY_GAP);
    const y = top + Math.floor(j / cols) * (cellH + GALLERY_GAP);
    const assetId = item.type === 'pdf' ? item.assetId : null;
    const cover = assetId
      ? await renderPdfPage(assetId, 1, Math.round(cellW * 2), Math.round(thumbH * 2))
      : null;
    let dw = cellW;
    let dh = thumbH;
    let dx = x;
    const dy = y; // top-align so filenames line up
    if (cover) {
      const fit = Math.min(cellW / cover.width, thumbH / cover.height);
      dw = cover.width * fit;
      dh = cover.height * fit;
      dx = x + (cellW - dw) / 2;
      pdf.addImage(cover.toDataURL('image/jpeg', 0.92), 'JPEG', dx, dy, dw, dh);
    } else {
      fillInk(pdf, 245, 245, 245);
      pdf.rect(x, y, cellW, thumbH, 'F');
    }
    drawInk(pdf, 214, 214, 214);
    pdf.rect(dx, dy, dw, dh, 'S');
    const page = startPages[baseIndex + j] ?? pageNum;
    pdf.link(dx, dy, dw, dh, { pageNumber: page });
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(8.5);
    ink(pdf, 70);
    pdf.textWithLink(truncate(mediaMeta(item).title || 'PDF', 32), x + cellW / 2, y + thumbH + 11, {
      pageNumber: page,
      align: 'center',
    });
  }
  drawFooter(pdf, pageNum, total);
}

// ── Videos ──

const VIDEO_GAP = 16;
function videoMetrics() {
  const cellW = (CONTENT_W - VIDEO_GAP) / 2;
  const thumbH = cellW * (9 / 16);
  const cellH = thumbH + 32; // thumbnail + label + URL
  const rows = Math.max(1, Math.floor((CONTENT_BOTTOM - HEADING_BOTTOM) / (cellH + 14)));
  return { cellW, thumbH, cellH, perPage: rows * 2 };
}
async function drawVideoPage(
  pdf: Pdf,
  group: Item[],
  first: boolean,
  pageNum: number,
  total: number,
): Promise<void> {
  drawHeading(pdf, 'Videos', first);
  const { cellW, thumbH, cellH } = videoMetrics();
  const top = first ? HEADING_BOTTOM : MARGIN;
  for (let i = 0; i < group.length; i++) {
    const item = group[i]!;
    const x = MARGIN + (i % 2) * (cellW + VIDEO_GAP);
    const y = top + Math.floor(i / 2) * (cellH + 14);
    const canvas = downscale(await renderItemCanvas(item, 2), 900);
    const fit = Math.min(cellW / canvas.width, thumbH / canvas.height);
    const dw = canvas.width * fit;
    const dh = canvas.height * fit;
    const dx = x + (cellW - dw) / 2;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', dx, y, dw, dh);
    const cx = x + cellW / 2;
    const url = effectiveUrl(item);
    if (url) pdf.link(dx, y, dw, dh, { url });
    const label = item.name?.trim() || null;
    let ty = y + thumbH + 12;
    if (label) {
      pdf.setFont(DOC_FONT, 'normal');
      pdf.setFontSize(10);
      ink(pdf, 45);
      pdf.text(truncate(label, 40), cx, ty, { align: 'center' });
      ty += 12;
    }
    if (url) {
      pdf.setFont(DOC_FONT, 'normal');
      pdf.setFontSize(8.5);
      ink(pdf, 40, 90, 200);
      pdf.textWithLink(truncate(url, 56), cx, ty, { url, align: 'center' });
    }
  }
  drawFooter(pdf, pageNum, total);
}

// ── Storyboards: shot panels, 2×3 per page, slate lines under each frame ──

const SB_PDF_GAP = 18;
function storyboardPdfMetrics(aspect: string) {
  const cellW = (CONTENT_W - SB_PDF_GAP) / 2;
  const ar =
    aspect === '9:16' ? 9 / 16 : aspect === '4:3' ? 4 / 3 : aspect === '2.39:1' ? 2.39 : 16 / 9;
  const frameH = cellW / ar;
  const cellH = frameH + 52; // frame + three slate lines
  const rows = Math.max(1, Math.floor((CONTENT_BOTTOM - HEADING_BOTTOM) / (cellH + 16)));
  return { cellW, frameH, cellH, perPage: rows * 2 };
}

async function drawStoryboardPage(
  pdf: Pdf,
  doc: CanvasDocument,
  sb: StoryboardItem,
  group: StoryboardPanel[],
  first: boolean,
  pageNum: number,
  total: number,
): Promise<void> {
  drawHeading(pdf, 'Storyboards', first);
  const { cellW, frameH, cellH } = storyboardPdfMetrics(sb.aspect);
  let top = first ? HEADING_BOTTOM : MARGIN;
  // Board title + runtime lead every board's first page.
  if (group === undefined || group.length === 0 || sb.panels[0]?.id === group[0]?.id) {
    pdf.setFont(DOC_FONT, 'bold');
    pdf.setFontSize(14);
    ink(pdf, 30);
    const secs = sb.panels.reduce((sum, p) => sum + (p.duration ?? 0), 0);
    const runtime = secs > 0 ? `  ·  ${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s` : '';
    pdf.text(`${truncate(sb.title, 60)}${runtime}`, MARGIN, top + 4);
    top += 20;
  }
  for (let i = 0; i < group.length; i++) {
    const panel = group[i]!;
    const x = MARGIN + (i % 2) * (cellW + SB_PDF_GAP);
    const y = top + Math.floor(i / 2) * (cellH + 16);
    // Frame: first framed item rendered inside; empty frames get a slate box.
    drawInk(pdf, 165);
    pdf.setLineWidth(0.8);
    pdf.rect(x, y, cellW, frameH, 'S');
    const framedId = panel.itemIds[0];
    const framed = framedId ? doc.items[framedId] : undefined;
    if (framed) {
      const canvas = downscale(
        (await imageCanvas(framed)) ?? (await renderItemCanvas(framed, 2)),
        1000,
      );
      placeContain(pdf, canvas, x + 1, y + 1, cellW - 2, frameH - 2);
    } else {
      fillInk(pdf, 243);
      pdf.rect(x + 1, y + 1, cellW - 2, frameH - 2, 'F');
      drawInk(pdf, 200);
      pdf.line(x + 8, y + frameH / 2, x + cellW - 8, y + frameH / 2 - 10);
      pdf.line(x + 8, y + frameH / 2 - 10, x + cellW - 8, y + frameH / 2);
    }
    // Slate lines.
    let ty = y + frameH + 13;
    pdf.setFont(DOC_FONT, 'bold');
    pdf.setFontSize(10);
    ink(pdf, 35);
    const slug = panel.scene ? `${panel.label}  ·  ${panel.scene}` : panel.label;
    pdf.text(truncate(slug, 58), x, ty);
    ty += 12;
    if (panel.action) {
      pdf.setFont(DOC_FONT, 'normal');
      pdf.setFontSize(9);
      ink(pdf, 70);
      pdf.text(truncate(panel.action, 68), x, ty);
      ty += 11;
    }
    const meta = [panel.move, panel.lens, panel.duration != null ? `${panel.duration}s` : '']
      .filter(Boolean)
      .join(' · ');
    if (meta) {
      pdf.setFont(DOC_FONT, 'normal');
      pdf.setFontSize(8.5);
      ink(pdf, 120);
      pdf.text(truncate(meta, 60), x, ty);
    }
  }
  drawFooter(pdf, pageNum, total);
}

// ── Webpages (iframe embeds) ──

const WEBPAGE_GAP = 16;
function webpageMetrics() {
  const cellW = (CONTENT_W - WEBPAGE_GAP) / 2;
  const thumbH = cellW * 0.72;
  const cellH = thumbH + 32; // poster + label + URL
  const rows = Math.max(1, Math.floor((CONTENT_BOTTOM - HEADING_BOTTOM) / (cellH + 14)));
  return { cellW, thumbH, cellH, perPage: rows * 2 };
}
async function drawWebpagePage(pdf: Pdf, group: Item[], first: boolean): Promise<void> {
  drawHeading(pdf, 'Webpages', first);
  const { cellW, thumbH, cellH } = webpageMetrics();
  const top = first ? HEADING_BOTTOM : MARGIN;
  for (let i = 0; i < group.length; i++) {
    const item = group[i]!;
    const url =
      item.type === 'iframe'
        ? item.url
        : item.type === 'map'
          ? mapExternalUrl(item)
          : (effectiveUrl(item) ?? '');
    const x = MARGIN + (i % 2) * (cellW + WEBPAGE_GAP);
    const y = top + Math.floor(i / 2) * (cellH + 14);
    const canvas = downscale(await renderItemCanvas(item, 2), 1100);
    const fit = Math.min(cellW / canvas.width, thumbH / canvas.height);
    const dw = canvas.width * fit;
    const dh = canvas.height * fit;
    const dx = x + (cellW - dw) / 2;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', dx, y, dw, dh);
    // A hairline frame so white posters read as a tile.
    drawInk(pdf, 210);
    pdf.rect(dx, y, dw, dh, 'S');
    const cx = x + cellW / 2;
    if (url) pdf.link(dx, y, dw, dh, { url });
    const label = item.name?.trim() || hostOf(url);
    let ty = y + thumbH + 12;
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(10);
    ink(pdf, 45);
    pdf.text(truncate(label, 44), cx, ty, { align: 'center' });
    ty += 12;
    if (url) {
      pdf.setFontSize(8.5);
      ink(pdf, 40, 90, 200);
      pdf.textWithLink(truncate(url, 58), cx, ty, { url, align: 'center' });
    }
  }
}

// ── Audio ──

const AUDIO_COLS = 3;
const AUDIO_GAP = 16;
function audioMetrics() {
  const cellW = (CONTENT_W - AUDIO_GAP * (AUDIO_COLS - 1)) / AUDIO_COLS;
  const cellH = cellW + 18;
  const rows = Math.max(1, Math.floor((CONTENT_BOTTOM - HEADING_BOTTOM) / (cellH + AUDIO_GAP)));
  return { cellW, cellH, perPage: rows * AUDIO_COLS };
}
async function audioTile(item: Item): Promise<HTMLCanvasElement> {
  const S = 360;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const tileCover =
    item.type === 'audio'
      ? item.coverAssetId
      : item.type === 'playlist'
        ? (item.tracks[item.current]?.coverAssetId ?? item.tracks[0]?.coverAssetId ?? null)
        : null;
  if (tileCover) {
    const blob = await getAssetBlob(tileCover);
    if (blob) {
      try {
        const bm = await createImageBitmap(blob);
        const fit = Math.max(S / bm.width, S / bm.height);
        ctx.drawImage(
          bm,
          (S - bm.width * fit) / 2,
          (S - bm.height * fit) / 2,
          bm.width * fit,
          bm.height * fit,
        );
        bm.close();
        return c;
      } catch {
        /* fall through */
      }
    }
  }
  ctx.fillStyle = '#eef1f5';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#9aa3af';
  ctx.beginPath();
  ctx.arc(S * 0.4, S * 0.62, S * 0.07, 0, Math.PI * 2);
  ctx.arc(S * 0.62, S * 0.55, S * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#9aa3af';
  ctx.lineWidth = S * 0.025;
  ctx.beginPath();
  ctx.moveTo(S * 0.47, S * 0.62);
  ctx.lineTo(S * 0.47, S * 0.36);
  ctx.lineTo(S * 0.69, S * 0.3);
  ctx.lineTo(S * 0.69, S * 0.55);
  ctx.stroke();
  return c;
}
async function drawAudioPage(
  pdf: Pdf,
  group: Item[],
  first: boolean,
  pageNum: number,
  total: number,
): Promise<void> {
  drawHeading(pdf, 'Audio', first);
  const { cellW, cellH } = audioMetrics();
  const top = first ? HEADING_BOTTOM : MARGIN;
  for (let i = 0; i < group.length; i++) {
    const item = group[i]!;
    const x = MARGIN + (i % AUDIO_COLS) * (cellW + AUDIO_GAP);
    const y = top + Math.floor(i / AUDIO_COLS) * (cellH + AUDIO_GAP);
    placeContain(pdf, await audioTile(item), x, y, cellW, cellW);
    const url = effectiveUrl(item);
    const label = truncate(mediaMeta(item).title || 'Audio', 30);
    if (url) pdf.link(x, y, cellW, cellW, { url });
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(9);
    if (url) {
      ink(pdf, 40, 90, 200);
      pdf.textWithLink(label, x + cellW / 2, y + cellW + 12, { url, align: 'center' });
    } else {
      ink(pdf, 80);
      pdf.text(label, x + cellW / 2, y + cellW + 12, { align: 'center' });
    }
  }
  drawFooter(pdf, pageNum, total);
}

// ── Colors ──

interface ColorEntry {
  id: string;
  name: string | null;
  colors: { color: string; name?: string }[];
  multi: boolean;
}
interface ColorCell {
  entry: ColorEntry;
  x: number;
  y: number;
  w: number;
  h: number;
}
const SWATCH_COLS = 4;
const COLOR_GAP = 14;
const PALETTE_H = 80;
const PALETTE_LABEL_H = 16;
function buildColorEntries(doc: CanvasDocument, items: Item[]): ColorEntry[] {
  const out: ColorEntry[] = [];
  for (const item of items) {
    const set = colorSetFor(doc, item);
    if (!set) continue;
    let name: string | null = null;
    if (item.type === 'palette') name = item.name ?? null;
    else if (item.type === 'swatch' && item.groupId) name = doc.groups[item.groupId]?.name ?? null;
    else if (item.type === 'swatch') name = item.name ?? null;
    out.push({ id: item.id, name, colors: set.colors, multi: set.multi });
  }
  return out;
}
function layoutColors(entries: ColorEntry[]): ColorCell[][] {
  const swatches = entries.filter((e) => !e.multi);
  const palettes = entries.filter((e) => e.multi);
  const s = (CONTENT_W - COLOR_GAP * (SWATCH_COLS - 1)) / SWATCH_COLS;
  interface Row {
    h: number;
    cells: ColorCell[];
  }
  const rows: Row[] = [];
  for (let i = 0; i < swatches.length; i += SWATCH_COLS) {
    const g = swatches.slice(i, i + SWATCH_COLS);
    rows.push({
      h: s,
      cells: g.map((entry, j) => ({ entry, x: MARGIN + j * (s + COLOR_GAP), y: 0, w: s, h: s })),
    });
  }
  for (const entry of palettes) {
    rows.push({
      h: PALETTE_H + (entry.name ? PALETTE_LABEL_H : 0),
      cells: [{ entry, x: MARGIN, y: 0, w: CONTENT_W, h: PALETTE_H }],
    });
  }
  const pages: ColorCell[][] = [];
  let cur: ColorCell[] = [];
  let y = HEADING_BOTTOM;
  for (const row of rows) {
    if (cur.length && y + row.h > CONTENT_BOTTOM) {
      pages.push(cur);
      cur = [];
      y = MARGIN;
    }
    for (const c of row.cells) {
      c.y = y;
      cur.push(c);
    }
    y += row.h + COLOR_GAP;
  }
  if (cur.length) pages.push(cur);
  return pages;
}
function drawColorPage(
  pdf: Pdf,
  cells: ColorCell[],
  first: boolean,
  pageNum: number,
  total: number,
): void {
  drawHeading(pdf, 'Colors', first);
  for (const cell of cells) {
    const colors = cell.entry.colors.length ? cell.entry.colors : [{ color: '#cccccc' }];
    const segW = cell.w / colors.length;
    colors.forEach((c, i) => {
      const [r, g, b] = hexToRgb(c.color);
      fillInk(pdf, r, g, b);
      pdf.rect(cell.x + i * segW, cell.y, segW + 0.5, cell.h, 'F');
      if (segW < 34) return;
      const [tr, tg, tb] = hexToRgb(readableTextColor(c.color));
      ink(pdf, tr, tg, tb);
      const cx = cell.x + i * segW + segW / 2;
      const cy = cell.y + cell.h / 2;
      const label = cell.entry.multi ? c.name : (cell.entry.name ?? c.name);
      if (label) {
        pdf.setFont(DOC_FONT, 'bold');
        pdf.setFontSize(cell.entry.multi ? 8 : 10);
        pdf.text(truncate(label, cell.entry.multi ? 14 : 22), cx, cy - 3, { align: 'center' });
        pdf.setFont(DOC_FONT, 'normal');
        pdf.setFontSize(cell.entry.multi ? 7.5 : 9);
        pdf.text(c.color.toUpperCase(), cx, cy + 9, { align: 'center' });
      } else {
        pdf.setFont(DOC_FONT, 'bold');
        pdf.setFontSize(cell.entry.multi ? 8.5 : 10);
        pdf.text(c.color.toUpperCase(), cx, cy + 3, { align: 'center' });
      }
    });
    if (cell.entry.multi && cell.entry.name) {
      pdf.setFont(DOC_FONT, 'bold');
      pdf.setFontSize(10);
      ink(pdf, 45);
      pdf.text(truncate(cell.entry.name, 80), cell.x, cell.y + cell.h + 12);
    }
  }
  drawFooter(pdf, pageNum, total);
}

// ── Links ──

interface LinkEntry {
  title: string | null;
  url: string;
  /** Row flavor: plain link, the RSS subheading, or a feed row. */
  kind?: 'link' | 'subhead' | 'feed';
}
const LINK_TITLE_H = 26;
const LINK_URL_H = 18;
const LINK_SUBHEAD_H = 30;
function linkTitleOf(item: Item): string | null {
  if (item.type === 'link') {
    const l = item.label?.trim();
    return l && l !== item.url ? l : null;
  }
  const n = item.name?.trim();
  return n || null;
}
function buildLinkEntries(items: Item[]): LinkEntry[] {
  const out: LinkEntry[] = [];
  const feeds: LinkEntry[] = [];
  for (const item of items) {
    if (item.type === 'rss') {
      feeds.push({ title: item.feedTitle ?? hostOf(item.url), url: item.url, kind: 'feed' });
      continue;
    }
    const url = effectiveUrl(item);
    if (!url) continue;
    out.push({ title: linkTitleOf(item), url });
  }
  // Titled links first (alphabetical by title); untitled URLs at the bottom.
  const titled = out
    .filter((e) => e.title)
    .sort((a, b) => a.title!.toLowerCase().localeCompare(b.title!.toLowerCase()));
  const untitled = out
    .filter((e) => !e.title)
    .sort((a, b) => a.url.toLowerCase().localeCompare(b.url.toLowerCase()));
  const rows = [...titled, ...untitled];
  if (feeds.length) {
    feeds.sort((a, b) =>
      (a.title ?? '').toLowerCase().localeCompare((b.title ?? '').toLowerCase()),
    );
    rows.push({ title: 'RSS', url: '', kind: 'subhead' }, ...feeds);
  }
  return rows;
}
function paginateLinks(entries: LinkEntry[]): LinkEntry[][] {
  const pages: LinkEntry[][] = [];
  let cur: LinkEntry[] = [];
  let used = 0;
  for (const e of entries) {
    const h = e.kind === 'subhead' ? LINK_SUBHEAD_H : e.title ? LINK_TITLE_H : LINK_URL_H;
    const avail = pages.length === 0 ? CONTENT_BOTTOM - HEADING_BOTTOM : CONTENT_BOTTOM - MARGIN;
    if (cur.length && used + h > avail) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(e);
    used += h;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}
function drawLinkPage(pdf: Pdf, group: LinkEntry[], first: boolean): void {
  drawHeading(pdf, 'Links', first);
  const textX = MARGIN + 14;
  let y = first ? HEADING_BOTTOM : MARGIN;
  for (const entry of group) {
    if (entry.kind === 'subhead') {
      pdf.setFont(DOC_FONT, 'bold');
      pdf.setFontSize(9);
      ink(pdf, 120);
      pdf.text(entry.title!.toUpperCase(), MARGIN, y + 18);
      y += LINK_SUBHEAD_H;
      continue;
    }
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(10);
    ink(pdf, 70);
    pdf.text('•', MARGIN, y + 10);
    if (entry.title) {
      pdf.setFont(DOC_FONT, 'bold');
      pdf.setFontSize(9.5);
      ink(pdf, 35);
      pdf.textWithLink(truncate(entry.title, 104), textX, y + 9, { url: entry.url });
      pdf.setFont(DOC_FONT, 'normal');
      pdf.setFontSize(8);
      ink(pdf, 40, 90, 200);
      pdf.textWithLink(truncate(entry.url, 124), textX, y + 20, { url: entry.url });
      y += LINK_TITLE_H;
    } else {
      pdf.setFont(DOC_FONT, 'normal');
      pdf.setFontSize(9.5);
      ink(pdf, 40, 90, 200);
      pdf.textWithLink(truncate(entry.url, 112), textX, y + 10, { url: entry.url });
      y += LINK_URL_H;
    }
  }
}

// ── Per-item header: title above the content + metadata (URL, note, tags) ──

/**
 * Draw (or with measureOnly, just measure) the item header block: bold title,
 * then clickable URL, note (wrapped, clamped) and tags when present.
 * Returns the consumed height including a bottom gap.
 */
function drawItemHeader(
  pdf: Pdf,
  item: Item,
  y: number,
  opts: { fg?: [number, number, number]; measureOnly?: boolean } = {},
): number {
  const fg = opts.fg;
  const draw = !opts.measureOnly;
  let used = 0;
  const title = truncate(mediaMeta(item).title || '', 90);
  if (title) {
    pdf.setFont(DOC_FONT, 'bold');
    pdf.setFontSize(13);
    if (draw) {
      if (fg) pdf.setTextColor(fg[0], fg[1], fg[2]);
      else ink(pdf, 25);
      pdf.text(title, MARGIN, y + used + 13, { maxWidth: CONTENT_W });
    }
    used += 19;
  }
  const url = effectiveUrl(item);
  if (url) {
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(9.5);
    if (draw) {
      ink(pdf, 40, 90, 200);
      pdf.textWithLink(truncate(url, 110), MARGIN, y + used + 11, { url });
    }
    used += 16;
  }
  if (item.notes) {
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(9);
    const lines = (pdf.splitTextToSize(item.notes, CONTENT_W) as string[]).slice(0, 5);
    if (draw) {
      if (fg) pdf.setTextColor(fg[0], fg[1], fg[2]);
      else ink(pdf, 110);
      lines.forEach((ln, i) => pdf.text(ln, MARGIN, y + used + 10 + i * 12));
    }
    used += lines.length * 12 + 3;
  }
  if (item.tags && item.tags.length) {
    pdf.setFont(DOC_FONT, 'normal');
    pdf.setFontSize(8.5);
    if (draw) {
      if (fg) pdf.setTextColor(fg[0], fg[1], fg[2]);
      else ink(pdf, 130);
      pdf.text(truncate(`Tags: ${item.tags.join(', ')}`, 120), MARGIN, y + used + 10);
    }
    used += 14;
  }
  return used ? used + 8 : 0;
}

/** paginateUnits with a smaller first page (room for the item header). */
function paginateUnitsWithFirst(units: Unit[], firstAvail: number, restAvail: number): Unit[][] {
  const pages: Unit[][] = [];
  let cur: Unit[] = [];
  let used = 0;
  let cap = firstAvail;
  for (const u of units) {
    const adv = (cur.length ? u.gapBefore : 0) + u.height;
    if (cur.length && used + adv > cap) {
      pages.push(cur);
      cur = [];
      used = 0;
      cap = restAvail;
    }
    cur.push(cur.length === 0 ? { ...u, gapBefore: 0 } : u);
    used += (cur.length === 1 ? 0 : u.gapBefore) + u.height;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

// ── Code snippets: syntax-colored monospace printing ──

const CODE_PRINT_SIZE = 8.5; // deliberately smaller than TEXT_BASE
const CODE_PRINT_PAD = 6;

/** Print palettes are fixed per PDF theme (screen theme vars may not contrast
 *  with the print band). */
const CODE_PRINT_LIGHT: Record<string, string> = {
  fg: '#1f2328',
  comment: '#6e7781',
  punct: '#57606a',
  keyword: '#cf222e',
  string: '#0a3069',
  number: '#0550ae',
  function: '#8250df',
  type: '#953800',
  variable: '#0550ae',
};
const CODE_PRINT_DARK: Record<string, string> = {
  fg: '#abb2bf',
  comment: '#5c6370',
  punct: '#7f848e',
  keyword: '#c678dd',
  string: '#98c379',
  number: '#d19a66',
  function: '#61afef',
  type: '#e5c07b',
  variable: '#e06c75',
};
const TOKEN_GROUP: Record<string, string> = {
  comment: 'comment',
  prolog: 'comment',
  doctype: 'comment',
  cdata: 'comment',
  punctuation: 'punct',
  operator: 'punct',
  keyword: 'keyword',
  atrule: 'keyword',
  important: 'keyword',
  string: 'string',
  char: 'string',
  'attr-value': 'string',
  'template-string': 'string',
  url: 'string',
  number: 'number',
  boolean: 'number',
  constant: 'number',
  symbol: 'number',
  function: 'function',
  selector: 'function',
  'attr-name': 'function',
  property: 'function',
  'class-name': 'type',
  tag: 'type',
  builtin: 'type',
  namespace: 'type',
  variable: 'variable',
  regex: 'variable',
  deleted: 'variable',
};

/** Wrap a flat token stream into colored, page-width monospace line units. */
function layoutCodeUnits(
  pdf: Pdf,
  tokens: { text: string; type: string | null }[],
  dark: boolean,
): Unit[] {
  const palette = dark ? CODE_PRINT_DARK : CODE_PRINT_LIGHT;
  const colorFor = (type: string | null): [number, number, number] =>
    hexToRgb(palette[type ? (TOKEN_GROUP[type] ?? 'fg') : 'fg'] ?? palette.fg!);
  pdf.setFont('courier', 'normal');
  pdf.setFontSize(CODE_PRINT_SIZE);
  const maxW = CONTENT_W - CODE_PRINT_PAD * 2;
  const units: Unit[] = [];
  let line: { text: string; color: [number, number, number] }[] = [];
  let lineW = 0;
  const pushLine = () => {
    units.push({
      kind: 'codetoks',
      gapBefore: 0,
      height: CODE_PRINT_SIZE * 1.5,
      size: CODE_PRINT_SIZE,
      tokens: line,
    });
    line = [];
    lineW = 0;
  };
  for (const tok of tokens) {
    const parts = tok.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) pushLine();
      let rest = part;
      while (rest.length) {
        const w = pdf.getTextWidth(rest);
        if (lineW + w <= maxW) {
          line.push({ text: rest, color: colorFor(tok.type) });
          lineW += w;
          break;
        }
        // Hard-wrap: take as many chars as fit (at least one).
        let cut = Math.max(1, Math.floor((rest.length * (maxW - lineW)) / w));
        while (cut > 1 && lineW + pdf.getTextWidth(rest.slice(0, cut)) > maxW) cut--;
        line.push({ text: rest.slice(0, cut), color: colorFor(tok.type) });
        rest = rest.slice(cut);
        pushLine();
      }
    });
  }
  pushLine();
  return units;
}

// ── Recipe pages ──

interface RecipeLine {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  gray: number;
  indent: number;
  gapBefore: number;
  /** Hanging label drawn left of the indent (step numbers, bullets). */
  hang?: string;
}

const recipeLineH = (l: RecipeLine) => l.size * 1.4 + l.gapBefore;

/** Wrap one logical line into page-width visual lines. */
function wrapRecipeLine(pdf: Pdf, base: Omit<RecipeLine, 'text'>, text: string): RecipeLine[] {
  pdf.setFont(DOC_FONT, base.bold ? 'bold' : base.italic ? 'italic' : 'normal');
  pdf.setFontSize(base.size);
  const wrapped = pdf.splitTextToSize(text, CONTENT_W - base.indent) as string[];
  return wrapped.map((t, i) => {
    const line: RecipeLine = { ...base, text: t, gapBefore: i === 0 ? base.gapBefore : 0 };
    if (i > 0) delete line.hang;
    return line;
  });
}

function buildRecipeLines(pdf: Pdf, item: RecipeItem): RecipeLine[] {
  const lines: RecipeLine[] = [];
  const push = (base: Omit<RecipeLine, 'text'>, text: string) =>
    lines.push(...wrapRecipeLine(pdf, base, text));

  push({ size: 20, bold: true, italic: false, gray: 25, indent: 0, gapBefore: 0 }, item.title);
  const meta = [
    item.author ? `by ${item.author}` : null,
    item.totalMin ? `${item.totalMin} min` : null,
    item.servings,
    item.cuisine ?? item.category,
  ]
    .filter(Boolean)
    .join('  ·  ');
  if (meta)
    push({ size: 10.5, bold: false, italic: false, gray: 110, indent: 0, gapBefore: 6 }, meta);
  if (item.description)
    push(
      { size: 11, bold: false, italic: true, gray: 80, indent: 0, gapBefore: 8 },
      item.description,
    );

  if (item.ingredients.length) {
    push(
      { size: 11.5, bold: true, italic: false, gray: 60, indent: 0, gapBefore: 18 },
      'INGREDIENTS',
    );
    for (const ing of item.ingredients) {
      push(
        { size: 11, bold: false, italic: false, gray: 35, indent: 14, gapBefore: 4, hang: '•' },
        ing,
      );
    }
  }
  if (item.steps.length) {
    push(
      { size: 11.5, bold: true, italic: false, gray: 60, indent: 0, gapBefore: 18 },
      'INSTRUCTIONS',
    );
    let n = 0;
    for (const step of item.steps) {
      if (step.endsWith(':')) {
        push(
          { size: 11, bold: true, italic: false, gray: 45, indent: 0, gapBefore: 10 },
          step.slice(0, -1),
        );
      } else {
        n += 1;
        push(
          {
            size: 11,
            bold: false,
            italic: false,
            gray: 35,
            indent: 18,
            gapBefore: 6,
            hang: `${n}.`,
          },
          step,
        );
      }
    }
  }
  if (item.sourceUrl)
    push(
      { size: 9.5, bold: false, italic: false, gray: 140, indent: 0, gapBefore: 16 },
      item.sourceUrl,
    );
  return lines;
}

/** Greedy pagination given per-page available heights. */
function paginateRecipeLines(
  lines: RecipeLine[],
  firstAvail: number,
  avail: number,
): RecipeLine[][] {
  const pages: RecipeLine[][] = [];
  let page: RecipeLine[] = [];
  let used = 0;
  let budget = firstAvail;
  for (const line of lines) {
    const h = recipeLineH(line);
    if (used + h > budget && page.length) {
      pages.push(page);
      page = [];
      used = 0;
      budget = avail;
    }
    page.push(line);
    used += h;
  }
  if (page.length) pages.push(page);
  return pages;
}

async function recipeHeroCanvas(assetId: string): Promise<HTMLCanvasElement | null> {
  try {
    const blob = await getAssetBlob(assetId);
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  } catch {
    return null;
  }
}

const RECIPE_HERO_H = 165;

function drawRecipeLines(pdf: Pdf, lines: RecipeLine[], top: number): void {
  let y = top;
  for (const line of lines) {
    y += line.gapBefore + line.size;
    pdf.setFont(DOC_FONT, line.bold ? 'bold' : line.italic ? 'italic' : 'normal');
    pdf.setFontSize(line.size);
    ink(pdf, line.gray);
    if (line.hang) pdf.text(line.hang, MARGIN, y);
    pdf.text(line.text, MARGIN + line.indent, y);
    y += line.size * 0.4;
  }
}

// ── Orchestration ──

interface PlannedSection {
  cat: PdfCategory;
  count: number;
  startPage: number;
  jobs: Job[];
}

function planSection(
  cat: PdfCategory,
  items: Item[],
  startPage: number,
  pdf: Pdf,
  ctx: Ctx,
): PlannedSection {
  const jobs: Job[] = [];

  if (cat === 'image') {
    const { perPage } = galleryMetrics();
    const galleryPages = Math.max(1, Math.ceil(items.length / perPage));
    const individualStart = startPage + galleryPages;
    chunk(items, perPage).forEach((group, g) => {
      jobs.push((p, pn, t) =>
        drawImageGalleryPage(p, group, g * perPage, individualStart, g === 0, pn, t),
      );
    });
    for (const item of items) jobs.push((p, pn, t) => drawIndividualImagePage(p, item, pn, t));
  } else if (cat === 'video') {
    const { perPage } = videoMetrics();
    chunk(items, perPage).forEach((group, g) =>
      jobs.push((p, pn, t) => drawVideoPage(p, group, g === 0, pn, t)),
    );
  } else if (cat === 'audio') {
    const { perPage } = audioMetrics();
    chunk(items, perPage).forEach((group, g) =>
      jobs.push((p, pn, t) => drawAudioPage(p, group, g === 0, pn, t)),
    );
  } else if (cat === 'storyboard') {
    for (const item of items) {
      if (item.type !== 'storyboard') continue;
      const { perPage } = storyboardPdfMetrics(item.aspect);
      chunk(item.panels, perPage).forEach((group, g) =>
        jobs.push((p, pn, t) => drawStoryboardPage(p, ctx.doc, item, group, g === 0, pn, t)),
      );
    }
  } else if (cat === 'color') {
    layoutColors(buildColorEntries(ctx.doc, items)).forEach((cells, g) =>
      jobs.push((p, pn, t) => drawColorPage(p, cells, g === 0, pn, t)),
    );
  } else if (cat === 'webpage') {
    const { perPage } = webpageMetrics();
    chunk(items, perPage).forEach((group, g) =>
      jobs.push((p) => drawWebpagePage(p, group, g === 0)),
    );
  } else if (cat === 'link') {
    paginateLinks(buildLinkEntries(items)).forEach((group, g) =>
      jobs.push((p) => drawLinkPage(p, group, g === 0)),
    );
  } else if (cat === 'text') {
    const availH = PAGE_H - MARGIN * 2;
    // Pre-paginate every note so the index knows where each one starts.
    const notes: {
      item: TextItem;
      title: string;
      pages: Unit[][];
      style: PdfTextStyle;
      headerH: number;
    }[] = [];
    for (const item of items) {
      if (item.type !== 'text') continue;
      const style = textStyle(item, ctx.fontFor.get(item.fontFamily));
      const headerH = drawItemHeader(pdf, item, MARGIN, { measureOnly: true });
      const pages = paginateUnitsWithFirst(
        layoutMarkdown(pdf, item.text, style),
        availH - headerH,
        availH,
      );
      if (pages.length) notes.push({ item, title: mediaMeta(item).title, pages, style, headerH });
    }
    // Index first (first-line titles → linked pages), then the notes.
    const perPage = textIndexPerPage();
    const indexPages = Math.max(1, Math.ceil(notes.length / perPage));
    let content = startPage + indexPages;
    const entries = notes.map((n) => {
      const entry = { title: n.title, page: content };
      content += n.pages.length;
      return entry;
    });
    chunk(entries, perPage).forEach((group, g) => {
      jobs.push((p) => drawTextIndexPage(p, group, g === 0));
    });
    for (const n of notes) {
      n.pages.forEach((pageUnits, i) => {
        jobs.push((p) => drawTextPage(p, n.item, pageUnits, n.style, i === 0 ? n.headerH : 0));
      });
    }
  } else if (cat === 'recipe') {
    const recipes = items.filter((i): i is RecipeItem => i.type === 'recipe');
    for (const item of recipes) {
      const hasHero = Boolean(item.imageAssetId);
      const firstAvail = PAGE_H - HEADING_BOTTOM - MARGIN - (hasHero ? RECIPE_HERO_H + 14 : 0);
      const pages = paginateRecipeLines(
        buildRecipeLines(pdf, item),
        firstAvail,
        PAGE_H - MARGIN * 2,
      );
      pages.forEach((pageLines, i) => {
        jobs.push(async (p) => {
          const first = i === 0;
          if (first) drawHeading(p, 'Recipes', item === recipes[0]);
          let top = first ? HEADING_BOTTOM : MARGIN;
          if (first && hasHero) {
            const hero = await recipeHeroCanvas(item.imageAssetId!);
            if (hero) placeContain(p, hero, MARGIN, top, CONTENT_W, RECIPE_HERO_H);
            top += RECIPE_HERO_H + 14;
          }
          drawRecipeLines(p, pageLines, top);
        });
      });
    }
  } else if (cat === 'code') {
    const availH = PAGE_H - MARGIN * 2;
    const snippets = items
      .filter((i): i is CodeItem => i.type === 'code')
      .map((item) => {
        const headerH = drawItemHeader(pdf, item, MARGIN, { measureOnly: true });
        return {
          item,
          headerH,
          pages: paginateUnitsWithFirst(ctx.codeUnits.get(item.id) ?? [], availH - headerH, availH),
        };
      })
      .filter((sn) => sn.pages.length);
    const perPage = textIndexPerPage();
    const indexPages = Math.max(1, Math.ceil(snippets.length / perPage));
    let content = startPage + indexPages;
    const entries = snippets.map((sn) => {
      const entry = { title: mediaMeta(sn.item).title, page: content };
      content += sn.pages.length;
      return entry;
    });
    chunk(entries, perPage).forEach((group, g) => {
      jobs.push((p) => drawTextIndexPage(p, group, g === 0, 'Code'));
    });
    const style: PdfTextStyle = {
      base: CODE_PRINT_SIZE,
      width: CONTENT_W,
      marginX: MARGIN,
      pageW: PAGE_W,
      fg: hexToRgb(DARK ? '#abb2bf' : '#1f2328'),
      codeColor: hexToRgb(DARK ? '#abb2bf' : '#1f2328'),
      align: 'left',
    };
    for (const sn of snippets) {
      sn.pages.forEach((pageUnits, i) => {
        jobs.push((p) => {
          const headerH = i === 0 ? drawItemHeader(p, sn.item, MARGIN) : 0;
          drawUnitsPage(p, pageUnits, MARGIN + headerH, style);
        });
      });
    }
  } else if (cat === 'font') {
    const fonts = items.filter((i): i is FontItem => i.type === 'font');
    const perPage = textIndexPerPage();
    const indexPages = Math.max(1, Math.ceil(fonts.length / perPage));
    let content = startPage + indexPages;
    const entries = fonts.map((f) => ({ title: f.family, page: content++ }));
    chunk(entries, perPage).forEach((group, g) => {
      jobs.push((p) => drawFontIndexPage(p, group, g === 0));
    });
    for (const f of fonts) {
      jobs.push((p, pn, t) => drawFontPage(p, f, pn, t));
    }
  } else if (cat === 'pdf') {
    // Index grid first (cover thumbnails → each PDF's start), then the docs.
    const { perPage } = pdfIndexMetrics();
    const indexPages = Math.max(1, Math.ceil(items.length / perPage));
    let content = startPage + indexPages;
    const startPages: number[] = [];
    for (const item of items) {
      const info = ctx.pdfMap.get(item.id) ?? { srcDoc: null, numPages: 1 };
      startPages.push(content);
      content += info.numPages;
    }
    chunk(items, perPage).forEach((group, g) => {
      jobs.push((p, pn, t) => drawPdfIndexPage(p, group, g * perPage, startPages, g === 0, pn, t));
    });
    for (const item of items) {
      if (item.type === 'epub') {
        // Books get a rendered cover/header page (no pdf-lib merge source).
        jobs.push((p, pn, t) => drawIndividualImagePage(p, item, pn, t));
        continue;
      }
      const info = ctx.pdfMap.get(item.id) ?? { srcDoc: null, numPages: 1 };
      for (let k = 1; k <= info.numPages; k++) {
        // A blank placeholder; the real page is merged in afterward (pdf-lib).
        jobs.push((_p, pn) => {
          ctx.mappings.push({ pageIndex: pn - 1, srcId: item.id, srcPage: k - 1 });
        });
      }
    }
  } else {
    for (const item of items) jobs.push((p, pn, t) => drawIndividualImagePage(p, item, pn, t));
  }

  return { cat, count: items.length, startPage, jobs };
}

async function preloadPdfs(items: Item[]): Promise<Ctx['pdfMap']> {
  const map: Ctx['pdfMap'] = new Map();
  const pdfItems = items.filter((i) => i.type === 'pdf');
  if (!pdfItems.length) return map;
  const { PDFDocument } = await import('pdf-lib');
  for (const item of pdfItems) {
    if (item.type !== 'pdf') continue;
    const blob = await getAssetBlob(item.assetId);
    if (!blob) {
      map.set(item.id, { srcDoc: null, numPages: item.pageCount ?? 1 });
      continue;
    }
    try {
      const srcDoc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), {
        ignoreEncryption: true,
      });
      map.set(item.id, { srcDoc, numPages: srcDoc.getPageCount() });
    } catch {
      map.set(item.id, { srcDoc: null, numPages: item.pageCount ?? 1 });
    }
  }
  return map;
}

interface OutlineEntry {
  title: string;
  pageIndex: number;
}

/**
 * Finalize the jsPDF output with pdf-lib: merge real source-PDF pages onto their
 * reserved placeholders and attach a document outline (the navigable TOC that
 * PDF readers show in their sidebar). Always run so the outline is reliable.
 */
async function finalizePdf(
  jsBytes: ArrayBuffer,
  ctx: Ctx,
  outline: OutlineEntry[],
): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFHexString } = await import('pdf-lib');
  const out = await PDFDocument.load(jsBytes);

  if (ctx.mappings.length) {
    for (const m of ctx.mappings) {
      const info = ctx.pdfMap.get(m.srcId);
      const page = out.getPage(m.pageIndex);
      if (info?.srcDoc && m.srcPage < info.srcDoc.getPageCount()) {
        try {
          const [embedded] = await out.embedPages([info.srcDoc.getPage(m.srcPage)]);
          if (embedded) {
            const fit = Math.min(PAGE_W / embedded.width, PAGE_H / embedded.height);
            const w = embedded.width * fit;
            const h = embedded.height * fit;
            page.drawPage(embedded, {
              x: (PAGE_W - w) / 2,
              y: (PAGE_H - h) / 2,
              width: w,
              height: h,
            });
          }
        } catch {
          /* leave the placeholder blank */
        }
      }
    }
  }

  // Document outline (bookmarks). Built by hand: pdf-lib has no high-level API.
  if (outline.length) {
    const c = out.context;
    const pages = out.getPages();
    const outlinesRef = c.nextRef();
    const refs = outline.map(() => c.nextRef());
    outline.forEach((e, i) => {
      const page = pages[Math.min(e.pageIndex, pages.length - 1)]!;
      const node = {
        Title: PDFHexString.fromText(e.title),
        Parent: outlinesRef,
        Dest: [page.ref, PDFName.of('Fit')],
        ...(i > 0 ? { Prev: refs[i - 1]! } : {}),
        ...(i < outline.length - 1 ? { Next: refs[i + 1]! } : {}),
      };
      c.assign(refs[i]!, c.obj(node));
    });
    c.assign(
      outlinesRef,
      c.obj({
        Type: PDFName.of('Outlines'),
        First: refs[0]!,
        Last: refs[refs.length - 1]!,
        Count: outline.length,
      }),
    );
    out.catalog.set(PDFName.of('Outlines'), outlinesRef);
    out.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  }

  return out.save();
}

export async function exportCurrentAsAssetPdf(opts?: {
  types?: Set<string>;
  dark?: boolean;
  /** Pages scope: 'page' = the active page's assets only (default 'all'). */
  scope?: 'page' | 'all';
}): Promise<void> {
  const { doc } = useDocumentStore.getState();
  DARK = opts?.dark ?? false;
  setPdfDark(DARK);
  const selected = opts?.types ?? null;
  const firstPg = doc.pages[0]?.id ?? null;
  const wantPg = opts?.scope === 'page' ? activePageId(doc) : null;
  const items = lightboxList(doc).filter((it) => {
    if (wantPg !== null && (it.pageId ?? firstPg) !== wantPg) return false;
    const c = categoryOf(it);
    return c !== null && (!selected || selected.has(c));
  });

  const grouped = new Map<PdfCategory, Item[]>();
  for (const it of items) {
    const c = categoryOf(it)!;
    (grouped.get(c) ?? grouped.set(c, []).get(c)!).push(it);
  }
  const order = PDF_CATEGORY_ORDER.filter((c) => grouped.has(c));
  // Specimen pages draw with the real faces — make sure they're registered.
  await Promise.all(
    (grouped.get('font') ?? []).map((f) =>
      f.type === 'font' ? ensureFont(f.family, f.assetId) : Promise.resolve(false),
    ),
  );
  const ctx: Ctx = {
    doc,
    pdfMap: await preloadPdfs(grouped.get('pdf') ?? []),
    mappings: [],
    fontFor: new Map(),
    codeUnits: new Map(),
  };

  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', compress: true });

  // Typography: the document chrome uses the Settings → Text default font;
  // text notes use their own faces (board fonts embed when TrueType).
  const boardFonts = new Map<string, string>();
  for (const it of Object.values(doc.items)) {
    if (it.type === 'font') boardFonts.set(it.family, it.assetId);
  }
  const fontCache = new Map<string, string>();
  DOC_FONT = await resolvePdfFont(
    pdf,
    useSessionStore.getState().textDefaults.fontFamily,
    boardFonts,
    fontCache,
  );
  for (const it of items) {
    if (it.type === 'text' && !ctx.fontFor.has(it.fontFamily)) {
      ctx.fontFor.set(
        it.fontFamily,
        await resolvePdfFont(pdf, it.fontFamily, boardFonts, fontCache),
      );
    }
  }

  // Pre-tokenize code snippets (Prism lives in a lazy chunk).
  const codeItems = (grouped.get('code') ?? []).filter((i): i is CodeItem => i.type === 'code');
  if (codeItems.length) {
    const { tokenizeCode } = await import('../text/codeHighlight');
    for (const item of codeItems) {
      ctx.codeUnits.set(
        item.id,
        layoutCodeUnits(pdf, tokenizeCode(item.code, item.language), DARK),
      );
    }
  }

  // Plan: title = page 1, contents = page 2, sections follow.
  const sections: PlannedSection[] = [];
  let page = 2;
  for (const cat of order) {
    const planned = planSection(cat, grouped.get(cat)!, page + 1, pdf, ctx);
    sections.push(planned);
    page += planned.jobs.length;
  }

  const jobs: Job[] = [(p) => drawTitlePage(p, doc)];
  jobs.push((p, pn, t) =>
    drawTocPage(
      p,
      sections.map((s) => ({ cat: s.cat, count: s.count, page: s.startPage })),
      pn,
      t,
    ),
  );
  for (const s of sections) jobs.push(...s.jobs);

  const total = jobs.length;
  for (let i = 0; i < jobs.length; i++) {
    if (i > 0) pdf.addPage();
    paintPageBg(pdf);
    await jobs[i]!(pdf, i + 1, total);
    if ((i + 1) % 6 === 0) await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  const outline: OutlineEntry[] = [
    { title: 'Cover', pageIndex: 0 },
    { title: 'Contents', pageIndex: 1 },
    ...sections.map((s) => ({ title: PDF_CATEGORY_LABEL[s.cat], pageIndex: s.startPage - 1 })),
  ];
  const bytes = await finalizePdf(pdf.output('arraybuffer'), ctx, outline);
  downloadBlob(
    new Blob([bytes as BlobPart], { type: 'application/pdf' }),
    `${safeFilename(doc.name)}.pdf`,
  );
}
