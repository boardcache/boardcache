import type { EditAction, EditState } from './mdFormat';

/**
 * The markdown editor currently focused. Toolbar buttons live outside the
 * textarea, so they format "the active editor" rather than receiving a ref.
 * Buttons must preventDefault on mousedown to keep the textarea focused.
 */
export interface ActiveEditor {
  id: string;
  apply: (action: EditAction) => void;
  /** The text and selection as they are, for a control that depends on them. */
  read: () => EditState | null;
}

let active: ActiveEditor | null = null;

export function setActiveEditor(editor: ActiveEditor | null): void {
  active = editor;
}

/** Clear only if `id` is still the active editor (avoids races on blur). */
export function clearActiveEditor(id: string): void {
  if (active?.id === id) active = null;
}

/** The active editor itself, for a dialog that will outlive the focus. */
export function getActiveEditor(): ActiveEditor | null {
  return active;
}

/** Apply a formatting action to the active editor; no-op if none is focused. */
export function applyActiveFormat(action: EditAction): boolean {
  if (!active) return false;
  active.apply(action);
  return true;
}
