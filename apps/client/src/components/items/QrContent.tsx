import { useMemo } from 'react';
import type { QrItem } from '@boardcache/schema';
import { qrCode, qrPathData, QR_PAD } from '../../lib/media/qr';

/**
 * Vector QR code: the item box is the containing square (background fills it);
 * the code itself — quiet zone included via the viewBox — stays square and
 * centered. Pure SVG, so it's crisp at any zoom.
 */
export function QrContent({ item }: { item: QrItem }) {
  const parts = useMemo(() => {
    const code = qrCode(item.text);
    return code ? { total: code.size + QR_PAD * 2, d: qrPathData(code) } : null;
  }, [item.text]);

  return (
    <div className="qr-item" style={{ background: item.background }} title={item.text || undefined}>
      {parts ? (
        <svg
          viewBox={`0 0 ${parts.total} ${parts.total}`}
          preserveAspectRatio="xMidYMid meet"
          shapeRendering="crispEdges"
          aria-label="QR code"
        >
          <path d={parts.d} fill={item.color} />
        </svg>
      ) : (
        <span className="qr-empty">{item.text.trim() ? 'Too long for a QR code' : 'QR'}</span>
      )}
    </div>
  );
}
