/**
 * The reading preferences the full-screen views share (Notes, Feeds): the
 * text size steps and the page's width as a share of the stage. Each view
 * keeps its own values on the device; these are the scales they step along.
 */

/** The reading sizes, the lightbox's steps. */
export const TEXT_SCALES = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
/** The page's width as a share of the stage, narrow to full. */
export const PAGE_WIDTH_MIN = 40;
export const PAGE_WIDTH_MAX = 100;
const PAGE_WIDTH_DEFAULT = 72;

/** The next text size up or down from `current` (1 when it is off the scale). */
export function steppedScale(current: number, dir: 1 | -1): number {
  const at = TEXT_SCALES.findIndex((v) => Math.abs(v - current) < 1e-6);
  const i = at === -1 ? TEXT_SCALES.indexOf(1) : at;
  return TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, i + dir))]!;
}

/** A stored text size, or 1 when it is missing or off the scale. */
export function readStoredScale(key: string): number {
  try {
    const n = Number(localStorage.getItem(key));
    return TEXT_SCALES.some((v) => Math.abs(v - n) < 1e-6) ? n : 1;
  } catch {
    return 1;
  }
}

/** A stored page width, or the view's default when it is missing or out of range. */
export function readStoredWidth(key: string, fallback = PAGE_WIDTH_DEFAULT): number {
  try {
    const n = Number(localStorage.getItem(key));
    return n >= PAGE_WIDTH_MIN && n <= PAGE_WIDTH_MAX ? n : fallback;
  } catch {
    return fallback;
  }
}
