import '../_shared/tablet.css';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { unzipSync, strFromU8 } from 'fflate';
import {
  BookOpenIcon,
  FileTextIcon,
  FolderIcon,
  PenLineIcon,
  TabletIcon,
} from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { apiFetch, hasSyncServer } from '../../lib/sync/apiBase';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { importMediaFiles } from '../../lib/import/importMedia';
import { parseRmPage, renderRmPage } from '../../lib/integrations/remarkable';
import type { RmPage } from '../../lib/integrations/remarkable';
import { buildRmPdf } from './rmPdf';
import { usePluginSettings } from '../settingsStore';
import { useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';
import { registerPlugin } from '../registry';

/**
 * reMarkable plugin: import handwritten notebook pages (as images or a true
 * vector PDF), plus PDFs and ePubs stored in the cloud — the official
 * reMarkable cloud or a self-hosted rmfakecloud instance. Connection uses
 * the tablet's one-time code flow; requests proxy through the sync server.
 */

const PLUGIN_ID = 'remarkable';

interface CloudSettings {
  /** '' = official cloud, else an rmfakecloud base URL. */
  baseUrl: string;
  /** Long-lived device token from the one-time code. */
  deviceToken: string | null;
}

function readSettings(raw: unknown): CloudSettings {
  const r = (raw ?? {}) as Partial<CloudSettings>;
  return { baseUrl: r.baseUrl ?? '', deviceToken: r.deviceToken ?? null };
}

const useSettings = () => readSettings(usePluginSettings((s) => s.settings[PLUGIN_ID]));
const saveSettings = (next: CloudSettings) => usePluginSettings.getState().set(PLUGIN_ID, next);

/** Short-lived user token, minted from the device token per app session. */
let userToken: string | null = null;

interface RmDoc {
  id: string;
  name: string;
  parent: string;
  type: 'folder' | 'notebook' | 'pdf' | 'epub';
  pages: number;
}

async function proxy<T>(path: string, payload: unknown): Promise<T> {
  const res = await apiFetch(`/api/remarkable/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `reMarkable request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

async function ensureUserToken(): Promise<string> {
  if (userToken) return userToken;
  const settings = readSettings(usePluginSettings.getState().settings[PLUGIN_ID]);
  if (!settings.deviceToken) throw new Error('Connect your reMarkable account first.');
  const { userToken: token } = await proxy<{ userToken: string }>('session', {
    baseUrl: settings.baseUrl,
    deviceToken: settings.deviceToken,
  });
  userToken = token;
  return token;
}

interface DialogState {
  open: boolean;
  openDialog: () => void;
  close: () => void;
}

const useRmDialog = create<DialogState>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  close: () => set({ open: false }),
}));

// --- connection (settings panel + dialog) ------------------------------------

function ConnectForm({ onError }: { onError?: (message: string | null) => void }) {
  const settings = useSettings();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fail = (message: string | null) => (onError ? onError(message) : setLocalError(message));

  const connect = async () => {
    setBusy(true);
    fail(null);
    try {
      const { deviceToken } = await proxy<{ deviceToken: string }>('register', {
        baseUrl: settings.baseUrl,
        code: code.trim(),
      });
      userToken = null;
      saveSettings({ ...settings, deviceToken });
      setCode('');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tb-connect" data-testid="rk-connect">
      {localError && <p className="tb-error">{localError}</p>}
      <label>
        Server
        <input
          value={settings.baseUrl}
          placeholder="Official reMarkable Cloud"
          data-testid="rk-base-url"
          onChange={(e) => saveSettings({ ...settings, baseUrl: e.target.value.trim() })}
        />
      </label>
      <p className="tb-hint">
        Leave empty for the official cloud, or enter your rmfakecloud address (e.g.
        https://rm.example.com).
      </p>
      <label>
        One-time code
        <input
          value={code}
          placeholder="abcdefgh"
          autoComplete="off"
          data-testid="rk-code"
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <p className="tb-hint">
        Get a code at my.remarkable.com → Pair device → browser (or your rmfakecloud UI). The code
        is used once to register; only the resulting device token is stored.
      </p>
      <button
        type="button"
        className="sync-primary"
        disabled={busy || code.trim().length < 6}
        data-testid="rk-connect-btn"
        onClick={() => void connect()}
      >
        {busy ? 'Connecting' : 'Connect'}
      </button>
    </div>
  );
}

function SyncGateHint() {
  return (
    <div className="tb-connect">
      <p className="tb-hint">
        Cloud import goes through your sync server. Sign in under Board sync to use it — or import
        .rm / .rmdoc files directly from the Upload File tab.
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

function RemarkableSettingsPanel() {
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const settings = useSettings();
  if (!hasSyncServer() || !signedIn) return <SyncGateHint />;
  if (!settings.deviceToken) return <ConnectForm />;
  return (
    <div className="tb-connect" data-testid="rk-connected">
      <p className="tb-hint">
        Connected to <strong>{settings.baseUrl || 'the official reMarkable Cloud'}</strong>.
      </p>
      <button
        type="button"
        className="tb-secondary"
        data-testid="rk-disconnect"
        onClick={() => {
          userToken = null;
          saveSettings({ ...settings, deviceToken: null });
        }}
      >
        Disconnect
      </button>
    </div>
  );
}

// --- import dialog -----------------------------------------------------------

function RemarkableDialog() {
  const open = useRmDialog((s) => s.open);
  return open ? <RemarkableDialogBody /> : null;
}

interface Staged {
  pages: RmPage[];
  name: string;
}

/**
 * Minimal ustar reader for .rmn archives (RCU's notebook format: a tar of
 * the device's raw files). Handles standard names, ustar prefixes, and GNU
 * long-name entries — enough for real RCU output.
 */
function untar(bytes: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const decoder = new TextDecoder();
  const str = (offset: number, length: number) => {
    const raw = bytes.subarray(offset, offset + length);
    const end = raw.indexOf(0);
    return decoder.decode(end === -1 ? raw : raw.subarray(0, end));
  };
  let pos = 0;
  let pendingLongName: string | null = null;
  while (pos + 512 <= bytes.length) {
    if (bytes[pos] === 0) break; // end-of-archive zero blocks
    const size = parseInt(str(pos + 124, 12).trim() || '0', 8) || 0;
    const typeflag = bytes[pos + 156];
    let name = str(pos, 100);
    const prefix = str(pos + 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    if (pendingLongName) {
      name = pendingLongName;
      pendingLongName = null;
    }
    const body = bytes.subarray(pos + 512, pos + 512 + size);
    if (typeflag === 0x4c /* 'L' GNU long name */) {
      const end = body.indexOf(0);
      pendingLongName = decoder.decode(end === -1 ? body : body.subarray(0, end));
    } else if (typeflag === 0x30 /* '0' */ || typeflag === 0) {
      if (name) files[name] = body;
    }
    pos += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Stage a bundle's components ({path -> bytes}, zip or tar alike). */
function stageComponents(files: Record<string, Uint8Array>, name: string): Staged {
  const contentName = Object.keys(files).find((f) => f.endsWith('.content'));
  let order: string[] | null = null;
  if (contentName) {
    try {
      const content = JSON.parse(strFromU8(files[contentName]!)) as {
        cPages?: { pages?: { id: string; deleted?: { value?: number } }[] };
        pages?: string[];
      };
      order =
        content.cPages?.pages?.filter((p) => !p.deleted?.value).map((p) => p.id) ??
        content.pages ??
        null;
    } catch {
      /* fall back to file order */
    }
  }
  const rmNames = Object.keys(files).filter((f) => f.endsWith('.rm'));
  const ordered = order
    ? order
        .map((id) => rmNames.find((f) => f.endsWith(`/${id}.rm`) || f === `${id}.rm`))
        .filter((f): f is string => Boolean(f))
    : rmNames.sort();
  if (!ordered.length) throw new Error('No .rm pages found in the bundle.');
  const pages = ordered.map((f) => {
    const bytes = files[f]!;
    return parseRmPage(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  });
  return { pages, name: name.replace(/\.(rmdoc|rmn)$/i, '') };
}

function RemarkableDialogBody() {
  const close = () => useRmDialog.getState().close();
  const [tab, setTab] = useState<'file' | 'cloud'>('file');
  const [staged, setStaged] = useState<Staged | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageFile = (buffer: ArrayBuffer, name: string) => {
    try {
      const bytes = new Uint8Array(buffer);
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // 'PK'
      if (isZip || /\.rmdoc$/i.test(name)) {
        setStaged(stageComponents(unzipSync(bytes), name));
      } else if (/\.rmn$/i.test(name)) {
        // RCU notebook archive: a tar of the device's raw files.
        setStaged(stageComponents(untar(bytes), name));
      } else {
        setStaged({ pages: [parseRmPage(buffer)], name: name.replace(/\.rm$/i, '') });
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file.');
    }
  };

  return (
    <UiDialog
      title={staged ? `Import Pages — ${staged.name}` : 'Import reMarkable Notes'}
      onClose={close}
      className="tb-sheet"
      size="large"
      testId="remarkable-dialog"
    >
      {staged ? (
        <PagePicker staged={staged} onBack={() => setStaged(null)} onDone={close} />
      ) : (
        <div className="tb-body">
          <div className="seg seg-fill" role="group" aria-label="Import source">
            <button
              type="button"
              className={tab === 'file' ? 'active' : ''}
              data-testid="rk-tab-file"
              onClick={() => setTab('file')}
            >
              Upload File
            </button>
            <button
              type="button"
              className={tab === 'cloud' ? 'active' : ''}
              data-testid="rk-tab-cloud"
              onClick={() => setTab('cloud')}
            >
              reMarkable Cloud
            </button>
          </div>
          {error && <p className="tb-error">{error}</p>}
          {tab === 'file' ? (
            <FileTab onPick={stageFile} />
          ) : (
            <CloudTab onStage={setStaged} onError={setError} onDone={close} />
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
      className="tb-drop"
      data-testid="rk-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        read(e.dataTransfer.files[0]);
      }}
    >
      <p>Drop a .rm page, .rmdoc bundle, or .rmn archive (RCU) here, or</p>
      <button type="button" className="sync-primary" onClick={() => inputRef.current?.click()}>
        Choose File
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".rm,.rmdoc,.rmn"
        hidden
        data-testid="rk-file-input"
        onChange={(e) => {
          read(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <p className="tb-hint">Lines v6 files from firmware 3.x (reMarkable 1/2, Paper Pro).</p>
    </div>
  );
}

function CloudTab({
  onStage,
  onError,
  onDone,
}: {
  onStage: (staged: Staged) => void;
  onError: (message: string | null) => void;
  onDone: () => void;
}) {
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; ratio: number | null } | null>(null);
  const [docs, setDocs] = useState<RmDoc[] | null>(null);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);

  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!signedIn || !settings.deviceToken || loadedFor.current === settings.deviceToken) return;
    loadedFor.current = settings.deviceToken;
    setBusy(true);
    void (async () => {
      try {
        const token = await ensureUserToken();
        const { docs: list } = await proxy<{ docs: RmDoc[] }>('list', {
          baseUrl: settings.baseUrl,
          userToken: token,
        });
        setDocs(list);
      } catch (err) {
        userToken = null;
        loadedFor.current = null;
        onError(err instanceof Error ? err.message : 'Could not list documents.');
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, settings.deviceToken]);

  if (!hasSyncServer() || !signedIn) return <SyncGateHint />;
  if (!settings.deviceToken) {
    return (
      <>
        <ConnectForm onError={onError} />
        <p className="tb-hint">
          The connection is saved with the plugin&apos;s settings (Settings → Plugins → reMarkable).
        </p>
      </>
    );
  }
  if (!docs) return <p className="tb-hint">Loading your documents</p>;

  const here = trail.length ? trail[trail.length - 1]!.id : '';
  const entries = docs
    .filter((d) => d.parent === here)
    .sort(
      (a, b) =>
        (a.type === 'folder' ? 0 : 1) - (b.type === 'folder' ? 0 : 1) ||
        a.name.localeCompare(b.name),
    );

  const fetchBlob = async (
    hash: string,
    label: string,
    ratioBase: number,
    ratioSpan: number,
    size = 0,
  ) => {
    const token = await ensureUserToken();
    const res = await apiFetch('/api/remarkable/blob', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ baseUrl: settings.baseUrl, userToken: token, hash }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? 'Download failed.');
    }
    const total = Number(res.headers.get('content-length') ?? 0) || size;
    if (!res.body) return res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      setProgress({
        label,
        ratio: total > 0 ? ratioBase + ratioSpan * Math.min(1, loaded / total) : null,
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

  const openDoc = async (doc: RmDoc) => {
    onError(null);
    if (doc.type === 'folder') {
      setTrail([...trail, { id: doc.id, name: doc.name }]);
      return;
    }
    setBusy(true);
    setProgress({ label: `Opening ${doc.name}`, ratio: null });
    try {
      const token = await ensureUserToken();
      const manifest = await proxy<{
        fileType: string;
        pages: { id: string; hash: string; size: number }[];
        pdf: { hash: string; size: number } | null;
        epub: { hash: string; size: number } | null;
      }>('doc', { baseUrl: settings.baseUrl, userToken: token, docId: doc.id });

      if (manifest.pdf || manifest.epub) {
        const comp = manifest.pdf ?? manifest.epub!;
        const mime = manifest.pdf ? 'application/pdf' : 'application/epub+zip';
        const ext = manifest.pdf ? '.pdf' : '.epub';
        const bytes = await fetchBlob(comp.hash, `Downloading ${doc.name}`, 0, 1, comp.size);
        setProgress({ label: `Importing ${doc.name}`, ratio: null });
        await importMediaFiles(
          [new File([bytes], doc.name.endsWith(ext) ? doc.name : doc.name + ext, { type: mime })],
          clientToCanvas(window.innerWidth / 2, window.innerHeight / 2),
        );
        onDone();
        return;
      }

      const pages: RmPage[] = [];
      for (let i = 0; i < manifest.pages.length; i++) {
        const p = manifest.pages[i]!;
        const bytes = await fetchBlob(
          p.hash,
          `Downloading page ${i + 1}/${manifest.pages.length}`,
          i / manifest.pages.length,
          1 / manifest.pages.length,
          p.size,
        );
        pages.push(parseRmPage(bytes));
      }
      if (!pages.length) throw new Error('This notebook has no pages.');
      onStage({ pages, name: doc.name });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not open the document.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="tb-browser" data-testid="rk-browser">
      <div className="tb-path btns btns-ghost btns-sm">
        <button
          type="button"
          disabled={busy || trail.length === 0}
          data-testid="rk-up"
          onClick={() => setTrail(trail.slice(0, -1))}
        >
          ←
        </button>
        <span>{trail.length ? trail.map((t) => t.name).join(' / ') : 'My Files'}</span>
      </div>
      {progress && (
        <div className="tb-progress" data-testid="rk-progress">
          <span className="tb-progress-label">
            {progress.label}
            {progress.ratio !== null ? ` — ${Math.round(progress.ratio * 100)}%` : '…'}
          </span>
          <span className="tb-progress-track">
            <span
              className={`tb-progress-fill${progress.ratio === null ? ' indeterminate' : ''}`}
              style={progress.ratio !== null ? { width: `${progress.ratio * 100}%` } : undefined}
            />
          </span>
        </div>
      )}
      <div className="tb-list">
        {entries.map((d) => (
          <button
            key={d.id}
            type="button"
            className="tb-row"
            disabled={busy}
            data-testid={`rk-entry-${d.name}`}
            onClick={() => void openDoc(d)}
          >
            <span className="tb-row-icon">
              {d.type === 'folder' ? (
                <FolderIcon size={14} />
              ) : d.type === 'notebook' ? (
                <PenLineIcon size={14} />
              ) : d.type === 'pdf' ? (
                <FileTextIcon size={14} />
              ) : (
                <BookOpenIcon size={14} />
              )}
            </span>
            <span className="tb-row-name">{d.name}</span>
            {d.type === 'notebook' && (
              <span className="tb-row-size">
                {d.pages} page{d.pages === 1 ? '' : 's'}
              </span>
            )}
          </button>
        ))}
        {entries.length === 0 && <p className="tb-hint">This folder is empty.</p>}
      </div>
      <p className="tb-hint">Notebooks open a page picker; PDFs and ePubs import directly.</p>
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
  const { pages, name } = staged;
  const [thumbs, setThumbs] = useState<(string | null)[]>(() => pages.map(() => null));
  const [selected, setSelected] = useState<boolean[]>(() => pages.map(() => true));
  const [format, setFormat] = useState<'images' | 'pdf'>('images');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < pages.length; i++) {
        if (cancelled) return;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        try {
          const canvas = renderRmPage(pages[i]!, 220 / pages[i]!.width);
          if (!cancelled) {
            const url = canvas.toDataURL('image/png');
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
  }, [pages]);

  const importPages = async () => {
    setBusy(true);
    setError(null);
    try {
      const at = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
      const picked = pages.map((_, i) => i).filter((i) => selected[i]);
      if (!picked.length) return;
      if (format === 'pdf') {
        await importMediaFiles(
          [
            await buildRmPdf(
              picked.map((i) => pages[i]!),
              name,
            ),
          ],
          at,
        );
      } else {
        const files: File[] = [];
        for (const i of picked) {
          const canvas = renderRmPage(pages[i]!, 1);
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
  const allSelected = count === pages.length;
  return (
    <div className="tb-body">
      {error && <p className="tb-error">{error}</p>}
      <div className="tb-picker-bar btns">
        <button type="button" onClick={onBack} disabled={busy}>
          ← Back
        </button>
        <button
          type="button"
          data-testid="rk-select-all"
          onClick={() => setSelected(pages.map(() => !allSelected))}
        >
          {allSelected ? 'Select None' : 'Select All'}
        </button>
        <div className="seg tb-format" role="group" aria-label="Import format">
          <button
            type="button"
            className={format === 'images' ? 'active' : ''}
            data-testid="rk-format-images"
            onClick={() => setFormat('images')}
          >
            Images
          </button>
          <button
            type="button"
            className={format === 'pdf' ? 'active' : ''}
            data-testid="rk-format-pdf"
            onClick={() => setFormat('pdf')}
          >
            Vector PDF
          </button>
        </div>
        <button
          type="button"
          className="sync-primary"
          disabled={busy || count === 0}
          data-testid="rk-import"
          onClick={() => void importPages()}
        >
          {busy
            ? 'Importing'
            : format === 'pdf'
              ? `Import PDF (${count} Page${count === 1 ? '' : 's'})`
              : `Import ${count} Page${count === 1 ? '' : 's'}`}
        </button>
      </div>
      <div className="tb-pages" data-testid="rk-pages">
        {pages.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`tb-page${selected[i] ? ' selected' : ''}`}
            data-testid={`rk-page-${i + 1}`}
            onClick={() => setSelected((prev) => prev.map((v, j) => (j === i ? !v : v)))}
          >
            {thumbs[i] ? (
              <img src={thumbs[i]!} alt={`Page ${i + 1}`} />
            ) : (
              <span className="tb-page-loading" />
            )}
            <span className="tb-page-num">{i + 1}</span>
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
    order: 59,
    name: 'reMarkable',
    description:
      'Import reMarkable notebook pages as images or a true vector PDF — upload .rm/.rmdoc files or browse your reMarkable Cloud / rmfakecloud, including PDFs and ePubs stored there.',
  },
  addMenu: [
    {
      label: 'Import reMarkable Notes',
      category: 'documents',
      icon: <TabletIcon />,
      onSelect: () => useRmDialog.getState().openDialog(),
    },
  ],
  Component: RemarkableDialog,
  SettingsPanel: RemarkableSettingsPanel,
});
