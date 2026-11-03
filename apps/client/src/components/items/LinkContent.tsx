import type { LinkItem } from '@boardcache/schema';
import { linkCssColors } from '../../lib/color/linkColors';
import { cardZoom } from '../../lib/canvas/cardZoom';
import { ScaledCard } from './ScaledCard';

/**
 * A link button: the theme's accent (or a picked color), auto-contrasting
 * label. Double-click
 * opens. It scales like a project card: a corner drag zooms the label,
 * padding and corners together; an edge drag only widens or heightens it.
 */
export function LinkContent({ item }: { item: LinkItem }) {
  return (
    <ScaledCard item={{ ...item, zoom: cardZoom(item) }} baseW={item.width}>
      <div className="link-item" style={linkCssColors(item)} title={item.url || undefined}>
        <span className="link-item-label">{item.label || 'Link'}</span>
        <span className="link-item-arrow" aria-hidden>
          ↗
        </span>
      </div>
    </ScaledCard>
  );
}
