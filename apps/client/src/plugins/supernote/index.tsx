import './style.css';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  BookOpenIcon,
  FileTextIcon,
  FolderIcon,
  PenLineIcon,
  PenToolIcon,
} from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { apiFetch, hasSyncServer } from '../../lib/sync/apiBase';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { importMediaFiles } from '../../lib/import/importMedia';
import { NoteRenderer } from './noteRenderer';
import { buildNotePdf } from './notePdf';
import { usePluginSettings } from '../settingsStore';
import { useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';
import { registerPlugin } from '../registry';

/**
 * Supernote plugin: import .note pages (as images or a vector PDF), plus
 * PDFs and ePubs straight from a Supernote cloud — the official cloud or a
 * self-hosted Private Cloud instance (both speak the same API, proxied
 * through the sync server because neither sends CORS headers).
 *
 * The cloud connection lives in plugin settings (Settings → Plugins →
 * Supernote) and is shared with the import dialog.
 */

const PLUGIN_ID = 'supernote';

interface CloudSettings {
  /** '' = official cloud, else a private cloud base URL. */
  baseUrl: string;
  email: string;
  /** 30-day JWT from the cloud; the password itself is never stored. */
  token: string | null;
}

function readCloudSettings(raw: unknown): CloudSettings {
  const r = (raw ?? {}) as Partial<CloudSettings>;
  return { baseUrl: r.baseUrl ?? '', email: r.email ?? '', token: r.token ?? null };
}

/** Reactive cloud settings (synced via the encrypted settings blob). */
function useCloudSettings(): CloudSettings {
  return readCloudSettings(usePluginSettings((s) => s.settings[PLUGIN_ID]));
}

const saveCloudSettings = (next: CloudSettings) =>
  usePluginSettings.getState().set(PLUGIN_ID, next);

interface CloudFile {
  id: string;
  name: string;
  isFolder: boolean;
  size: number;
}

/** File kinds the canvas can take straight from the cloud. */
function importableKind(name: string): 'note' | 'pdf' | 'epub' | null {
  if (/\.note$/i.test(name)) return 'note';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.epub$/i.test(name)) return 'epub';
  return null;
}

interface DialogState {
  open: boolean;
  openDialog: () => void;
  close: () => void;
}

const useSupernoteDialog = create<DialogState>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  close: () => set({ open: false }),
}));

async function proxy<T>(path: string, payload: unknown): Promise<T> {
  const res = await apiFetch(`/api/supernote/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Supernote request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

// --- cloud connection (shared by the settings panel and the dialog) ---------

function ConnectForm({ onError }: { onError?: (message: string | null) => void }) {
  const settings = useCloudSettings();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fail = (message: string | null) => (onError ? onError(message) : setLocalError(message));

  const connect = async () => {
    setBusy(true);
    fail(null);
    try {
      const { token } = await proxy<{ token: string }>('login', {
        baseUrl: settings.baseUrl,
        email: settings.email,
        password,
      });
      saveCloudSettings({ ...settings, token });
      setPassword('');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sn-connect" data-testid="sn-connect">
      {localError && <p className="sn-error">{localError}</p>}
      <label>
        Server
        <input
          value={settings.baseUrl}
          placeholder="Official Supernote Cloud"
          data-testid="sn-base-url"
          onChange={(e) => saveCloudSettings({ ...settings, baseUrl: e.target.value.trim() })}
        />
      </label>
      <p className="sn-hint">
        Leave empty for the official cloud, or enter your Private Cloud address (e.g.
        http://192.168.1.20:8080).
      </p>
      <label>
        Email
        <input
          value={settings.email}
          autoComplete="username"
          data-testid="sn-email"
          onChange={(e) => saveCloudSettings({ ...settings, email: e.target.value.trim() })}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          data-testid="sn-password"
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <p className="sn-hint">Your password is used once to sign in and never stored.</p>
      <button
        type="button"
        className="sync-primary"
        disabled={busy || !settings.email || !password}
        data-testid="sn-connect-btn"
        onClick={() => void connect()}
      >
        {busy ? 'Connecting' : 'Connect'}
      </button>
    </div>
  );
}

function SyncGateHint() {
  return (
    <div className="sn-connect">
      <p className="sn-hint">
        Cloud import goes through your sync server. Sign in under Board sync to use it — or import
        .note files directly from the Upload File tab.
      </p>
      {hasSyncServer() && (
        <button
          type="button"
          className="sync-primary"
          onClick={() => useSessionStore.getState().setSyncDialogOpen(true)}
        >
          Open Sync Settings
        </button>
      )}
    </div>
  );
}

/** Settings → Plugins → Supernote: manage the cloud connection. */
function SupernoteSettingsPanel() {
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const settings = useCloudSettings();
  if (!hasSyncServer() || !signedIn) return <SyncGateHint />;
  if (!settings.token) return <ConnectForm />;
  return (
    <div className="sn-connect" data-testid="sn-connected">
      <p className="sn-hint">
        Connected to <strong>{settings.baseUrl || 'the official Supernote Cloud'}</strong> as{' '}
        <strong>{settings.email}</strong>.
      </p>
      <button
        type="button"
        data-testid="sn-disconnect"
        className="sn-secondary"
        onClick={() => saveCloudSettings({ ...settings, token: null })}
      >
        Disconnect
      </button>
    </div>
  );
}

// --- import dialog -----------------------------------------------------------

function SupernoteDialog() {
  const open = useSupernoteDialog((s) => s.open);
  return open ? <SupernoteDialogBody /> : null;
}

/** A parsed notebook staged for page selection (pages render in a worker). */
interface Staged {
  renderer: NoteRenderer;
  name: string;
}

function SupernoteDialogBody() {
  const close = () => useSupernoteDialog.getState().close();
  const [tab, setTab] = useState<'file' | 'cloud'>('file');
  const [staged, setStaged] = useState<Staged | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stage = (buffer: ArrayBuffer, name: string) => {
    try {
      setStaged({ renderer: new NoteRenderer(buffer), name: name.replace(/\.note$/i, '') });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file.');
    }
  };
  // The staged worker dies with the dialog or when going back to the tabs.
  const stagedRef = useRef<Staged | null>(null);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  useEffect(() => () => stagedRef.current?.renderer.dispose(), []);

  return (
    <UiDialog
      title={staged ? `Import Pages — ${staged.name}` : 'Import Supernote Notes'}
      onClose={close}
      className="sn-sheet"
      testId="supernote-dialog"
    >
      {staged ? (
        <PagePicker
          staged={staged}
          onBack={() => {
            staged.renderer.dispose();
            setStaged(null);
          }}
          onDone={close}
        />
      ) : (
        <div className="sn-body">
          <div className="sn-tabs" role="group" aria-label="Import source">
            <button
              type="button"
              className={tab === 'file' ? 'active' : ''}
              data-testid="sn-tab-file"
              onClick={() => setTab('file')}
            >
              Upload File
            </button>
            <button
              type="button"
              className={tab === 'cloud' ? 'active' : ''}
              data-testid="sn-tab-cloud"
              onClick={() => setTab('cloud')}
            >
              Supernote Cloud
            </button>
          </div>
          {error && <p className="sn-error">{error}</p>}
          {tab === 'file' ? (
            <FileTab onPick={stage} />
          ) : (
            <CloudTab onPickNote={stage} onError={setError} onDone={close} />
          )}
        </div>
      )}
    </UiDialog>
  );
}

function FileTab({ onPick }: { onPick: (buffer: ArrayBuffer, name: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const read = (file: File | undefined) => {
    if (!file) return;
    void file.arrayBuffer().then((buf) => onPick(buf, file.name));
  };
  return (
    <div
      className="sn-drop"
      data-testid="sn-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        read(e.dataTransfer.files[0]);
      }}
    >
      <p>Drop a .note file here, or</p>
      <button type="button" className="sync-primary" onClick={() => inputRef.current?.click()}>
        Choose File
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".note"
        hidden
        data-testid="sn-file-input"
        onChange={(e) => {
          read(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <p className="sn-hint">Supernote X-series notebooks (A5 X, A6 X2 Nomad, Manta).</p>
    </div>
  );
}

function CloudTab({
  onPickNote,
  onError,
  onDone,
}: {
  onPickNote: (buffer: ArrayBuffer, name: string) => void;
  onError: (message: string | null) => void;
  onDone: () => void;
}) {
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const settings = useCloudSettings();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    name: string;
    /** 0..1, or null while the size is unknown / during import. */
    ratio: number | null;
    phase: 'downloading' | 'importing';
  } | null>(null);
  const [listing, setListing] = useState<CloudFile[] | null>(null);
  // Breadcrumb of visited folders; root is implicit.
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);

  const browse = async (directoryId: string) => {
    const { files } = await proxy<{ files: CloudFile[] }>('list', {
      baseUrl: settings.baseUrl,
      token: settings.token,
      directoryId,
    });
    setListing(files);
  };

  // With a stored token, list the root when the browser first shows; an
  // expired token drops back to the connect form.
  const autoBrowsed = useRef(false);
  useEffect(() => {
    if (autoBrowsed.current || !signedIn || !settings.token || listing) return;
    autoBrowsed.current = true;
    void (async () => {
      try {
        await browse('0');
      } catch {
        saveCloudSettings({
          ...readCloudSettings(usePluginSettings.getState().settings[PLUGIN_ID]),
          token: null,
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, settings.token]);

  if (!hasSyncServer() || !signedIn) return <SyncGateHint />;

  if (!settings.token) {
    return (
      <>
        <ConnectForm onError={onError} />
        <p className="sn-hint">
          The connection is saved with the plugin&apos;s settings (Settings → Plugins → Supernote).
        </p>
      </>
    );
  }
  if (!listing) return <p className="sn-hint">Loading</p>;

  const download = async (file: CloudFile): Promise<ArrayBuffer> => {
    setProgress({ name: file.name, ratio: file.size > 0 ? 0 : null, phase: 'downloading' });
    const res = await apiFetch('/api/supernote/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ baseUrl: settings.baseUrl, token: settings.token, id: file.id }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? 'Download failed.');
    }
    const total = Number(res.headers.get('content-length') ?? 0) || file.size || 0;
    if (!res.body) return res.arrayBuffer(); // no streaming — keep the spinner
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      setProgress({
        name: file.name,
        ratio: total > 0 ? Math.min(1, loaded / total) : null,
        phase: 'downloading',
      });
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out.buffer;
  };

  const openEntry = async (file: CloudFile) => {
    onError(null);
    setBusy(true);
    try {
      if (file.isFolder) {
        await browse(file.id);
        setTrail([...trail, { id: file.id, name: file.name }]);
        return;
      }
      const kind = importableKind(file.name);
      if (kind === 'note') {
        const bytes = await download(file);
        setProgress({ name: file.name, ratio: null, phase: 'importing' });
        onPickNote(bytes, file.name);
        return;
      }
      if (kind === 'pdf' || kind === 'epub') {
        // The canvas takes these natively — import straight to the board.
        const bytes = await download(file);
        setProgress({ name: file.name, ratio: null, phase: 'importing' });
        const mime = kind === 'pdf' ? 'application/pdf' : 'application/epub+zip';
        await importMediaFiles(
          [new File([bytes], file.name, { type: mime })],
          clientToCanvas(window.innerWidth / 2, window.innerHeight / 2),
        );
        onDone();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not open the entry.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const up = async () => {
    const next = trail.slice(0, -1);
    setBusy(true);
    try {
      await browse(next.length ? next[next.length - 1]!.id : '0');
      setTrail(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sn-browser" data-testid="sn-browser">
      <div className="sn-path">
        <button
          type="button"
          disabled={busy || trail.length === 0}
          data-testid="sn-up"
          onClick={() => void up()}
        >
          ←
        </button>
        <span>{trail.length ? trail.map((t) => t.name).join(' / ') : 'All Files'}</span>
      </div>
      {progress && (
        <div className="sn-progress" data-testid="sn-progress">
          <span className="sn-progress-label">
            {progress.phase === 'downloading' ? 'Downloading' : 'Opening'} {progress.name}
            {progress.ratio !== null ? ` — ${Math.round(progress.ratio * 100)}%` : '…'}
          </span>
          <span className="sn-progress-track">
            <span
              className={`sn-progress-fill${progress.ratio === null ? ' indeterminate' : ''}`}
              style={progress.ratio !== null ? { width: `${progress.ratio * 100}%` } : undefined}
            />
          </span>
        </div>
      )}
      <div className="sn-list">
        {listing.map((f) => {
          const kind = importableKind(f.name);
          return (
            <button
              key={f.id}
              type="button"
              className={`sn-row${f.isFolder ? ' sn-folder' : ''}`}
              disabled={busy || (!f.isFolder && !kind)}
              data-testid={`sn-entry-${f.name}`}
              onClick={() => void openEntry(f)}
            >
              <span className="sn-row-icon">
                {f.isFolder ? (
                  <FolderIcon size={14} />
                ) : kind === 'note' ? (
                  <PenLineIcon size={14} />
                ) : kind === 'pdf' ? (
                  <FileTextIcon size={14} />
                ) : kind === 'epub' ? (
                  <BookOpenIcon size={14} />
                ) : (
                  '·'
                )}
              </span>
              <span className="sn-row-name">{f.name}</span>
              {!f.isFolder && <span className="sn-row-size">{(f.size / 1024).toFixed(0)} KB</span>}
            </button>
          );
        })}
        {listing.length === 0 && <p className="sn-hint">This folder is empty.</p>}
      </div>
      <p className="sn-hint">Notes open a page picker; PDFs and ePubs import directly.</p>
    </div>
  );
}

function PagePicker({
  staged,
  onBack,
  onDone,
}: {
  staged: Staged;
  onBack: () => void;
  onDone: () => void;
}) {
  const { renderer, name } = staged;
  const note = renderer.note;
  const [thumbs, setThumbs] = useState<(string | null)[]>(() => note.pages.map(() => null));
  const [selected, setSelected] = useState<boolean[]>(() => note.pages.map(() => true));
  const [format, setFormat] = useState<'images' | 'pdf'>('images');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Render page thumbnails progressively.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < note.pages.length; i++) {
        if (cancelled) return;
        try {
          const canvas = await renderer.renderPage(i);
          const thumb = document.createElement('canvas');
          const scale = 220 / canvas.width;
          thumb.width = 220;
          thumb.height = Math.round(canvas.height * scale);
          thumb.getContext('2d')!.drawImage(canvas, 0, 0, thumb.width, thumb.height);
          const url = thumb.toDataURL('image/png');
          if (!cancelled) {
            setThumbs((prev) => prev.map((t, j) => (j === i ? url : t)));
          }
        } catch {
          /* leave placeholder */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [renderer, note]);

  const importPages = async () => {
    setBusy(true);
    setError(null);
    try {
      const at = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
      const picked = note.pages.map((_, i) => i).filter((i) => selected[i]);
      if (!picked.length) return;
      if (format === 'pdf') {
        await importMediaFiles([await buildNotePdf((i) => renderer.flatten(i), picked, name)], at);
      } else {
        const files: File[] = [];
        for (const i of picked) {
          const canvas = await renderer.renderPage(i);
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/png'),
          );
          if (!blob) throw new Error(`Could not render page ${i + 1}.`);
          files.push(new File([blob], `${name} p${i + 1}.png`, { type: 'image/png' }));
        }
        await importMediaFiles(files, at);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const count = selected.filter(Boolean).length;
  const allSelected = count === note.pages.length;
  return (
    <div className="sn-body">
      {error && <p className="sn-error">{error}</p>}
      <div className="sn-picker-bar">
        <button type="button" onClick={onBack} disabled={busy}>
          ← Back
        </button>
        <button
          type="button"
          data-testid="sn-select-all"
          onClick={() => setSelected(note.pages.map(() => !allSelected))}
        >
          {allSelected ? 'Select None' : 'Select All'}
        </button>
        <div className="sn-format" role="group" aria-label="Import format">
          <button
            type="button"
            className={format === 'images' ? 'active' : ''}
            data-testid="sn-format-images"
            onClick={() => setFormat('images')}
          >
            Images
          </button>
          <button
            type="button"
            className={format === 'pdf' ? 'active' : ''}
            data-testid="sn-format-pdf"
            onClick={() => setFormat('pdf')}
          >
            Vector PDF
          </button>
        </div>
        <button
          type="button"
          className="sync-primary"
          disabled={busy || count === 0}
          data-testid="sn-import"
          onClick={() => void importPages()}
        >
          {busy
            ? 'Importing'
            : format === 'pdf'
              ? `Import PDF (${count} Page${count === 1 ? '' : 's'})`
              : `Import ${count} Page${count === 1 ? '' : 's'}`}
        </button>
      </div>
      <div className="sn-pages" data-testid="sn-pages">
        {note.pages.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`sn-page${selected[i] ? ' selected' : ''}`}
            data-testid={`sn-page-${i + 1}`}
            onClick={() => setSelected((prev) => prev.map((v, j) => (j === i ? !v : v)))}
          >
            {thumbs[i] ? (
              <img src={thumbs[i]!} alt={`Page ${i + 1}`} />
            ) : (
              <span className="sn-page-loading" />
            )}
            <span className="sn-page-num">{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    defaultEnabled: false,
    order: 58,
    name: 'Supernote',
    description:
      'Import Supernote .note pages as images or a vector PDF — upload directly or browse your Supernote Cloud / Private Cloud, including PDFs and ePubs stored there.',
  },
  addMenu: [
    {
      label: 'Import Supernote Notes',
      category: 'documents',
      icon: <PenToolIcon />,
      onSelect: () => useSupernoteDialog.getState().openDialog(),
    },
  ],
  Component: SupernoteDialog,
  SettingsPanel: SupernoteSettingsPanel,
});
