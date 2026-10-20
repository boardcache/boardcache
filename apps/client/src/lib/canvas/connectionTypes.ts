import type { ConnectionRel } from '@boardcache/schema';

/**
 * The research vocabulary for typed connections. 'relates' is the neutral
 * default and keeps the theme's line color (incl. corkboard's red yarn);
 * the others carry their meaning as a color on the canvas and in Graph View.
 */
export const CONNECTION_RELS: {
  id: ConnectionRel;
  name: string;
  color: string | null;
  /** Reads one way (from → to) and draws a direction chevron; symmetric
   *  rels (relates, contradicts) stay clean lines. */
  directional: boolean;
}[] = [
  { id: 'relates', name: 'Relates', color: null, directional: false },
  { id: 'supports', name: 'Supports', color: '#2e9e5b', directional: true },
  { id: 'contradicts', name: 'Contradicts', color: '#d64545', directional: false },
  { id: 'causes', name: 'Causes', color: '#e08a2e', directional: true },
  { id: 'cites', name: 'Cites', color: '#4a7de0', directional: true },
  { id: 'depends', name: 'Depends on', color: '#8a63d2', directional: true },
  { id: 'partof', name: 'Part of', color: '#2a9d8f', directional: true },
  { id: 'follows', name: 'Follows', color: '#c2578f', directional: true },
  { id: 'inspires', name: 'Inspires', color: '#d9a521', directional: true },
  { id: 'duplicates', name: 'Duplicates', color: '#8a93a5', directional: false },
];

export function relDirectional(rel: ConnectionRel | undefined): boolean {
  return CONNECTION_RELS.find((r) => r.id === (rel ?? 'relates'))?.directional ?? false;
}

export function relColor(rel: ConnectionRel | undefined): string | null {
  return CONNECTION_RELS.find((r) => r.id === (rel ?? 'relates'))?.color ?? null;
}

export function relName(rel: ConnectionRel | undefined): string {
  return CONNECTION_RELS.find((r) => r.id === (rel ?? 'relates'))?.name ?? 'Relates';
}
