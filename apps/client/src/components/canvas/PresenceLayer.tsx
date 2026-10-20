import { useCollabStore } from '../../state/collabStore';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * World-space presence for team boards: each peer's live cursor (colored
 * pointer + name tag) and the outline of whatever they have selected.
 * Sizes counter-scale so presence chrome stays screen-constant at any zoom.
 */
export function PresenceLayer() {
  const peers = useCollabStore((s) => s.peers);
  const remoteOverrides = useCollabStore((s) => s.remoteOverrides);
  const items = useDocumentStore((s) => s.doc.items);
  const scale = useDocumentStore((s) => s.doc.viewport.scale);
  const doc = useDocumentStore((s) => s.doc);
  const myPage = useSessionStore((s) => s.activePageId);
  const first = doc.pages[0]?.id ?? null;
  const mine = myPage ?? first;
  // Pages: only co-paged peers paint cursors/outlines on this canvas.
  const list = Object.values(peers).filter((p) => (p.page ?? first) === mine);
  if (list.length === 0) return null;
  const k = 1 / scale;

  return (
    <svg className="presence-layer" aria-hidden>
      {list.map((peer) => (
        <g key={peer.id}>
          {peer.selection.map((id) => {
            const item = items[id];
            if (!item) return null;
            const live = remoteOverrides[id]?.bounds;
            const x = live?.x ?? item.x;
            const y = live?.y ?? item.y;
            const w = live?.width ?? item.width;
            const h = live?.height ?? item.height;
            return (
              <rect
                key={id}
                className="presence-selection"
                x={x - 3 * k}
                y={y - 3 * k}
                width={w + 6 * k}
                height={h + 6 * k}
                rx={4 * k}
                style={{ stroke: peer.color }}
              />
            );
          })}
          {peer.cursor && (
            <g
              transform={`translate(${peer.cursor.x}, ${peer.cursor.y}) scale(${k})`}
              data-testid="presence-cursor"
            >
              <path
                d="M0 0 L0 14 L4 11 L7 17 L9.4 16 L6.5 10 L11 9.5 Z"
                fill={peer.color}
                stroke="white"
                strokeWidth="1"
              />
              <g transform="translate(12, 16)">
                <rect
                  x={0}
                  y={0}
                  width={peer.name.length * 6.6 + 12}
                  height={18}
                  rx={9}
                  fill={peer.color}
                />
                <text x={6} y={12.5} className="presence-name">
                  {peer.name}
                </text>
              </g>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}
