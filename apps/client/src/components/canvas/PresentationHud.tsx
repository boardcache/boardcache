import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ExpandIcon, FitIcon } from '../icons';
import {
  openPresentedItem,
  presentGo,
  presentResetZoom,
  presentZoomed,
  refocusStep,
  stopPresentation,
} from '../../lib/canvas/presentation';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Presentation Mode HUD: a small counter with prev / next / exit, and a Fit
 * button while the presenter is zoomed in for a closer look. The canvas
 * itself takes taps (right two thirds advance, left third goes back) and
 * swipes on empty space, while the step's items keep their own controls —
 * a PDF pages, a video plays — without selecting or dragging. Ctrl-wheel,
 * pinch, a double-click or + zoom in on the step (never out of it); a drag
 * pans while zoomed; 0 or the Fit button goes back to the frame.
 */
export function PresentationHud() {
  const presenting = useSessionStore((s) => s.presenting);
  const step = useSessionStore((s) => s.presentStep);
  const count = useDocumentStore((s) => s.doc.presentation.steps.length);
  const viewable = useSessionStore((s) => s.presentIds.length > 0);
  const lightboxOpen = useSessionStore((s) => s.lightboxId !== null);
  // Re-rendered on every camera move, so the module's answer stays current.
  useDocumentStore((s) => s.doc.viewport.scale);
  const zoomed = presenting && presentZoomed();
  // A presentation with no steps left (deleted while playing) ends itself.
  useEffect(() => {
    if (presenting && count === 0) stopPresentation();
  }, [presenting, count]);
  // Back from the lightbox: land on the step exactly where the show left off.
  useEffect(() => {
    if (presenting && !lightboxOpen) refocusStep();
  }, [presenting, lightboxOpen]);
  if (!presenting) return null;
  // Portaled to the body: fixed positioning must not inherit a transformed
  // ancestor's coordinate space.
  return createPortal(
    <>
      <div className="present-hud" data-testid="present-hud">
        <button
          type="button"
          className="present-btn"
          aria-label="Previous"
          data-testid="present-prev"
          disabled={step === 0}
          onClick={() => presentGo(-1)}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span className="present-count" data-testid="present-count">
          {step + 1} / {count}
        </span>
        <button
          type="button"
          className="present-btn"
          aria-label="Next"
          data-testid="present-next"
          disabled={step >= count - 1}
          onClick={() => presentGo(1)}
        >
          <ChevronRightIcon size={16} />
        </button>
        {zoomed && (
          <button
            type="button"
            className="present-btn"
            aria-label="Fit step"
            title="Back to the step (0)"
            data-testid="present-fit"
            onClick={presentResetZoom}
          >
            <FitIcon size={15} />
          </button>
        )}
        <span className="present-sep" aria-hidden />
        <button
          type="button"
          className="present-btn"
          aria-label="View item"
          title="View in the lightbox"
          data-testid="present-open"
          disabled={!viewable}
          onClick={() => openPresentedItem()}
        >
          <ExpandIcon size={15} />
        </button>
        <button
          type="button"
          className="present-btn"
          aria-label="Exit presentation"
          title="Exit (Esc)"
          data-testid="present-exit"
          onClick={stopPresentation}
        >
          <CloseIcon size={15} />
        </button>
      </div>
    </>,
    document.body,
  );
}
