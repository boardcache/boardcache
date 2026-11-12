import type {
  CanvasDocument,
  ContactField,
  ContactItem,
  ContactlistItem,
  Item,
} from '@boardcache/schema';
import { openUrl } from '../text/itemUrl';
import { safeHttpUrl } from '../text/safeUrl';

/**
 * Contacts: the words a contact card shows and the order a list of them
 * takes. Shared by the canvas card, the thumbnail painter, the Contacts
 * view, the lightbox and the vCard bridge.
 */

/** The card's design size: a business card, 3.5 × 2, at 300 wide. */
export const CONTACT_CARD_W = 300;
export const CONTACT_CARD_H = 170;

/** The contact list's design size: a column of rows that scrolls. */
export const CONTACT_LIST_W = 320;
export const CONTACT_LIST_H = 400;

/** Label choices for a new line, in menu order. */
export const FIELD_LABELS = ['', 'home', 'work', 'mobile', 'main', 'other'] as const;

/** The networks a social line can name, with the page a handle opens. */
export const SOCIAL_NETWORKS: { key: string; label: string; url: (handle: string) => string }[] = [
  { key: 'x', label: 'X', url: (h) => `https://x.com/${h}` },
  { key: 'instagram', label: 'Instagram', url: (h) => `https://www.instagram.com/${h}` },
  { key: 'linkedin', label: 'LinkedIn', url: (h) => `https://www.linkedin.com/in/${h}` },
  { key: 'facebook', label: 'Facebook', url: (h) => `https://www.facebook.com/${h}` },
  { key: 'github', label: 'GitHub', url: (h) => `https://github.com/${h}` },
  {
    key: 'mastodon',
    label: 'Mastodon',
    // `@user@server` lives at https://server/@user; a bare handle has no home.
    url: (h) => {
      const m = /^([^@]+)@(.+)$/.exec(h);
      return m ? `https://${m[2]}/@${m[1]}` : `https://mastodon.social/@${h}`;
    },
  },
  { key: 'bluesky', label: 'Bluesky', url: (h) => `https://bsky.app/profile/${h}` },
  { key: 'threads', label: 'Threads', url: (h) => `https://www.threads.net/@${h}` },
  { key: 'tiktok', label: 'TikTok', url: (h) => `https://www.tiktok.com/@${h}` },
  { key: 'youtube', label: 'YouTube', url: (h) => `https://www.youtube.com/@${h}` },
  { key: 'other', label: 'Other', url: (h) => `https://${h}` },
];

/** A network's name as the card prints it ("LinkedIn"; an unknown key capitalised). */
export function socialLabel(label: string): string {
  const key = label.trim().toLowerCase();
  return SOCIAL_NETWORKS.find((n) => n.key === key)?.label ?? labelText(label);
}

/** Where a social line opens: the value when it is already a URL, else the
 *  network's page for the handle (an `@` in front is dropped). */
function socialHref(f: ContactField): string {
  const v = f.value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return `https://${v}`;
  const handle = v.replace(/^@/, '');
  const net = SOCIAL_NETWORKS.find((n) => n.key === f.label.trim().toLowerCase());
  return net && net.key !== 'other' ? net.url(handle) : `https://${handle}`;
}

type Named = Pick<ContactItem, 'fullName' | 'givenName' | 'familyName' | 'org'>;

/** The name the card shows: the display name, else the parts, else the organisation. */
export function contactName(c: Named): string {
  return (
    c.fullName.trim() ||
    [c.givenName, c.familyName]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ') ||
    c.org.trim() ||
    'Contact'
  );
}

/** Up to two initials for a card without a photo ("AL" for Ada Lovelace). */
export function contactInitials(c: Named): string {
  const name = contactName(c);
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/** Where they work: "Mathematician · Analytical Engines" (either half may be absent). */
export function contactSubline(c: Pick<ContactItem, 'jobTitle' | 'org'>): string {
  return [c.jobTitle.trim(), c.org.trim()].filter(Boolean).join(' · ');
}

/** The one-line detail (lightbox caption): the first email, else the first phone, else where they work. */
export function contactDetailLine(c: ContactItem): string {
  return c.emails[0]?.value ?? c.phones[0]?.value ?? contactSubline(c);
}

/** A label as the card prints it: "Work", "Mobile", "Boat phone". */
export function labelText(label: string): string {
  const s = label.trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : '';
}

/** "December 10, 1815", or "December 10" when the year is unknown. */
export function formatBirthday(b: string | null): string {
  if (!b) return '';
  const noYear = /^--(\d{2})-(\d{2})$/.exec(b);
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
  if (!noYear && !full) return b;
  const [y, m, d] = full
    ? [Number(full[1]), Number(full[2]), Number(full[3])]
    : [2000, Number(noYear![1]), Number(noYear![2])];
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    ...(full ? { year: 'numeric' } : {}),
  });
}

/** The sort key: family name, given name, then the display name. */
function sortKey(c: ContactItem): string {
  const name = contactName(c);
  return `${c.familyName.trim() || name}\u0000${c.givenName.trim()}\u0000${name}`.toLowerCase();
}

/** By last name, then first name; organisations by their name. */
export function sortContacts(items: ContactItem[]): ContactItem[] {
  return [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

/** Every contact on the board, in document order (listed ones included). */
export function boardContacts(doc: CanvasDocument): ContactItem[] {
  return Object.values(doc.items).filter((it): it is ContactItem => it.type === 'contact');
}

/** Every contact list on the board, in document order. */
function boardContactLists(doc: CanvasDocument): ContactlistItem[] {
  return Object.values(doc.items).filter((it): it is ContactlistItem => it.type === 'contactlist');
}

/** The list a contact sits in, when that list is still on the board. */
export function contactListOf(doc: CanvasDocument, item: Item): ContactlistItem | null {
  if (item.type !== 'contact' || !item.listId) return null;
  const list = doc.items[item.listId];
  return list?.type === 'contactlist' ? list : null;
}

/** Is this a contact that lives in a list (a row there, not a card on the canvas)? */
export function inContactList(doc: CanvasDocument, item: Item): boolean {
  return contactListOf(doc, item) !== null;
}

/** The rows of a list: its contacts by last name. */
export function listContacts(doc: CanvasDocument, listId: string): ContactItem[] {
  return sortContacts(boardContacts(doc).filter((c) => c.listId === listId));
}

/** The list new contacts join on a page: the first one there, if any. */
export function defaultContactList(
  doc: CanvasDocument,
  pageId: string | null,
): ContactlistItem | null {
  const first = doc.pages[0]?.id ?? null;
  const lists = boardContactLists(doc).filter((l) => (l.pageId ?? first) === (pageId ?? first));
  return lists.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))[0] ?? null;
}

/** The letter a contact files under in an index (its sort name's first letter, else #). */
export function contactLetter(c: ContactItem): string {
  const ch = (c.familyName.trim() || contactName(c))[0] ?? '';
  return /\p{L}/u.test(ch) ? ch.toUpperCase() : '#';
}

/** Does the contact match a search (name, organisation, any line, notes)? */
export function contactMatches(c: ContactItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const lines = [
    ...c.emails,
    ...c.phones,
    ...c.urls,
    ...c.addresses,
    ...c.socials,
    ...c.fields,
  ].flatMap((f) => [f.label, f.value]);
  return [contactName(c), c.org, c.jobTitle, c.notes ?? '', ...lines].some((s) =>
    s.toLowerCase().includes(q),
  );
}

/** The kinds of line a contact has; `field` is a custom one and opens nothing. */
export type ContactLineKind = 'email' | 'phone' | 'url' | 'address' | 'social' | 'field';

/** The href a line opens with: mailto, tel, the address itself, a map search,
 *  the social profile; a custom field has none. */
export function fieldHref(kind: ContactLineKind, f: ContactField): string {
  switch (kind) {
    case 'email':
      return `mailto:${f.value}`;
    case 'phone':
      return `tel:${f.value.replace(/[^\d+*#]/g, '')}`;
    case 'url':
      // Only a web address opens: a scheme typed (or imported) into the
      // field is not a way to run something.
      return safeHttpUrl(/^[a-z]+:/i.test(f.value) ? f.value : `https://${f.value}`) ?? '';
    case 'address':
      return `https://www.openstreetmap.org/search?query=${encodeURIComponent(f.value)}`;
    case 'social':
      return safeHttpUrl(socialHref(f)) ?? '';
    case 'field':
      return '';
  }
}

/** Open a line: a web address in the browser, a mail or phone link with the
 *  system's handler (a navigation the shells hand to the OS). */
export function openContactHref(href: string): void {
  if (/^https?:/i.test(href)) openUrl(href);
  else if (/^(mailto|tel):/i.test(href)) window.location.assign(href);
}
