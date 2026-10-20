import { useState } from 'react';
import { create } from 'zustand';
import { importUrlList, type UrlLineResult } from '../../lib/import/importFromUrl';
import { UiDialog } from '../ui/Dialog';

/** Core "Import from URL": paste links (one per line), get media on the canvas. */

interface ImportUrlState {
  open: boolean;
  toggle: (open: boolean) => void;
}

export const useImportUrlDialog = create<ImportUrlState>((set) => ({
  open: false,
  toggle: (open) => set({ open }),
}));

export function ImportUrlDialog() {
  const open = useImportUrlDialog((s) => s.open);
  return open ? <ImportUrlDialogBody /> : null;
}

type Phase = 'edit' | 'busy' | 'done';

function ImportUrlDialogBody() {
  const close = () => useImportUrlDialog.getState().toggle(false);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('edit');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<UrlLineResult[]>([]);

  const urls = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const run = async () => {
    if (!urls.length || phase === 'busy') return;
    setPhase('busy');
    setProgress({ done: 0, total: urls.length });
    const outcome = await importUrlList(urls, (done, total) => setProgress({ done, total }));
    setResults(outcome);
    setPhase('done');
  };

  const imported = results.filter((r) => r.ok).length;
  const failures = results.filter((r) => !r.ok);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <UiDialog
      title="Import from URL"
      onClose={close}
      className="export-sheet"
      testId="importurl-dialog"
    >
      <div className="export-body">
        {phase === 'edit' && (
          <>
            <p className="export-intro">
              One URL per line. Images, video, audio, PDFs, fonts, text/Markdown, board files,
              YouTube/Vimeo links (embedded as players) — anything else that's a webpage becomes a
              link button.
            </p>
            <label className="plugin-settings-field">
              <span>URLs</span>
              <textarea
                value={text}
                placeholder={'https://example.com/photo.jpg\nhttps://example.com/clip.mp4'}
                autoFocus
                data-autofocus
                rows={6}
                spellCheck={false}
                data-testid="importurl-input"
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="aimedia-actions">
              <button
                type="button"
                className="sync-primary"
                disabled={!urls.length}
                data-testid="importurl-confirm"
                onClick={() => void run()}
              >
                {urls.length > 1 ? `Import ${urls.length} URLs` : 'Import'}
              </button>
            </div>
          </>
        )}
        {phase === 'busy' && (
          <>
            <p className="export-intro">
              Importing {Math.min(progress.done + 1, progress.total)} of {progress.total}…
            </p>
            <div className="importurl-progress" data-testid="importurl-progress">
              <div className="importurl-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
        {phase === 'done' && (
          <>
            <p className="export-intro" data-testid="importurl-summary">
              Imported {imported} of {results.length} {results.length === 1 ? 'item' : 'items'}.
            </p>
            {failures.length > 0 && (
              <ul className="importurl-failures">
                {failures.map((f) => (
                  <li key={f.url} className="sync-error" data-testid="importurl-error">
                    <strong>{f.url}</strong> — {f.error}
                  </li>
                ))}
              </ul>
            )}
            <div className="aimedia-actions">
              <button
                type="button"
                className="sync-primary"
                data-testid="importurl-close"
                onClick={close}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </UiDialog>
  );
}
