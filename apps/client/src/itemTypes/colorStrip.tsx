import type { ColorEntry } from '../lib/mediaItems';

/** A multi-colour strip for grouped swatches and palettes. */
export function ColorStrip({ colors }: { colors: ColorEntry[] }) {
  return (
    <span className="gallery-palette">
      {colors.map((c, i) => (
        <i key={i} style={{ background: c.color }} />
      ))}
    </span>
  );
}
