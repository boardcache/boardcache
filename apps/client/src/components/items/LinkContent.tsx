import type { LinkItem } from '@boardcache/schema';
import { readableTextColor } from '../../lib/color/color';
import { cardZoom } from '../../lib/canvas/cardZoom';
import { ScaledCard } from './ScaledCard';

/**
 * A link button: colored background, auto-contrasting label. Double-click
 * opens. It scales like a project card: a corner drag zooms the label,
 * padding and corners together; an edge drag only widens or heightens it.
 */
export function LinkContent({ item }: { item: LinkItem }) {
  return (
    <ScaledCard item={{ ...item, zoom: cardZoom(item) }} baseW={item.width}>
      <div
        className="link-item"
        style={{
          background: item.background,
          color: readableTextColor(item.background),
        }}
        title={item.url || undefined}
      >
        <span className="link-item-label">{item.label || 'Link'}</span>
        <span className="link-item-arrow" aria-hidden>
          ↗
        </span>
      </div>
    </ScaledCard>
  );
}
