import { useEffect, useState } from 'react';
import { formatBytes } from '../../lib/board/boardSize';
import {
  exportCurrentAsViewer,
  viewerExportSummary,
  type ViewerExportSummary,
} from '../../lib/export/exportViewer';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { UiDialog } from '../ui/Dialog';

/**
 * Confirms an Interactive Offline boardCache export: shows what's included and a
 * rough size before building, then a "Building" state while the zip is made.
 */
export function ViewerExportDialog() {
  const open = useSessionStore((s) => s.viewerExportOpen);
  return open ? <ViewerExportDialogBody /> : null;
}

function ViewerExportDialogBody() {
  const close = () => useSessionStore.getState().setViewerExportOpen(false);
  const [summary, setSummary] = useState<ViewerExportSummary | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const doc = useDocumentStore.getState().doc;
    void viewerExportSummary(doc)
      .then((s) => alive && setSummary(s))
      .catch(() => alive && setError('Could not read the board’s assets.'));
    return () => {
      alive = false;
    };
  }, []);

  const doExport = async () => {
    setBuilding(true);
    setError(null);
    try {
      await exportCurrentAsViewer();
      close();
    } catch (err) {
      console.error('boardCache: viewer export failed', err);
      setError('The export failed. Please try again.');
      setBuilding(false);
    }
  };

  return (
    <UiDialog
      title="Interactive Offline boardCache"
      onClose={close}
      className="export-sheet"
      testId="viewer-export-dialog"
      dismissable={!building}
    >
      <div className="export-body">
        <p className="export-intro">
          Packages this board as a self-contained <code>.zip</code> you can open offline by
          double-clicking <code>index.html</code> — no web server or internet needed.
        </p>

        <div className="export-manifest" data-testid="export-manifest">
          <div className="export-row">
            <span>index.html + viewer app</span>
            <span>{summary ? `~${formatBytes(summary.appBytes)}` : '…'}</span>
          </div>
          {summary?.groups.map((g) => (
            <div className="export-row" key={g.label}>
              <span>
                {g.count} {g.label}
              </span>
              <span>{formatBytes(g.bytes)}</span>
            </div>
          ))}
          {summary && summary.groups.length === 0 && (
            <div className="export-row export-muted">
              <span>No media assets on this board</span>
              <span>—</span>
            </div>
          )}
          <div className="export-row export-total">
            <span>Estimated total</span>
            <span data-testid="export-total">
              {summary ? `~${formatBytes(summary.totalBytes)}` : '…'}
            </span>
          </div>
        </div>

        {building && (
          <p className="export-status" data-testid="export-building">
            <span className="export-spinner" aria-hidden /> Building your export
          </p>
        )}
        {error && (
          <p className="export-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className="export-actions">
        <button type="button" className="export-cancel" onClick={close} disabled={building}>
          Cancel
        </button>
        <button
          type="button"
          className="export-primary"
          onClick={() => void doExport()}
          disabled={building || !summary}
          data-testid="viewer-export-confirm"
        >
          {building ? 'Building' : 'Export'}
        </button>
      </footer>
    </UiDialog>
  );
}
