import { clientToCanvas } from './canvasDom';
import type { Point } from './coords';
import { createShape } from '../import/createItems';
import { freehandToBox, isConnector } from './shapeGeometry';
import { useDocumentStore } from '../../state/documentStore';
import { DRAW_TOOL_SHAPE, useSessionStore } from '../../state/sessionStore';
import type { DrawToolId } from '../../state/sessionStore';

/**
 * Pointer gesture for the draw tools. Live preview writes only to the session
 * `draft`; one createShape command commits on pointer-up (rule 3.4). Tiny
 * click-drags become a default-sized shape so a single click still places one.
 */

const DRAG_THRESHOLD = 4;
const DEFAULT_BOX = 120;

export function beginDraw(
  e: { pointerId: number; clientX: number; clientY: number; shiftKey: boolean },
  tool: DrawToolId,
): void {
  const shape = DRAW_TOOL_SHAPE[tool];
  const style = useSessionStore.getState().shapeStyle;
  const start = clientToCanvas(e.clientX, e.clientY);
  const freehand = shape === 'draw';
  const connector = isConnector(shape);
  const points: Point[] = [start];
  let moved = false;

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const p = clientToCanvas(ev.clientX, ev.clientY);
    if (!moved && Math.hypot(p.x - start.x, p.y - start.y) >= DRAG_THRESHOLD / scale()) {
      moved = true;
    }

    if (freehand) {
      points.push(p);
      const box = freehandToBox(points);
      useSessionStore.getState().setDraft({
        shape,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        flipDiagonal: false,
        style,
        points: [...points],
      });
      return;
    }

    let end = p;
    if (ev.shiftKey && !connector) {
      // Constrain to a square from the start corner.
      const side = Math.max(Math.abs(p.x - start.x), Math.abs(p.y - start.y));
      end = {
        x: start.x + Math.sign(p.x - start.x || 1) * side,
        y: start.y + Math.sign(p.y - start.y || 1) * side,
      };
    } else if (ev.shiftKey && connector) {
      end = snapAngle(start, p);
    }
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    // flipDiagonal true when the segment runs sw→ne (╱).
    const flip = end.x >= start.x !== end.y >= start.y;
    useSessionStore.getState().setDraft({ shape, x, y, width, height, flipDiagonal: flip, style });
  };

  const onEnd = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    const draft = useSessionStore.getState().draft;
    useSessionStore.getState().setDraft(null);

    if (freehand) {
      if (points.length < 2) {
        useSessionStore.getState().setTool('select');
        return;
      }
      const box = freehandToBox(points);
      createShape('draw', { ...box, points: box.norm }, style);
      return;
    }

    if (!moved || !draft) {
      // Treat as a click: place a default-sized box centered on the point.
      if (connector) {
        createShape(
          shape,
          {
            x: start.x - DEFAULT_BOX / 2,
            y: start.y,
            width: DEFAULT_BOX,
            height: 0.0001,
            flipDiagonal: false,
          },
          style,
        );
      } else {
        createShape(
          shape,
          {
            x: start.x - DEFAULT_BOX / 2,
            y: start.y - DEFAULT_BOX / 2,
            width: DEFAULT_BOX,
            height: DEFAULT_BOX,
          },
          style,
        );
      }
      return;
    }

    createShape(
      shape,
      {
        x: draft.x,
        y: draft.y,
        width: Math.max(connector ? 1 : 8, draft.width),
        height: Math.max(connector ? 1 : 8, draft.height),
        flipDiagonal: draft.flipDiagonal,
      },
      style,
    );
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
}

function scale(): number {
  return useDocumentStore.getState().doc.viewport.scale;
}

/** Snap a connector endpoint to the nearest 15° from the start. */
function snapAngle(start: Point, p: Point): Point {
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len };
}
