import { useRef, useState } from 'react';
import {
  DEST_LABELS,
  REMOTE_DESTS,
  collectBackupEntries,
  decryptBackup,
  fetchRemoteBackup,
  isEncryptedBackup,
  listRemoteBackups,
  loadTargets,
  planImport,
  runImport,
  saveTarget,
} from '../../lib/sync/backup';
import type {
  ConflictChoice,
  DestConfig,
  ImportResult,
  ImportRow,
  RemoteFile,
} from '../../lib/sync/backup';
import { hasSyncServer } from '../../lib/sync/apiBase';
import { importJsonFile } from '../../lib/board/transfer';
import { openBoard } from '../../lib/board/boardLibrary';
import { DestConfigFields } from './BackupDialog';
import { UiSelect } from '../ui/Select';

/**
 * Import boards from a file or any backup destination (S3, FTP/SFTP,
 * WebDAV/NextCloud, Git). Accepts single .boardcache files and whole
 * *_boardcache_backup.zip archives; name collisions ask per board —
 * replace the existing board, skip, or keep both.
 */

type Source = 'file' | (typeof REMOTE_DESTS)[number];
type Phase = 'source' | 'browse' | 'passphrase' | 'conflicts' | 'done';

export function ImportBody({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const remoteAvailable = hasSyncServer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source>('file');
  const [targets, setTargets] = useState(() => loadTargets());
  const [phase, setPhase] = useState<Phase>('source');
  const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [choices, setChoices] = useState<ConflictChoice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, setPending] = useState<{ blob: Blob; name: string } | null>(null);
  const [passphrase, setPassphrase] = useState('');

  const config = source === 'file' ? {} : (targets[source] ?? {});
  const setConfig = (next: DestConfig) => {
    if (source === 'file') return;
    setTargets((prev) => ({ ...prev, [source]: next }));
    saveTarget(source, next);
  };

  const fail = (err: unknown, fallback: string) => {
    setBusy(null);
    setError(err instanceof Error ? err.message : fallback);
  };

  /** File/blob in hand → decrypt if needed → plan → conflicts or import. */
  const startImport = async (blob: Blob, name: string) => {
    setBusy('Reading boards');
    setError(null);
    try {
      if (await isEncryptedBackup(blob)) {
        setPending({ blob, name });
        setBusy(null);
        setPhase('passphrase');
        return;
      }
      const entries = await collectBackupEntries(blob, name.replace(/\.enc$/i, ''));
      const plan = await planImport(entries);
      setRows(plan);
      setChoices(plan.map(() => 'keep'));
      setBusy(null);
      if (plan.some((r) => r.existing)) {
        setPhase('conflicts');
      } else {
        await execute(
          plan,
          plan.map(() => 'keep'),
        );
      }
    } catch (err) {
      fail(err, 'Could not read that file.');
    }
  };

  const execute = async (plan: ImportRow[], plannedChoices: ConflictChoice[]) => {
    setBusy('Importing');
    setError(null);
    try {
      const res = await runImport(plan, plannedChoices);
      onDone();
      // A clean single-board import jumps straight into the board (matching
      // the old quick-import behavior); anything else shows the summary.
      if (plan.length === 1 && !plan[0]!.existing && res.lastImportedId && !res.errors.length) {
        await openBoard(res.lastImportedId);
        onClose();
        return;
      }
      setResult(res);
      setPhase('done');
    } catch (err) {
      fail(err, 'Import failed.');
    } finally {
      setBusy(null);
    }
  };

  const browse = async () => {
    if (source === 'file') return;
    setBusy('Listing backups');
    setError(null);
    try {
      setRemoteFiles(await listRemoteBackups(source, config));
      setPhase('browse');
    } catch (err) {
      fail(err, 'Could not list backups.');
    } finally {
      setBusy(null);
    }
  };

  const pickRemote = async (name: string) => {
    if (source === 'file') return;
    setBusy(`Downloading ${name}…`);
    setError(null);
    try {
      const blob = await fetchRemoteBackup(source, config, name);
      await startImport(blob, name);
    } catch (err) {
      fail(err, 'Download failed.');
    }
  };

  const conflictCount = rows.filter((r) => r.existing).length;

  return (
    <div className="export-body">
      {phase === 'source' && (
        <>
          <p className="export-intro">
            Import a single <code>.boardcache</code> board or a whole
            <code> boardcache_backup</code> archive — from a file or a backup destination.
          </p>
          <label className="plugin-settings-field">
            <span>Source</span>
            <UiSelect
              ariaLabel="Import source"
              testId="import-source"
              value={source}
              onChange={(v) => setSource(v as Source)}
              options={[
                { value: 'file', label: 'Local file' },
                ...REMOTE_DESTS.map((d) => ({
                  value: d,
                  label: remoteAvailable
                    ? DEST_LABELS[d]
                    : `${DEST_LABELS[d]} (needs the sync server)`,
                  disabled: !remoteAvailable,
                })),
              ]}
            />
          </label>
          {source !== 'file' && (
            <DestConfigFields dest={source} config={config} onChange={setConfig} />
          )}
          <div className="aimedia-actions">
            {source === 'file' ? (
              <button
                type="button"
                className="sync-primary"
                data-testid="import-pick-file"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose file
              </button>
            ) : (
              <button
                type="button"
                className="sync-primary"
                disabled={busy !== null}
                data-testid="import-browse"
                onClick={() => void browse()}
              >
                {busy ?? 'Browse backups'}
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".boardcache,.refboard,.zip,.json,.enc"
            hidden
            data-testid="board-import-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.name.toLowerCase().endsWith('.json')) {
                void importJsonFile(file).then(onDone, (err) => fail(err, 'Import failed.'));
              } else {
                void startImport(file, file.name);
              }
            }}
          />
        </>
      )}

      {phase === 'passphrase' && pending && (
        <>
          <p className="export-intro">
            <code>{pending.name}</code> is an encrypted backup — enter its passphrase.
          </p>
          <label className="plugin-settings-field">
            <span>Passphrase</span>
            <input
              type="password"
              value={passphrase}
              autoFocus
              data-testid="import-passphrase"
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  document
                    .querySelector<HTMLButtonElement>('[data-testid="import-decrypt"]')
                    ?.click();
                }
              }}
            />
          </label>
          <div className="aimedia-actions">
            <button type="button" onClick={() => setPhase('source')}>
              Cancel
            </button>
            <button
              type="button"
              className="sync-primary"
              disabled={!passphrase || busy !== null}
              data-testid="import-decrypt"
              onClick={() => {
                void (async () => {
                  setBusy('Decrypting');
                  setError(null);
                  try {
                    const plain = await decryptBackup(pending.blob, passphrase);
                    setPending(null);
                    setPassphrase('');
                    await startImport(plain, pending.name.replace(/\.enc$/i, ''));
                  } catch (err) {
                    fail(err, 'Decryption failed.');
                  }
                })();
              }}
            >
              Unlock
            </button>
          </div>
        </>
      )}

      {phase === 'browse' && (
        <>
          <p className="export-intro">Backups on {DEST_LABELS[source as never]}:</p>
          <div className="import-file-list" data-testid="import-file-list">
            {remoteFiles.length === 0 && <p className="settings-hint">No backups found.</p>}
            {remoteFiles.map((f) => (
              <button
                type="button"
                key={f.name}
                className="import-file-row"
                data-testid="import-file-row"
                disabled={busy !== null}
                onClick={() => void pickRemote(f.name)}
              >
                <span className="import-file-name">{f.name}</span>
                <span className="import-file-meta">
                  {f.size !== null ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : ''}
                  {f.mtime ? ` · ${new Date(f.mtime).toLocaleString()}` : ''}
                </span>
              </button>
            ))}
          </div>
          <div className="aimedia-actions">
            <button type="button" onClick={() => setPhase('source')}>
              Back
            </button>
          </div>
        </>
      )}

      {phase === 'conflicts' && (
        <>
          <p className="export-intro" data-testid="import-conflicts-intro">
            {conflictCount} of {rows.length} board{rows.length === 1 ? '' : 's'} already exist (same
            name). Choose what to do:
          </p>
          <div className="import-conflicts">
            {rows.map((row, i) =>
              row.existing ? (
                <div className="import-conflict-row" key={i} data-testid="import-conflict-row">
                  <span className="import-file-name">{row.entry.boardName}</span>
                  <UiSelect
                    ariaLabel={`Conflict choice for ${row.entry.boardName}`}
                    testId="import-conflict-choice"
                    value={choices[i]!}
                    onChange={(v) =>
                      setChoices((prev) =>
                        prev.map((c, j) => (j === i ? (v as ConflictChoice) : c)),
                      )
                    }
                    options={[
                      { value: 'replace', label: 'Replace existing' },
                      { value: 'skip', label: 'Skip' },
                      { value: 'keep', label: 'Keep both' },
                    ]}
                  />
                </div>
              ) : null,
            )}
          </div>
          <div className="import-applyall">
            {(['replace', 'skip', 'keep'] as const).map((c) => (
              <button
                type="button"
                key={c}
                data-testid={`import-all-${c}`}
                onClick={() => setChoices(rows.map((r) => (r.existing ? c : 'keep')))}
              >
                {c === 'replace' ? 'Replace all' : c === 'skip' ? 'Skip all' : 'Keep both (all)'}
              </button>
            ))}
          </div>
          <div className="aimedia-actions">
            <button type="button" onClick={() => setPhase('source')}>
              Cancel
            </button>
            <button
              type="button"
              className="sync-primary"
              disabled={busy !== null}
              data-testid="import-confirm"
              onClick={() => void execute(rows, choices)}
            >
              {busy ?? 'Import'}
            </button>
          </div>
        </>
      )}

      {phase === 'done' && result && (
        <>
          <p className="export-intro" data-testid="import-result">
            Imported {result.imported}, replaced {result.replaced}, skipped {result.skipped}.
            {result.errors.length > 0 && ` Failed: ${result.errors.join('; ')}`}
          </p>
          <div className="aimedia-actions">
            <button type="button" className="sync-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}

      {phase !== 'conflicts' && busy && (
        <p className="settings-hint" data-testid="import-busy">
          {busy}
        </p>
      )}
      {error && (
        <p className="sync-error" role="alert" data-testid="import-error">
          {error}
        </p>
      )}
    </div>
  );
}
