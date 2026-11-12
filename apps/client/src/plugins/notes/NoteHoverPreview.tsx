import { useEffect, useRef, useState } from 'react';
import type { TextItem } from '@boardcache/schema';
import { renderMarkdown } from '../../lib/text/markdown';
import { findNoteByTitle, noteTitle } from '../../lib/text/wikilinks';
import { useDocumentStore } from '../../state/documentStore';

/** The hover rests this long on a link before the card shows. */
const SHOW_MS = 400;
/** Characters of the note the card shows at most. */
const EXCERPT = 1500;
const CARD_W = 360;
const CARD_H = 320;

interface Shown {
  title: string;
  note: TextItem | null;
  x: number;
  y: number;
}

/**
 * A card with the start of a note, shown when the pointer rests on a
 * `[[link]]` to it in the page or the live editor, as Obsidian does; a
 * link to a note that does not exist yet says so. The card follows the
 * link's place and goes when the pointer leaves it.
 */
export function NoteHoverPreview({ within }: { within: React.RefObject<HTMLElement | null> }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | null>(null);
  const link = useRef<Element | null>(null);

  useEffect(() => {
    const root = within.current;
    if (!root) return;
    const clear = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      clear();
      link.current = null;
      setShown(null);
    };
    const over = (e: Event) => {
      const target = (e.target as Element | null)?.closest?.('[data-note]');
      if (!target || target === link.current) return;
      // Inside the card itself: leave it.
      if (target.closest('.notes-hover')) return;
      clear();
      link.current = target;
      const title = target.getAttribute('data-note') ?? '';
      timer.current = window.setTimeout(() => {
        if (link.current !== target || !title) return;
        const box = target.getBoundingClientRect();
        const doc = useDocumentStore.getState().doc;
        const note = findNoteByTitle(doc, title);
        // Below the link, or above it when the bottom is near; kept on screen.
        const below = box.bottom + 8 + CARD_H <= window.innerHeight;
        const y = below ? box.bottom + 8 : Math.max(8, box.top - 8 - CARD_H);
        const x = Math.max(8, Math.min(box.left, window.innerWidth - CARD_W - 8));
        setShown({ title, note, x, y });
      }, SHOW_MS);
    };
    const out = (e: Event) => {
      const target = (e.target as Element | null)?.closest?.('[data-note]');
      if (!target || target !== link.current) return;
      const to = (e as MouseEvent).relatedTarget as Element | null;
      if (to?.closest?.('.notes-hover')) return;
      hide();
    };
    root.addEventListener('mouseover', over);
    root.addEventListener('mouseout', out);
    root.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('mousedown', hide, true);
    return () => {
      clear();
      root.removeEventListener('mouseover', over);
      root.removeEventListener('mouseout', out);
      root.removeEventListener('scroll', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('mousedown', hide, true);
    };
  }, [within]);

  if (!shown) return null;
  const { note, title } = shown;
  const text = note?.text ?? '';
  const excerpt = text.length > EXCERPT ? `${text.slice(0, EXCERPT)}\n\n…` : text;
  return (
    <div
      className="notes-hover"
      data-testid="notes-hover-preview"
      style={{ left: shown.x, top: shown.y, width: CARD_W, maxHeight: CARD_H }}
      onMouseLeave={() => setShown(null)}
    >
      <div className="notes-hover-title">{note ? noteTitle(note) : title}</div>
      {note ? (
        <div
          className="md-rendered md-text notes-hover-body"
          style={{ fontFamily: note.fontFamily }}
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(excerpt.trim() ? excerpt : '_Nothing here yet._', {
              properties: false,
            }),
          }}
        />
      ) : (
        <p className="notes-hover-missing">No note with this title yet. Click to make it.</p>
      )}
    </div>
  );
}
