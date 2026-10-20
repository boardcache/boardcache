import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ConnectionEndpoint } from '@boardcache/schema';
import { anchorOnRect, endpointRect } from '../../lib/canvas/connections';
import { activePageId, onPage } from '../../lib/board/pages';
import { beginConnect } from '../../lib/canvas/gestures';
import { selectionGroupState } from '../../lib/canvas/grouping';
import { useCanvasReadOnly } from '../../lib/canvas/readOnly';
import { VIEWER } from '../../lib/viewerMode';
import type { Rect } from '../../lib/canvas/coords';
import { useShallow } from 'zustand/react/shallow';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { themeFlags } from '../../lib/themes';
import { relColor, relDirectional } from '../../lib/canvas/connectionTypes';

/**
 * World-space SVG layer for connections: committed connector lines (rendered
 * beneath the items), the live connect-drag draft, and the connect handles on
 * the current selection. Lines select on click; Delete removes them.
 */

const rectCenter = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** The endpoint the current selection offers for connecting, if any. */
function selectionEndpoint(): ConnectionEndpoint | null {
  const session = useSessionStore.getState();
  const doc = useDocumentStore.getState().doc;
  const sel = session.selection;
  if (sel.length === 0) return null;
  const state = selectionGroupState(doc, sel, session.isolatedGroupId);
  // A fully-selected group connects as the group — unless it's isolated,
  // where members act as individuals.
  if (state.groupId && session.isolatedGroupId !== state.groupId) {
    return { kind: 'group', id: state.groupId };
  }
  if (sel.length === 1 && doc.items[sel[0]!]) return { kind: 'item', id: sel[0]! };
  return null;
}

export function ConnectionsLayer() {
  const connections = useDocumentStore(useShallow((s) => s.doc.connections));
  const doc = useDocumentStore((s) => s.doc);
  const scale = useDocumentStore((s) => s.doc.viewport.scale);
  const overrides = useSessionStore((s) => s.gesture?.overrides);
  const selectedId = useSessionStore((s) => s.selectedConnectionId);
  const draft = useSessionStore((s) => s.connectDraft);
  const visible = useSessionStore((s) => s.connectionsVisible);
  // Re-derive the handle endpoint when the selection changes.
  const selection = useSessionStore((s) => s.selection);
  const isolated = useSessionStore((s) => s.isolatedGroupId);
  void selection;
  void isolated;

  // Hidden connections also hide the create-affordance — a drag would land
  // an invisible line.
  const readOnly = useCanvasReadOnly();
  const handleSource = readOnly || !visible ? null : selectionEndpoint();
  const handleRect = handleSource ? endpointRect(doc, handleSource, overrides) : null;

  const page = useSessionStore((s) => s.activePageId);
  const pageOf = (endpoint: { kind: string; id: string }): boolean => {
    if (endpoint.kind !== 'item') return true; // group endpoints follow members
    const item = doc.items[endpoint.id];
    return !item || onPage(doc, item, activePageId(doc));
  };
  void page; // subscription: re-filter on page switches
  // A connection touching a HIDDEN item hides with it.
  const endpointHidden = (e: { kind: string; id: string }): boolean =>
    e.kind === 'item' && Boolean(doc.items[e.id]?.hidden);
  const lines = (visible ? Object.values(connections) : [])
    .filter((c) => pageOf(c.from) && pageOf(c.to))
    .filter((c) => !endpointHidden(c.from) && !endpointHidden(c.to))
    .map((c) => {
      const fromRect = endpointRect(doc, c.from, overrides);
      const toRect = endpointRect(doc, c.to, overrides);
      if (!fromRect || !toRect) return null; // dangling — pruned on next edit
      const a = anchorOnRect(fromRect, rectCenter(toRect));
      const b = anchorOnRect(toRect, rectCenter(fromRect));
      return { id: c.id, a, b, label: c.label, rel: c.rel };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const draftGeometry = (() => {
    if (!draft) return null;
    const fromRect = endpointRect(doc, draft.from, overrides);
    if (!fromRect) return null;
    const targetRect = draft.target ? endpointRect(doc, draft.target, overrides) : null;
    const end = targetRect ? anchorOnRect(targetRect, rectCenter(fromRect)) : draft;
    const a = anchorOnRect(fromRect, end);
    return { a, end, targetRect };
  })();

  if (lines.length === 0 && !draftGeometry && !handleRect) return null;

  // Corkboard personality: connections render as sagging red yarn.
  const yarn = Boolean(themeFlags(useSessionStore.getState().themeId).yarn);
  const stringPath = (a: { x: number; y: number }, b: { x: number; y: number }): string => {
    if (!yarn) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const sag = Math.min(46, 10 + len * 0.08);
    return `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 + sag} ${b.x} ${b.y}`;
  };
  const dot = (yarn ? 5 : 4) / scale;
  const handleR = 5 / scale;
  const selectLine = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    useSessionStore.getState().setSelection([]);
    useSessionStore.getState().setSelectedConnection(id);
  };

  const renderLine = ({ id, a, b, label, rel }: (typeof lines)[number]) => {
    const active = id === selectedId;
    // Typed connections carry their meaning as color (inline wins over
    // any theme styling, corkboard's yarn red included).
    const tint = relColor(rel);
    const tintStyle = tint ? { stroke: tint } : undefined;
    const dotStyle = tint ? { fill: tint } : undefined;
    return (
      <g key={id} className={`connection${active ? ' connection-selected' : ''}`}>
        <path
          className="connection-hit"
          d={stringPath(a, b)}
          onPointerDown={readOnly ? undefined : (e) => selectLine(e, id)}
          data-testid="connection-hit"
          data-connection-id={id}
        />
        <path className="connection-line" d={stringPath(a, b)} style={tintStyle} />
        {relDirectional(rel) &&
          (() => {
            // Chevron at the path midpoint, aligned to its tangent. For
            // the yarn quadratic the t=0.5 tangent is still b−a; only
            // the position sags (P(0.5) = ¼a + ½ctrl + ¼b).
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const sag = yarn ? Math.min(46, 10 + len * 0.08) : 0;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 + sag / 2;
            const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            return (
              <path
                className="connection-arrow"
                data-testid="connection-arrow"
                d="M -5 -4.5 L 4 0 L -5 4.5"
                style={tintStyle}
                transform={`translate(${mx} ${my}) rotate(${angle}) scale(${1.4 / scale})`}
              />
            );
          })()}
        <circle className="connection-dot" cx={a.x} cy={a.y} r={dot} style={dotStyle} />
        <circle className="connection-dot" cx={b.x} cy={b.y} r={dot} style={dotStyle} />
        {label && (
          <text
            className="connection-label"
            x={(a.x + b.x) / 2}
            y={(a.y + b.y) / 2 - 6 / scale}
            fontSize={12 / scale}
            textAnchor="middle"
          >
            {label}
          </text>
        )}
      </g>
    );
  };

  // Two stacking layers: unselected lines live BENEATH items (DOM order —
  // this svg has no z-index), so yarn crossing a card never obscures it;
  // the selected line, draft rubber-band and connect handles float above.
  const underLines = lines.filter((l) => l.id !== selectedId);
  const overLines = lines.filter((l) => l.id === selectedId);
  return (
    <>
      <svg className="connections-layer connections-under" aria-hidden={VIEWER}>
        {underLines.map(renderLine)}
      </svg>
      <svg className="connections-layer" aria-hidden={VIEWER}>
        {overLines.map(renderLine)}

        {draftGeometry && (
          <g className="connection-draft">
            {draftGeometry.targetRect && (
              <rect
                className="connection-target"
                x={draftGeometry.targetRect.x - 4 / scale}
                y={draftGeometry.targetRect.y - 4 / scale}
                width={draftGeometry.targetRect.width + 8 / scale}
                height={draftGeometry.targetRect.height + 8 / scale}
                rx={6 / scale}
                data-testid="connection-target"
              />
            )}
            <path
              className="connection-line connection-draft-line"
              d={stringPath(draftGeometry.a, draftGeometry.end)}
            />
            <circle
              className="connection-dot"
              cx={draftGeometry.end.x}
              cy={draftGeometry.end.y}
              r={dot}
            />
          </g>
        )}

        {handleRect &&
          handleSource &&
          !draft &&
          // Just OUTSIDE the frame so they never collide with the edge
          // resize handles (top clears the rotate handle at 28px too).
          (
            [
              { x: handleRect.x + handleRect.width / 2, y: handleRect.y - 14 / scale },
              {
                x: handleRect.x + handleRect.width + 14 / scale,
                y: handleRect.y + handleRect.height / 2,
              },
              {
                x: handleRect.x + handleRect.width / 2,
                y: handleRect.y + handleRect.height + 14 / scale,
              },
              { x: handleRect.x - 14 / scale, y: handleRect.y + handleRect.height / 2 },
            ] as const
          ).map((p, i) => (
            <circle
              key={i}
              className="connect-handle"
              cx={p.x}
              cy={p.y}
              r={handleR}
              data-testid="connect-handle"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                beginConnect(e, handleSource);
              }}
            />
          ))}
      </svg>
    </>
  );
}
