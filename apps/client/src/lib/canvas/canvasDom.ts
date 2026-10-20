import type { Point } from './coords';
import { screenToCanvas } from './coords';
import { useDocumentStore } from '../../state/documentStore';

/**
 * The one place that knows which DOM element hosts the canvas. Gesture code
 * needs it to convert pointer client coordinates into canvas space without
 * threading refs through every call site.
 */
let canvasContainer: HTMLElement | null = null;
let lastClient: { x: number; y: number } | null = null;

function trackPointer(e: PointerEvent): void {
  lastClient = { x: e.clientX, y: e.clientY };
}

export function registerCanvasContainer(el: HTMLElement | null): void {
  if (canvasContainer) canvasContainer.removeEventListener('pointermove', trackPointer);
  canvasContainer = el;
  if (el) el.addEventListener('pointermove', trackPointer, { passive: true });
}

export function getCanvasContainer(): HTMLElement | null {
  return canvasContainer;
}

/** Convert pointer client coords → screen coords relative to the canvas. */
export function clientToScreen(clientX: number, clientY: number): Point {
  if (!canvasContainer) return { x: clientX, y: clientY };
  const rect = canvasContainer.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/** Convert pointer client coords straight to canvas coordinates. */
export function clientToCanvas(clientX: number, clientY: number): Point {
  return screenToCanvas(clientToScreen(clientX, clientY), useDocumentStore.getState().doc.viewport);
}

/**
 * Canvas point under the cursor's last position over the canvas — used to drop
 * new items where the user is working rather than in the middle of the screen.
 * Falls back to the viewport center before the pointer has been over the canvas
 * (e.g. touch, or a fresh load).
 */
export function lastPointerCanvas(): Point {
  const { x, y } = lastClient ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  return clientToCanvas(x, y);
}
