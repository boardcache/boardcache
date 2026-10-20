/** Color math: hex ⇄ RGB ⇄ HSL plus harmony generation. Pure, unit-tested. */

export interface Rgb {
  r: number; // 0..255
  g: number;
  b: number;
}

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, '0')}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = hue / 360;
  const channel = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: channel(hk + 1 / 3) * 255,
    g: channel(hk) * 255,
    b: channel(hk - 1 / 3) * 255,
  };
}

export function shiftHue(hex: string, degrees: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  return rgbToHex(hslToRgb({ ...hsl, h: hsl.h + degrees }));
}

export function withLightness(hex: string, l: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(hslToRgb({ ...rgbToHsl(rgb), l: Math.max(0, Math.min(1, l)) }));
}

/**
 * A dark-theme stand-in for a backdrop colour picked in light mode. Pale
 * tints (the usual choice for a group or page wash) become deep shades of
 * the same hue — lightness mirrored into the low range, saturation lifted a
 * touch so the hue still reads over a dark page — while mid and dark
 * colours, which already hold up on a dark page, pass through unchanged.
 */
export function darkVariant(hex: string): string {
  const split = splitHexAlpha(hex);
  const rgb = hexToRgb(split.hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  if (hsl.l < 0.6) return hex;
  const l = 0.2 + (1 - hsl.l) * 0.55;
  const s = Math.min(1, hsl.s * 1.15 + 0.05);
  const out = rgbToHex(hslToRgb({ h: hsl.h, s, l }));
  return split.alpha < 1 ? withAlpha(out, split.alpha) : out;
}

export type HarmonyKind = 'complementary' | 'analogous' | 'triadic' | 'tetradic' | 'shades';

export const HARMONY_KINDS: readonly HarmonyKind[] = [
  'complementary',
  'analogous',
  'triadic',
  'tetradic',
  'shades',
];

/** Generate a harmony palette (base color first). */
export function harmony(baseHex: string, kind: HarmonyKind): string[] {
  const base = baseHex.toLowerCase();
  switch (kind) {
    case 'complementary':
      return [base, shiftHue(base, 180)];
    case 'analogous':
      return [shiftHue(base, -30), base, shiftHue(base, 30)];
    case 'triadic':
      return [base, shiftHue(base, 120), shiftHue(base, 240)];
    case 'tetradic':
      return [base, shiftHue(base, 90), shiftHue(base, 180), shiftHue(base, 270)];
    case 'shades': {
      const rgb = hexToRgb(base);
      if (!rgb) return [base];
      const { h, s } = rgbToHsl(rgb);
      return [0.85, 0.65, 0.5, 0.35, 0.18].map((l) => rgbToHex(hslToRgb({ h, s, l })));
    }
  }
}

/** Perceived luminance 0..1 (for choosing readable label colors). */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/** Dark text on light backgrounds, light text on dark — for label contrast. */
/** Split #rrggbb or #rrggbbaa into the solid hex and a 0–1 alpha. */
export function splitHexAlpha(hex: string): { hex: string; alpha: number } {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return { hex, alpha: 1 };
  return { hex: `#${m[1]!}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

/** #rrggbb + alpha → #rrggbbaa (plain #rrggbb when fully opaque). */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (a >= 1) return hex;
  return (
    hex +
    Math.round(a * 255)
      .toString(16)
      .padStart(2, '0')
  );
}

export function readableTextColor(background: string): string {
  return luminance(background) > 0.55 ? '#16181d' : '#ffffff';
}

export interface Hsv {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r: number;
  let g: number;
  let b: number;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export interface Cmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

export function rgbToCmyk({ r, g, b }: Rgb): Cmyk {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 1 };
  return {
    c: (1 - rn - k) / (1 - k),
    m: (1 - gn - k) / (1 - k),
    y: (1 - bn - k) / (1 - k),
    k,
  };
}

/** Labeled, copyable color representations for the lightbox sidebar. */
export function colorFormats(hex: string): { label: string; value: string }[] {
  const rgb = hexToRgb(hex);
  if (!rgb) return [{ label: 'HEX', value: hex }];
  const hsl = rgbToHsl(rgb);
  const hsv = rgbToHsv(rgb);
  const cmyk = rgbToCmyk(rgb);
  const pct = (n: number) => Math.round(n * 100);
  return [
    { label: 'HEX', value: hex.toLowerCase() },
    { label: 'RGB', value: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
    { label: 'HSL', value: `hsl(${Math.round(hsl.h)}, ${pct(hsl.s)}%, ${pct(hsl.l)}%)` },
    { label: 'HSV', value: `hsv(${Math.round(hsv.h)}, ${pct(hsv.s)}%, ${pct(hsv.v)}%)` },
    {
      label: 'CMYK',
      value: `cmyk(${pct(cmyk.c)}%, ${pct(cmyk.m)}%, ${pct(cmyk.y)}%, ${pct(cmyk.k)}%)`,
    },
  ];
}
