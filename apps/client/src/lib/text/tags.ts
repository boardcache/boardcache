import type { CanvasDocument, Item } from '@boardcache/schema';

/**
 * Tags are free-form metadata on any item. They're normalized on input
 * (trimmed, inner whitespace collapsed, a leading `#` dropped) and de-duplicated
 * case-insensitively so `Red` and `red` don't both live on one item.
 */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();
}

/** Split a comma/newline-separated string into normalized, non-empty tags. */
export function parseTags(raw: string): string[] {
  return raw.split(/[,\n]/).map(normalizeTag).filter(Boolean);
}

/** Add `tag` to a list case-insensitively (keeps the existing casing on dup). */
export function withTag(tags: string[], tag: string): string[] {
  const t = normalizeTag(tag);
  if (!t) return tags;
  if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return tags;
  return [...tags, t];
}

/** Remove `tag` from a list case-insensitively. */
export function withoutTag(tags: string[], tag: string): string[] {
  return tags.filter((x) => x.toLowerCase() !== tag.toLowerCase());
}

/** Every distinct tag across the document, sorted case-insensitively. */
export function allTags(doc: CanvasDocument): string[] {
  const seen = new Map<string, string>(); // lowercased → first-seen casing
  for (const item of Object.values(doc.items)) {
    for (const tag of item.tags ?? []) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** True when the item carries `tag` (case-insensitive). */
export function hasTag(item: Item, tag: string): boolean {
  const t = tag.toLowerCase();
  return (item.tags ?? []).some((x) => x.toLowerCase() === t);
}
