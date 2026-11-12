/**
 * The options after an embed's title: `![[Harbour|300]]`, `![[Harbour|center]]`,
 * `![[Harbour|300|center]]` (either order). A width in px, an alignment,
 * or both; anything else is ignored.
 */

export type EmbedAlign = 'left' | 'center' | 'right';

export interface EmbedParams {
  size: string | null;
  align: EmbedAlign | null;
}

const ALIGNS = new Set<string>(['left', 'center', 'right']);

/** Parse the `|`-separated options (without the title). */
export function parseEmbedParams(rest: string): EmbedParams {
  let size: string | null = null;
  let align: EmbedAlign | null = null;
  for (const raw of rest.split('|')) {
    const part = raw.trim().toLowerCase();
    if (!part) continue;
    if (/^\d{2,4}$/.test(part)) size = part;
    else if (ALIGNS.has(part)) align = part as EmbedAlign;
  }
  return { size, align };
}

/** Split `Title|300|center` into the title and its options. */
export function splitEmbed(inner: string): { title: string; params: EmbedParams } {
  const bar = inner.indexOf('|');
  const title = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
  return { title, params: parseEmbedParams(bar >= 0 ? inner.slice(bar + 1) : '') };
}
