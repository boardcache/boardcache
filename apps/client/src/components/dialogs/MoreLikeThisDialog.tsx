import { revealItemPage } from '../../lib/board/pages';
import { useEffect, useState } from 'react';
import { getCanvasContainer } from '../../lib/canvas/canvasDom';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { mediaMeta } from '../../lib/mediaItems';
import { similarItems, type ScoredItem } from '../../lib/search/similarity';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { SemanticHint } from '../chrome/SemanticHint';
import { UiDialog } from '../ui/Dialog';

/**
 * "More like this" (context menu): local content similarity for one item —
 * semantic vectors when the on-device model is enabled, keyword overlap
 * otherwise. Clicking a row flies the canvas to that item.
 */
export function MoreLikeThisDialog() {
  const id = useSessionStore((s) => s.moreLikeThisId);
  return id ? <Body id={id} /> : null;
}

function Body({ id }: { id: string }) {
  const close = () => useSessionStore.getState().setMoreLikeThis(null);
  const doc = useDocumentStore((s) => s.doc);
  const [rows, setRows] = useState<ScoredItem[] | null>(null);

  const [rowsFor, setRowsFor] = useState(id);
  if (rowsFor !== id) {
    setRowsFor(id);
    setRows(null);
  }
  useEffect(() => {
    let live = true;
    similarItems(id, 10)
      .then((r) => {
        if (live) setRows(r.filter((s) => s.id !== id));
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [id]);

  const source = doc.items[id];
  const title = source ? mediaMeta(source).title : '';

  return (
    <UiDialog
      title={`More like “${title.length > 32 ? `${title.slice(0, 32)}…` : title}”`}
      onClose={close}
      className="suggest-conn-sheet"
      size="wide"
      testId="more-like-this"
    >
      <div className="suggest-conn-body">
        {rows === null ? (
          <p className="suggest-conn-empty">Comparing content</p>
        ) : rows.length === 0 ? (
          <p className="suggest-conn-empty" data-testid="mlt-empty">
            Nothing else on this board reads similar. Add notes, OCR text, or descriptions to give
            items more to match on.
          </p>
        ) : (
          <ul className="suggest-conn-list">
            {rows.map((s) => {
              const other = doc.items[s.id];
              if (!other) return null;
              return (
                <li key={s.id} className="suggest-conn-row" data-testid="mlt-row">
                  <div className="suggest-conn-pair">
                    <span className="suggest-conn-name mlt-name">{mediaMeta(other).title}</span>
                  </div>
                  <div className="suggest-conn-why">
                    {s.terms.length ? `Shared: ${s.terms.join(', ')}` : 'Similar content'}
                    <span className="suggest-conn-score">{Math.round(s.score * 100)}%</span>
                  </div>
                  <div className="suggest-conn-actions">
                    <button
                      type="button"
                      className="suggest-conn-btn primary"
                      data-testid="mlt-reveal"
                      onClick={() => {
                        close();
                        const session = useSessionStore.getState();
                        if (session.view !== 'canvas') session.setView('canvas');
                        session.setSelection([s.id]);
                        revealItemPage(other.id);
                        fitViewportTo(rotatedRectAABB(other), getCanvasContainer());
                      }}
                    >
                      Show on canvas
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <SemanticHint />
      </div>
    </UiDialog>
  );
}
