import type { EmailItem } from '@boardcache/schema';
import { EmailContent } from '../components/items/EmailContent';
import { EmailReader, emailViewOfItem } from '../components/items/EmailReader';
import { cardZoom } from '../lib/canvas/cardZoom';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import {
  addressList,
  EMAIL_CARD_W,
  emailSender,
  emailSnippet,
  emailTitle,
  formatEmailDate,
} from '../lib/mail/email';
import { emailFrameDocument } from '../lib/mail/sanitizeEmailHtml';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { baseText, join } from '../lib/search/extract';
import { defineItemType } from './registry';
import type { MetaOverride, StageProps } from './registry';

function EmailCard({ item }: { item: EmailItem }) {
  return (
    <span className="gallery-email" data-testid="gallery-email-thumb">
      <EmailContent item={item} mode="fit" />
    </span>
  );
}

/** The lightbox: the message in the reader, as wide as the stage. */
function Stage({ item }: StageProps<EmailItem>) {
  return (
    <div className="lightbox-email" onClick={(e) => e.stopPropagation()}>
      <EmailReader message={emailViewOfItem(item)} />
    </div>
  );
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Greedy word wrap for the painter. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, max: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
      if (lines.length === max) return lines;
    }
  }
  if (line && lines.length < max) lines.push(line);
  return lines;
}

/** Board thumbnail / snapshot painter: the card at its design size, zoomed
 *  like the card (the CSS sizes, mirrored). */
function paint(item: EmailItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  const k = cardZoom(item);
  const W = item.width / Math.max(0.01, k);
  const H = item.height / Math.max(0.01, k);
  const font = 'Inter, system-ui, sans-serif';
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, W - 1, H - 1, 12);
  ctx.fillStyle = p.card.bg;
  ctx.fill();
  ctx.strokeStyle = p.dark ? 'rgba(230,232,236,0.26)' : 'rgba(35,39,46,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();
  const pad = 18;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // The head: sender on the left, the date on the right.
  ctx.fillStyle = p.card.sub;
  ctx.font = `500 13px ${font}`;
  const date = formatEmailDate(item.date);
  const dateW = date ? ctx.measureText(date).width : 0;
  ctx.fillText(ellipsize(ctx, emailSender(item), W - pad * 2 - dateW - 10), pad, 16 + 8);
  if (date) {
    ctx.textAlign = 'right';
    ctx.fillText(date, W - pad, 16 + 8);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = p.card.text;
  ctx.font = `700 17px ${font}`;
  let ty = 16 + 8 + 28;
  for (const line of wrapLines(ctx, item.subject.trim() || '(No subject)', W - pad * 2, 2)) {
    ctx.fillText(line, pad, ty);
    ty += 22;
  }
  ctx.fillStyle = p.card.sub;
  ctx.font = `400 13px ${font}`;
  ty += 4;
  const room = Math.max(0, Math.floor((H - ty - 14) / 19));
  for (const line of wrapLines(ctx, emailSnippet(item.text, 400), W - pad * 2, room)) {
    ctx.fillText(line, pad, ty);
    ty += 19;
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: EmailItem): Extracted {
  return {
    title: emailTitle(item),
    body: join(
      addressList(item.from),
      addressList(item.to),
      addressList(item.cc),
      item.text,
      ...item.attachments.map((a) => a.name),
      baseText(item),
    ),
  };
}

/** Lightbox-panel / caption metadata: the subject and the sender with the date. */
function meta(item: EmailItem, base: { title: string }): MetaOverride {
  const date = formatEmailDate(item.date, true);
  return {
    title: item.name?.trim() || item.subject.trim() || base.title,
    detail: [emailSender(item), date].filter(Boolean).join(' · ') || null,
  };
}

/** The item's own window (File → Pop Out): the envelope and the body in a
 *  frame under the same policy as the reader's. */
function popout(item: EmailItem, _p: PopoutContext): string {
  const row = (label: string, value: string) =>
    value ? `<div class="erow"><b>${label}</b> ${escapeHtml(value)}</div>` : '';
  const body = item.html
    ? `<iframe class="eframe" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc="${escapeHtml(emailFrameDocument(item.html))}"></iframe>`
    : `<pre class="etext">${escapeHtml(item.text)}</pre>`;
  return (
    `<div class="email"><h1>${escapeHtml(item.subject.trim() || '(No subject)')}</h1>` +
    row('From', addressList(item.from)) +
    row('To', addressList(item.to)) +
    row('Cc', addressList(item.cc)) +
    row('Date', formatEmailDate(item.date, true)) +
    `${body}</div>`
  );
}

export const emailType = defineItemType('email', {
  popout,
  edit: null, // a message is read, not edited; Rename and the notes are the metadata's
  pdfCategory: null, // the Asset PDF prints media and notes; messages stay in their .eml
  meta,
  label: 'Email',
  searchText,
  thumbnail: paint,
  render: EmailContent,
  card: EmailCard,
  stage: Stage,
  cardAspect: () => 240 / EMAIL_CARD_W,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
