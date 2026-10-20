import { useEffect, useMemo, useReducer } from 'react';
import type { Item } from '@boardcache/schema';
import { getCanvasContainer } from '../../lib/canvas/canvasDom';
import { visibleCanvasRect } from '../../lib/canvas/coords';
import type { Point } from '../../lib/canvas/coords';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import {
  computeMinimapView,
  minimapRect,
  minimapToCanvas,
  minimapWorld,
} from '../../lib/canvas/minimap';
import type { MinimapView } from '../../lib/canvas/minimap';
import { activePageId, pageItems } from '../../lib/board/pages';
import { contentBounds } from '../../lib/media/thumbnail';
import { centerViewportOn } from '../../lib/canvas/viewportActions';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useMobileViewport } from '../../hooks/useMobileViewport';

/** Long edge of the minimap box, in screen px. Phones fit it between the
 *  Edit button and the toggle column. */
const MINIMAP_LONG = 210;
const MINIMAP_LONG_MOBILE = 170;
const WORLD_PAD = 80;

/** A representative fill color per item type for the minimap dots. */
function itemColor(item: Item): string {
  switch (item.type) {
    case 'swatch':
      return item.color;
    case 'palette':
      return item.colors[0]?.color ?? '#7a8290';
    case 'shape':
      return item.stroke ?? '#7a8290';
    case 'image':
      return '#5b8def';
    case 'video':
      return '#b06ef7';
    case 'text':
      return '#9aa4ae';
    default:
      return '#7a8290';
  }
}

/** Item dots, memoized so panning within content doesn't re-render them. */
function MinimapItems({ items, view }: { items: Item[]; view: MinimapView }) {
  return (
    <>
      {items.map((item) => {
        const aabb = rotatedRectAABB({
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          rotation: item.rotation,
        });
        const r = minimapRect(aabb, view);
        return (
          <rect
            key={item.id}
            x={r.x}
            y={r.y}
            width={Math.max(1.5, r.width)}
            height={Math.max(1.5, r.height)}
            rx={1}
            fill={itemColor(item)}
            opacity={0.85}
          />
        );
      })}
    </>
  );
}

/**
 * Minimap popup (rule 3.1: rendered from document data, never the DOM). Shows
 * every item plus a viewport rectangle proportional to the window; drag the
 * rectangle (or click anywhere) to pan. A bottom-right button toggles it.
 */
export function Minimap() {
  const open = useSessionStore((s) => s.minimapOpen);
  const mobile = useMobileViewport();
  // Re-render on any doc change (viewport pan/zoom + item edits).
  const doc = useDocumentStore((s) => s.doc);
  const [, bumpResize] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    if (!open) return;
    const onResize = () => bumpResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  const container = getCanvasContainer();
  const cw = container?.clientWidth ?? 0;
  const ch = container?.clientHeight ?? 0;

  // Box matches the window aspect ratio so it reads as a mini-window.
  const aspect = cw > 0 && ch > 0 ? cw / ch : 1.4;
  const long = mobile ? MINIMAP_LONG_MOBILE : MINIMAP_LONG;
  const mmW = aspect >= 1 ? long : Math.round(long * aspect);
  const mmH = aspect >= 1 ? Math.round(long / aspect) : long;

  const visible = visibleCanvasRect(doc.viewport, cw || 1, ch || 1);
  const page = useSessionStore((s) => s.activePageId);
  void page; // re-derive on page switch
  // eslint-disable-next-line react-hooks/exhaustive-deps -- page rides via the subscription above
  const items = useMemo(() => pageItems(doc, activePageId(doc)), [doc.items, doc.pages, page]);
  const content = contentBounds(doc, items);
  const world = minimapWorld(content, visible, WORLD_PAD);
  const view = computeMinimapView(world, mmW, mmH);

  // Memoize the dots by the world/scale signature so a pan that doesn't change
  // the world (the common case) keeps the same element tree.
  const worldKey = `${Math.round(world.x)}:${Math.round(world.y)}:${Math.round(world.width)}:${Math.round(view.scale * 1000)}`;
  const dots = useMemo(
    () => <MinimapItems items={items} view={view} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view is captured via worldKey; re-deriving only when the mapping changes
    [items, worldKey, mmW, mmH],
  );

  if (!open) return null;

  const viewRect = minimapRect(visible, view);

  const pointerToCanvas = (e: { clientX: number; clientY: number }, svg: SVGSVGElement): Point => {
    const rect = svg.getBoundingClientRect();
    return minimapToCanvas({ x: e.clientX - rect.left, y: e.clientY - rect.top }, view);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const svg = e.currentTarget;
    svg.setPointerCapture(e.pointerId);

    // If the press is inside the viewport rect, preserve the grab offset so the
    // rectangle doesn't jump; otherwise center on the press point.
    const pressCanvas = pointerToCanvas(e, svg);
    const viewCenter = { x: visible.x + visible.width / 2, y: visible.y + visible.height / 2 };
    const inside =
      pressCanvas.x >= visible.x &&
      pressCanvas.x <= visible.x + visible.width &&
      pressCanvas.y >= visible.y &&
      pressCanvas.y <= visible.y + visible.height;
    const grab: Point = inside
      ? { x: viewCenter.x - pressCanvas.x, y: viewCenter.y - pressCanvas.y }
      : { x: 0, y: 0 };
    if (!inside) centerViewportOn(pressCanvas, container);

    const onMove = (ev: PointerEvent) => {
      const c = pointerToCanvas(ev, svg);
      centerViewportOn({ x: c.x + grab.x, y: c.y + grab.y }, container);
    };
    const onUp = () => {
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
  };

  // Clamp the on-screen rect so it stays visible even when the view is far out.
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const vx = clamp(viewRect.x, 0, mmW);
  const vy = clamp(viewRect.y, 0, mmH);
  const vw = clamp(viewRect.x + viewRect.width, 0, mmW) - vx;
  const vh = clamp(viewRect.y + viewRect.height, 0, mmH) - vy;

  return (
    <div className="minimap-float">
      <div className="minimap-panel" data-testid="minimap" style={{ width: mmW, height: mmH }}>
        <svg
          className="minimap-svg"
          width={mmW}
          height={mmH}
          onPointerDown={onPointerDown}
          data-testid="minimap-svg"
        >
          <rect x={0} y={0} width={mmW} height={mmH} className="minimap-bg" />
          {dots}
          <rect
            className="minimap-viewport"
            data-testid="minimap-viewport"
            x={vx}
            y={vy}
            width={Math.max(0, vw)}
            height={Math.max(0, vh)}
          />
        </svg>
      </div>
    </div>
  );
}
