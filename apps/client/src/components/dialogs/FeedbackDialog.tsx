import { useState } from 'react';
import { create } from 'zustand';
import { UiDialog } from '../ui/Dialog';
import { UiSelect } from '../ui/Select';
import { sendFeedback } from '../../lib/sync/syncApi';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';

/**
 * Send feedback — File menu. Works signed in or not (local-only users have
 * things to say too). Diagnostics are opt-in and never include board
 * content: build id, browser, current view, and item counts.
 */

interface FeedbackDialogState {
  open: boolean;
  toggle: (open: boolean) => void;
}
export const useFeedbackDialog = create<FeedbackDialogState>((set) => ({
  open: false,
  toggle: (open) => set({ open }),
}));

const CATEGORIES = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'idea', label: 'An idea' },
  { value: 'question', label: 'A question' },
  { value: 'other', label: 'Something else' },
];

export function FeedbackDialog() {
  const open = useFeedbackDialog((s) => s.open);
  return open ? <FeedbackDialogBody /> : null;
}

function FeedbackDialogBody() {
  const close = () => useFeedbackDialog.getState().toggle(false);
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const [category, setCategory] = useState('bug');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [diagnostics, setDiagnostics] = useState(true);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (message.trim().length < 3 || state === 'sending') return;
    setState('sending');
    setError(null);
    try {
      await sendFeedback({
        category,
        message: message.trim(),
        ...(email.trim() && !signedIn ? { email: email.trim() } : {}),
        ...(diagnostics ? { diagnostics: collectDiagnostics() } : {}),
      });
      setState('sent');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'Could not send. Try again in a moment.');
    }
  };

  return (
    <UiDialog title="Send feedback" onClose={close} className="tier-sheet" testId="feedback-dialog">
      <div className="plugin-settings">
        {state === 'sent' ? (
          <>
            <p className="feedback-thanks" data-testid="feedback-sent">
              Sent. Thank you — every message is read by a person.
            </p>
            <div className="pj-dialog-actions">
              <button type="button" className="suggest-conn-btn btn-primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="settings-row">
              <span>About</span>
              <UiSelect
                value={category}
                ariaLabel="Feedback category"
                testId="feedback-category"
                options={CATEGORIES}
                onChange={setCategory}
              />
            </label>
            <label className="settings-row settings-row-top">
              <span>Message</span>
              <textarea
                className="tag-input pj-textarea feedback-message"
                value={message}
                autoFocus
                placeholder="What happened, or what would help?"
                data-testid="feedback-message"
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
            {!signedIn && (
              <label className="settings-row">
                <span>Email</span>
                <input
                  type="email"
                  className="tag-input"
                  value={email}
                  placeholder="Optional — if you'd like a reply"
                  data-testid="feedback-email"
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
            )}
            <label className="settings-row settings-row-check">
              <input
                type="checkbox"
                checked={diagnostics}
                data-testid="feedback-diagnostics"
                onChange={(e) => setDiagnostics(e.target.checked)}
              />
              <span>
                Include diagnostics (app build, browser, current view, item counts — never board
                contents)
              </span>
            </label>
            {error && (
              <p className="sync-error" role="alert">
                {error}
              </p>
            )}
            <div className="pj-dialog-actions">
              <button type="button" className="suggest-conn-btn" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="suggest-conn-btn btn-primary"
                disabled={message.trim().length < 3 || state === 'sending'}
                data-testid="feedback-send"
                onClick={() => void submit()}
              >
                {state === 'sending' ? 'Sending' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </UiDialog>
  );
}

/** Nothing here identifies a board's contents. */
function collectDiagnostics(): Record<string, unknown> {
  const session = useSessionStore.getState();
  const doc = useDocumentStore.getState().doc;
  const types: Record<string, number> = {};
  for (const item of Object.values(doc.items)) types[item.type] = (types[item.type] ?? 0) + 1;
  return {
    build: String(import.meta.env.VITE_BUILD_ID ?? 'dev'),
    ua: navigator.userAgent.slice(0, 200),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    view: session.view,
    pluginView: session.pluginView ?? null,
    items: Object.keys(doc.items).length,
    types,
    schema: doc.schemaVersion,
  };
}
