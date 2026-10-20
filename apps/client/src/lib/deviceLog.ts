import { apiFetch, syncServerBaseValue } from './sync/apiBase';

/**
 * Device diagnostics: ships tiny JSON events to /api/client-log so failures
 * that only reproduce on physical devices (iOS Safari, historically) can be
 * diagnosed from the server log. Always-on for errors; the dialog paint
 * probe is called explicitly by UiDialog. Fire-and-forget, never throws.
 */

const seen = new Set<string>();

/** Report a named diagnostic event (sync failures, gesture breadcrumbs). */
export function logDeviceEvent(event: string, data?: Record<string, unknown>): void {
  deviceLog(event, data);
}

function deviceLog(event: string, data?: Record<string, unknown>): void {
  try {
    const body = JSON.stringify({
      event,
      build: String(import.meta.env.VITE_BUILD_ID ?? 'dev'),
      ua: navigator.userAgent,
      vw: window.innerWidth,
      vh: window.innerHeight,
      ...data,
    });
    // The shells (desktop app://, mobile capacitor://) are not on the sync
    // server's origin: a relative post would hit their own scheme and vanish,
    // and sendBeacon cannot make a cross-origin JSON request. They go through
    // apiFetch, which carries the right auth for that origin.
    const base = syncServerBaseValue();
    if (base === null) return;
    if (base !== '') {
      void apiFetch('/api/client-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
      return;
    }
    // sendBeacon survives navigations/crashes better than fetch.
    if (
      !navigator.sendBeacon?.('/api/client-log', new Blob([body], { type: 'application/json' }))
    ) {
      void fetch('/api/client-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    /* diagnostics must never break the app */
  }
}

/** The buttons under investigation: log their full input event chain so we
 *  can see WHERE the tap dies on-device (pointerdown fires but click never
 *  does? click fires but the dialog never paints?). */
const WATCHED = new Set([
  'menu-settings',
  'sync-status',
  'library-backups',
  'library-import',
  'menu-add', // known-working dropdown, for contrast
]);

const GESTURE_KEY = 'boardcache:gesture';

/**
 * Leave a note about a gesture in progress, or clear it (`null`) when the
 * gesture ends. A tab that runs out of memory mid-gesture is killed without
 * any error event (iOS shows "A problem repeatedly occurred"), so the note
 * outliving the page is the only evidence; the next load reports it.
 */
export function noteGesture(data: Record<string, unknown> | null): void {
  try {
    if (data) sessionStorage.setItem(GESTURE_KEY, JSON.stringify({ ...data, at: Date.now() }));
    else sessionStorage.removeItem(GESTURE_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

function reportUnfinishedGesture(): void {
  try {
    const left = sessionStorage.getItem(GESTURE_KEY);
    if (!left) return;
    sessionStorage.removeItem(GESTURE_KEY);
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    deviceLog('unfinished-gesture', {
      ...(JSON.parse(left) as Record<string, unknown>),
      nav: nav?.type ?? null,
    });
  } catch {
    /* diagnostics must never break the app */
  }
}

/** Global error hooks — deduped so a render loop can't flood the log. */
export function installDeviceErrorLog(): void {
  reportUnfinishedGesture();
  for (const type of ['pointerdown', 'touchstart', 'touchend', 'click'] as const) {
    document.addEventListener(
      type,
      (e) => {
        const el = (e.target as HTMLElement | null)?.closest?.('[data-testid]');
        const id = el?.getAttribute('data-testid');
        if (id && WATCHED.has(id)) {
          deviceLog('evt', {
            type,
            id,
            trusted: e.isTrusted,
            defaultPrevented: e.defaultPrevented,
          });
        }
      },
      true,
    );
  }
  window.addEventListener('error', (e) => {
    const key = `${e.message}@${e.filename}:${e.lineno}`;
    if (seen.has(key) || seen.size > 20) return;
    seen.add(key);
    deviceLog('window-error', {
      message: String(e.message).slice(0, 500),
      source: `${e.filename}:${e.lineno}:${e.colno}`,
      stack: String(e.error?.stack ?? '').slice(0, 1200),
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e.reason?.message ?? e.reason ?? 'unknown');
    if (seen.has(msg) || seen.size > 20) return;
    seen.add(msg);
    deviceLog('unhandled-rejection', {
      message: msg.slice(0, 500),
      stack: String(e.reason?.stack ?? '').slice(0, 1200),
    });
  });
}

/** One frame after a dialog mounts: is it actually painted and on-screen? */
export function probeDialogPaint(label: string): void {
  requestAnimationFrame(() => {
    try {
      const backdrop = document.querySelector('.dlg-veil');
      const modal = document.querySelector('.dlg-sheet');
      const rect = modal?.getBoundingClientRect();
      const cs = modal ? getComputedStyle(modal) : null;
      deviceLog('dialog-paint', {
        label,
        backdrop: !!backdrop,
        modal: !!modal,
        rect: rect
          ? `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`
          : null,
        display: cs?.display ?? null,
        visibility: cs?.visibility ?? null,
        opacity: cs?.opacity ?? null,
        zIndex: cs?.zIndex ?? null,
        topAtCenter: (() => {
          const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
          return el ? `${el.tagName}.${String(el.className).slice(0, 60)}` : 'none';
        })(),
      });
    } catch {
      /* never break the dialog */
    }
  });
}

/**
 * One line per session from an installed iPhone app: the numbers behind the
 * iOS 27 status-bar blur (what the OS reports as safe area, what boot.js
 * decided) so the top inset can be tuned without holding the phone.
 */
export function probeInstalledApp(): void {
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    const installed =
      nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (!installed || !/iP(hone|ad|od)/.test(navigator.userAgent)) return;
    if (seen.has('installed-probe')) return;
    seen.add('installed-probe');
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
      'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const insetTop = cs.paddingTop;
    const insetBottom = cs.paddingBottom;
    probe.remove();
    deviceLog('installed-probe', {
      flagged: document.documentElement.hasAttribute('data-ios-top-blur'),
      standalone: nav.standalone === true,
      displayMode: window.matchMedia('(display-mode: standalone)').matches,
      insetTop,
      insetBottom,
      screenH: window.screen.height,
      outerH: window.outerHeight,
      vvTop: window.visualViewport?.offsetTop ?? null,
      vvH: window.visualViewport?.height ?? null,
      dpr: window.devicePixelRatio,
    });
  } catch {
    /* diagnostics never break the app */
  }
}
