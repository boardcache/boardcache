import type { Item } from '@boardcache/schema';

/**
 * Evidence strength vocabulary (research boards): 1–5, how far a case may
 * lean on an item. One module owns the names so the context menu, canvas
 * badge, lightbox field, case scoring and search all agree. Unrated items
 * carry no strength at all: a case counts them, but not their weight.
 */
const WEIGHT_MAX = 5;

export interface WeightMeta {
  value: number;
  name: string;
}

export const WEIGHT_LEVELS: readonly WeightMeta[] = [
  { value: 1, name: 'Weak' },
  { value: 2, name: 'Limited' },
  { value: 3, name: 'Moderate' },
  { value: 4, name: 'Strong' },
  { value: 5, name: 'Conclusive' },
];

export function weightMeta(weight: Item['weight']): WeightMeta | undefined {
  return weight ? WEIGHT_LEVELS.find((w) => w.value === weight) : undefined;
}

/** "4/5 · Strong" for tooltips and captions. */
export function weightLabel(weight: number): string {
  return `${weight}/${WEIGHT_MAX} · ${weightMeta(weight)?.name ?? ''}`.trim();
}
