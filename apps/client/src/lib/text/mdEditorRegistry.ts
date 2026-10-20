import type { EditAction } from './mdFormat';

/**
 * The markdown editor currently focused. Toolbar buttons live outside the
 * textarea, so they format "the active editor" rather than receiving a ref.
 * Buttons must preventDefault on mousedown to keep the textarea focused.
 */
interface ActiveEditor {
  id: string;
  apply: (action: EditAction) => void;
}

let active: ActiveEditor | null = null;

export function setActiveEditor(editor: ActiveEditor | null): void {
  active = editor;
}

/** Clear only if `id` is still the active editor (avoids races on blur). */
export function clearActiveEditor(id: string): void {
  if (active?.id === id) active = null;
}

/** Apply a formatting action to the active editor; no-op if none is focused. */
export function applyActiveFormat(action: EditAction): boolean {
  if (!active) return false;
  active.apply(action);
  return true;
}
