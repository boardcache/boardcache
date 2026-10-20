import type { TitleItem } from '@boardcache/schema';

/**
 * Fit math for title items: the stored text has NO font size — it scales to
 * fit the box ("contain"), padded, measured with a shared canvas context.
 * Used by the canvas renderer, board thumbnails and the pop-out, so every
 * surface agrees on the same fit.
 */

const MEASURE_PX = 100;
const LINE_HEIGHT = 1.18;

let ctx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')!;
  return ctx;
}

export function titleLines(item: Pick<TitleItem, 'text'>): string[] {
  const lines = item.text.split('\n');
  return lines.length ? lines : [''];
}

export function titleFont(
  item: Pick<TitleItem, 'fontFamily' | 'bold' | 'italic'>,
  px: number,
): string {
  return `${item.italic ? 'italic ' : ''}${item.bold ? '700' : '400'} ${px}px ${item.fontFamily}`;
}

/** Padding scales with the box so small titles don't drown in whitespace. */
export function titlePadding(w: number, h: number): number {
  return Math.max(4, Math.min(w, h) * 0.08);
}

/**
 * The font size (px) at which the text fits the box: widest line fills the
 * available width, capped so all lines fit the height too.
 */
export function titleFontSize(
  item: Pick<TitleItem, 'text' | 'fontFamily' | 'bold' | 'italic'>,
  w: number,
  h: number,
): number {
  const pad = titlePadding(w, h);
  const availW = Math.max(1, w - pad * 2);
  const availH = Math.max(1, h - pad * 2);
  const lines = titleLines(item);
  const c = measureCtx();
  c.font = titleFont(item, MEASURE_PX);
  let maxLine = 1;
  for (const line of lines) {
    maxLine = Math.max(maxLine, c.measureText(line || ' ').width);
  }
  const totalH = lines.length * MEASURE_PX * LINE_HEIGHT;
  const scale = Math.min(availW / maxLine, availH / totalH);
  return Math.max(2, MEASURE_PX * scale);
}

export { LINE_HEIGHT as TITLE_LINE_HEIGHT };
