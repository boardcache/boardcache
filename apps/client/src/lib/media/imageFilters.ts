import type { ImageFilters } from '@boardcache/schema';

/** Identity filters — an item with these (or null) is visually untouched. */
export const DEFAULT_FILTERS: ImageFilters = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  grayscale: 0,
  invert: false,
};

/** Filters with all per-control ranges, used to build sliders and reset. */
export const FILTER_CONTROLS = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 2, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 1, step: 0.01 },
] as const;

/** Build the CSS/canvas `filter` string for an item's filters (or undefined if none). */
export function filterCss(filters: ImageFilters | null | undefined): string | undefined {
  if (!filters) return undefined;
  const parts: string[] = [];
  if (filters.brightness !== 1) parts.push(`brightness(${filters.brightness})`);
  if (filters.contrast !== 1) parts.push(`contrast(${filters.contrast})`);
  if (filters.saturation !== 1) parts.push(`saturate(${filters.saturation})`);
  if (filters.grayscale > 0) parts.push(`grayscale(${filters.grayscale})`);
  if (filters.invert) parts.push('invert(1)');
  return parts.length ? parts.join(' ') : undefined;
}

/** True when the filters deviate from the identity (something to render/bake). */
export function hasActiveFilters(filters: ImageFilters | null | undefined): boolean {
  return filterCss(filters) !== undefined;
}

/** Normalize to null when filters are back at the identity (keeps the doc clean). */
export function normalizeFilters(filters: ImageFilters): ImageFilters | null {
  return hasActiveFilters(filters) ? filters : null;
}
