import type { CanvasDocument, EmailAddress, EmailItem } from '@boardcache/schema';
import { cleanFolderPath } from '../structure/folders';

/**
 * The email item's small vocabulary: the card's design size, how a mailbox
 * prints, the sender line, the snippet, dates and sizes. Shared by the card,
 * the reader, the painter and the Email view.
 */

/** The card's design width and height; it is zoomed like the other cards. */
export const EMAIL_CARD_W = 360;
export const EMAIL_CARD_H = 240;

/** `Name <address>`, or the address alone. */
function addressText(a: EmailAddress): string {
  const name = a.name.trim();
  const address = a.address.trim();
  if (name && address) return `${name} <${address}>`;
  return name || address;
}

/** The name when there is one, else the address. */
export function addressShort(a: EmailAddress): string {
  return a.name.trim() || a.address.trim();
}

export const addressList = (list: EmailAddress[]): string => list.map(addressText).join(', ');

export function emailSender(item: Pick<EmailItem, 'from'>): string {
  const first = item.from[0];
  return first ? addressShort(first) || 'Unknown sender' : 'Unknown sender';
}

/** The reader's and the lightbox's title: the item's own name, else the subject. */
export function emailTitle(item: Pick<EmailItem, 'name' | 'subject'>): string {
  return item.name?.trim() || item.subject.trim() || '(No subject)';
}

/** The first words of the text, one line, for cards and lists. */
export function emailSnippet(text: string, max = 300): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** A short date for lists (time today, the date otherwise) or the full one. */
export function formatEmailDate(iso: string | null, long = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (long) return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Every email on the board, newest first. */
export function boardEmails(doc: CanvasDocument): EmailItem[] {
  return Object.values(doc.items)
    .filter((i): i is EmailItem => i.type === 'email')
    .sort(
      (a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.subject.localeCompare(b.subject),
    );
}

export const emailFolderOf = (item: EmailItem): string => cleanFolderPath(item.folder ?? '');

/** Every header line as a text block, for the full-headers view and the download. */
export function headersText(item: Pick<EmailItem, 'headers'>): string {
  return item.headers.map((h) => `${h.name}: ${h.value}`).join('\n');
}
