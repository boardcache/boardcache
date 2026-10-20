import { useMemo } from 'react';
import { stepBounds } from '../../lib/canvas/presentation';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/** Step numbers beside their targets on the canvas — while the panel is open. */
export function PresentationBadges() {
  const open = useSessionStore((s) => s.presentPanelOpen && !s.presenting);
  const doc = useDocumentStore((s) => s.doc);
  const scale = doc.viewport.scale;
  // Derived outside the selector: a selector must return a stable reference.
  const badges = useMemo(
    () =>
      open
        ? doc.presentation.steps.flatMap((st, i) => {
            const b = stepBounds(doc, st.id);
            return b ? [{ id: st.id, n: i + 1, x: b.x, y: b.y }] : [];
          })
        : [],
    [open, doc],
  );
  if (!open) return null;
  return (
    <div className="present-badges" aria-hidden>
      {badges.map((b) => (
        <span
          key={b.id}
          className="present-badge"
          data-testid="present-badge"
          style={{
            left: b.x,
            top: b.y,
            transform: `translate(-40%, -40%) scale(${1 / Math.max(0.05, scale)})`,
          }}
        >
          {b.n}
        </span>
      ))}
    </div>
  );
}
