import { useState } from 'react';
import { UiDialog } from '../ui/Dialog';

export type LockDialogMode =
  | 'set'
  | 'open'
  | 'remove'
  | 'folder-set'
  | 'folder-open'
  | 'folder-remove';

const COPY: Record<LockDialogMode, { title: string; action: string; note: string }> = {
  set: {
    title: 'Lock board',
    action: 'Lock',
    note: 'The board and its media are encrypted on this device with a key derived from this password. There is no recovery — if you forget it, the board cannot be opened.',
  },
  open: {
    title: 'Unlock board',
    action: 'Open',
    note: 'This board is password-locked. It stays encrypted on disk and re-locks when closed.',
  },
  remove: {
    title: 'Remove lock',
    action: 'Remove lock',
    note: 'Decrypts the board and its media back to normal (unlocked) storage.',
  },
  'folder-set': {
    title: 'Lock folder',
    action: 'Lock folder',
    note: 'Every board in this folder (and its subfolders) is encrypted on this device with a key derived from this password, and the folder shows nothing until it is unlocked. There is no recovery — if you forget it, the boards cannot be opened.',
  },
  'folder-open': {
    title: 'Unlock folder',
    action: 'Unlock',
    note: 'This folder is password-locked. Its boards stay encrypted on disk; the folder re-locks when you lock it or close the app.',
  },
  'folder-remove': {
    title: 'Remove folder lock',
    action: 'Remove lock',
    note: 'Decrypts every board in the folder back to normal (unlocked) storage.',
  },
};

/** Password prompt for board locks: set (with confirmation), open, or remove. */
export function BoardLockDialog({
  mode,
  boardName,
  onSubmit,
  onClose,
}: {
  mode: LockDialogMode;
  boardName: string;
  /** Returns an error message to show, or null when done (dialog closes). */
  onSubmit: (password: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = COPY[mode];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'set' || mode === 'folder-set') {
      if (password.length < 4) {
        setError('Use at least 4 characters.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords don’t match.');
        return;
      }
    }
    setBusy(true);
    const result = await onSubmit(password).catch(() => 'Something went wrong.');
    setBusy(false);
    if (result) setError(result);
    else onClose();
  };

  return (
    <UiDialog
      title={`${copy.title} · ${boardName}`}
      onClose={onClose}
      className="lock-sheet"
      testId="lock-dialog"
      dismissable={!busy}
    >
      <form className="sync-body" onSubmit={(e) => void submit(e)}>
        <p className="sync-note">{copy.note}</p>
        <label className="sync-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={
              mode === 'set' || mode === 'folder-set' ? 'new-password' : 'current-password'
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            data-autofocus
            data-testid="lock-password"
          />
        </label>
        {(mode === 'set' || mode === 'folder-set') && (
          <label className="sync-field">
            <span>Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              data-testid="lock-password-confirm"
            />
          </label>
        )}
        {error && (
          <p className="sync-error" role="alert" data-testid="lock-error">
            {error}
          </p>
        )}
        <div className="sync-actions">
          <button type="submit" className="sync-primary" disabled={busy} data-testid="lock-submit">
            {busy ? 'Working' : copy.action}
          </button>
        </div>
      </form>
    </UiDialog>
  );
}
