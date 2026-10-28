import { revealItemPage } from '../../lib/board/pages';
import { useEffect, useState } from 'react';
import { getCanvasContainer } from '../../lib/canvas/canvasDom';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { mediaMeta } from '../../lib/mediaItems';
import { duplicatePairs, outlierItems, type ScoredItem } from '../../lib/search/similarity';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { SemanticHint } from '../chrome/SemanticHint';
import { UiDialog } from '../ui/Dialog';

/**
 * Board Insights (View menu): what the local similarity engine notices —
 * near-duplicate pairs worth cleaning up, and the items that fit the board
 * least ("the odd ones out" — on a research board, the leads that don't
 * match the theory). Read-only: revealing is the only action.
 */
export function InsightsDialog() {
  const open = useSessionStore((s) => s.insightsOpen);
  return open ? <Body /> : null;
}

interface Data {
  dupes: { a: string; b: string; score: number }[];
  outliers: ScoredItem[];
}

function Body() {
  const close = () => useSessionStore.getState().setInsightsOpen(false);
  const doc = useDocumentStore((s) => s.doc);
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([duplicatePairs(), outlierItems()]).then(([dupes, outliers]) => {
      if (live) setData({ dupes, outliers });
    });
    return () => {
      live = false;
    };
  }, []);

  const nameOf = (id: string) => (doc.items[id] ? mediaMeta(doc.items[id]!).title : '(deleted)');
  const reveal = (ids: string[]) => {
    close();
    const session = useSessionStore.getState();
    if (session.view !== 'canvas') session.setView('canvas');
    session.setSelection(ids);
    const first = doc.items[ids[0]!];
    revealItemPage(ids[0]!);
    if (first) fitViewportTo(rotatedRectAABB(first), getCanvasContainer());
  };

  return (
    <UiDialog
      title="Board Insights"
      onClose={close}
      className="suggest-conn-sheet"
      size="wide"
      testId="insights-dialog"
    >
      <div className="suggest-conn-body">
        {data === null ? (
          <p className="suggest-conn-empty">Reading the board</p>
        ) : (
          <>
            <p className="suggest-conn-hint">
              Local analysis only — nothing is changed or deleted; every row just shows you where to
              look.
            </p>
            <span className="lsp-field-label">Possible duplicates</span>
            {data.dupes.length === 0 ? (
              <p className="suggest-conn-empty" data-testid="insights-no-dupes">
                No near-duplicate content found.
              </p>
            ) : (
              <ul className="suggest-conn-list">
                {data.dupes.map((d) => (
                  <li
                    key={`${d.a}|${d.b}`}
                    className="suggest-conn-row"
                    data-testid="insights-dupe"
                  >
                    <div className="suggest-conn-pair">
                      <span className="suggest-conn-name">{nameOf(d.a)}</span>
                      <span className="suggest-conn-arrow">≈</span>
                      <span className="suggest-conn-name">{nameOf(d.b)}</span>
                    </div>
                    <div className="suggest-conn-why">
                      Nearly identical content
                      <span className="suggest-conn-score">{Math.round(d.score * 100)}%</span>
                    </div>
                    <div className="suggest-conn-actions">
                      <button
                        type="button"
                        className="suggest-conn-btn primary"
                        data-testid="insights-dupe-show"
                        onClick={() => reveal([d.a, d.b])}
                      >
                        Show both
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <span className="lsp-field-label" style={{ marginTop: 12 }}>
              The odd ones out
            </span>
            {data.outliers.length === 0 ? (
              <p className="suggest-conn-empty" data-testid="insights-no-outliers">
                Not enough text-bearing items to judge fit yet.
              </p>
            ) : (
              <ul className="suggest-conn-list">
                {data.outliers.map((o) => (
                  <li key={o.id} className="suggest-conn-row" data-testid="insights-outlier">
                    <div className="suggest-conn-pair">
                      <span className="suggest-conn-name mlt-name">{nameOf(o.id)}</span>
                    </div>
                    <div className="suggest-conn-why">
                      Reads least like the rest of the board
                      <span className="suggest-conn-score">{Math.round(o.score * 100)}% fit</span>
                    </div>
                    <div className="suggest-conn-actions">
                      <button
                        type="button"
                        className="suggest-conn-btn primary"
                        data-testid="insights-outlier-show"
                        onClick={() => reveal([o.id])}
                      >
                        Show on canvas
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <SemanticHint />
      </div>
    </UiDialog>
  );
}
