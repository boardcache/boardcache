import { useCallback, useRef, useState } from 'react';
import {
  BoldIcon,
  CodeIcon,
  HeadingIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  StrikethroughIcon,
  TextQuoteIcon,
} from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { promptText } from '../../components/ui/Prompt';
import {
  applyMarkdownTool,
  markdownToHtml,
  plainToHtml,
  type ComposeFormat,
  type ComposeTool,
} from '../../lib/mail/composeBody';
import { sanitizeEmailHtml } from '../../lib/mail/sanitizeEmailHtml';
import { showNotice } from '../../lib/notices';
import { textFromHtml } from '../../lib/text/safeUrl';
import { accountById } from './accounts';
import { saveDraft, sendMail, type OutgoingMail } from './mailApi';
import { pageKey, useEmailUi } from './store';

/**
 * A new message, a reply, a forward or a draft taken up again: to, cc, bcc,
 * subject and the body written as HTML (a toolbar over an editable area),
 * as Markdown (rendered to HTML on the way out, the source as the text
 * part) or as plain text. Sent through the account's SMTP server (filed
 * under Sent when the IMAP server has such a folder), or saved under
 * Drafts to finish later.
 */
export function ComposeDialog() {
  const draft = useEmailUi((s) => s.compose);
  if (!draft) return null;
  return (
    <ComposeForm
      key={`${draft.accountId}-${draft.inReplyTo ?? ''}-${draft.draft?.uid ?? ''}-${draft.subject}`}
    />
  );
}

const FORMAT_KEY = 'boardcache:emailComposeFormat';
const FORMATS: { id: ComposeFormat; label: string }[] = [
  { id: 'html', label: 'HTML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'plain', label: 'Plain text' },
];
const TOOLS: { id: ComposeTool; label: string; icon: React.ReactNode }[] = [
  { id: 'bold', label: 'Bold', icon: <BoldIcon size={14} /> },
  { id: 'italic', label: 'Italic', icon: <ItalicIcon size={14} /> },
  { id: 'strike', label: 'Strikethrough', icon: <StrikethroughIcon size={14} /> },
  { id: 'heading', label: 'Heading', icon: <HeadingIcon size={14} /> },
  { id: 'quote', label: 'Quote', icon: <TextQuoteIcon size={14} /> },
  { id: 'bullets', label: 'Bulleted list', icon: <ListIcon size={14} /> },
  { id: 'numbers', label: 'Numbered list', icon: <ListOrderedIcon size={14} /> },
  { id: 'code', label: 'Code', icon: <CodeIcon size={14} /> },
  { id: 'link', label: 'Link', icon: <LinkIcon size={14} /> },
];

function storedFormat(): ComposeFormat {
  try {
    const v = localStorage.getItem(FORMAT_KEY);
    if (v === 'html' || v === 'markdown' || v === 'plain') return v;
  } catch {
    /* private mode */
  }
  return 'html';
}

/** The HTML editor's command for a tool (the link asks for its address first). */
const HTML_COMMANDS: Record<Exclude<ComposeTool, 'link'>, [string, string?]> = {
  bold: ['bold'],
  italic: ['italic'],
  strike: ['strikeThrough'],
  heading: ['formatBlock', 'h2'],
  quote: ['formatBlock', 'blockquote'],
  bullets: ['insertUnorderedList'],
  numbers: ['insertOrderedList'],
  code: ['formatBlock', 'pre'],
};

function ComposeForm() {
  const draft = useEmailUi((s) => s.compose)!;
  const account = accountById(draft.accountId);
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [subject, setSubject] = useState(draft.subject);
  // The body in its text form (Markdown or plain), and as HTML; `derived`
  // is the HTML last made from the text, so an untouched switch back keeps
  // the text as written instead of flattening the HTML.
  const [format, setFormat] = useState<ComposeFormat>(() => (draft.html ? 'html' : storedFormat()));
  const [source, setSource] = useState(draft.text);
  // Nothing renders from the HTML (the editable area is uncontrolled), so it
  // lives in a ref: seeded once, read when the message goes out.
  const [initialHtml] = useState(() =>
    draft.html ? draft.html : format === 'html' ? plainToHtml(draft.text) : '',
  );
  const htmlRef = useRef(initialHtml);
  const derived = useRef<string | null>(draft.html ? null : format === 'html' ? initialHtml : null);
  const [busy, setBusy] = useState<'send' | 'draft' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const close = () => useEmailUi.getState().setCompose(null);
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();

  // The editable area takes the HTML whenever the element is attached (the
  // dialog mounts its content more than once).
  const attachEditor = useCallback((el: HTMLDivElement | null) => {
    editor.current = el;
    if (!el) return;
    if (el.innerHTML !== htmlRef.current) el.innerHTML = htmlRef.current;
    // The browser's own serialisation is what an untouched editor reads back.
    if (derived.current !== null) derived.current = el.innerHTML;
  }, []);

  const switchFormat = (next: ComposeFormat) => {
    if (next === format) return;
    try {
      localStorage.setItem(FORMAT_KEY, next);
    } catch {
      /* private mode */
    }
    if (next === 'html') {
      const made = format === 'markdown' ? markdownToHtml(source) : plainToHtml(source);
      derived.current = made;
      htmlRef.current = made;
    } else if (format === 'html') {
      const current = editor.current?.innerHTML ?? htmlRef.current;
      if (derived.current === null || current !== derived.current) {
        setSource(textFromHtml(sanitizeEmailHtml(current)));
      }
      derived.current = null;
    }
    setFormat(next);
  };

  const apply = async (tool: ComposeTool) => {
    if (format === 'html') {
      const el = editor.current;
      if (!el) return;
      el.focus();
      if (tool === 'link') {
        const sel = window.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const url = await promptText({ title: 'Link address', placeholder: 'https://' });
        if (!url) return;
        el.focus();
        if (range && sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        if (!range || range.collapsed) {
          document.execCommand(
            'insertHTML',
            false,
            `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`,
          );
        } else document.execCommand('createLink', false, url);
      } else {
        const [command, value] = HTML_COMMANDS[tool];
        document.execCommand(command, false, value);
      }
      htmlRef.current = el.innerHTML;
      return;
    }
    const ta = textarea.current;
    if (!ta) return;
    let url: string | undefined;
    if (tool === 'link') {
      const asked = await promptText({ title: 'Link address', placeholder: 'https://' });
      if (!asked) return;
      url = asked;
    }
    const next = applyMarkdownTool(source, ta.selectionStart, ta.selectionEnd, tool, url);
    setSource(next.value);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(next.start, next.end);
    });
  };

  const outgoing = (): OutgoingMail => {
    const body =
      format === 'html'
        ? (() => {
            const clean = sanitizeEmailHtml(editor.current?.innerHTML ?? htmlRef.current);
            return { text: textFromHtml(clean), html: clean };
          })()
        : format === 'markdown'
          ? { text: source, html: markdownToHtml(source) }
          : { text: source };
    return {
      to: to.trim(),
      ...(cc.trim() ? { cc: cc.trim() } : {}),
      ...(bcc.trim() ? { bcc: bcc.trim() } : {}),
      subject,
      ...body,
      ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}),
      ...(draft.references ? { references: draft.references } : {}),
      ...(draft.draft ? { draft: draft.draft } : {}),
    };
  };

  /** The Drafts folder (and the open draft) are read afresh afterwards. */
  const forgetDraft = (folder: string | undefined) => {
    const ui = useEmailUi.getState();
    if (draft.draft) {
      ui.forgetPage(pageKey(draft.accountId, draft.draft.folder));
      if (ui.selected[draft.accountId] === String(draft.draft.uid))
        ui.setSelected(draft.accountId, null);
    }
    if (folder) ui.forgetPage(pageKey(draft.accountId, folder));
  };

  const send = async () => {
    if (!account || !to.trim()) return;
    setBusy('send');
    setError(null);
    try {
      const out = await sendMail(account, outgoing());
      forgetDraft(undefined);
      close();
      showNotice(out.savedToSent ? 'Sent, and filed under Sent.' : 'Sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The mail could not be sent.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!account) return;
    setBusy('draft');
    setError(null);
    try {
      const out = await saveDraft(account, outgoing());
      forgetDraft(out.folder);
      close();
      showNotice('Saved under Drafts.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The draft could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const title = draft.draft ? 'Draft' : draft.inReplyTo ? 'Reply' : 'New Message';
  return (
    <UiDialog
      title={title}
      onClose={close}
      size="large"
      dismissable={!busy}
      resizable="boardcache:emailComposeBox"
      testId="email-compose"
    >
      <div className="plugin-settings-fields email-compose">
        <div className="email-compose-from">
          From {account ? `${account.name} <${account.email}>` : 'an account that is gone'}
        </div>
        <label className="plugin-settings-field">
          <span>To</span>
          <input
            value={to}
            placeholder="name@example.com, another@example.com"
            autoFocus={!draft.to}
            data-testid="email-compose-to"
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={stop}
          />
        </label>
        <div className="email-compose-copies">
          <label className="plugin-settings-field">
            <span>Cc</span>
            <input
              value={cc}
              data-testid="email-compose-cc"
              onChange={(e) => setCc(e.target.value)}
              onKeyDown={stop}
            />
          </label>
          <label className="plugin-settings-field">
            <span>Bcc</span>
            <input
              value={bcc}
              data-testid="email-compose-bcc"
              onChange={(e) => setBcc(e.target.value)}
              onKeyDown={stop}
            />
          </label>
        </div>
        <label className="plugin-settings-field">
          <span>Subject</span>
          <input
            value={subject}
            data-testid="email-compose-subject"
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={stop}
          />
        </label>
        <div className="email-compose-bar">
          <div className="seg" role="group" aria-label="Message format">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={format === f.id ? 'active' : ''}
                aria-pressed={format === f.id}
                data-testid={`email-compose-format-${f.id}`}
                onClick={() => switchFormat(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {format !== 'plain' && (
            <div className="email-compose-tools" role="toolbar" aria-label="Formatting">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="view-icon-btn small"
                  title={t.label}
                  aria-label={t.label}
                  data-testid={`email-compose-tool-${t.id}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void apply(t.id)}
                >
                  {t.icon}
                </button>
              ))}
            </div>
          )}
        </div>
        {format === 'html' ? (
          <div
            ref={attachEditor}
            className="email-compose-editor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Message"
            data-testid="email-compose-editor"
            onInput={(e) => {
              htmlRef.current = (e.target as HTMLDivElement).innerHTML;
            }}
            onKeyDown={stop}
          />
        ) : (
          <textarea
            ref={textarea}
            className="email-compose-text"
            value={source}
            rows={14}
            autoFocus={!!draft.to}
            aria-label="Message"
            data-testid="email-compose-text"
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={stop}
          />
        )}
        {error && (
          <p className="email-account-result" role="alert" data-testid="email-compose-error">
            {error}
          </p>
        )}
        <div className="ui-prompt-actions">
          <button
            type="button"
            data-testid="email-compose-draft"
            disabled={!!busy || !account}
            onClick={() => void save()}
          >
            {busy === 'draft' ? 'Saving' : 'Save Draft'}
          </button>
          <span className="email-spacer" />
          <button
            type="button"
            className="sync-primary"
            data-testid="email-compose-send"
            disabled={!!busy || !account || !to.trim()}
            onClick={() => void send()}
          >
            {busy === 'send' ? 'Sending' : 'Send'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
