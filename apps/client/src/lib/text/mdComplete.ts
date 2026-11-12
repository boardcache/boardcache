/**
 * The `[[` completion shared by the Markdown editors: what is being typed,
 * and which titles to offer for it.
 */

/** The `[[query` (or `![[query`, an embed) being typed before the caret,
 *  if any (no `]]` closed it). */
export function detectWikiLink(
  value: string,
  caret: number,
): { query: string; start: number; embed: boolean } | null {
  const upto = value.slice(0, caret);
  const m = upto.match(/(!?)\[\[([^[\]\n]*)$/);
  if (!m) return null;
  return { query: m[2] ?? '', start: caret - (m[2]?.length ?? 0), embed: m[1] === '!' };
}

/** The titles matching a query: those that start with it first, then the
 *  rest, alphabetically; duplicates folded; at most eight. */
export function filterTitles(titles: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of titles) {
    const key = t.toLowerCase();
    if (seen.has(key) || (q && !key.includes(q))) continue;
    seen.add(key);
    out.push(t);
  }
  out.sort((a, b) => {
    const sa = q && a.toLowerCase().startsWith(q) ? 0 : 1;
    const sb = q && b.toLowerCase().startsWith(q) ? 0 : 1;
    return sa - sb || a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
  return out.slice(0, 8);
}
