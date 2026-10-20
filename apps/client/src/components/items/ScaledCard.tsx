import { useSessionStore } from '../../state/sessionStore';

/**
 * Uniform-zoom chassis for content cards (Task List, Project): the card
 * renders at `width ÷ zoom` and is scaled by `zoom`. During a resize drag the
 * live geometry comes from the gesture: a UNIFORM drag (corner) previews the
 * zoom growing with the width; an edge drag keeps the zoom and lets the
 * content reflow into the new box. Cards without a stored zoom derive it
 * from their width (the legacy rule). The lightbox (`stage`) is unscaled.
 */
export function ScaledCard({
  item,
  baseW,
  stage = false,
  children,
}: {
  item: { id: string; width: number; height: number; zoom?: number | undefined };
  baseW: number;
  stage?: boolean | undefined;
  children: React.ReactNode;
}) {
  const liveW = useSessionStore((s) =>
    s.gesture?.kind === 'resize' ? (s.gesture.overrides[item.id]?.width ?? null) : null,
  );
  const liveH = useSessionStore((s) =>
    s.gesture?.kind === 'resize' ? (s.gesture.overrides[item.id]?.height ?? null) : null,
  );
  const uniform = useSessionStore((s) => s.gesture?.kind === 'resize' && !!s.gesture.uniform);
  if (stage) return <>{children}</>;
  const zoom = item.zoom ?? item.width / Math.max(1, baseW);
  const k = uniform && liveW !== null && item.width > 0 ? zoom * (liveW / item.width) : zoom;
  return (
    <div className="card-fit">
      <div
        className="card-scale"
        style={{
          width: (liveW ?? item.width) / Math.max(0.01, k),
          height: (liveH ?? item.height) / Math.max(0.01, k),
          transform: `scale(${k})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
