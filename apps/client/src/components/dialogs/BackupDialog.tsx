import { useState } from 'react';
import {
  DEST_LABELS,
  REMOTE_DESTS,
  buildBackupZip,
  encryptBackup,
  loadTargets,
  saveTarget,
  uploadBackup,
} from '../../lib/sync/backup';
import type { BackupDest, DestConfig } from '../../lib/sync/backup';
import { hasSyncServer } from '../../lib/sync/apiBase';
import { downloadBlob } from '../../lib/export/download';
import { UiSelect } from '../ui/Select';

/**
 * Back up every board (local + synced) as one dated zip — download it, or
 * push it to S3 / FTP / SFTP / WebDAV–NextCloud / a Git repo through the
 * sync server's relay. Destination configs persist locally (they hold
 * credentials, so they stay on this device).
 */

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'number' | 'checkbox';
  placeholder?: string;
}

const DEST_FIELDS: Record<(typeof REMOTE_DESTS)[number], FieldDef[]> = {
  s3: [
    { key: 'bucket', label: 'Bucket' },
    { key: 'region', label: 'Region', placeholder: 'us-east-1' },
    { key: 'endpoint', label: 'Endpoint (S3-compatible, optional)', placeholder: 'https://…' },
    { key: 'prefix', label: 'Key prefix (optional)', placeholder: 'boardcache/' },
    { key: 'accessKeyId', label: 'Access key id' },
    { key: 'secretAccessKey', label: 'Secret access key', type: 'password' },
  ],
  ftp: [
    { key: 'host', label: 'Host' },
    { key: 'port', label: 'Port', type: 'number', placeholder: '21' },
    { key: 'user', label: 'User' },
    { key: 'password', label: 'Password', type: 'password' },
    { key: 'dir', label: 'Directory (optional)', placeholder: 'backups' },
    { key: 'secure', label: 'Use FTPS (TLS)', type: 'checkbox' },
  ],
  sftp: [
    { key: 'host', label: 'Host' },
    { key: 'port', label: 'Port', type: 'number', placeholder: '22' },
    { key: 'user', label: 'User' },
    { key: 'password', label: 'Password', type: 'password' },
    { key: 'dir', label: 'Directory (optional)', placeholder: 'backups' },
  ],
  webdav: [
    {
      key: 'url',
      label: 'Folder URL',
      placeholder: 'https://cloud.example.com/remote.php/dav/files/USER/backups',
    },
    { key: 'user', label: 'User' },
    { key: 'password', label: 'Password / app password', type: 'password' },
  ],
  git: [
    {
      key: 'repo',
      label: 'Repository URL (with token)',
      placeholder: 'https://TOKEN@github.com/user/backups.git',
    },
    { key: 'branch', label: 'Branch (optional)', placeholder: 'main' },
    { key: 'dir', label: 'Directory (optional)', placeholder: 'boardcache' },
  ],
};

/** Config fields for one remote destination (shared with the import dialog). */
export function DestConfigFields({
  dest,
  config,
  onChange,
}: {
  dest: (typeof REMOTE_DESTS)[number];
  config: DestConfig;
  onChange: (next: DestConfig) => void;
}) {
  return (
    <div className="backup-fields">
      {DEST_FIELDS[dest].map((f) =>
        f.type === 'checkbox' ? (
          <label className="backup-check" key={f.key}>
            <input
              type="checkbox"
              checked={Boolean(config[f.key])}
              data-testid={`backup-${dest}-${f.key}`}
              onChange={(e) => onChange({ ...config, [f.key]: e.target.checked })}
            />
            <span>{f.label}</span>
          </label>
        ) : (
          <label className="plugin-settings-field" key={f.key}>
            <span>{f.label}</span>
            <input
              type={f.type ?? 'text'}
              value={String(config[f.key] ?? '')}
              placeholder={f.placeholder}
              spellCheck={false}
              data-testid={`backup-${dest}-${f.key}`}
              onChange={(e) =>
                onChange({
                  ...config,
                  [f.key]: f.type === 'number' ? Number(e.target.value) || '' : e.target.value,
                })
              }
            />
          </label>
        ),
      )}
    </div>
  );
}

export function BackupBody() {
  const remoteAvailable = hasSyncServer();
  const [dest, setDest] = useState<BackupDest>('download');
  const [targets, setTargets] = useState(() => loadTargets());
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config = targets[dest] ?? {};
  const setConfig = (next: DestConfig) => {
    setTargets((prev) => ({ ...prev, [dest]: next }));
    saveTarget(dest, next);
  };

  const run = async () => {
    setBusy(true);
    setStatus('Packaging boards');
    setError(null);
    try {
      const build = await buildBackupZip();
      let blob = build.blob;
      let filename = build.filename;
      if (passphrase.trim()) {
        setStatus('Encrypting');
        blob = await encryptBackup(blob, passphrase.trim());
        filename = `${filename}.enc`;
      }
      const lockedNote = build.skippedLocked.length
        ? ` Not downloaded yet, so skipped: ${build.skippedLocked.join(', ')}. Open them once while online, or try again when connected.`
        : '';
      if (dest === 'download') {
        downloadBlob(blob, filename);
        setStatus(`Downloaded ${filename} (${build.included} boards).${lockedNote}`);
      } else {
        setStatus(`Uploading ${filename}…`);
        await uploadBackup(dest, config, filename, blob);
        setStatus(
          `Backed up ${build.included} boards to ${DEST_LABELS[dest]} as ${filename}.${lockedNote}`,
        );
      }
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export-body">
      <p className="export-intro">
        Packages every board (synced and locked ones included) into a dated backup file. Locked
        boards stay encrypted with their own password. Set a passphrase to encrypt the whole backup
        (AES-256) — without one it's a plain zip.
      </p>
      <label className="plugin-settings-field">
        <span>Destination</span>
        <UiSelect
          ariaLabel="Backup destination"
          testId="backup-dest"
          value={dest}
          onChange={(v) => setDest(v as BackupDest)}
          options={[
            { value: 'download', label: DEST_LABELS.download },
            ...REMOTE_DESTS.map((d) => ({
              value: d,
              label: remoteAvailable ? DEST_LABELS[d] : `${DEST_LABELS[d]} (needs the sync server)`,
              disabled: !remoteAvailable,
            })),
          ]}
        />
      </label>
      {dest !== 'download' && <DestConfigFields dest={dest} config={config} onChange={setConfig} />}
      <label className="plugin-settings-field">
        <span>Passphrase (optional — encrypts the backup)</span>
        <input
          type="password"
          value={passphrase}
          placeholder="Leave empty for an unencrypted zip"
          data-testid="backup-passphrase"
          onChange={(e) => setPassphrase(e.target.value)}
        />
      </label>
      {status && (
        <p className="settings-hint" data-testid="backup-status">
          {status}
        </p>
      )}
      {error && (
        <p className="sync-error" role="alert" data-testid="backup-error">
          {error}
        </p>
      )}
      <div className="aimedia-actions">
        <button
          type="button"
          className="sync-primary"
          disabled={busy}
          data-testid="backup-run"
          onClick={() => void run()}
        >
          {busy ? 'Backing up' : 'Back up now'}
        </button>
      </div>
    </div>
  );
}
