import { useEffect, useLayoutEffect, useState } from 'react';
import { create } from 'zustand';

/**
 * A short tour of the library for a first visit: a handful of coach marks,
 * each anchored to a real control, with a sentence apiece. It runs once per
 * device (the sidebar's "Take the tour" replays it) and stops at any step.
 * On a phone the sidebar is a drawer: the library opens it for the steps
 * whose controls live there and closes it again for the rest.
 */

const TOUR_SEEN_KEY = 'boardcache:tourSeen';

interface TourStep {
  /** The control the mark points at, by test id (the first visible one wins). */
  anchors: string[];
  /** The control sits in the sidebar, which is a drawer on phones. */
  drawer: boolean;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    anchors: ['new-board-card'],
    drawer: false,
    title: 'Boards start here',
    body: 'A new board is one click. Boards live on this device until you choose to sync them.',
  },
  {
    anchors: ['library-side-templates'],
    drawer: true,
    title: 'Templates and the welcome board',
    body: 'Templates are starting points you can edit or delete. The welcome board is a tour of the canvas itself.',
  },
  {
    anchors: ['library-side-community'],
    drawer: true,
    title: 'The Community',
    body: 'Boards other people have published: open one live, clone it into your library, or publish your own.',
  },
  {
    // The header's indicator on a desktop; the drawer's row on a phone.
    anchors: ['sync-status', 'sync-status-drawer'],
    drawer: true,
    title: 'Sync when you want it',
    body: 'An account keeps boards on every device, end-to-end encrypted. Without one, everything still works here.',
  },
  {
    anchors: ['library-side-settings'],
    drawer: true,
    title: 'Settings',
    body: 'Themes, plugins, the assistant, backups and import live here. That is the tour; the welcome board takes it from here.',
  },
];

interface TourState {
  step: number | null;
  /** Finished or skipped once on this device: the sidebar's offer is gone. */
  seen: boolean;
  start: () => void;
  next: () => void;
  stop: () => void;
}

const seenAtStart = (): boolean => {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return true;
  }
};

const useLibraryTour = create<TourState>((set, get) => ({
  step: null,
  seen: seenAtStart(),
  start: () => set({ step: 0 }),
  next: () => {
    const s = get().step;
    if (s === null) return;
    if (s + 1 >= STEPS.length) get().stop();
    else set({ step: s + 1 });
  },
  stop: () => {
    try {
      localStorage.setItem(TOUR_SEEN_KEY, '1');
    } catch {
      /* storage unavailable */
    }
    set({ step: null, seen: true });
  },
}));

export const startLibraryTour = (): void => useLibraryTour.getState().start();

/** Whether the sidebar still offers the tour (it has not run to its end or been skipped). */
export const useTourOffered = (): boolean => useLibraryTour((s) => !s.seen);

/**
 * Whether the current step wants the sidebar drawer open: null while no
 * tour runs. The library screen follows it on phones, where the sidebar is
 * off screen until opened.
 */
export const useTourDrawer = (): boolean | null =>
  useLibraryTour((s) => (s.step === null ? null : STEPS[s.step]!.drawer));

/** First visit: the tour runs by itself, once. */
export function maybeAutoStartTour(): void {
  try {
    if (localStorage.getItem(TOUR_SEEN_KEY)) return;
  } catch {
    return;
  }
  if (window.location.pathname !== '/') return;
  startLibraryTour();
}

/** How long the phone drawer takes to slide in (09-library-mobile.css). */
const DRAWER_SLIDE_MS = 220;

/**
 * The box of the step's control, if it is on screen. A control inside a
 * closed drawer has a size but sits beyond the left edge; one below the
 * fold of a scrolling sidebar is scrolled into view first.
 */
function anchorRect(step: TourStep): DOMRect | null {
  for (const id of step.anchors) {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) continue;
    let r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= 0 || r.left >= window.innerWidth) continue;
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'nearest' });
      r = el.getBoundingClientRect();
    }
    return r;
  }
  return null;
}

export function LibraryTour() {
  const step = useLibraryTour((s) => s.step);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (step === null) return;
    const current = STEPS[step]!;
    const place = () => setRect(anchorRect(current));
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // The drawer slides: measure again once it has settled.
    window.addEventListener('transitionend', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('transitionend', place, true);
    };
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useLibraryTour.getState().stop();
      if (e.key === 'Enter' || e.key === 'ArrowRight') useLibraryTour.getState().next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  // A step whose control is not on screen is skipped rather than shown
  // adrift, once the drawer has had time to arrive.
  useEffect(() => {
    if (step === null || rect !== null) return;
    const t = setTimeout(() => {
      const r = anchorRect(STEPS[step]!);
      if (r === null) useLibraryTour.getState().next();
      else setRect(r);
    }, DRAWER_SLIDE_MS + 80);
    return () => clearTimeout(t);
  }, [step, rect]);

  if (step === null || !rect) return null;
  const current = STEPS[step]!;
  const pad = 8;
  const spot = {
    left: rect.left - pad,
    top: rect.top - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
  // The card sits to the right of the control when there is room; on a
  // narrow screen it goes below the control, or above when the control is
  // near the bottom (the drawer's Settings row, say).
  const cardW = Math.min(320, window.innerWidth - 32);
  const cardH = 200;
  const right = spot.left + spot.width + 16;
  const fitsRight = right + cardW < window.innerWidth - 16;
  const fitsBelow = spot.top + spot.height + 16 + cardH < window.innerHeight - 16;
  const narrowLeft = Math.max(16, Math.min(spot.left, window.innerWidth - cardW - 16));
  const cardStyle = fitsRight
    ? { left: right, top: Math.max(16, Math.min(spot.top, window.innerHeight - 220)) }
    : fitsBelow
      ? { left: narrowLeft, top: spot.top + spot.height + 16 }
      : { left: narrowLeft, bottom: window.innerHeight - spot.top + 16 };
  const last = step === STEPS.length - 1;

  return (
    <div
      className="tour"
      role="dialog"
      aria-modal="true"
      aria-label="Library tour"
      data-testid="library-tour"
    >
      <div className="tour-veil" onClick={() => useLibraryTour.getState().stop()} />
      <div className="tour-spot" style={spot} />
      <div className="tour-card menu-panel" style={{ ...cardStyle, width: cardW }}>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <div className="tour-actions">
          <span className="tour-dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <i key={i} className={i === step ? 'on' : ''} />
            ))}
          </span>
          {!last && (
            <button
              type="button"
              className="sync-secondary"
              data-testid="tour-skip"
              onClick={() => useLibraryTour.getState().stop()}
            >
              Skip
            </button>
          )}
          <button
            type="button"
            className="sync-primary"
            data-testid="tour-next"
            onClick={() => useLibraryTour.getState().next()}
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
