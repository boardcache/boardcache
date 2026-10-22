import type { Item } from '@boardcache/schema';
import { safeHttpUrl } from './safeUrl';

/** A URL intrinsic to the item's type (not user-attached). */
function intrinsicUrl(item: Item): string | null {
  if (item.type === 'link') return item.url || null;
  if (item.type === 'iframe') return item.url || null;
  if (item.type === 'video' && item.embed) return item.embed.url || null;
  if (item.type === 'audio' && item.embed) return item.embed.url || null;
  return null;
}

/** The URL to use for the item: its intrinsic one, else a user-attached one. */
export function effectiveUrl(item: Item): string | null {
  return intrinsicUrl(item) ?? item.linkUrl ?? null;
}

/** Items that don't already carry an intrinsic URL can have one attached. */
export function canAttachUrl(item: Item): boolean {
  return intrinsicUrl(item) === null;
}

/** Open a URL that came from board content in a new tab. Only http(s)
 *  ever opens: a board is often someone else's, and javascript:, data: or
 *  file: targets are not links. */
export function openUrl(url: string | null | undefined): void {
  const safe = safeHttpUrl(url);
  if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
}
