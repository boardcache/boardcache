import type { TextItem } from '@boardcache/schema';
import { rotatedRectAABB } from '../canvas/geometry';
import { getCanvasContainer } from '../canvas/canvasDom';
import { fitViewportTo } from '../canvas/viewportActions';
import { revealItemPage } from '../board/pages';
import { showNotice } from '../notices';
import { setItemsHidden } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { findNoteByTitle } from './wikilinks';

/** Bring a note into view on the canvas: its page, framed, selected. A
 *  note kept off the canvas is put on it first. */
export function revealNoteOnCanvas(note: TextItem): void {
  if (note.hidden) setItemsHidden([note.id], false);
  const session = useSessionStore.getState();
  session.setLightbox(null);
  if (session.view !== 'canvas') session.setView('canvas');
  revealItemPage(note.id);
  session.setSelection([note.id]);
  // The canvas may be mounting this frame (coming from another view).
  requestAnimationFrame(() => fitViewportTo(rotatedRectAABB(note), getCanvasContainer()));
}

/** A `[[Title]]` link clicked on the canvas: go to that note, or say it
 *  is not on the board. */
export function followWikiLinkOnCanvas(title: string): void {
  const note = findNoteByTitle(useDocumentStore.getState().doc, title);
  if (!note) {
    showNotice(`No note called “${title}” on this board.`, { id: 'wikilink-miss' });
    return;
  }
  revealNoteOnCanvas(note);
}

/** The `[[…]]` link under a click, if any. */
export function wikiLinkTarget(target: EventTarget | null): string | null {
  const a = target instanceof Element ? target.closest('a.md-wikilink') : null;
  return a?.getAttribute('data-note') ?? null;
}
