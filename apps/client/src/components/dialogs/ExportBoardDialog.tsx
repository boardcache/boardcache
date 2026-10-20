import { useState } from 'react';
import { create } from 'zustand';
import { exportCurrentAsBoardcache } from '../../lib/board/transfer';
import { UiDialog } from '../ui/Dialog';

/** Export the open board as a .boardcache file, optionally passphrase-encrypted. */

interface ExportBoardState {
  open: boolean;
  toggle: (open: boolean) => void;
}

export const useExportBoardDialog = create<ExportBoardState>((set) => ({
  open: false,
  toggle: (open) => set({ open }),
}));

export function ExportBoardDialog() {
  const open = useExportBoardDialog((s) => s.open);
  return open ? <ExportBoardDialogBody /> : null;
}

function ExportBoardDialogBody() {
  const close = () => useExportBoardDialog.getState().toggle(false);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await exportCurrentAsBoardcache(passphrase);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
      setBusy(false);
    }
  };

  return (
    <UiDialog
      title="Export boardCache Backup"
      onClose={close}
      className="export-sheet"
      testId="exportboard-dialog"
    >
      <div className="export-body">
        <p className="export-intro">
          Saves this board (items and assets) as a <code>.boardcache</code> file. Set a passphrase
          to encrypt it (AES-256) — without one it's a plain file.
        </p>
        <label className="plugin-settings-field">
          <span>Passphrase (optional — encrypts the file)</span>
          <input
            type="password"
            value={passphrase}
            placeholder="Leave empty for an unencrypted file"
            autoFocus
            data-autofocus
            data-testid="exportboard-passphrase"
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void run();
              }
            }}
          />
        </label>
        {error && (
          <p className="sync-error" role="alert" data-testid="exportboard-error">
            {error}
          </p>
        )}
        <div className="aimedia-actions">
          <button
            type="button"
            className="sync-primary"
            disabled={busy}
            data-testid="exportboard-confirm"
            onClick={() => void run()}
          >
            {busy ? 'Exporting' : 'Export'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
