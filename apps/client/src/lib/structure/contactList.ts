import type { CanvasDocument, ContactItem, Item } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { findOpenSpot } from '../canvas/placeSpot';
import { runCommand, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { CONTACT_CARD_H, CONTACT_CARD_W, contactListOf, sortContacts } from './contacts';

/**
 * Contact lists: a card on the canvas that holds contacts as rows. A listed
 * contact stays a real item (the Contacts view, the tools and the lightbox
 * reach it by id); only its place on the canvas is the list, so the canvas
 * does not draw it (lib/board/pages `pageItems`). Dropping a card on a list
 * files it; sending a row to the board makes it a card again beside the
 * list. Deleting a list deletes its rows (state/commands removeItems).
 */

export interface ContactListTarget {
  itemId: string;
}

const CAPTURE_PAD = 12;

/** The contact list under a canvas point, when the dragged items can file
 *  into it (they are contacts and the list is not among them). */
export function contactListAt(
  doc: CanvasDocument,
  pt: Point,
  dragged: ReadonlySet<string>,
): ContactListTarget | null {
  let hasContact = false;
  for (const id of dragged) if (doc.items[id]?.type === 'contact') hasContact = true;
  if (!hasContact) return null;
  let best: { id: string; z: number } | null = null;
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'contactlist' || item.locked || dragged.has(item.id)) continue;
    if (
      pt.x < item.x - CAPTURE_PAD ||
      pt.x > item.x + item.width + CAPTURE_PAD ||
      pt.y < item.y - CAPTURE_PAD ||
      pt.y > item.y + item.height + CAPTURE_PAD
    )
      continue;
    if (!best || item.zIndex > best.z) best = { id: item.id, z: item.zIndex };
  }
  return best ? { itemId: best.id } : null;
}

/** The contacts among `ids` (the rest are left alone). */
function contactsAmong(doc: CanvasDocument, ids: string[]): ContactItem[] {
  return ids.map((id) => doc.items[id]).filter((it): it is ContactItem => it?.type === 'contact');
}

/** File contacts into a list: they leave the canvas and become rows. */
export function attachContactsToList(ids: string[], listId: string, label = 'Add to list'): void {
  runCommand(label, (draft) => {
    const list = draft.items[listId];
    if (list?.type !== 'contactlist') return;
    for (const c of contactsAmong(draft, ids)) {
      c.listId = listId;
      // Parked under the list, so a copy or a send lands near it.
      c.x = list.x;
      c.y = list.y;
      c.groupId = null;
      c.pageId = list.pageId;
    }
  });
  const session = useSessionStore.getState();
  if (session.selection.some((id) => ids.includes(id))) session.setSelection([listId]);
}

/** Take contacts out of their lists onto the board, as cards beside the
 *  list, and select them. Returns the ids that moved. */
export function sendContactsToBoard(ids: string[], label = 'Send to board'): string[] {
  const { doc } = useDocumentStore.getState();
  const moving = sortContacts(contactsAmong(doc, ids).filter((c) => contactListOf(doc, c)));
  if (moving.length === 0) return [];
  const placed = new Map<string, Point>();
  const reserved: { x: number; y: number; width: number; height: number }[] = [];
  for (const c of moving) {
    const list = contactListOf(doc, c)!;
    const w = c.width || CONTACT_CARD_W;
    const h = c.height || CONTACT_CARD_H;
    // Centre of the first open spot to the right of the list.
    const at = findOpenSpot(
      doc,
      { x: list.x + list.width + 24 + w / 2, y: list.y + h / 2 },
      w,
      h,
      reserved,
    );
    const p = { x: at.x - w / 2, y: at.y - h / 2 };
    placed.set(c.id, p);
    reserved.push({ x: p.x, y: p.y, width: w, height: h });
  }
  runCommand(label, (draft) => {
    let z = topZIndex(draft) + 1;
    for (const c of moving) {
      const d = draft.items[c.id];
      const p = placed.get(c.id);
      if (d?.type !== 'contact' || !p) continue;
      d.listId = null;
      d.x = p.x;
      d.y = p.y;
      d.zIndex = z++;
    }
  });
  const out = moving.map((c) => c.id);
  useSessionStore.getState().setSelection(out);
  return out;
}

/** Clone remap (duplicate/paste/transfer): rows follow their list's clone;
 *  a row whose list did not travel arrives as a card. */
export function remapClonedContactLists(clones: Item[], idMap: ReadonlyMap<string, string>): void {
  for (const clone of clones) {
    if (clone.type !== 'contact' || !clone.listId) continue;
    clone.listId = idMap.get(clone.listId) ?? null;
  }
}

/** The ids a list carries with it (copy, delete, send): its rows. */
export function listedContactIds(doc: CanvasDocument, listIds: Iterable<string>): string[] {
  const lists = new Set(listIds);
  return Object.values(doc.items)
    .filter((it) => it.type === 'contact' && it.listId !== null && lists.has(it.listId))
    .map((it) => it.id);
}
