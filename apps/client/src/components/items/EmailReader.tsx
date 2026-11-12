import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EmailAddress, EmailAttachment } from '@boardcache/schema';
import { getAssetBlob } from '../../lib/board/assetStore';
import { downloadBlob } from '../../lib/export/download';
import { addressList, formatBytes, formatEmailDate } from '../../lib/mail/email';
import { emailFrameDocument } from '../../lib/mail/sanitizeEmailHtml';
import { ChevronDownIcon, ChevronUpIcon, DetailsIcon, ImageIcon, PaperclipIcon } from '../icons';

/**
 * The message as a reader: the subject and the envelope, the actions a
 * host adds (reply, save, delete), the attachments, the full headers on
 * request, and the body — HTML in a sandboxed frame under its own content
 * policy (remote pictures blocked until asked), or the text as written.
 * The lightbox stage and the Email view both show messages through it.
 */

/** Whether the envelope shows To, Cc and Reply to; phones start folded. */
const DETAILS_KEY = 'boardcache:emailDetails';
function readDetailsPref(): boolean {
  try {
    const v = localStorage.getItem(DETAILS_KEY);
    if (v === 'open') return true;
    if (v === 'folded') return false;
  } catch {
    /* private mode */
  }
  return !window.matchMedia('(max-width: 760px)').matches;
}

/** What the reader shows: an email item, or a message fetched from an account. */
export interface EmailView {
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  replyTo: EmailAddress[];
  date: string | null;
  text: string;
  /** Sanitised HTML, or null for a plain message. */
  html: string | null;
  headers: { name: string; value: string }[];
  attachments: (Pick<EmailAttachment, 'name' | 'mime' | 'size' | 'cid'> & {
    /** The part's bytes, when they are to be had. */
    load: () => Promise<Blob | null>;
  })[];
}

/** An email item as the reader's view (attachments come from the asset store). */
export function emailViewOfItem(item: {
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  replyTo: EmailAddress[];
  date: string | null;
  text: string;
  html: string | null;
  headers: { name: string; value: string }[];
  attachments: EmailAttachment[];
}): EmailView {
  return {
    subject: item.subject,
    from: item.from,
    to: item.to,
    cc: item.cc,
    replyTo: item.replyTo,
    date: item.date,
    text: item.text,
    html: item.html,
    headers: item.headers,
    attachments: item.attachments.map((a) => ({
      name: a.name,
      mime: a.mime,
      size: a.size,
      cid: a.cid,
      load: async () => (a.assetId ? ((await getAssetBlob(a.assetId)) ?? null) : null),
    })),
  };
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** The sandbox the body's frame runs in: no scripts, no origin, no forms;
 *  links may open a new tab. */
const EMAIL_FRAME_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';

export function EmailReader({
  message,
  actions,
  testId = 'email-reader',
}: {
  message: EmailView;
  /** Buttons the host puts before the reader's own (reply, save, delete). */
  actions?: ReactNode;
  testId?: string;
}) {
  const [showHeaders, setShowHeaders] = useState(false);
  const [remoteImages, setRemoteImages] = useState(false);
  const [details, setDetails] = useState(readDetailsPref);
  const toggleDetails = () =>
    setDetails((v) => {
      try {
        localStorage.setItem(DETAILS_KEY, v ? 'folded' : 'open');
      } catch {
        /* private mode */
      }
      return !v;
    });
  const foldable = message.to.length + message.cc.length + message.replyTo.length > 0;
  // Inline parts (cid:) become data URLs for the frame.
  const [cid, setCid] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const inline = message.attachments.filter((a) => a.cid);
    if (!inline.length || !message.html) return;
    void (async () => {
      const map: Record<string, string> = {};
      for (const a of inline) {
        const blob = await a.load();
        if (blob && blob.size <= 4 * 1024 * 1024) map[a.cid!] = await blobToDataUrl(blob);
      }
      if (alive) setCid(map);
    })();
    return () => {
      alive = false;
    };
  }, [message]);
  const frameDoc = useMemo(
    () => (message.html ? emailFrameDocument(message.html, { remoteImages, cid }) : null),
    [message.html, remoteImages, cid],
  );
  const hasRemote = !!message.html && /\b(src|url\()\s*=?\s*["']?https?:/i.test(message.html);
  const download = async (a: EmailView['attachments'][number]) => {
    const blob = await a.load();
    if (blob) downloadBlob(blob, a.name);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="email-reader" data-testid={testId} onPointerDown={stop}>
      <div className="email-reader-head">
        <h2 className="email-reader-subject" data-testid="email-reader-subject">
          {message.subject.trim() || '(No subject)'}
        </h2>
        <div className="email-envelope-wrap">
          <dl className="email-envelope" data-testid="email-envelope">
            {message.from.length > 0 && (
              <>
                <dt>From</dt>
                <dd data-testid="email-envelope-from">{addressList(message.from)}</dd>
              </>
            )}
            {details && message.to.length > 0 && (
              <>
                <dt>To</dt>
                <dd>{addressList(message.to)}</dd>
              </>
            )}
            {details && message.cc.length > 0 && (
              <>
                <dt>Cc</dt>
                <dd>{addressList(message.cc)}</dd>
              </>
            )}
            {details && message.replyTo.length > 0 && (
              <>
                <dt>Reply to</dt>
                <dd>{addressList(message.replyTo)}</dd>
              </>
            )}
            {message.date && (
              <>
                <dt>Date</dt>
                <dd>{formatEmailDate(message.date, true)}</dd>
              </>
            )}
          </dl>
          {foldable && (
            <button
              type="button"
              className="email-envelope-toggle"
              aria-expanded={details}
              aria-label={details ? 'Hide details' : 'Show details'}
              title={details ? 'Hide details' : 'Show details'}
              data-testid="email-envelope-toggle"
              onClick={toggleDetails}
            >
              {details ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
            </button>
          )}
        </div>
        <div className="email-reader-actions">
          {actions}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            aria-pressed={showHeaders}
            data-testid="email-headers-toggle"
            title={showHeaders ? 'Hide Headers' : 'Headers'}
            onClick={() => setShowHeaders((v) => !v)}
          >
            <DetailsIcon size={14} />{' '}
            <span className="email-action-label">{showHeaders ? 'Hide Headers' : 'Headers'}</span>
          </button>
          {hasRemote && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-pressed={remoteImages}
              data-testid="email-remote-images"
              title={remoteImages ? 'Hide Remote Images' : 'Load Remote Images'}
              onClick={() => setRemoteImages((v) => !v)}
            >
              <ImageIcon size={14} />{' '}
              <span className="email-action-label">
                {remoteImages ? 'Hide Remote Images' : 'Load Remote Images'}
              </span>
            </button>
          )}
        </div>
        {message.attachments.length > 0 && (
          <div className="email-attachments" data-testid="email-attachments">
            {message.attachments.map((a, i) => (
              <button
                key={`${a.name}-${i}`}
                type="button"
                className="email-attachment"
                data-testid="email-attachment"
                title={`${a.mime} · ${formatBytes(a.size)}`}
                onClick={() => void download(a)}
              >
                <PaperclipIcon size={13} />
                <span className="email-attachment-name">{a.name}</span>
                <span className="email-attachment-size">{formatBytes(a.size)}</span>
              </button>
            ))}
          </div>
        )}
        {showHeaders && (
          <pre className="email-headers" data-testid="email-headers">
            {message.headers.map((h) => `${h.name}: ${h.value}`).join('\n') ||
              'No headers were kept.'}
          </pre>
        )}
      </div>
      {frameDoc ? (
        <iframe
          className="email-frame"
          data-testid="email-frame"
          srcDoc={frameDoc}
          sandbox={EMAIL_FRAME_SANDBOX}
          referrerPolicy="no-referrer"
          title={message.subject || 'Message'}
        />
      ) : (
        <pre className="email-text" data-testid="email-text">
          {message.text || 'This message has no text.'}
        </pre>
      )}
    </div>
  );
}
