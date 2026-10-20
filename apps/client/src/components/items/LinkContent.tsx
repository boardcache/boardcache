import type { LinkItem } from '@boardcache/schema';
import { readableTextColor } from '../../lib/color/color';

/** A link button: colored background, auto-contrasting label. Double-click opens. */
const FONT_SIZE = { s: 12, m: 15, l: 20 } as const;

export function LinkContent({ item }: { item: LinkItem }) {
  return (
    <div
      className="link-item"
      style={{
        background: item.background,
        color: readableTextColor(item.background),
        fontSize: FONT_SIZE[item.size],
      }}
      title={item.url || undefined}
    >
      <span className="link-item-label">{item.label || 'Link'}</span>
      <span className="link-item-arrow" aria-hidden>
        ↗
      </span>
    </div>
  );
}
