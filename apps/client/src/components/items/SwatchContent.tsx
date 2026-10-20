import type { SwatchItem } from '@boardcache/schema';

/** A single color chip — just the color. Hex/name live in the lightbox. */
export function SwatchContent({ item }: { item: SwatchItem }) {
  return <div className="swatch-item" style={{ background: item.color }} />;
}
