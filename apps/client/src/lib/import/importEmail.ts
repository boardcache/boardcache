import type { EmailAttachment } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { putAsset } from '../board/assetStore';
import { EMAIL_CARD_H, EMAIL_CARD_W } from '../mail/email';
import { parseEmailFile, type ParsedEmail } from '../mail/parseEmail';
import { MAX_EMAIL_HTML, sanitizeEmailHtml } from '../mail/sanitizeEmailHtml';
import { textFromHtml } from '../text/safeUrl';
import { showNotice } from '../notices';
import { createEmailItem } from './createItems';

export { isEmailFile } from '../mail/parseEmail';

/** A byte view as a Blob part (its own buffer, never a shared one). */
const bytesPart = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** The largest attachment kept as an asset; bigger ones are listed without bytes. */
const MAX_ATTACHMENT = 25 * 1024 * 1024;

/**
 * Dropped, picked or pasted email files (.eml, .emlx, .mbox, .msg) become
 * email cards: the message as received is an asset, each attachment an
 * asset of its own, and the parsed fields live on the item.
 */
export async function importEmailFiles(files: File[], point: Point): Promise<string[]> {
  const ids: string[] = [];
  let n = 0;
  for (const file of files) {
    let messages: ParsedEmail[];
    try {
      messages = await parseEmailFile(file);
    } catch (err) {
      console.error('boardCache: email import failed', err);
      showNotice(`“${file.name}” could not be read as an email.`, { kind: 'warn' });
      continue;
    }
    if (messages.length === 0) showNotice(`“${file.name}” holds no messages.`);
    for (const m of messages) {
      // Several messages (an mbox): a grid from the drop point.
      const at = {
        x: point.x + (n % 3) * (EMAIL_CARD_W + 24),
        y: point.y + Math.floor(n / 3) * (EMAIL_CARD_H + 24),
      };
      ids.push(await addParsedEmail(m, at));
      n++;
    }
  }
  return ids;
}

/** Put a parsed message on the board at `at`; returns the item's id. */
export async function addParsedEmail(
  m: ParsedEmail,
  at: Point,
  extra: { folder?: string; source?: { account: string; mailbox: string } } = {},
): Promise<string> {
  const assetId = m.raw
    ? await putAsset(new Blob([bytesPart(m.raw)], { type: 'message/rfc822' }))
    : null;
  const attachments: EmailAttachment[] = [];
  for (const a of m.attachments) {
    const size = a.bytes.byteLength;
    const id =
      size <= MAX_ATTACHMENT
        ? await putAsset(new Blob([bytesPart(a.bytes)], { type: a.mime }))
        : null;
    attachments.push({ name: a.name, mime: a.mime, size, assetId: id, cid: a.cid });
  }
  const html = m.html && m.html.length <= MAX_EMAIL_HTML ? sanitizeEmailHtml(m.html) : null;
  const text = m.text.trim() || (m.html ? textFromHtml(m.html).replace(/\s+/g, ' ').trim() : '');
  return createEmailItem(at, {
    subject: m.subject,
    from: m.from,
    to: m.to,
    cc: m.cc,
    replyTo: m.replyTo,
    date: m.date,
    messageId: m.messageId,
    text,
    html,
    headers: m.headers,
    attachments,
    assetId,
    ...(extra.folder ? { folder: extra.folder } : {}),
    ...(extra.source ? { mailSource: extra.source } : {}),
  });
}
