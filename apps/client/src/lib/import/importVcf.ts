import type { ContactItem } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { putAsset } from '../board/assetStore';
import type { ContactlistItem } from '@boardcache/schema';
import { activePageId } from '../board/pages';
import { findOpenSpot } from '../canvas/placeSpot';
import {
  CONTACT_CARD_H,
  CONTACT_CARD_W,
  CONTACT_LIST_H,
  CONTACT_LIST_W,
  defaultContactList,
} from '../structure/contacts';
import { parseVcf } from '../structure/vcard';
import type { VcardContact } from '../structure/vcard';
import { showNotice } from '../notices';
import { addItems, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { buildContactItem, buildContactListItem } from './createItems';

/**
 * vCard import: every card in a dropped, picked or pasted .vcf becomes a
 * contact, in one undo step. Several contacts, or one when the page already
 * keeps a contact list, file into a list (the page's list, else a new one
 * at the drop point); a single contact on a page without a list lands as a
 * card. An inline photo is stored as an asset; a photo the card only links
 * to is left out (the card shows initials).
 */

/** Where new contacts go: `list` files them, `cards` lays them out, `auto`
 *  (the default) files several, or any when the page has a list. */
export type ContactPlacement = 'auto' | 'list' | 'cards';

/** The list new contacts file into, when the placement says so: the page's
 *  list, else a new one at `point` (added by the caller's command). */
function contactListFor(
  placement: ContactPlacement,
  count: number,
  point: Point,
  z: number,
): { list: ContactlistItem; fresh: boolean } | null {
  if (placement === 'cards') return null;
  const { doc } = useDocumentStore.getState();
  const existing = defaultContactList(doc, activePageId(doc));
  if (existing) return { list: existing, fresh: false };
  if (placement === 'auto' && count < 2) return null;
  const at = findOpenSpot(doc, point, CONTACT_LIST_W, CONTACT_LIST_H);
  const page = activePageId(doc);
  return {
    list: buildContactListItem(
      { x: at.x - CONTACT_LIST_W / 2, y: at.y - CONTACT_LIST_H / 2 },
      page ? { pageId: page } : {},
      z,
    ),
    fresh: true,
  };
}

export function isVcfFile(f: File): boolean {
  return f.type === 'text/vcard' || f.type === 'text/x-vcard' || /\.vcf$/i.test(f.name);
}

export async function importVcfFiles(files: File[], point: Point): Promise<string[]> {
  const ids: string[] = [];
  for (const file of files) ids.push(...(await importVcfText(await file.text(), point)));
  return ids;
}

function base64Blob(base64: string, mime: string): Blob | null {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

async function storePhoto(card: VcardContact): Promise<string | null> {
  if (!card.photo?.base64) return null;
  const blob = base64Blob(card.photo.base64, card.photo.mime || 'image/jpeg');
  if (!blob || blob.size === 0) return null;
  try {
    return await putAsset(blob);
  } catch {
    return null;
  }
}

/** Contacts for the vCard text; ids of what landed (empty = nothing readable). */
export async function importVcfText(
  text: string,
  point: Point,
  placement: ContactPlacement = 'auto',
): Promise<string[]> {
  const cards = parseVcf(text);
  if (cards.length === 0) {
    showNotice('No contacts found in that file.');
    return [];
  }
  const photos = await Promise.all(cards.map(storePhoto));
  const { doc } = useDocumentStore.getState();
  const cols = Math.ceil(Math.sqrt(cards.length));
  const gap = 24;
  let z = topZIndex(doc) + 1;
  const target = contactListFor(placement, cards.length, point, z++);
  const list = target?.list ?? null;
  const items: ContactItem[] = cards.map((card, i) =>
    buildContactItem(
      list
        ? { x: list.x, y: list.y }
        : {
            x: point.x + (i % cols) * (CONTACT_CARD_W + gap),
            y: point.y + Math.floor(i / cols) * (CONTACT_CARD_H + gap),
          },
      {
        listId: list?.id ?? null,
        socials: card.socials,
        fields: card.fields,
        fullName: card.fullName,
        givenName: card.givenName,
        familyName: card.familyName,
        org: card.org,
        jobTitle: card.jobTitle,
        emails: card.emails,
        phones: card.phones,
        urls: card.urls,
        addresses: card.addresses,
        birthday: card.birthday,
        uid: card.uid,
        photoAssetId: photos[i] ?? null,
        ...(card.notes ? { notes: card.notes } : {}),
      },
      z++,
    ),
  );
  addItems(
    target?.fresh ? [target.list, ...items] : items,
    cards.length === 1 ? 'Import contact' : `Import ${cards.length} contacts`,
  );
  const ids = items.map((it) => it.id);
  useSessionStore.getState().setSelection(list ? [list.id] : ids);
  return ids;
}
