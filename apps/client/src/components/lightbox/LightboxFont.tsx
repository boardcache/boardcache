import { useEffect, useState } from 'react';
import type { FontItem } from '@boardcache/schema';
import { ensureFont } from '../../lib/media/fontRegistry';

const RAMP = [12, 16, 20, 28, 40, 56, 72];
const DEFAULT_LINE = 'Whereas recognition of the inherent dignity';

/**
 * Google-Fonts-style specimen: an editable preview line rendered at a ramp of
 * sizes, plus full glyph sets — everything typeset in the item's actual face.
 */
export function LightboxFont({ item }: { item: FontItem }) {
  const [ready, setReady] = useState(false);
  const [line, setLine] = useState(DEFAULT_LINE);

  useEffect(() => {
    let alive = true;
    void ensureFont(item.family, item.assetId).then((ok) => {
      if (alive && ok) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [item.family, item.assetId]);

  const family = ready ? `'${item.family.replace(/'/g, '')}'` : undefined;

  return (
    <div className="lightbox-font" data-testid="lightbox-font" onClick={(e) => e.stopPropagation()}>
      <input
        className="lightbox-font-input"
        value={line}
        onChange={(e) => setLine(e.target.value)}
        placeholder="Type here to preview"
        data-testid="lightbox-font-input"
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div className="lightbox-font-ramp">
        {RAMP.map((size) => (
          <div className="lightbox-font-row" key={size}>
            <span className="lightbox-font-size">{size}px</span>
            <span
              className="lightbox-font-sample"
              style={{ fontSize: size, ...(family ? { fontFamily: family } : {}) }}
            >
              {line || DEFAULT_LINE}
            </span>
          </div>
        ))}
      </div>
      <div className="lightbox-font-glyphs" style={family ? { fontFamily: family } : undefined}>
        <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
        <p>abcdefghijklmnopqrstuvwxyz</p>
        <p>0123456789 !@#$%^&amp;*()_+-=[]{}|;':",./&lt;&gt;?</p>
      </div>
    </div>
  );
}
