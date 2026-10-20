import { useSessionStore } from '../../state/sessionStore';

/** Blocking spinner shown while an export is being prepared for download.
 *  Tasks that report progress (board downloads) get a bar instead. */
export function ExportOverlay() {
  const label = useSessionStore((s) => s.exportBusy);
  const progress = useSessionStore((s) => s.exportProgress);
  if (!label) return null;
  return (
    <div className="export-overlay" data-testid="export-overlay">
      <div className="export-overlay-card">
        {progress === null && <span className="export-spinner" aria-hidden />}
        <span>{label}</span>
        {progress !== null && (
          <span className="export-progressbar" data-testid="export-progressbar" aria-hidden>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        )}
      </div>
    </div>
  );
}
