import { useEffect, useState } from 'react';
import { mediaMeta } from '../../lib/mediaItems';
import {
  dismissSuggestion,
  suggestConnections,
  type ConnectionSuggestion,
} from '../../lib/search/suggestConnections';
import { addConnection } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { SemanticHint } from '../chrome/SemanticHint';
import { UiDialog } from '../ui/Dialog';
import { CloseIcon, LinkIcon } from '../icons';

/**
 * Review queue for AI-suggested connections (research arc 4/10): pairs of
 * unconnected items with overlapping content, each with a "why" line. Every
 * connection is created by an explicit click — never automatically (user's
 * standing rule). Dismissals stick for the session.
 */
export function SuggestConnectionsDialog() {
  const open = useSessionStore((s) => s.suggestConnectionsOpen);
  return open ? <SuggestBody /> : null;
}

function SuggestBody() {
  const close = () => useSessionStore.getState().setSuggestConnectionsOpen(false);
  const doc = useDocumentStore((s) => s.doc);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<ConnectionSuggestion[]>([]);

  useEffect(() => {
    let live = true;
    void suggestConnections().then((s) => {
      if (!live) return;
      setSuggestions(s);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const nameOf = (id: string): string => {
    const item = doc.items[id];
    return item ? mediaMeta(item).title : '(deleted)';
  };

  const drop = (s: ConnectionSuggestion) =>
    setSuggestions((prev) => prev.filter((p) => !(p.a === s.a && p.b === s.b)));

  return (
    <UiDialog
      title="Suggested Connections"
      onClose={close}
      className="suggest-conn-sheet"
      testId="suggest-conn-dialog"
    >
      <div className="suggest-conn-body">
        {loading ? (
          <p className="suggest-conn-empty">Analyzing the board</p>
        ) : suggestions.length === 0 ? (
          <p className="suggest-conn-empty" data-testid="suggest-conn-empty">
            No suggestions right now. Suggestions come from overlapping content between unconnected
            items — add notes, OCR text, or descriptions and try again.
          </p>
        ) : (
          <>
            <p className="suggest-conn-hint">
              Nothing is connected until you approve it. Connect, then click the line to set what it
              means.
            </p>
            <ul className="suggest-conn-list">
              {suggestions.map((s) => (
                <li
                  key={`${s.a}|${s.b}`}
                  className="suggest-conn-row"
                  data-testid="suggest-conn-row"
                >
                  <div className="suggest-conn-pair">
                    <span className="suggest-conn-name">{nameOf(s.a)}</span>
                    <span className="suggest-conn-arrow">↔</span>
                    <span className="suggest-conn-name">{nameOf(s.b)}</span>
                  </div>
                  <div className="suggest-conn-why">
                    {s.reason}
                    <span className="suggest-conn-score">{Math.round(s.score * 100)}%</span>
                  </div>
                  <div className="suggest-conn-actions">
                    <button
                      type="button"
                      className="suggest-conn-btn primary"
                      data-testid="suggest-conn-accept"
                      onClick={() => {
                        addConnection({ kind: 'item', id: s.a }, { kind: 'item', id: s.b });
                        drop(s);
                      }}
                    >
                      <LinkIcon size={14} /> Connect
                    </button>
                    <button
                      type="button"
                      className="suggest-conn-btn"
                      data-testid="suggest-conn-dismiss"
                      aria-label="Dismiss suggestion"
                      onClick={() => {
                        dismissSuggestion(s.a, s.b);
                        drop(s);
                      }}
                    >
                      <CloseIcon size={14} /> Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <SemanticHint />
      </div>
    </UiDialog>
  );
}
