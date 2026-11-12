import type { CanvasDocument, ContactItem } from '@boardcache/schema';
import { getAssetBlob } from '../board/assetStore';
import { contactName } from '../structure/contacts';
import { writeVcf } from '../structure/vcard';
import type { VcardWriteContact } from '../structure/vcard';
import { downloadBlob, exportFileName } from './download';

/** A photo's bytes as base64, for the card's PHOTO line. */
async function photoOf(item: ContactItem): Promise<{ mime: string; base64: string } | null> {
  if (!item.photoAssetId) return null;
  try {
    const blob = await getAssetBlob(item.photoAssetId);
    if (!blob || blob.size === 0) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { mime: blob.type || 'image/jpeg', base64: btoa(bin) };
  } catch {
    return null;
  }
}

function writeShape(item: ContactItem): Omit<VcardWriteContact, 'photo'> {
  return {
    uid: item.uid,
    fullName: contactName(item),
    givenName: item.givenName,
    familyName: item.familyName,
    org: item.org,
    jobTitle: item.jobTitle,
    emails: item.emails,
    phones: item.phones,
    urls: item.urls,
    addresses: item.addresses,
    birthday: item.birthday,
    socials: item.socials,
    fields: item.fields,
    notes: item.notes ?? '',
  };
}

/** The vCard text for these contacts, photos inline when their bytes are at hand. */
async function contactsVcf(items: ContactItem[]): Promise<string> {
  const photos = await Promise.all(items.map(photoOf));
  return writeVcf(items.map((it, i) => ({ ...writeShape(it), photo: photos[i] ?? null })));
}

/** The vCard text without photos (synchronous, for the assistant). */
export function contactsVcfText(items: ContactItem[]): string {
  return writeVcf(items.map((it) => ({ ...writeShape(it), photo: null })));
}

/** Save one contact, or every contact on the board, as a .vcf file. */
export async function downloadContactsVcf(
  items: ContactItem[],
  doc: CanvasDocument,
): Promise<void> {
  if (items.length === 0) return;
  const base =
    items.length === 1 ? items[0]!.name || contactName(items[0]!) : doc.name || 'contacts';
  const text = await contactsVcf(items);
  downloadBlob(
    new Blob([text], { type: 'text/vcard;charset=utf-8' }),
    exportFileName(undefined, base, 'vcf'),
  );
}
