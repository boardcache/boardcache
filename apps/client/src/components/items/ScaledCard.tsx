import { useSessionStore } from '../../state/sessionStore';

/**
 * Uniform-zoom chassis for content cards (Task List, Project): the card
 * renders at `width ÷ zoom` and is scaled by `zoom`. During a resize drag the
 * live geometry comes from the gesture: a UNIFORM drag (corner) previews the
 * zoom growing with the width; an edge drag keeps the zoom and lets the
 * content reflow into the new box. Cards without a stored zoom derive it
 * from their width (the legacy rule). The lightbox (`stage`) is unscaled.
 */
interface ScaledItem {
  id: string;
  width: number;
  height: number;
  zoom?: number | undefined;
}

/**
 * The card's live box on the canvas (`w` × `h`) and its live zoom `k`: the
 * resize gesture's override while one runs, else the stored geometry.
 */
export function useScaledBox(item: ScaledItem, baseW: number): { w: number; h: number; k: number } {
  const liveW = useSessionStore((s) =>
    s.gesture?.kind === 'resize' ? (s.gesture.overrides[item.id]?.width ?? null) : null,
  );
  const liveH = useSessionStore((s) =>
    s.gesture?.kind === 'resize' ? (s.gesture.overrides[item.id]?.height ?? null) : null,
  );
  const uniform = useSessionStore((s) => s.gesture?.kind === 'resize' && !!s.gesture.uniform);
  const zoom = item.zoom ?? item.width / Math.max(1, baseW);
  const k = uniform && liveW !== null && item.width > 0 ? zoom * (liveW / item.width) : zoom;
  return { w: liveW ?? item.width, h: liveH ?? item.height, k: Math.max(0.01, k) };
}

export function ScaledCard({
  item,
  baseW,
  stage = false,
  children,
}: {
  item: ScaledItem;
  baseW: number;
  stage?: boolean | undefined;
  children: React.ReactNode;
}) {
  const { w, h, k } = useScaledBox(item, baseW);
  if (stage) return <>{children}</>;
  return (
    <div className="card-fit">
      <div className="card-scale" style={{ width: w / k, height: h / k, transform: `scale(${k})` }}>
        {children}
      </div>
    </div>
  );
}
