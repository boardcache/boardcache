import { canvasToScreen } from '../../lib/canvas/coords';
import { effectiveBounds } from '../../lib/canvas/gestures';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Blinking status under each in-flight AI generation: "Thinking" before the
 * first token, "Streaming" while it fills in. Positioned just below the box in
 * screen space so it stays a constant size at any zoom.
 */
export function AIGenerationStatus() {
  const generations = useSessionStore((s) => s.aiGenerations);
  const items = useDocumentStore((s) => s.doc.items);
  const viewport = useDocumentStore((s) => s.doc.viewport);

  const entries = Object.entries(generations);
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map(([id, phase]) => {
        const item = items[id];
        if (!item) return null;
        const aabb = rotatedRectAABB(effectiveBounds(item));
        const anchor = canvasToScreen(
          { x: aabb.x + aabb.width / 2, y: aabb.y + aabb.height },
          viewport,
        );
        return (
          <div
            key={id}
            className="ai-status-pill"
            data-testid={`ai-status-${phase}`}
            style={{ left: anchor.x, top: anchor.y + 8 }}
          >
            {phase === 'thinking' ? 'Thinking' : 'Streaming'}
          </div>
        );
      })}
    </>
  );
}
