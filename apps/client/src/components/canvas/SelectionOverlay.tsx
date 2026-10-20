import { isMobileViewport } from '../../lib/mobile';
import { useLowDetail } from '../../lib/canvas/lod';
import { useShallow } from 'zustand/react/shallow';
import type { Item } from '@boardcache/schema';
import { canvasToScreen } from '../../lib/canvas/coords';
import type { Point } from '../../lib/canvas/coords';
import {
  beginLineEndpoint,
  beginMultiScale,
  beginResize,
  beginRotate,
  effectiveBounds,
} from '../../lib/canvas/gestures';
import {
  RESIZE_HANDLES,
  rectCenter,
  rotatePoint,
  rotatedRectAABB,
  unionRects,
} from '../../lib/canvas/geometry';
import type { ResizeHandle, RotatedRect } from '../../lib/canvas/geometry';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 28;

/** Handle position on the rect edge in local (unrotated) space. */
function handlePoint(bounds: RotatedRect, handle: ResizeHandle): Point {
  const cx = handle.includes('w')
    ? bounds.x
    : handle.includes('e')
      ? bounds.x + bounds.width
      : bounds.x + bounds.width / 2;
  const cy = handle.includes('n')
    ? bounds.y
    : handle.includes('s')
      ? bounds.y + bounds.height
      : bounds.y + bounds.height / 2;
  return rotatePoint({ x: cx, y: cy }, rectCenter(bounds), bounds.rotation);
}

/** Pick a resize cursor that roughly matches the handle's on-screen direction. */
function cursorForHandle(handle: ResizeHandle, rotation: number): string {
  const base: Record<ResizeHandle, number> = {
    n: 0,
    ne: 45,
    e: 90,
    se: 135,
    s: 180,
    sw: 225,
    w: 270,
    nw: 315,
  };
  const angle = (((base[handle] + rotation) % 360) + 360) % 360;
  const sector = Math.round(angle / 45) % 4;
  return ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'][sector]!;
}

function Handle({
  point,
  cursor,
  onPointerDown,
}: {
  point: Point;
  cursor: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  // Touch needs a much bigger target than a mouse cursor.
  const size = isMobileViewport() ? 22 : HANDLE_SIZE;
  return (
    <rect
      className="selection-handle"
      x={point.x - size / 2}
      y={point.y - size / 2}
      width={size}
      height={size}
      rx={isMobileViewport() ? 5 : 0}
      style={{ cursor }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onPointerDown(e);
      }}
    />
  );
}

/** A line/arrow is selected with on-segment handles, not a bounding box. */
function isConnector(item: Item): boolean {
  return item.type === 'shape' && (item.shape === 'line' || item.shape === 'arrow');
}

/** Circular handle for a line/arrow: an `end` (hollow) or the `rotate` centre (filled). */
function ConnectorHandle({
  point,
  kind,
  onPointerDown,
}: {
  point: Point;
  kind: 'end' | 'rotate';
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <circle
      className={kind === 'rotate' ? 'selection-rotate-center' : 'selection-endpoint'}
      cx={point.x}
      cy={point.y}
      r={kind === 'rotate' ? 5 : 5.5}
      style={{ cursor: kind === 'rotate' ? 'grab' : 'crosshair' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onPointerDown(e);
      }}
    />
  );
}

/**
 * Screen-space SVG overlay: selection outline, resize/rotate handles, and
 * the marquee. Re-renders during pan/zoom and gestures, but it's a handful
 * of SVG nodes — items themselves never re-render for viewport changes.
 */
export function SelectionOverlay() {
  const viewport = useDocumentStore((s) => s.doc.viewport);
  // Zoomed-out LOD: items are a few pixels — screen-sized handles would
  // blanket them and steal every click/drag from the overview raster. The
  // outline still shows WHAT is selected; transforms want a closer zoom.
  const lowDetail = useLowDetail();
  const selection = useSessionStore((s) => s.selection);
  const marquee = useSessionStore((s) => s.marquee);
  const cropBox = useSessionStore((s) => s.cropBox);
  const gesture = useSessionStore((s) => s.gesture);
  const items = useDocumentStore(
    useShallow((s) => selection.map((id) => s.doc.items[id]).filter(Boolean) as Item[]),
  );

  const toScreen = (p: Point) => canvasToScreen(p, viewport);

  let chrome: React.ReactNode = null;

  if (items.length === 1 && isConnector(items[0]!)) {
    // Line / arrow: handles on the segment itself (no bounding box). The two
    // endpoints are opposite box corners; the centre rotates.
    const item = items[0]!;
    const bounds = effectiveBounds(item, gesture?.overrides[item.id]);
    const flip = item.type === 'shape' && item.flipDiagonal;
    const a = toScreen(handlePoint(bounds, flip ? 'sw' : 'nw'));
    const b = toScreen(handlePoint(bounds, flip ? 'ne' : 'se'));
    const center = toScreen(rectCenter(bounds));
    chrome = (
      <>
        <line className="selection-connector" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        {!item.locked && !lowDetail && (
          <>
            <ConnectorHandle
              point={a}
              kind="end"
              onPointerDown={(e) => beginLineEndpoint(e, item.id, 'a')}
            />
            <ConnectorHandle
              point={b}
              kind="end"
              onPointerDown={(e) => beginLineEndpoint(e, item.id, 'b')}
            />
            <ConnectorHandle
              point={center}
              kind="rotate"
              onPointerDown={(e) => beginRotate(e, item.id)}
            />
          </>
        )}
      </>
    );
  } else if (items.length === 1) {
    const item = items[0]!;
    const bounds = effectiveBounds(item, gesture?.overrides[item.id]);
    const corners = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height },
    ].map((p) => toScreen(rotatePoint(p, rectCenter(bounds), bounds.rotation)));
    const outline = corners.map((p) => `${p.x},${p.y}`).join(' ');

    // Rotate grip floats above the top edge, following the item's rotation.
    const topCenterLocal = { x: bounds.x + bounds.width / 2, y: bounds.y };
    const topCenter = toScreen(rotatePoint(topCenterLocal, rectCenter(bounds), bounds.rotation));
    const gripLocal = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y - ROTATE_OFFSET / viewport.scale,
    };
    const grip = toScreen(rotatePoint(gripLocal, rectCenter(bounds), bounds.rotation));

    chrome = (
      <>
        <polygon className="selection-outline" points={outline} />
        {!item.locked && !lowDetail && (
          <>
            <line
              className="selection-rotate-line"
              x1={topCenter.x}
              y1={topCenter.y}
              x2={grip.x}
              y2={grip.y}
            />
            <circle
              className="selection-rotate-grip"
              cx={grip.x}
              cy={grip.y}
              r={isMobileViewport() ? 13 : 5}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                beginRotate(e, item.id);
              }}
            />
            {(isMobileViewport() ? (['se'] as const) : RESIZE_HANDLES).map((handle) => (
              <Handle
                key={handle}
                point={toScreen(handlePoint(bounds, handle))}
                cursor={cursorForHandle(handle, bounds.rotation)}
                onPointerDown={(e) => beginResize(e, item.id, handle)}
              />
            ))}
          </>
        )}
      </>
    );
  } else if (items.length > 1) {
    const aabb = unionRects(
      items.map((item) => rotatedRectAABB(effectiveBounds(item, gesture?.overrides[item.id]))),
    );
    if (aabb) {
      const tl = toScreen({ x: aabb.x, y: aabb.y });
      const br = toScreen({ x: aabb.x + aabb.width, y: aabb.y + aabb.height });
      const cornerHandles = [
        { handle: 'nw' as const, point: { x: tl.x, y: tl.y } },
        { handle: 'ne' as const, point: { x: br.x, y: tl.y } },
        { handle: 'se' as const, point: { x: br.x, y: br.y } },
        { handle: 'sw' as const, point: { x: tl.x, y: br.y } },
      ];
      chrome = (
        <>
          <rect
            className="selection-outline"
            x={tl.x}
            y={tl.y}
            width={br.x - tl.x}
            height={br.y - tl.y}
          />
          {!lowDetail &&
            cornerHandles.map(({ handle, point }) => (
              <Handle
                key={handle}
                point={point}
                cursor={cursorForHandle(handle, 0)}
                onPointerDown={(e) => beginMultiScale(e, handle)}
              />
            ))}
        </>
      );
    }
  }

  let marqueeRect: React.ReactNode = null;
  if (marquee) {
    const tl = toScreen({ x: marquee.x, y: marquee.y });
    const br = toScreen({ x: marquee.x + marquee.width, y: marquee.y + marquee.height });
    marqueeRect = (
      <rect className="marquee-rect" x={tl.x} y={tl.y} width={br.x - tl.x} height={br.y - tl.y} />
    );
  }

  let cropRect: React.ReactNode = null;
  if (cropBox) {
    const tl = toScreen({ x: cropBox.x, y: cropBox.y });
    const br = toScreen({ x: cropBox.x + cropBox.width, y: cropBox.y + cropBox.height });
    cropRect = (
      <rect className="crop-box" x={tl.x} y={tl.y} width={br.x - tl.x} height={br.y - tl.y} />
    );
  }

  return (
    <svg className="selection-overlay" data-testid="selection-overlay">
      {chrome}
      {marqueeRect}
      {cropRect}
    </svg>
  );
}
