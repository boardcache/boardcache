import type { Point } from '../canvas/coords';
import { createLinkItem, createSwatchItem } from './createItems';
import { createRssItem } from '../integrations/rss';
import { updateItems } from '../../state/commands';

/**
 * Smart text paste/drop: recognizable strings become their natural item type
 * instead of a markdown box — a bare URL turns into a link button (or an RSS
 * reader for feed-looking URLs), a color literal becomes a swatch. Returns
 * false when the text is none of those so callers fall back to a text item.
 */

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, '0');

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** '#abc', '#aabbcc(dd)', 'rgb(a)(…)', 'hsl(a)(…)' → '#rrggbb', else null. */
function parseColorText(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  const short = /^#([0-9a-f]{3,4})$/.exec(t);
  if (short) {
    const [r, g, b] = short[1]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(t);
  if (long) return `#${long[1]}`;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/][^)]*)?\)$/.exec(
    t,
  );
  if (rgb) return `#${hex2(+rgb[1]!)}${hex2(+rgb[2]!)}${hex2(+rgb[3]!)}`;
  const hsl =
    /^hsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*(?:[,/][^)]*)?\)$/.exec(
      t,
    );
  if (hsl) {
    const [r, g, b] = hslToRgb(+hsl[1]!, +hsl[2]! / 100, +hsl[3]! / 100);
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  return null;
}

function isRssUrl(url: string): boolean {
  return /\.(rss|atom|xml)(\?|#|$)/i.test(url) || /\/(feed|rss|atom)(\/|\?|#|$)/i.test(url);
}

export function smartCreateFromText(text: string, at: Point): boolean {
  const t = text.trim();
  if (!t) return false;

  const hex = parseColorText(t);
  if (hex) {
    createSwatchItem(at, hex);
    return true;
  }

  if (/^https?:\/\/\S+$/i.test(t) && !/\s/.test(t)) {
    if (isRssUrl(t)) {
      void createRssItem(t, at);
      return true;
    }
    const id = createLinkItem(at);
    let label = t;
    try {
      label = new URL(t).hostname.replace(/^www\./, '');
    } catch {
      /* keep the raw text as the label */
    }
    updateItems([id], 'Paste link', (d) => {
      if (d.type !== 'link') return;
      d.url = t;
      d.label = label;
    });
    return true;
  }
  return false;
}
