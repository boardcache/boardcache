import { useSessionStore } from '../../state/sessionStore';
import { VIEWER } from '../viewerMode';

/**
 * Is the canvas view-only right now? True in the offline/share/community
 * viewer, whenever the pan tool ("lock the canvas") is active, and while
 * Presentation Mode plays: then nothing selects, moves, edits or opens an
 * editor, and menus offer only looking and copying. Every gesture and
 * shortcut that would change the board asks this first.
 */
export function canvasReadOnly(): boolean {
  const s = useSessionStore.getState();
  return VIEWER || s.tool === 'pan' || s.presenting;
}

/** The same answer, reactive: content components hide their editing chrome
 *  (checkboxes, chips, inputs, drag handles) while it is true. */
export function useCanvasReadOnly(): boolean {
  return useSessionStore((s) => VIEWER || s.tool === 'pan' || s.presenting);
}
