import { getDb } from '../db';

/**
 * Board names are unique in a library. A name that is already taken gets a
 * counter: "Trip", "Trip (1)", "Trip (2)". The comparison ignores case and
 * surrounding space, and a name that already carries a counter counts from
 * its base, so importing "Trip (1)" beside "Trip (1)" gives "Trip (2)", not
 * "Trip (1) (1)".
 */
export function uniqueBoardName(name: string, taken: Iterable<string>): string {
  const key = (s: string) => s.trim().toLowerCase();
  const used = new Set<string>();
  for (const t of taken) used.add(key(t));
  const wanted = name.trim();
  if (!used.has(key(wanted))) return wanted;
  const base = wanted.replace(/\s\(\d+\)$/, '');
  for (let n = 1; ; n++) {
    const candidate = `${base} (${n})`;
    if (!used.has(key(candidate))) return candidate;
  }
}

/** The name `name` as the library can take it: unchanged if free, else with
 *  a counter. `excludeId` is the board being renamed, whose own name is free. */
export async function uniqueLibraryName(name: string, excludeId?: string): Promise<string> {
  const db = await getDb();
  const records = await db.getAll('boards');
  return uniqueBoardName(
    name,
    records.filter((r) => r.id !== excludeId).map((r) => r.name),
  );
}
