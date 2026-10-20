import type { CanvasDocument, PresentationView, Viewport } from '@boardcache/schema';
import type { Point, Rect } from './coords';
import { MAX_SCALE, panBy, zoomBy } from './coords';
import { groupMembers } from './grouping';
import { isLightboxable, mediaMeta, representativeId } from '../mediaItems';
import { contentBounds } from '../media/thumbnail';
import { runCommand } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Presentation Mode: an ordered list of steps (an item or a whole group each)
 * stored on the document; playing it hides the chrome and flies the camera
 * from step to step — a slight zoom out, then in onto the target.
 */

const ROUND = (v: number) => Math.round(v * 1000) / 1000;

function presentationIds(doc: CanvasDocument): string[] {
  return doc.presentation.steps.map((s) => s.id);
}

export function isPresented(doc: CanvasDocument, id: string): boolean {
  return doc.presentation.steps.some((s) => s.id === id);
}

/** The ids a step frames (a group's members, or the item itself). */
function stepItemIds(doc: CanvasDocument, id: string): string[] {
  if (doc.groups[id]) return groupMembers(doc, id);
  return doc.items[id] ? [id] : [];
}

export function stepBounds(doc: CanvasDocument, id: string): Rect | null {
  const items = stepItemIds(doc, id)
    .map((i) => doc.items[i])
    .filter((i) => i !== undefined);
  return items.length ? contentBounds(doc, items) : null;
}

export function stepLabel(doc: CanvasDocument, id: string): string {
  const g = doc.groups[id];
  if (g) return g.name?.trim() || `Group (${groupMembers(doc, id).length})`;
  const it = doc.items[id];
  return it ? mediaMeta(it).title || it.type : 'Missing';
}

/** Append steps (ids already present are skipped; order preserved). */
export function addToPresentation(ids: string[]): void {
  runCommand('Add to presentation', (draft) => {
    const have = new Set(draft.presentation.steps.map((s) => s.id));
    for (const id of ids) {
      if (have.has(id) || !(id in draft.items || id in draft.groups)) continue;
      draft.presentation.steps.push({ id });
      have.add(id);
    }
  });
}

export function removeFromPresentation(ids: string[]): void {
  const drop = new Set(ids);
  runCommand('Remove from presentation', (draft) => {
    draft.presentation.steps = draft.presentation.steps.filter((s) => !drop.has(s.id));
  });
}

/** Move a step to a position (index among the remaining steps). */
/** Replace the whole order; steps that survive keep their captured views. */
export function setPresentationSteps(ids: string[]): void {
  runCommand('Arrange presentation', (draft) => {
    const prev = new Map(draft.presentation.steps.map((s) => [s.id, s]));
    draft.presentation.steps = ids
      .filter((id) => id in draft.items || id in draft.groups)
      .map((id) => prev.get(id) ?? { id });
  });
}

export function movePresentationStep(id: string, toIndex: number): void {
  runCommand('Reorder presentation', (draft) => {
    const steps = draft.presentation.steps;
    const from = steps.findIndex((s) => s.id === id);
    if (from === -1) return;
    const [step] = steps.splice(from, 1);
    steps.splice(Math.max(0, Math.min(toIndex, steps.length)), 0, step!);
  });
}

// ── playback ───────────────────────────────────────────────────────────────────

const container = () => document.querySelector<HTMLElement>('[data-testid="canvas-viewport"]');

/** The viewport that frames a rect with a margin (the Zoom-to-fit rule, but returned). */
function framing(rect: Rect): { x: number; y: number; scale: number } {
  const el = container();
  const width = el?.clientWidth ?? window.innerWidth;
  const height = el?.clientHeight ?? window.innerHeight;
  const margin = Math.min(80, width * 0.08);
  // Like Zoom to fit: never blow a small item up past 1.25× — a slide, not a microscope.
  const scale = Math.max(
    0.02,
    Math.min(
      1.25,
      (width - margin * 2) / Math.max(1, rect.width),
      (height - margin * 2) / Math.max(1, rect.height),
    ),
  );
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { scale, x: width / 2 - cx * scale, y: height / 2 - cy * scale };
}

let flight = 0;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** A step's custom camera, if the presenter set one. */
export function stepView(doc: CanvasDocument, id: string): PresentationView | null {
  return doc.presentation.steps.find((s) => s.id === id)?.view ?? null;
}

/** The camera right now, as a step view: the world point under the
 *  viewport's centre plus the scale — the same framing on any screen. */
export function currentView(): PresentationView {
  const vp = useDocumentStore.getState().doc.viewport;
  const el = container();
  const width = el?.clientWidth ?? window.innerWidth;
  const height = el?.clientHeight ?? window.innerHeight;
  return {
    x: ROUND((width / 2 - vp.x) / vp.scale),
    y: ROUND((height / 2 - vp.y) / vp.scale),
    scale: ROUND(vp.scale),
  };
}

/** Keep (or clear, with null) a custom camera on a step. */
export function setStepView(id: string, view: PresentationView | null): void {
  runCommand(view ? 'Set step view' : 'Reset step view', (draft) => {
    const step = draft.presentation.steps.find((s) => s.id === id);
    if (!step) return;
    if (view) step.view = view;
    else delete step.view;
  });
}

/** The viewport that shows a step view on the current screen. */
function viewportFor(view: PresentationView): { x: number; y: number; scale: number } {
  const el = container();
  const width = el?.clientWidth ?? window.innerWidth;
  const height = el?.clientHeight ?? window.innerHeight;
  return {
    scale: view.scale,
    x: width / 2 - view.x * view.scale,
    y: height / 2 - view.y * view.scale,
  };
}

/** Fly the camera to a rect (auto-framed with a margin). */
function flyTo(rect: Rect, duration = 650): Promise<void> {
  return flyToTarget(
    framing(rect),
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    duration,
  );
}

/** Fly the camera to a stored step view. */
function flyToView(view: PresentationView, duration = 650): Promise<void> {
  return flyToTarget(viewportFor(view), { x: view.x, y: view.y }, duration);
}

/** Fly to a step the way Present would (its custom view, else auto-framed) without presenting. */
export function showStep(id: string): void {
  const doc = useDocumentStore.getState().doc;
  const view = stepView(doc, id);
  if (view) void flyToView(view);
  else {
    const rect = stepBounds(doc, id);
    if (rect) void flyTo(rect);
  }
}

/** The flight itself: centres ease across while the zoom dips out then
 *  settles in (a touch of "pull back, then push in"). `c1` is the world
 *  point the target viewport centres on. */
function flyToTarget(
  target: { x: number; y: number; scale: number },
  c1: { x: number; y: number },
  duration: number,
): Promise<void> {
  const from = useDocumentStore.getState().doc.viewport;
  const el = container();
  const width = el?.clientWidth ?? window.innerWidth;
  const height = el?.clientHeight ?? window.innerHeight;
  const c0 = { x: (width / 2 - from.x) / from.scale, y: (height / 2 - from.y) / from.scale };
  const id = ++flight;
  const dist = Math.hypot(c1.x - c0.x, c1.y - c0.y) * Math.min(from.scale, target.scale);
  // No dip when barely moving; up to a 30% pull-back on long hops.
  const dip = Math.min(0.3, dist / Math.max(width, height) / 4);
  const set = useDocumentStore.getState().setViewport;
  if (duration <= 0 || (dist < 1 && Math.abs(from.scale - target.scale) < 0.001)) {
    set(target);
    return Promise.resolve();
  }
  const t0 = performance.now();
  return new Promise((resolve) => {
    const tick = (now: number) => {
      if (id !== flight) return resolve();
      const t = Math.min(1, (now - t0) / duration);
      const e = easeInOut(t);
      const cx = c0.x + (c1.x - c0.x) * e;
      const cy = c0.y + (c1.y - c0.y) * e;
      const scale =
        (from.scale + (target.scale - from.scale) * e) / (1 + dip * Math.sin(Math.PI * t));
      set({
        scale: ROUND(scale),
        x: ROUND(width / 2 - cx * scale),
        y: ROUND(height / 2 - cy * scale),
      });
      if (t < 1) requestAnimationFrame(tick);
      else {
        set(target);
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

let restore: { viewport: { x: number; y: number; scale: number }; chromeHidden: boolean } | null =
  null;

export function goToStep(index: number, instant = false): void {
  const doc = useDocumentStore.getState().doc;
  const steps = presentationIds(doc);
  if (steps.length === 0) return;
  const i = Math.max(0, Math.min(index, steps.length - 1));
  const id = steps[i]!;
  useSessionStore
    .getState()
    .setPresentation({ presenting: true, presentStep: i, presentIds: stepItemIds(doc, id) });
  const view = stepView(doc, id);
  if (view) {
    frame = viewportFor(view);
    void flyToView(view, instant ? 0 : 650);
  } else {
    const rect = stepBounds(doc, id);
    frame = rect ? framing(rect) : null;
    if (rect) void flyTo(rect, instant ? 0 : 650);
  }
}

// ── a closer look: zoom and pan inside the step ─────────────────────────────────

/** The camera that frames the current step. The presenter may zoom in from
 *  it and pan around inside it, never out of it. */
let frame: Viewport | null = null;

/** Is the presenter zoomed in past the step's frame? */
export function presentZoomed(): boolean {
  if (!frame) return false;
  return useDocumentStore.getState().doc.viewport.scale > frame.scale * 1.001;
}

/** Keep a camera inside the step: never zoomed out past the frame, never
 *  panned so that anything outside the frame comes into view. */
function constrainToStep(vp: Viewport): Viewport {
  if (!frame) return vp;
  const el = container();
  const width = el?.clientWidth ?? window.innerWidth;
  const height = el?.clientHeight ?? window.innerHeight;
  const scale = Math.min(MAX_SCALE, Math.max(frame.scale, vp.scale));
  if (scale <= frame.scale * 1.001) return { ...frame };
  // The frame's world rect, and the (smaller) rect the zoomed camera shows.
  const fx = -frame.x / frame.scale;
  const fy = -frame.y / frame.scale;
  const fw = width / frame.scale;
  const fh = height / frame.scale;
  const wx = Math.min(Math.max(-vp.x / scale, fx), fx + fw - width / scale);
  const wy = Math.min(Math.max(-vp.y / scale, fy), fy + fh - height / scale);
  return { scale: ROUND(scale), x: ROUND(-wx * scale), y: ROUND(-wy * scale) };
}

/** A screen point (client coordinates) as a point in the viewport. */
function viewportPoint(client?: Point): Point {
  const el = container();
  const rect = el?.getBoundingClientRect();
  if (!client)
    return {
      x: (rect?.width ?? window.innerWidth) / 2,
      y: (rect?.height ?? window.innerHeight) / 2,
    };
  return { x: client.x - (rect?.left ?? 0), y: client.y - (rect?.top ?? 0) };
}

/** Zoom by a factor around a screen point (the centre when none), inside the step. */
export function presentZoom(factor: number, at?: Point): void {
  if (!useSessionStore.getState().presenting || !frame) return;
  flight++; // the presenter has taken the camera from an in-flight move
  const { doc, setViewport } = useDocumentStore.getState();
  setViewport(constrainToStep(zoomBy(doc.viewport, viewportPoint(at), factor)));
}

/** Pan by screen pixels, inside the step. */
export function presentPan(dx: number, dy: number): void {
  if (!useSessionStore.getState().presenting || !frame) return;
  const { doc, setViewport } = useDocumentStore.getState();
  setViewport(constrainToStep(panBy(doc.viewport, dx, dy)));
}

/** Back to the step's own framing. */
export function presentResetZoom(): void {
  if (!useSessionStore.getState().presenting || !frame) return;
  flight++;
  useDocumentStore.getState().setViewport({ ...frame });
}

/** A double-click: a closer look around the point, or back out to the frame. */
export function presentZoomToggle(at: Point): void {
  if (presentZoomed()) presentResetZoom();
  else presentZoom(2.5, at);
}

/** Start playing; false when there is nothing to play (callers open the panel). */
export function startPresentation(step = 0): boolean {
  const doc = useDocumentStore.getState().doc;
  if (doc.presentation.steps.length === 0) return false;
  const session = useSessionStore.getState();
  restore = { viewport: { ...doc.viewport }, chromeHidden: session.chromeHidden };
  session.clearSelection();
  if (session.selectedConnectionId) session.setSelectedConnection(null);
  session.setPresentPanelOpen(false);
  session.setChromeHidden(true);
  goToStep(step, true);
  return true;
}

export function stopPresentation(): void {
  const session = useSessionStore.getState();
  if (!session.presenting) return;
  flight++;
  frame = null;
  session.setPresentation({ presenting: false, presentIds: [] });
  session.setChromeHidden(restore?.chromeHidden ?? false);
  if (restore) void flyTo(rectOfViewport(restore.viewport), 450);
  restore = null;
}

/** The world rect a viewport shows — to fly back to where the presenter started. */
function rectOfViewport(vp: { x: number; y: number; scale: number }): Rect {
  const el = container();
  const width = el?.clientWidth ?? window.innerWidth;
  const height = el?.clientHeight ?? window.innerHeight;
  const margin = Math.min(80, width * 0.08);
  return {
    x: (margin - vp.x) / vp.scale,
    y: (margin - vp.y) / vp.scale,
    width: (width - margin * 2) / vp.scale,
    height: (height - margin * 2) / vp.scale,
  };
}

/**
 * Open the current step in the lightbox — the first of its items that can
 * show there (a group step scopes ←/→ to its members). The show keeps its
 * place underneath; closing the lightbox lands back on this step.
 */
export function openPresentedItem(): boolean {
  const session = useSessionStore.getState();
  if (!session.presenting) return false;
  const doc = useDocumentStore.getState().doc;
  const stepId = presentationIds(doc)[session.presentStep];
  const item = session.presentIds.map((id) => doc.items[id]).find((it) => it && isLightboxable(it));
  if (!item || !stepId) return false;
  session.setLightboxGroupScope(doc.groups[stepId] ? stepId : null);
  session.setLightbox(representativeId(doc, item.id));
  return true;
}

/** Re-frame the current step without animation (after the lightbox closes over it). */
export function refocusStep(): void {
  const session = useSessionStore.getState();
  if (session.presenting) goToStep(session.presentStep, true);
}

export function presentGo(delta: number): void {
  const session = useSessionStore.getState();
  if (!session.presenting) return;
  const count = useDocumentStore.getState().doc.presentation.steps.length;
  const next = session.presentStep + delta;
  if (next < 0 || next >= count) return;
  goToStep(next);
}
