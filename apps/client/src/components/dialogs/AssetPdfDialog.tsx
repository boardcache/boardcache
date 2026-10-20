import { useMemo, useState } from 'react';
import { MoonIcon, SunIcon } from '../icons';
import { assetPdfCategories, exportCurrentAsAssetPdf } from '../../lib/export/exportAssetPdf';
import { withExportStatus } from '../../lib/export/exportStatus';
import { useDocumentStore } from '../../state/documentStore';
import { resolveTheme, useSessionStore } from '../../state/sessionStore';
import { UiDialog } from '../ui/Dialog';

/** Asset PDF export: choose which media types to include, then generate. */
export function AssetPdfDialog() {
  const open = useSessionStore((s) => s.assetPdfOpen);
  return open ? <AssetPdfDialogBody /> : null;
}

function AssetPdfDialogBody() {
  const close = () => useSessionStore.getState().setAssetPdfOpen(false);
  const categories = useMemo(() => assetPdfCategories(useDocumentStore.getState().doc), []);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(categories.map((c) => c.cat)),
  );
  // The PDF's appearance defaults to the app's current theme.
  const [dark, setDark] = useState(() => resolveTheme(useSessionStore.getState().theme) === 'dark');
  const multiPage = useDocumentStore.getState().doc.pages.length > 1;
  const [scope, setScope] = useState<'page' | 'all'>('all');

  const toggle = (cat: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const doExport = () => {
    close();
    void withExportStatus('Generating PDF', () =>
      exportCurrentAsAssetPdf({ types: new Set(selected), dark, scope }),
    );
  };

  return (
    <UiDialog title="Asset PDF" onClose={close} className="export-sheet" testId="asset-pdf-dialog">
      <div className="export-body">
        <p className="export-intro">
          A presentation PDF — a title page, then your assets grouped by type, one per page (with a
          combined Colors section). Choose what to include:
        </p>

        {categories.length === 0 ? (
          <p className="export-intro">This board has no assets to export.</p>
        ) : (
          <div className="export-manifest" data-testid="asset-pdf-types">
            <label className="export-check-row export-check-all" data-testid="asset-pdf-all">
              <input
                type="checkbox"
                checked={selected.size === categories.length}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && selected.size < categories.length;
                }}
                onChange={() =>
                  setSelected(
                    selected.size === categories.length
                      ? new Set()
                      : new Set(categories.map((c) => c.cat)),
                  )
                }
              />
              <span className="export-check-label">
                {selected.size === categories.length ? 'All types' : 'Select all'}
              </span>
            </label>
            {categories.map((c) => (
              <label className="export-check-row" key={c.cat} data-testid={`asset-pdf-${c.cat}`}>
                <input
                  type="checkbox"
                  checked={selected.has(c.cat)}
                  onChange={() => toggle(c.cat)}
                />
                <span className="export-check-label">{c.label}</span>
                <span className="export-check-count">{c.count}</span>
              </label>
            ))}
          </div>
        )}

        <div className="export-appearance" data-testid="asset-pdf-appearance">
          <span className="export-appearance-label">Appearance</span>
          <button
            type="button"
            className={`export-appearance-btn${!dark ? ' active' : ''}`}
            onClick={() => setDark(false)}
            aria-pressed={!dark}
            data-testid="asset-pdf-light"
          >
            <SunIcon /> Light
          </button>
          <button
            type="button"
            className={`export-appearance-btn${dark ? ' active' : ''}`}
            onClick={() => setDark(true)}
            aria-pressed={dark}
            data-testid="asset-pdf-dark"
          >
            <MoonIcon /> Dark
          </button>
        </div>
        {multiPage && (
          <div className="canvas-bg-scope" role="radiogroup" aria-label="Pages">
            <span className="canvas-bg-scope-label">Pages</span>
            <label>
              <input
                type="radio"
                name="apdf-scope"
                checked={scope === 'page'}
                data-testid="asset-pdf-scope-page"
                onChange={() => setScope('page')}
              />
              This page
            </label>
            <label>
              <input
                type="radio"
                name="apdf-scope"
                checked={scope === 'all'}
                data-testid="asset-pdf-scope-all"
                onChange={() => setScope('all')}
              />
              All pages
            </label>
          </div>
        )}
      </div>

      <footer className="export-actions">
        <button type="button" className="export-cancel" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="export-primary"
          onClick={doExport}
          disabled={selected.size === 0}
          data-testid="asset-pdf-confirm"
        >
          Export
        </button>
      </footer>
    </UiDialog>
  );
}
