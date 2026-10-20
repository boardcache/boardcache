import { canvasToScreen } from '../../lib/canvas/coords';
import type { AbsPathNode } from '../../lib/canvas/shapeGeometry';
import {
  absBezierD,
  arrowHead,
  diagonalEndpoints,
  diamondPoints,
  pointsToString,
  polygonPoints,
  starPoints,
} from '../../lib/canvas/shapeGeometry';
import { GradientDefs } from '../items/ShapeContent';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Live preview of the shape being drawn, in screen space (so it tracks pan/
 * zoom). Reuses the same geometry as the committed renderer so what you drag
 * is what you get.
 */
/** In-progress pen path: committed anchors, rubber band, handle of the last node. */
function PenPreview() {
  const pen = useSessionStore((s) => s.penDraft);
  const viewport = useDocumentStore((s) => s.doc.viewport);
  if (!pen || pen.nodes.length === 0) return null;

  const sp = (n: { x: number; y: number }) => canvasToScreen(n, viewport);
  const nodes: AbsPathNode[] = pen.nodes.map((n) => {
    const out: AbsPathNode = sp(n);
    if (n.hix != null && n.hiy != null) {
      const hi = sp({ x: n.hix, y: n.hiy });
      out.hix = hi.x;
      out.hiy = hi.y;
    }
    if (n.hox != null && n.hoy != null) {
      const ho = sp({ x: n.hox, y: n.hoy });
      out.hox = ho.x;
      out.hoy = ho.y;
    }
    return out;
  });
  const { stroke, strokeWidth, dashed } = pen.style;
  const strokeProps = {
    stroke: stroke ?? 'var(--accent)',
    strokeWidth,
    fill: 'none',
    strokeDasharray: dashed ? `${strokeWidth * 2.5} ${strokeWidth * 2}` : undefined,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };
  const last = nodes[nodes.length - 1]!;
  const cursor = pen.cursor ? sp(pen.cursor) : null;
  const first = nodes[0]!;

  return (
    <svg className="draft-preview" data-testid="pen-preview">
      {nodes.length > 1 && <path d={absBezierD(nodes, !!pen.closing)} {...strokeProps} />}
      {cursor && !pen.closing && (
        <path
          d={`M ${last.x} ${last.y} C ${last.hox ?? last.x} ${last.hoy ?? last.y} ${cursor.x} ${cursor.y} ${cursor.x} ${cursor.y}`}
          {...strokeProps}
          strokeDasharray="4 4"
          opacity={0.6}
        />
      )}
      {nodes.map((n, i) =>
        n.hix != null || n.hox != null ? (
          // Two independent hands, each a spoke from the anchor — the bar
          // always intersects its point, even after the pair is broken.
          <g key={`h${i}`} opacity={i === nodes.length - 1 ? 1 : 0.55}>
            {n.hix != null && (
              <>
                <line
                  x1={n.x}
                  y1={n.y}
                  x2={n.hix}
                  y2={n.hiy}
                  stroke="var(--accent)"
                  strokeWidth={1}
                />
                <circle cx={n.hix} cy={n.hiy} r={2.5} fill="var(--accent)" />
              </>
            )}
            {n.hox != null && (
              <>
                <line
                  x1={n.x}
                  y1={n.y}
                  x2={n.hox}
                  y2={n.hoy}
                  stroke="var(--accent)"
                  strokeWidth={1}
                />
                <circle cx={n.hox} cy={n.hoy} r={2.5} fill="var(--accent)" />
              </>
            )}
          </g>
        ) : null,
      )}
      {nodes.map((n, i) => (
        <rect
          key={i}
          x={n.x - 3}
          y={n.y - 3}
          width={6}
          height={6}
          fill="var(--panel-solid, #fff)"
          stroke="var(--accent)"
          strokeWidth={1.5}
        />
      ))}
      {nodes.length >= 2 && (
        <circle
          cx={first.x}
          cy={first.y}
          r={7}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1}
          opacity={0.7}
        />
      )}
    </svg>
  );
}

export function DraftPreview() {
  const draft = useSessionStore((s) => s.draft);
  const penDraft = useSessionStore((s) => s.penDraft);
  const viewport = useDocumentStore((s) => s.doc.viewport);
  if (!draft) return penDraft ? <PenPreview /> : null;

  const tl = canvasToScreen({ x: draft.x, y: draft.y }, viewport);
  const w = draft.width * viewport.scale;
  const h = draft.height * viewport.scale;
  const { stroke, strokeWidth, fill, dashed, fillGradient } = draft.style;
  const common = {
    stroke: stroke ?? 'none',
    strokeWidth,
    fill: fillGradient ? 'url(#draft-grad)' : (fill ?? 'none'),
    strokeDasharray: dashed ? `${strokeWidth * 2.5} ${strokeWidth * 2}` : undefined,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };

  let node: React.ReactNode = null;
  switch (draft.shape) {
    case 'rect':
      node = <rect x={0} y={0} width={w} height={h} rx={6} {...common} />;
      break;
    case 'ellipse':
      node = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />;
      break;
    case 'diamond':
      node = <polygon points={pointsToString(diamondPoints(w, h, 0))} {...common} />;
      break;
    case 'star':
      node = (
        <polygon
          points={pointsToString(starPoints(w / 2, h / 2, w / 2, h / 2, 5, 0.5))}
          {...common}
        />
      );
      break;
    case 'polygon':
      node = (
        <polygon
          points={pointsToString(polygonPoints(w / 2, h / 2, w / 2, h / 2, 5))}
          {...common}
        />
      );
      break;
    case 'draw':
      if (draft.points && draft.points.length > 1) {
        const d = draft.points
          .map((p, i) => {
            const s = canvasToScreen(p, viewport);
            return `${i === 0 ? 'M' : 'L'} ${s.x - tl.x} ${s.y - tl.y}`;
          })
          .join(' ');
        node = <path d={d} {...common} fill="none" />;
      }
      break;
    case 'line':
    case 'arrow': {
      const { a, b } = diagonalEndpoints(w, h, 0, draft.flipDiagonal);
      const headLen = Math.min(
        22,
        Math.max(9, strokeWidth * 3.5),
        Math.hypot(b.x - a.x, b.y - a.y) * 0.45,
      );
      const barbs = draft.shape === 'arrow' ? arrowHead(a, b, headLen) : null;
      node = (
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
    <svg className="draft-preview" data-testid="draft-preview">
      {fillGradient && <GradientDefs id="draft-grad" g={fillGradient} />}
      <g transform={`translate(${tl.x}, ${tl.y})`}>{node}</g>
    </svg>
  );
}
