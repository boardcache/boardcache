import { useState } from 'react';
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
import { useSyncStore } from '../../state/syncStore';
import { UiDialog } from '../ui/Dialog';

/**
 * Share the open board publicly: an encrypted snapshot goes to the sync
 * server, viewable read-only at /s/<id>. The decryption key rides in the
 * link fragment, or — with a password set — is derived from the password in
 * the viewer's browser. Either way the server only ever stores ciphertext.
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
  const [record, setRecord] = useState<ShareRecord | null>(() => getShareRecord(boardId));
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
            Sharing publishes an encrypted snapshot through the sync server —
            {hasSyncServer()
              ? ' sign in to your sync account first (Sync, in the top-right corner).'
              : ' this build has no sync server configured.'}
          </p>
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
              Anyone with the link can view a read-only snapshot of this board. The snapshot is
              encrypted — the key travels in the link itself (never sent to the server), or set a
              password so viewers must enter it first.
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
              shows a snapshot from {new Date(record.sharedAt).toLocaleString()}.
              {record.hasPassword && !record.wrappedSecret
                ? ' Enter the share password to update it.'
                : ' It republishes automatically when you close the board, or update it now.'}
            </p>
            <div className="share-link-row">
              <input
                type="text"
                readOnly
                value={shareLink(record)}
                data-testid="share-link"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="sync-secondary"
                data-testid="share-copy"
                onClick={() => void copy(shareLink(record))}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            {record.hasPassword && !record.wrappedSecret && (
              <label className="plugin-settings-field">
                <span>Password (needed to update — it is never stored readably)</span>
                <input
                  type="password"
                  value={password}
                  data-testid="share-password-input"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
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
                disabled={
                  busy !== null || (record.hasPassword && !record.wrappedSecret && !password.trim())
                }
                data-testid="share-update"
                onClick={() =>
                  void guard('Updating', async () => {
                    setRecord(await updateShare(record, password));
                    setPassword('');
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
