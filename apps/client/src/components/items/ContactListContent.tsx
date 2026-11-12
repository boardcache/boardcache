import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ContactItem, ContactlistItem } from '@boardcache/schema';
import { BoardsIcon, ContactIcon, SearchIcon } from '../icons';
import { useCanvasReadOnly } from '../../lib/canvas/readOnly';
import { sendContactsToBoard } from '../../lib/structure/contactList';
import {
  CONTACT_LIST_W,
  contactLetter,
  contactMatches,
  contactName,
  contactSubline,
  listContacts,
} from '../../lib/structure/contacts';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { ContactAvatar } from './ContactContent';
import { FittedCard, ScaledCard } from './ScaledCard';

/**
 * A contact list on the canvas: the board's address book as one card. The
 * rows are the contacts filed in it, by last name under letter headings,
 * each with the photo or initials, the name and where they work. A still
 * click on a row opens that contact in the lightbox (the pointer passes
 * through, so the list drags by its rows like by its title); the button at
 * the row's end sends the contact to the board as a card. A contact card
 * dropped on the list files into it. One component draws the canvas item
 * (ScaledCard), the gallery card (fitted) and the lightbox stage (plain,
 * with a search box).
 */

function useListRows(listId: string): ContactItem[] {
  return useDocumentStore(useShallow((s) => listContacts(s.doc, listId)));
}

function LetterRows({
  rows,
  onOpen,
  onSend,
  activeId,
}: {
  rows: ContactItem[];
  onOpen: (c: ContactItem) => void;
  onSend: ((c: ContactItem) => void) | null;
  activeId?: string | null;
}) {
  const groups: { letter: string; items: ContactItem[] }[] = [];
  for (const c of rows) {
    const letter = contactLetter(c);
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.items.push(c);
    else groups.push({ letter, items: [c] });
  }
  return (
    <>
      {groups.map((g) => (
        <div className="contact-list-group" key={g.letter}>
          <div className="contact-list-letter">{g.letter}</div>
          {g.items.map((c) => {
            const sub = contactSubline(c);
            return (
              <div
                className={`contact-list-row${c.id === activeId ? ' active' : ''}`}
                key={c.id}
                data-testid="contact-list-row"
                data-contact-id={c.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(c)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(c);
                }}
              >
                <ContactAvatar item={c} size={30} />
                <span className="contact-list-text">
                  <span className="contact-list-name">{contactName(c)}</span>
                  {sub && <span className="contact-list-sub">{sub}</span>}
                </span>
                {onSend && (
                  <button
                    type="button"
                    className="contact-list-send"
                    aria-label="Send to board"
                    title="Send to board"
                    data-testid="contact-list-send"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSend(c);
                    }}
                  >
                    <BoardsIcon size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function openInLightbox(list: ContactlistItem, c: ContactItem): void {
  const session = useSessionStore.getState();
  // The lightbox's Back row returns to the list.
  session.setLightboxReturn(list.id);
  session.setLightbox(c.id);
}

function Card({ item, interactive }: { item: ContactlistItem; interactive: boolean }) {
  const rows = useListRows(item.id);
  const readOnly = useCanvasReadOnly();
  const dropHover = useSessionStore((s) => s.contactListDropHover?.itemId === item.id);
  // A row opens on a still click; a drag that started on a row moves the list.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onOpen = (c: ContactItem) => {
    if (!interactive) return;
    openInLightbox(item, c);
  };
  return (
    <div
      className={`contact-list${dropHover ? ' drop-target' : ''}`}
      data-testid="contact-list"
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onClickCapture={(e) => {
        const d = down.current;
        down.current = null;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) e.stopPropagation();
      }}
    >
      <div className="contact-list-head">
        <ContactIcon size={15} />
        <span className="contact-list-title" data-testid="contact-list-title">
          {item.title}
        </span>
        <span className="contact-list-count" data-testid="contact-list-count">
          {rows.length}
        </span>
      </div>
      <div className="contact-list-rows">
        {rows.length === 0 ? (
          <div className="contact-list-empty">Drop contact cards here</div>
        ) : (
          <LetterRows
            rows={rows}
            onOpen={onOpen}
            onSend={interactive && !readOnly ? (c) => sendContactsToBoard([c.id]) : null}
          />
        )}
      </div>
    </div>
  );
}

export function ContactListContent({
  item,
  mode = 'canvas',
}: {
  item: ContactlistItem;
  /** canvas: zoomed like other cards; fit: scaled to the holding box. */
  mode?: 'canvas' | 'fit';
}) {
  if (mode === 'fit')
    return (
      <FittedCard baseW={CONTACT_LIST_W}>
        <Card item={item} interactive={false} />
      </FittedCard>
    );
  return (
    <ScaledCard item={item} baseW={CONTACT_LIST_W}>
      <Card item={item} interactive />
    </ScaledCard>
  );
}

/** The lightbox stage: the list at reading size with a search box; a row
 *  opens the contact (Back returns here). */
export function ContactListStage({
  item,
  actions,
}: {
  item: ContactlistItem;
  actions?: React.ReactNode;
}) {
  const rows = useListRows(item.id);
  const readOnly = useCanvasReadOnly();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => rows.filter((c) => contactMatches(c, query)), [rows, query]);
  return (
    <div className="contact-list-stage" data-testid="contact-list-stage">
      <div className="contact-list-stage-head">
        <h2>{item.title}</h2>
        <span className="contact-list-stage-count">
          {rows.length === 1 ? '1 contact' : `${rows.length} contacts`}
        </span>
      </div>
      <label className="contact-list-search">
        <SearchIcon size={14} />
        <input
          value={query}
          placeholder="Search"
          aria-label="Search the list"
          data-testid="contact-list-search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </label>
      <div className="contact-list-stage-rows">
        {rows.length === 0 ? (
          <div className="contact-list-empty">No contacts in this list yet.</div>
        ) : shown.length === 0 ? (
          <div className="contact-list-empty">No contact matches that.</div>
        ) : (
          <LetterRows
            rows={shown}
            onOpen={(c) => openInLightbox(item, c)}
            onSend={readOnly ? null : (c) => sendContactsToBoard([c.id])}
          />
        )}
      </div>
      {actions}
    </div>
  );
}
