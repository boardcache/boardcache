import { useEffect, useState } from 'react';
import {
  onSemanticState,
  semanticEnabled,
  semanticState,
  setSemanticEnabled,
} from '../../lib/search/semanticIndex';

/**
 * Shared discoverability footer for the similarity features (Suggest
 * Connections, More Like This, Board Insights): when the on-device model is
 * off they run on keyword overlap alone — say so, and offer the upgrade
 * right where it matters. Renders nothing once the model is active.
 */
export function SemanticHint() {
  const [sem, setSem] = useState(() => ({ ...semanticState(), enabled: semanticEnabled() }));
  useEffect(
    () => onSemanticState(() => setSem({ ...semanticState(), enabled: semanticEnabled() })),
    [],
  );

  if (sem.enabled && sem.state === 'ready') return null;
  return (
    <p className="semantic-hint" data-testid="semantic-hint">
      {!sem.enabled ? (
        <>
          Matching by keywords right now.{' '}
          <button
            type="button"
            className="semantic-hint-btn"
            data-testid="semantic-hint-enable"
            title="Also match by meaning. Downloads a ~25 MB model that runs entirely on this device — works offline afterwards."
            onClick={() => void setSemanticEnabled(true)}
          >
            Enable the on-device semantic model
          </button>{' '}
          for better results.
        </>
      ) : sem.state === 'error' ? (
        <>Semantic model failed to load — keyword matching only.</>
      ) : (
        <>Downloading the semantic model {sem.pct}%</>
      )}
    </p>
  );
}
