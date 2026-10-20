import { activePageId, pageItems } from '../board/pages';
import { DEFAULT_VIEWPORT } from '@boardcache/schema';
import { clampScale, zoomAtPoint, zoomBy } from './coords';
import type { Point } from './coords';
import { contentBounds } from '../media/thumbnail';
import { useDocumentStore } from '../../state/documentStore';

const ZOOM_STEP = 1.25;

function containerCenter(container: HTMLElement | null) {
  if (!container) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const rect = container.getBoundingClientRect();
  return { x: rect.width / 2, y: rect.height / 2 };
}

export function zoomInAt(container: HTMLElement | null) {
  const { doc, setViewport } = useDocumentStore.getState();
  setViewport(zoomBy(doc.viewport, containerCenter(container), ZOOM_STEP));
}

export function zoomOutAt(container: HTMLElement | null) {
  const { doc, setViewport } = useDocumentStore.getState();
  setViewport(zoomBy(doc.viewport, containerCenter(container), 1 / ZOOM_STEP));
}

/** Snap to 100% while keeping the view centered on the same canvas point. */
export function zoomTo100(container: HTMLElement | null) {
  const { doc, setViewport } = useDocumentStore.getState();
  setViewport(zoomAtPoint(doc.viewport, containerCenter(container), 1));
}

/** Back to the canvas origin at 100%. */
export function resetView() {
  useDocumentStore.getState().setViewport({ ...DEFAULT_VIEWPORT });
}

/** Center the view on a canvas point at the current zoom (minimap navigation). */
export function centerViewportOn(canvas: Point, container: HTMLElement | null) {
  const { doc, setViewport } = useDocumentStore.getState();
  const width = container?.clientWidth ?? window.innerWidth;
  const height = container?.clientHeight ?? window.innerHeight;
  const scale = doc.viewport.scale;
  setViewport({ scale, x: width / 2 - canvas.x * scale, y: height / 2 - canvas.y * scale });
}

/** Zoom to 100% and center the view on a canvas point. */
export function focusViewportOn(canvas: Point, container: HTMLElement | null) {
  const width = container?.clientWidth ?? window.innerWidth;
  const height = container?.clientHeight ?? window.innerHeight;
  useDocumentStore
    .getState()
    .setViewport({ scale: 1, x: width / 2 - canvas.x, y: height / 2 - canvas.y });
}

/** Center on a canvas rect, capping the zoom at 100% so it fits with a margin. */
export function fitViewportTo(
  rect: { x: number; y: number; width: number; height: number },
  container: HTMLElement | null,
) {
  const width = container?.clientWidth ?? window.innerWidth;
  const height = container?.clientHeight ?? window.innerHeight;
  const margin = 80;
  const scale = clampScale(
    Math.min(
      1,
      (width - margin * 2) / Math.max(1, rect.width),
      (height - margin * 2) / Math.max(1, rect.height),
    ),
  );
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  useDocumentStore
    .getState()
    .setViewport({ scale, x: width / 2 - cx * scale, y: height / 2 - cy * scale });
}

/** Zoom so every item fits in view with a margin; no-op on an empty board.
 *  `maxScale` caps the zoom-in (opening a board frames content without
 *  blowing a lone item up). */
export function zoomToFit(container: HTMLElement | null, maxScale = Infinity) {
  const { doc, setViewport } = useDocumentStore.getState();
  const bounds = contentBounds(doc, pageItems(doc, activePageId(doc)));
  if (!bounds) return;
  const width = container?.clientWidth ?? window.innerWidth;
  const height = container?.clientHeight ?? window.innerHeight;
  const margin = 64;
  const scale = clampScale(
    Math.min(
      maxScale,
      (width - margin * 2) / Math.max(1, bounds.width),
      (height - margin * 2) / Math.max(1, bounds.height),
    ),
  );
  setViewport({
    scale,
    x: width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: height / 2 - (bounds.y + bounds.height / 2) * scale,
  });
}
