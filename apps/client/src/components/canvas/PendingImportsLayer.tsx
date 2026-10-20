import { useRef } from 'react';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Canvas placeholders for media still being prepared (HEIC → JPEG conversion,
 * video probing/poster generation, AI generation). Rendered inside the world
 * layer so they pan/zoom in place, then vanish when the real item replaces
 * them. Cards are DRAGGABLE while loading — the finished media lands wherever
 * the card was moved. Drag uses window listeners so it survives the card's
 * re-renders (the store updates on every move) and the canvas pan handler.
 */
export function PendingImportsLayer() {
  const pending = useSessionStore((s) => s.pendingImports);
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(
    null,
  );
  if (pending.length === 0) return null;

  const onPointerDown = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const card = useSessionStore.getState().pendingImports.find((p) => p.id === id);
    if (!card) return;
    e.preventDefault();
    e.stopPropagation(); // not a canvas pan / marquee
    drag.current = { id, startX: e.clientX, startY: e.clientY, x: card.x, y: card.y };

    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const scale = useDocumentStore.getState().doc.viewport.scale || 1;
      useSessionStore.getState().updatePendingImport(d.id, {
        x: d.x + (ev.clientX - d.startX) / scale,
        y: d.y + (ev.clientY - d.startY) / scale,
      });
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      {pending.map((p) => (
        <div
          key={p.id}
          className={`pending-import${p.error ? ' is-error' : ''}`}
          data-testid="pending-import"
          data-status={p.error ? 'error' : 'loading'}
          style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.width, height: p.height }}
          onPointerDown={p.error ? undefined : onPointerDown(p.id)}
        >
          <div className="pending-import-inner">
            {!p.error && <span className="pending-import-spinner" aria-hidden />}
            <span className="pending-import-title">{p.label}</span>
            <span className="pending-import-name">{p.name}</span>
          </div>
        </div>
      ))}
    </>
  );
}
