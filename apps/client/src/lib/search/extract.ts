import type { Item } from '@boardcache/schema';

/** What a type contributes to the board search index. */
export interface Extracted {
  title: string;
  body: string;
}

/** Non-empty parts, one per line. */
export const join = (...parts: (string | null | undefined)[]): string =>
  parts.filter((p): p is string => !!p && p.trim().length > 0).join('\n');

/** The metadata every item carries: notes, attached URL, evidence status, tags. */
export const baseText = (item: Item): string =>
  join(
    item.notes,
    item.linkUrl,
    item.status,
    item.weight ? `strength ${item.weight}` : undefined,
    ...(item.tags ?? []),
  );
