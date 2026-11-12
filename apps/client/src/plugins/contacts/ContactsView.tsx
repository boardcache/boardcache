import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ContactItem } from '@boardcache/schema';
import {
  BoardsIcon,
  ChevronLeftIcon,
  CloseIcon,
  ContactIcon,
  ContactListIcon,
  DownloadIcon,
  FolderInputIcon,
  ListPlusIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from '../../components/icons';
import { ThemeToggle } from '../../components/chrome/ThemeToggle';
import { PopOutViewButton } from '../../components/chrome/PopOutViewButton';
import { ViewBarButton } from '../../components/chrome/ViewBarButton';
import { ContactAvatar } from '../../components/items/ContactContent';
import { confirmDialog } from '../../components/ui/Prompt';
import { useMobileViewport } from '../../hooks/useMobileViewport';
import { ConnectedMedia, ContactDetails } from '../../itemTypes/contact';
import { activePageId, revealItemPage } from '../../lib/board/pages';
import { clientToCanvas, getCanvasContainer } from '../../lib/canvas/canvasDom';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { downloadContactsVcf } from '../../lib/export/exportVcf';
import { createContactListItem } from '../../lib/import/createItems';
import { importVcfFiles } from '../../lib/import/importVcf';
import { syncUrl } from '../../lib/router';
import { attachContactsToList, sendContactsToBoard } from '../../lib/structure/contactList';
import {
  boardContacts,
  contactLetter,
  contactListOf,
  contactMatches,
  contactName,
  contactSubline,
  defaultContactList,
  sortContacts,
} from '../../lib/structure/contacts';
import { removeItems, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useContactsUi } from './store';

/**
 * The board's contacts: every contact card as an address book, the list by
 * last name on the left with a search box, the picked contact on the right
 * with every line, a notes field that writes straight to the card, and the
 * editor one click away. A full-screen plugin view on the gallery chassis
 * (View → Contacts), with the shared view bar. Phones show one side at a
 * time.
 */

export function ContactsView() {
  const contacts = useDocumentStore(useShallow((s) => sortContacts(boardContacts(s.doc))));
  const selectedId = useContactsUi((s) => s.selectedId);
  const query = useContactsUi((s) => s.query);
  const mobile = useMobileViewport();
  const fileInput = useRef<HTMLInputElement>(null);
  const back = () => useSessionStore.getState().setView('canvas');

  const shown = useMemo(() => contacts.filter((c) => contactMatches(c, query)), [contacts, query]);
  const selected = contacts.find((c) => c.id === selectedId) ?? null;

  // A deleted contact leaves the stage; the first one takes it on a desktop.
  useEffect(() => {
    if (selectedId && !selected) useContactsUi.getState().setSelected(null);
  }, [selectedId, selected]);
  useEffect(() => {
    if (!mobile && !selectedId && shown[0]) useContactsUi.getState().setSelected(shown[0].id);
  }, [mobile, selectedId, shown]);
  useEffect(() => {
    syncUrl();
  }, [selectedId]);

  const pick = (id: string) => useContactsUi.getState().setSelected(id);
  const showList = !mobile || !selected;
  const showDetail = !mobile || !!selected;

  return (
    <div className="gallery-screen contacts-screen" data-testid="contacts-screen">
      <header className="gallery-header view-bar contacts-bar">
        <div className="gallery-header-left">
          <ViewBarButton
            label="Back to canvas"
            icon={<BoardsIcon size={16} />}
            testId="contacts-back"
            onClick={back}
          />
          <h1>Contacts</h1>
          <span className="view-bar-count" data-testid="contacts-count">
            {contacts.length === 1 ? '1 contact' : `${contacts.length} contacts`}
          </span>
        </div>
        <div className="gallery-actions">
          <ViewBarButton
            label="New contact"
            icon={<PlusIcon size={16} />}
            testId="contacts-new"
            onClick={() => useContactsUi.getState().openNew()}
          />
          <ViewBarButton
            label="Import a .vcf file"
            icon={<FolderInputIcon size={16} />}
            testId="contacts-import"
            onClick={() => fileInput.current?.click()}
          />
          <ViewBarButton
            label="Export the contacts as .vcf"
            icon={<DownloadIcon size={16} />}
            testId="contacts-export"
            disabled={contacts.length === 0}
            onClick={() => void downloadContactsVcf(contacts, useDocumentStore.getState().doc)}
          />
          <PopOutViewButton testId="contacts-popout" />
          <ThemeToggle className="view-icon-btn" testId="contacts-theme-toggle" />
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept=".vcf,text/vcard"
        multiple
        hidden
        data-testid="contacts-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length)
            void importVcfFiles(
              files,
              clientToCanvas(window.innerWidth / 2, window.innerHeight / 2),
            );
        }}
      />
      <div className={`contacts-body${mobile ? ' contacts-one-pane' : ''}`}>
        {showList && (
          <aside className="contacts-list" data-testid="contacts-list">
            <div className="contacts-search">
              <SearchIcon size={14} />
              <input
                className="contacts-search-input"
                data-testid="contacts-search"
                placeholder="Search contacts"
                aria-label="Search contacts"
                value={query}
                onChange={(e) => useContactsUi.getState().setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') useContactsUi.getState().setQuery('');
                }}
              />
              {query && (
                <button
                  type="button"
                  className="contacts-search-clear"
                  aria-label="Clear search"
                  onClick={() => useContactsUi.getState().setQuery('')}
                >
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
            <div className="contacts-rows">
              {contacts.length === 0 ? (
                <div className="contacts-empty" data-testid="contacts-empty">
                  <p>No contacts on this board yet.</p>
                  <p>Add one, drop a .vcf file on the canvas, or import one here.</p>
                </div>
              ) : shown.length === 0 ? (
                <div className="contacts-empty">No contact matches that.</div>
              ) : (
                <LetterGroups contacts={shown} selectedId={selectedId} onPick={pick} />
              )}
            </div>
          </aside>
        )}
        {showDetail && (
          <section className="contacts-detail" data-testid="contacts-detail">
            {selected ? (
              <ContactPage key={selected.id} contact={selected} mobile={mobile} />
            ) : (
              <div className="contacts-detail-empty">Pick a contact to see it here.</div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function LetterGroups({
  contacts,
  selectedId,
  onPick,
}: {
  contacts: ContactItem[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const groups: { letter: string; items: ContactItem[] }[] = [];
  for (const c of contacts) {
    const letter = contactLetter(c);
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.items.push(c);
    else groups.push({ letter, items: [c] });
  }
  return (
    <>
      {groups.map((g) => (
        <div className="contacts-group" key={g.letter}>
          <div className="contacts-letter" data-testid="contacts-letter">
            {g.letter}
          </div>
          {g.items.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`contacts-row${c.id === selectedId ? ' active' : ''}`}
              data-testid="contacts-row"
              data-item-id={c.id}
              onClick={() => onPick(c.id)}
            >
              <ContactAvatar item={c} size={30} />
              <span className="contacts-row-text">
                <span className="contacts-row-name">{contactName(c)}</span>
                {contactSubline(c) && <span className="contacts-row-sub">{contactSubline(c)}</span>}
              </span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

/** The picked contact: the big avatar, every line, notes that save as you type. */
function ContactPage({ contact, mobile }: { contact: ContactItem; mobile: boolean }) {
  const id = contact.id;
  const list = useDocumentStore((s) => contactListOf(s.doc, contact));
  const [notes, setNotes] = useState(contact.notes ?? '');
  const notesRef = useRef(notes);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The field writes to the card after a pause, on blur and when it leaves.
  const flushNotes = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const text = notesRef.current.trim();
    const item = useDocumentStore.getState().doc.items[id];
    if (!item || item.type !== 'contact' || (item.notes ?? '') === text) return;
    updateItems([id], 'Edit contact notes', (d) => {
      if (text) d.notes = text;
      else delete d.notes;
    });
  }, [id]);
  // Outside writes (the dialog, the assistant, a sync) refresh the field when
  // nothing is pending here.
  useEffect(() => {
    if (timer.current === null && (contact.notes ?? '') !== notesRef.current.trim()) {
      notesRef.current = contact.notes ?? '';
      setNotes(contact.notes ?? '');
    }
  }, [contact.notes]);
  useEffect(() => () => flushNotes(), [flushNotes]);
  const onNotes = (text: string) => {
    notesRef.current = text;
    setNotes(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flushNotes, 800);
  };

  const showOnBoard = () => {
    // A listed contact is a row: the board shows its list.
    const target = list ?? contact;
    const session = useSessionStore.getState();
    session.setLightbox(null);
    session.setView('canvas');
    session.setSelection([target.id]);
    revealItemPage(target.id);
    requestAnimationFrame(() => fitViewportTo(target, getCanvasContainer()));
  };
  const sendToBoard = () => sendContactsToBoard([contact.id]);
  const putInList = () => {
    const doc = useDocumentStore.getState().doc;
    const target = defaultContactList(doc, activePageId(doc));
    const listId =
      target?.id ??
      createContactListItem(
        { x: contact.x + contact.width + 200, y: contact.y + 200 },
        {
          ...(contact.pageId ? { pageId: contact.pageId } : {}),
        },
      );
    attachContactsToList([contact.id], listId, target ? 'Add to list' : 'Put in a contact list');
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Delete contact',
      body: `Remove ${contactName(contact)} from the board?`,
      confirmLabel: 'Delete',
    });
    if (ok) removeItems([contact.id], 'Delete contact');
  };
  const sub = contactSubline(contact);

  return (
    <div className="contacts-page">
      {mobile && (
        <button
          type="button"
          className="contacts-page-back"
          data-testid="contacts-page-back"
          onClick={() => useContactsUi.getState().setSelected(null)}
        >
          <ChevronLeftIcon size={16} /> Contacts
        </button>
      )}
      <div className="contacts-page-head">
        <ContactAvatar item={contact} size={88} />
        <div className="contacts-page-names">
          <h2 data-testid="contacts-page-name">{contactName(contact)}</h2>
          {sub && <div className="contacts-page-sub">{sub}</div>}
          {list && (
            <div className="contacts-page-list" data-testid="contacts-page-list">
              <ContactListIcon size={13} /> In {list.title}
            </div>
          )}
        </div>
      </div>
      <div className="contacts-page-actions">
        <button
          type="button"
          className="btn btn-sm"
          data-testid="contacts-page-edit"
          onClick={() => useContactsUi.getState().openEdit(contact)}
        >
          <PencilIcon size={14} /> Edit
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="contacts-page-show"
          onClick={showOnBoard}
        >
          <BoardsIcon size={14} /> Show on Board
        </button>
        {list ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            data-testid="contacts-page-send"
            onClick={sendToBoard}
          >
            <ContactIcon size={14} /> Send to Board
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            data-testid="contacts-page-putlist"
            onClick={putInList}
          >
            <ListPlusIcon size={14} /> Put in List
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="contacts-page-export"
          onClick={() => void downloadContactsVcf([contact], useDocumentStore.getState().doc)}
        >
          <DownloadIcon size={14} /> Export
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost btn-danger"
          data-testid="contacts-page-delete"
          onClick={() => void remove()}
        >
          <TrashIcon size={14} /> Delete
        </button>
      </div>
      <ContactDetails item={contact} testId="contacts-page-details" />
      <ConnectedMedia item={contact} testId="contacts-page-media" />
      <label className="contacts-notes">
        <span>Notes</span>
        <textarea
          value={notes}
          rows={5}
          placeholder="Anything to remember about them"
          data-testid="contacts-notes"
          onChange={(e) => onNotes(e.target.value)}
          onBlur={flushNotes}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </label>
    </div>
  );
}
