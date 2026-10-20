import type { Item } from '@boardcache/schema';

/**
 * Evidence status vocabulary (research boards): a claim on the wall is
 * confirmed, unverified, or debunked. One module owns the ids, display
 * names, colors, and badge glyphs so the context menu, canvas badge,
 * Graph View card borders, and search index all agree.
 */
export type EvidenceStatus = NonNullable<Item['status']>;

export interface EvidenceStatusMeta {
  id: EvidenceStatus;
  name: string;
  /** Badge/border color (works on light and dark themes). */
  color: string;
  /** Single-character badge glyph. */
  glyph: string;
}

export const EVIDENCE_STATUSES: readonly EvidenceStatusMeta[] = [
  { id: 'confirmed', name: 'Confirmed', color: '#2e9e5b', glyph: '✓' },
  { id: 'unverified', name: 'Unverified', color: '#e0a828', glyph: '?' },
  { id: 'debunked', name: 'Debunked', color: '#d64545', glyph: '✕' },
];

export function statusMeta(id: EvidenceStatus | undefined): EvidenceStatusMeta | undefined {
  return id ? EVIDENCE_STATUSES.find((s) => s.id === id) : undefined;
}
