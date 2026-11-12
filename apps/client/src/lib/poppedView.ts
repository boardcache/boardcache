/**
 * A view popped out into a window of its own (the bar's pop-out button)
 * is named for it when opened. Such a window is the view and nothing
 * else: it never shows the canvas, since the board is already open in the
 * window it came from, and its bar is the handle the window moves by.
 */
export const POPPED_WINDOW_PREFIX = 'boardcache-view';

export function isPoppedView(): boolean {
  return typeof window !== 'undefined' && window.name.startsWith(POPPED_WINDOW_PREFIX);
}

/** Mark the document once so the styles know (called at boot). */
export function markPoppedView(): void {
  if (isPoppedView()) document.documentElement.classList.add('popped-view');
}
