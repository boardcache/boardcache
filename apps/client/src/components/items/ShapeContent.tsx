import type { ShapeItem } from '@boardcache/schema';
import {
  arrowHead,
  bezierPathD,
  diagonalEndpoints,
  diamondPoints,
  freehandPath,
  pointsToString,
  polygonPoints,
  starPoints,
} from '../../lib/canvas/shapeGeometry';

/**
 * Per-item inline SVG (rule 3.2: only the renderer knows the type). The SVG
 * fills the item box via a base-dimension viewBox with preserveAspectRatio
 * "none", so the shape scales with resize; non-scaling strokes keep the line
 * weight constant.
 */
/** SVG defs for a gradient fill (shared shape used by canvas/gallery/lightbox). */
export function GradientDefs({ id, g }: { id: string; g: NonNullable<ShapeItem['fillGradient']> }) {
  if (g.type === 'radial') {
    return (
      <defs>
        <radialGradient id={id} cx="0.5" cy="0.5" r="0.7">
          {g.stops.map((st, i) => (
            <stop key={i} offset={st.offset} stopColor={st.color} />
          ))}
        </radialGradient>
      </defs>
    );
  }
  const rad = (g.angle * Math.PI) / 180;
  const x1 = 0.5 - Math.cos(rad) / 2;
  const y1 = 0.5 - Math.sin(rad) / 2;
  const x2 = 0.5 + Math.cos(rad) / 2;
  const y2 = 0.5 + Math.sin(rad) / 2;
  return (
    <defs>
      <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
        {g.stops.map((st, i) => (
          <stop key={i} offset={st.offset} stopColor={st.color} />
        ))}
      </linearGradient>
    </defs>
  );
}

export function ShapeContent({ item }: { item: ShapeItem }) {
  const w = item.width;
  const h = item.height;
  const sw = item.strokeWidth;
  const inset = sw / 2 + 1;
  const stroke = item.stroke ?? 'none';
  const gradId = item.fillGradient ? `grad-${item.id}` : null;
  const fill = gradId ? `url(#${gradId})` : (item.fill ?? 'none');
  const dash = item.dashed ? `${sw * 2.5} ${sw * 2}` : undefined;

  const common = {
    stroke,
    strokeWidth: sw,
    fill,
    strokeDasharray: dash,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };

  let shape: React.ReactNode = null;

  switch (item.shape) {
    case 'rect':
      shape = (
        <rect
          x={inset}
          y={inset}
          width={Math.max(0, w - inset * 2)}
          height={Math.max(0, h - inset * 2)}
          rx={item.cornerRadius}
          {...common}
        />
      );
      break;
    case 'ellipse':
      shape = (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(0, w / 2 - inset)}
          ry={Math.max(0, h / 2 - inset)}
          {...common}
        />
      );
      break;
    case 'diamond':
      shape = <polygon points={pointsToString(diamondPoints(w, h, inset))} {...common} />;
      break;
    case 'star':
      shape = (
        <polygon
          points={pointsToString(
            starPoints(
              w / 2,
              h / 2,
              w / 2 - inset,
              h / 2 - inset,
              item.sides,
              item.innerRadiusRatio,
            ),
          )}
          {...common}
        />
      );
      break;
    case 'polygon':
      shape = (
        <polygon
          points={pointsToString(
            polygonPoints(w / 2, h / 2, w / 2 - inset, h / 2 - inset, item.sides),
          )}
          {...common}
        />
      );
      break;
    case 'draw':
      shape = <path d={freehandPath(item.points ?? [], w, h, inset)} {...common} fill="none" />;
      break;
    case 'path':
      shape = (
        <path
          d={bezierPathD(item.pathNodes ?? [], w, h, inset, item.pathClosed)}
          {...common}
          fill={item.pathClosed ? fill : 'none'}
        />
      );
      break;
    case 'line':
    case 'arrow': {
      const { a, b } = diagonalEndpoints(w, h, inset, item.flipDiagonal);
      const headLen = Math.min(22, Math.max(9, sw * 3.5), Math.hypot(b.x - a.x, b.y - a.y) * 0.45);
      const barbs = item.shape === 'arrow' ? arrowHead(a, b, headLen) : null;
      shape = (
        <>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} fill="none" />
          {barbs && (
            <polyline points={pointsToString([barbs[0], b, barbs[1]])} {...common} fill="none" />
          )}
        </>
      );
      break;
    }
  }

  return (
    <svg
      className="shape-item"
      width="100%"
      height="100%"
      viewBox={`0 0 ${Math.max(1, w)} ${Math.max(1, h)}`}
      preserveAspectRatio="none"
      overflow="visible"
    >
      {item.fillGradient && gradId && <GradientDefs id={gradId} g={item.fillGradient} />}
      {shape}
    </svg>
  );
}
