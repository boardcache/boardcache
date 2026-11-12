import type { EmailAddress } from '@boardcache/schema';

/**
 * Email files into one shape: RFC 822 messages (.eml, and Apple Mail's
 * .emlx wrapper), mbox mail spools (many messages in one file) and Outlook's
 * binary .msg. The MIME parser and the .msg reader load as lazy chunks the
 * first time a message is read.
 */

interface ParsedAttachment {
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** Content-ID of an inline part the HTML refers to as cid:. */
  cid: string | null;
  /** True for a part the body shows in place (a cid: picture). */
  inline: boolean;
}

export interface ParsedEmail {
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  replyTo: EmailAddress[];
  /** ISO timestamp, or null without a usable Date header. */
  date: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  text: string;
  /** The HTML body as written (unsanitised), or null for a plain message. */
  html: string | null;
  headers: { name: string; value: string }[];
  attachments: ParsedAttachment[];
  /** The message as received; null when it was rebuilt from another format. */
  raw: Uint8Array | null;
}

const EMAIL_EXT = /\.(eml|mbox|mbx|emlx|msg)$/i;
const EMAIL_MIME = new Set(['message/rfc822', 'application/mbox', 'application/vnd.ms-outlook']);

/** A file this importer reads: by extension, or by a mail MIME type. */
export function isEmailFile(file: File): boolean {
  return EMAIL_EXT.test(file.name) || EMAIL_MIME.has(file.type);
}

type Mailbox = {
  name?: string | undefined;
  address?: string | undefined;
  group?: Mailbox[] | undefined;
};

/** Flatten postal-mime's addresses (groups included) into name + address pairs. */
function mailboxes(list: Mailbox[] | Mailbox | undefined): EmailAddress[] {
  if (!list) return [];
  const arr = Array.isArray(list) ? list : [list];
  const out: EmailAddress[] = [];
  for (const m of arr) {
    if (m.group) out.push(...mailboxes(m.group));
    else if (m.address || m.name) out.push({ name: m.name ?? '', address: m.address ?? '' });
  }
  return out;
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

/** Parse one RFC 822 message. */
export async function parseRfc822(raw: Uint8Array): Promise<ParsedEmail> {
  const { default: PostalMime } = await import('postal-mime');
  const email = await PostalMime.parse(raw);
  return {
    subject: email.subject ?? '',
    from: mailboxes(email.from),
    to: mailboxes(email.to),
    cc: mailboxes(email.cc),
    replyTo: mailboxes(email.replyTo),
    date: isoDate(email.date),
    messageId: email.messageId ?? null,
    inReplyTo: email.inReplyTo ?? null,
    text: email.text ?? '',
    html: email.html ?? null,
    headers: email.headers.map((h) => ({ name: h.originalKey || h.key, value: h.value })),
    attachments: email.attachments.map((a) => ({
      name: a.filename || 'attachment',
      mime: a.mimeType || 'application/octet-stream',
      bytes: toBytes(a.content),
      cid: a.contentId ? a.contentId.replace(/^<|>$/g, '') : null,
      inline: a.disposition === 'inline' || a.related === true,
    })),
    raw,
  };
}

const FROM_ = [0x46, 0x72, 0x6f, 0x6d, 0x20]; // "From "

function startsWithFrom(bytes: Uint8Array, at: number): boolean {
  for (let i = 0; i < FROM_.length; i++) if (bytes[at + i] !== FROM_[i]) return false;
  return true;
}

/** Cut an mbox spool into its messages ("From " lines separate them). */
export function splitMbox(bytes: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  if (startsWithFrom(bytes, 0)) starts.push(0);
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a && startsWithFrom(bytes, i + 1)) starts.push(i + 1);
  }
  if (starts.length === 0) return bytes.length ? [bytes] : [];
  const out: Uint8Array[] = [];
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k]!;
    const to = k + 1 < starts.length ? starts[k + 1]! : bytes.length;
    // Drop the "From " line itself; the message starts on the next line.
    let lineEnd = from;
    while (lineEnd < to && bytes[lineEnd] !== 0x0a) lineEnd++;
    const body = bytes.subarray(Math.min(to, lineEnd + 1), to);
    if (body.some((b) => b !== 0x0a && b !== 0x0d && b !== 0x20)) out.push(body);
  }
  return out;
}

/** Apple Mail's .emlx: a byte count on the first line, the message, then a plist. */
export function unwrapEmlx(bytes: Uint8Array): Uint8Array {
  let nl = 0;
  while (nl < bytes.length && bytes[nl] !== 0x0a) nl++;
  const count = Number(new TextDecoder().decode(bytes.subarray(0, nl)).trim());
  const start = nl + 1;
  if (Number.isFinite(count) && count > 0 && start + count <= bytes.length)
    return bytes.subarray(start, start + count);
  return bytes.subarray(start);
}

/** Outlook's .msg, read with the OLE reader into the same shape. */
async function parseOutlookMsg(bytes: Uint8Array): Promise<ParsedEmail> {
  const { default: MsgReader } = await import('@kenjiuno/msgreader');
  const reader = new MsgReader(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const data = reader.getFileData();
  const html = data.bodyHtml ?? (data.html ? new TextDecoder().decode(data.html) : null);
  const recipients = (data.recipients ?? []).map((r) => ({
    kind: r.recipType ?? 'to',
    who: { name: r.name ?? '', address: r.email ?? '' },
  }));
  const headers: { name: string; value: string }[] = [];
  for (const line of (data.headers ?? '').split(/\r?\n(?!\s)/)) {
    const at = line.indexOf(':');
    if (at > 0) headers.push({ name: line.slice(0, at).trim(), value: line.slice(at + 1).trim() });
  }
  if (headers.length === 0) {
    if (data.senderEmail || data.senderName)
      headers.push({ name: 'From', value: `${data.senderName ?? ''} <${data.senderEmail ?? ''}>` });
    if (data.subject) headers.push({ name: 'Subject', value: data.subject });
  }
  const attachments: ParsedAttachment[] = [];
  for (const a of data.attachments ?? []) {
    if (a.attachmentHidden) continue;
    try {
      const file = reader.getAttachment(a);
      attachments.push({
        name: file.fileName || a.fileName || a.fileNameShort || 'attachment',
        mime: 'application/octet-stream',
        bytes: file.content,
        cid: a.pidContentId ?? null,
        inline: !!a.pidContentId,
      });
    } catch {
      /* an attachment the reader cannot open is left out */
    }
  }
  return {
    subject: data.subject ?? '',
    from:
      data.senderEmail || data.senderName
        ? [{ name: data.senderName ?? '', address: data.senderEmail ?? '' }]
        : [],
    to: recipients.filter((r) => r.kind === 'to').map((r) => r.who),
    cc: recipients.filter((r) => r.kind === 'cc').map((r) => r.who),
    replyTo: [],
    date: isoDate(data.messageDeliveryTime),
    messageId: null,
    inReplyTo: null,
    text: data.body ?? '',
    html: html || null,
    headers,
    attachments,
    raw: null,
  };
}

/** Every message in a file, by its kind. */
export async function parseEmailFile(file: File): Promise<ParsedEmail[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith('.msg') || file.type === 'application/vnd.ms-outlook')
    return [await parseOutlookMsg(bytes)];
  if (name.endsWith('.emlx')) return [await parseRfc822(unwrapEmlx(bytes))];
  if (name.endsWith('.mbox') || name.endsWith('.mbx') || file.type === 'application/mbox') {
    const out: ParsedEmail[] = [];
    for (const part of splitMbox(bytes)) out.push(await parseRfc822(part));
    return out;
  }
  return [await parseRfc822(bytes)];
}
