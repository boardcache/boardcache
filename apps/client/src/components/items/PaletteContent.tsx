import type { PaletteItem } from '@boardcache/schema';

export function PaletteContent({ item }: { item: PaletteItem }) {
  return (
    <div className="palette-item">
      {item.colors.map((entry, i) => (
        <div
          key={`${entry.color}-${i}`}
          className="palette-cell"
          style={{ background: entry.color }}
          title={entry.name ? `${entry.name} — ${entry.color}` : entry.color}
        />
      ))}
    </div>
  );
}
