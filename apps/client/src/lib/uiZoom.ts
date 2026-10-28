import { useSyncExternalStore } from 'react';
import { desktopUi } from './platform';

/**
 * Interface size on the desktop. The shell has no browser zoom of its own
 * (no zoom roles in its menu, and Cmd/Ctrl+= on a board zooms the canvas),
 * so the size of the interface is a setting: one zoom factor for every
 * window, stored by the shell and applied as windows open. The web app
 * leaves this to the browser's own zoom, so nothing here applies there.
 */

/** The sizes offered, as zoom factors (1 = 100%). */
export const UI_ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

/** True inside the desktop shell, where the interface has a size setting. */
export function uiZoomAvailable(): boolean {
  return desktopUi() !== null;
}

let current = 1;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(): void {
  if (loaded) return;
  loaded = true;
  const ui = desktopUi();
  if (!ui) return;
  void ui.getZoom().then((z) => {
    current = z;
    emit();
  });
  // Another window, or the View menu, changed it.
  ui.onZoom((z) => {
    current = z;
    emit();
  });
}

const subscribe = (l: () => void) => {
  load();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The current interface zoom factor (1 until the shell has answered). */
export function useUiZoom(): number {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 1,
  );
}

/** Set the interface size for every window; the shell stores it. */
export async function setUiZoom(zoom: number): Promise<void> {
  const ui = desktopUi();
  if (!ui) return;
  current = await ui.setZoom(zoom);
  emit();
}

/** Step to the next size up (1), down (-1), or back to 100% (0). */
export async function stepUiZoom(direction: 1 | -1 | 0): Promise<void> {
  if (direction === 0) return setUiZoom(1);
  load();
  const steps: number[] = [...UI_ZOOM_STEPS];
  const index = steps.findIndex((s) => Math.abs(s - current) < 0.005);
  let next = current;
  if (index === -1) {
    // Off the ladder (an older value): the nearest step in that direction.
    const candidates = steps.filter((s) => (direction > 0 ? s > current : s < current));
    if (candidates.length)
      next = direction > 0 ? candidates[0]! : candidates[candidates.length - 1]!;
  } else {
    next = steps[Math.min(steps.length - 1, Math.max(0, index + direction))]!;
  }
  if (next !== current) await setUiZoom(next);
}
