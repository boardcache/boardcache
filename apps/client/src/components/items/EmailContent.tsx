import type { EmailItem } from '@boardcache/schema';
import {
  addressShort,
  EMAIL_CARD_W,
  emailSender,
  emailSnippet,
  formatEmailDate,
} from '../../lib/mail/email';
import { MailIcon, PaperclipIcon } from '../icons';
import { FittedCard, ScaledCard } from './ScaledCard';

/**
 * The email card: who it is from and when, the subject, the first lines of
 * the text, and the attachment count. The card is a summary; the lightbox
 * and the Email view show the message itself. One component draws the
 * canvas item (ScaledCard), the gallery card (fitted) and a plain copy.
 */

function Card({ item }: { item: EmailItem }) {
  const to = item.to.map(addressShort).filter(Boolean);
  // Pictures the body shows in place are not what the foot counts.
  const files = item.attachments.filter((a) => !a.cid);
  return (
    <div className="email-item" data-testid="email-item">
      <div className="email-item-head">
        <span className="email-item-from" data-testid="email-item-from">
          <MailIcon size={14} />
          {emailSender(item)}
        </span>
        <span className="email-item-date">{formatEmailDate(item.date)}</span>
      </div>
      <div className="email-item-subject" data-testid="email-item-subject">
        {item.subject.trim() || '(No subject)'}
      </div>
      {to.length > 0 && <div className="email-item-to">To {to.join(', ')}</div>}
      <div className="email-item-snippet" data-testid="email-item-snippet">
        {emailSnippet(item.text, 400) || (item.html ? 'HTML message' : '')}
      </div>
      {files.length > 0 && (
        <div className="email-item-foot" data-testid="email-item-attachments">
          <PaperclipIcon size={12} />
          {files.length === 1 ? files[0]!.name : `${files.length} attachments`}
        </div>
      )}
    </div>
  );
}

export function EmailContent({
  item,
  mode = 'canvas',
}: {
  item: EmailItem;
  /** canvas: zoomed like other cards; fit: scaled to the holding box; plain: as is. */
  mode?: 'canvas' | 'fit' | 'plain';
}) {
  if (mode === 'fit')
    return (
      <FittedCard baseW={EMAIL_CARD_W}>
        <Card item={item} />
      </FittedCard>
    );
  if (mode === 'plain') return <Card item={item} />;
  return (
    <ScaledCard item={item} baseW={EMAIL_CARD_W}>
      <Card item={item} />
    </ScaledCard>
  );
}
