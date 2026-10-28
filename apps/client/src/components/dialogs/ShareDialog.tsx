import { useEffect, useState } from 'react';
import { authConfig } from '../../lib/sync/syncApi';
import { create } from 'zustand';
import { hasSyncServer } from '../../lib/sync/apiBase';
import {
  createShare,
  getShareRecord,
  removeShare,
  shareLink,
  updateShare,
} from '../../lib/sync/share';
import type { ShareRecord } from '../../lib/sync/share';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';
import { UiDialog } from '../ui/Dialog';

/**
 * Share the open board publicly: a read-only snapshot goes to the sync
 * server, viewable by anyone with the link at /s/<id>. The snapshot is
 * plaintext, like a Community publication, which is what lets the page paint
 * at once, fetch assets as they come into view and cache at the edge. A
 * password, when set, is checked by the server on every visit.
 */

interface ShareDialogState {
  open: boolean;
  toggle: (open: boolean) => void;
}

export const useShareDialog = create<ShareDialogState>((set) => ({
  open: false,
  toggle: (open) => set({ open }),
}));

export function ShareDialog() {
  const open = useShareDialog((s) => s.open);
  return open ? <ShareDialogBody /> : null;
}

function ShareDialogBody() {
  const close = () => useShareDialog.getState().toggle(false);
  const boardId = useDocumentStore((s) => s.doc.id);
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  // Share links are a sync feature: a plan that syncs nothing cannot make one
  // (the server refuses too). The board still exports as a file for free.
  const needsPlan = useSyncStore(
    (s) => s.entitlements?.enforced === true && s.entitlements.limits.syncBytes === 0,
  );
  const [record, setRecord] = useState<ShareRecord | null>(() => getShareRecord(boardId));
  // Share links point at the view host when the server names one.
  const [viewUrl, setViewUrl] = useState('');
  useEffect(() => {
    let alive = true;
    void authConfig().then((c) => alive && setViewUrl(c.viewUrl ?? ''));
    return () => {
      alive = false;
    };
  }, []);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (link: string) => {
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!hasSyncServer() || !signedIn) {
    return (
      <UiDialog title="Share Board" onClose={close} className="export-sheet" testId="share-dialog">
        <div className="export-body">
          <p className="export-intro" data-testid="share-signin-hint">
            Sharing publishes a read-only snapshot through the sync server —
            {hasSyncServer()
              ? ' sign in to your sync account first (Sync, in the top-right corner).'
              : ' this build has no sync server configured.'}
          </p>
        </div>
      </UiDialog>
    );
  }

  if (needsPlan && !record) {
    return (
      <UiDialog title="Share Board" onClose={close} className="export-sheet" testId="share-dialog">
        <div className="export-body">
          <p className="export-intro" data-testid="share-plan-hint">
            Share links come with the Personal and Team plans, which also sync your boards between
            devices. Without one, export the board as a .boardcache file, or publish it to the
            Community, for free.
          </p>
          <div className="aimedia-actions">
            <button
              type="button"
              className="sync-primary"
              data-testid="share-see-plans"
              onClick={() => {
                close();
                const session = useSessionStore.getState();
                session.setSettingsSection('sync');
                session.setSettingsOpen(true);
              }}
            >
              See plans
            </button>
          </div>
        </div>
      </UiDialog>
    );
  }

  return (
    <UiDialog title="Share Board" onClose={close} className="export-sheet" testId="share-dialog">
      <div className="export-body">
        {!record ? (
          <>
            <p className="export-intro">
              Anyone with the link can view a read-only snapshot of this board. Unlike your synced
              boards, a shared snapshot is readable by the server, so it loads fast and can be
              cached. Set a password to make viewers enter it first.
            </p>
            <label className="plugin-settings-field">
              <span>Password (optional — viewers must enter it)</span>
              <input
                type="password"
                value={password}
                placeholder="Leave empty for a link-only share"
                data-testid="share-password-input"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="aimedia-actions">
              <button
                type="button"
                className="sync-primary"
                disabled={busy !== null}
                data-testid="share-create"
                onClick={() =>
                  void guard('Sharing', async () => {
                    setRecord(await createShare(password));
                    setPassword('');
                  })
                }
              >
                {busy ?? 'Create share link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="export-intro">
              This board is shared{record.hasPassword ? ' (password-protected)' : ''}. The link
              shows a snapshot from {new Date(record.sharedAt).toLocaleString()}. It republishes
              automatically when you close the board, or update it now.
            </p>
            <div className="share-link-row">
              <input
                type="text"
                readOnly
                value={shareLink(record, viewUrl)}
                data-testid="share-link"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="sync-secondary"
                data-testid="share-copy"
                onClick={() => void copy(shareLink(record, viewUrl))}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="aimedia-actions">
              <button
                type="button"
                className="sync-secondary"
                disabled={busy !== null}
                data-testid="share-remove"
                onClick={() =>
                  void guard('Stopping', async () => {
                    await removeShare(boardId, record);
                    setRecord(null);
                  })
                }
              >
                Stop sharing
              </button>
              <button
                type="button"
                className="sync-primary"
                disabled={busy !== null}
                data-testid="share-update"
                onClick={() =>
                  void guard('Updating', async () => {
                    setRecord(await updateShare(record));
                  })
                }
              >
                {busy ?? 'Update share'}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="sync-error" role="alert" data-testid="share-error-msg">
            {error}
          </p>
        )}
      </div>
    </UiDialog>
  );
}
