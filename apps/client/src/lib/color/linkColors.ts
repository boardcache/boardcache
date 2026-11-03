import type { LinkItem } from '@boardcache/schema';
import { linkButtonDefaults } from '../themes';
import { readableTextColor } from './color';

/**
 * A link button's colors. `background: 'auto'` (the default for new buttons)
 * follows the theme's accent live, so a mode or theme switch restyles it;
 * a picked #rrggbb stays fixed. The label always reads against the fill.
 */

export const isThemeLink = (item: Pick<LinkItem, 'background'>): boolean =>
  item.background === 'auto';

/** CSS values for the DOM (canvas item, gallery card). */
export function linkCssColors(item: Pick<LinkItem, 'background'>): {
  background: string;
  color: string;
} {
  if (isThemeLink(item)) return { background: 'var(--accent)', color: 'var(--accent-fg)' };
  return { background: item.background, color: readableTextColor(item.background) };
}

/** Concrete hex colors for canvas painters (thumbnails, low detail, exports),
 *  which cannot resolve CSS variables and paint both modes regardless of the
 *  live page. */
export function linkPaintColors(
  item: Pick<LinkItem, 'background'>,
  dark: boolean,
): { background: string; color: string } {
  if (isThemeLink(item)) return linkButtonDefaults(dark);
  return { background: item.background, color: readableTextColor(item.background) };
}
