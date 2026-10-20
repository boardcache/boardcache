/**
 * Touch long-press for cards in an index (boards, folders, team boards):
 * press and hold without moving → `onPress(id)`. Mouse and pen never count;
 * they have right-click and modifier keys. One press is tracked at a time.
 *
 * The browser follows a held touch with its own events — a `click` on
 * release, a `contextmenu` on Android, a native drag lift for `draggable`
 * elements — so the card's handlers ask `claimClick`, `claimContextMenu` and
 * `blockDrag` before acting, and those swallow the follow-ups of a press.
 */
export interface LongPress {
  /** Spread onto the card; arms the press on touch pointers only. */
  handlers(id: string): { onPointerDown: (e: React.PointerEvent) => void };
  /** True (and consumed) when a click is the release of a press that fired. */
  claimClick(): boolean;
  /** True when a contextmenu event is the browser's reading of a touch hold:
   *  fires the press if the timer hasn't yet, and the menu must not open. */
  claimContextMenu(e: React.MouseEvent): boolean;
  /** True when a dragstart comes from a touch pointer, which the caller then
   *  cancels: a held touch selects here, it never lifts a card. */
  blockDrag(e: React.DragEvent): boolean;
}

const HOLD_MS = 450;
const SLOP_PX = 10;

export function createLongPress(onPress: (id: string) => void): LongPress {
  let touchActive = false; // a touch pointer is down on a card
  let touchId: string | null = null;
  let fired = false;
  let firedAt = 0;
  let cancel: (() => void) | null = null;

  const fire = () => {
    if (fired || touchId === null) return;
    fired = true;
    firedAt = Date.now();
    onPress(touchId);
  };

  return {
    handlers(id) {
      return {
        onPointerDown(e) {
          cancel?.();
          fired = false;
          if (e.pointerType !== 'touch' || e.button !== 0) {
            touchActive = false;
            return;
          }
          touchActive = true;
          touchId = id;
          const x0 = e.clientX;
          const y0 = e.clientY;
          const onMove = (mv: PointerEvent) => {
            if (Math.hypot(mv.clientX - x0, mv.clientY - y0) > SLOP_PX) cancel?.();
          };
          const end = () => {
            cancel?.();
            // The click that follows a release lands after this; keep `fired`
            // for it, forget the pointer.
            touchActive = false;
          };
          const timer = window.setTimeout(() => {
            cancel?.();
            fire();
          }, HOLD_MS);
          cancel = () => {
            window.clearTimeout(timer);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            cancel = null;
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', end);
          window.addEventListener('pointercancel', end);
        },
      };
    },
    claimClick() {
      if (!fired) return false;
      // The synthetic click of the release arrives within a frame or two;
      // anything later is a new tap.
      const recent = Date.now() - firedAt < 700;
      fired = false;
      return recent;
    },
    claimContextMenu(e) {
      // Chromium on touch reports the hold as a contextmenu; it may land
      // before or after our timer. Either way it is the press, not a menu.
      if (!touchActive && !(fired && Date.now() - firedAt < 700)) return false;
      e.preventDefault();
      cancel?.();
      fire();
      return true;
    },
    blockDrag(e) {
      if (!touchActive) return false;
      e.preventDefault();
      return true;
    },
  };
}
