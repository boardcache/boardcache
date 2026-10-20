import type { CanvasDocument, Item, SwatchItem } from '@boardcache/schema';
import { itemType } from '../itemTypes';

/** Everything on the canvas is viewable in the lightbox. */
export function isLightboxable(_item: Item): boolean {
  return true;
}

const readingOrder = (a: Item, b: Item) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1);

/** All items in reading order (top-to-bottom, left-to-right). */
export function orderedItems(doc: CanvasDocument): Item[] {
  return Object.values(doc.items).sort(readingOrder);
}

/**
 * The lightbox / gallery list: every item in reading order, but a swatch group
 * collapses to a single entry (its first member) since the lightbox shows the
 * whole group's colors at once.
 */
export function lightboxList(doc: CanvasDocument): Item[] {
  const seenGroups = new Set<string>();
  const out: Item[] = [];
  for (const item of orderedItems(doc)) {
    if (item.type === 'swatch' && item.groupId) {
      if (seenGroups.has(item.groupId)) continue;
      seenGroups.add(item.groupId);
    }
    out.push(item);
  }
  return out;
}

/** Members of a swatch group in reading order. */
export function swatchGroupMembers(doc: CanvasDocument, groupId: string): SwatchItem[] {
  return Object.values(doc.items)
    .filter((i): i is SwatchItem => i.type === 'swatch' && i.groupId === groupId)
    .sort(readingOrder);
}

/**
 * Normalize an id to the entry that actually appears in the list — opening a
 * non-first member of a swatch group resolves to the group's first member.
 */
export function representativeId(doc: CanvasDocument, id: string): string {
  const item = doc.items[id];
  if (item?.type === 'swatch' && item.groupId) {
    return swatchGroupMembers(doc, item.groupId)[0]?.id ?? id;
  }
  return id;
}

export interface ColorEntry {
  color: string;
  name?: string;
}

export interface ColorSet {
  colors: ColorEntry[];
  /** true for palettes and swatch groups (multiple selectable colors). */
  multi: boolean;
}

/** The colors an item exposes to the lightbox sidebar, or null if it has none. */
export function colorSetFor(doc: CanvasDocument, item: Item): ColorSet | null {
  if (item.type === 'palette') {
    return {
      colors: item.colors.map((c) =>
        c.name !== undefined ? { color: c.color, name: c.name } : { color: c.color },
      ),
      multi: true,
    };
  }
  if (item.type === 'swatch') {
    if (item.groupId) {
      return {
        colors: swatchGroupMembers(doc, item.groupId).map((s) =>
          s.name !== undefined ? { color: s.color, name: s.name } : { color: s.color },
        ),
        multi: true,
      };
    }
    return {
      colors: [
        item.name !== undefined ? { color: item.color, name: item.name } : { color: item.color },
      ],
      multi: false,
    };
  }
  return null;
}

export interface MediaMeta {
  title: string;
  typeLabel: string;
  detail: string | null;
}

/** Human-facing metadata for the lightbox panel and gallery captions. */
export function mediaMeta(item: Item): MediaMeta {
  const def = itemType(item);
  const base = { title: item.name ?? def.label, detail: null };
  const over = def.meta?.(item, base) ?? {};
  return { title: over.title ?? base.title, typeLabel: def.label, detail: over.detail ?? null };
}
