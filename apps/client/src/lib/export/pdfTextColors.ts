import { readableTextColor, splitHexAlpha } from '../color/color';

type Rgb = [number, number, number];

/** #rgb / #rrggbb / #rrggbbaa → RGB (alpha ignored); null when it isn't a hex colour. */
export function parseHex(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * How a text box prints. The page IS the card, so:
 *  - an unstyled box ('auto' follows the theme on the canvas) and a
 *    transparent one print straight onto the page — no fill;
 *  - an explicit fill prints as chosen, a translucent one flattened over the
 *    page colour (PDF fills here are opaque);
 *  - default ink is whatever reads on the surface it lands on; a chosen ink
 *    is kept.
 */
export function pdfTextColors(
  item: { background: string | null; color: string },
  pageBase: string,
): { fill: string | null; ink: string } {
  let fill: string | null = null;
  if (item.background && item.background !== 'auto') {
    const { hex, alpha } = splitHexAlpha(item.background);
    const rgb = parseHex(hex);
    const base = parseHex(pageBase);
    if (rgb && alpha > 0.02) {
      fill =
        alpha >= 1 || !base
          ? toHex(rgb)
          : toHex(rgb.map((v, i) => v * alpha + base[i]! * (1 - alpha)) as Rgb);
    }
  }
  const chosen = item.color !== 'default' ? parseHex(item.color) : null;
  return { fill, ink: chosen ? toHex(chosen) : readableTextColor(fill ?? pageBase) };
}
