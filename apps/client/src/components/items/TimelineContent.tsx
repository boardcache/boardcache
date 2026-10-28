import { useEffect, useRef, useState } from 'react';
import type { Item, TimelineItem } from '@boardcache/schema';
import { renderItemCanvas } from '../../lib/media/thumbnail';
import { canvasReadOnly, useCanvasReadOnly } from '../../lib/canvas/readOnly';
import { pointColor, timelineSlots } from '../../lib/structure/timelineLayout';
import { addTimelinePoint } from '../../lib/structure/timelineAttach';
import { runSilent } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Timeline cards: an axis with milestone points, each a label + optional
 * date and a collapsible description. Points are edited through the
 * timeline plugin's dialog (dispatched by event so the viewer bundle never
 * carries the editor). Phase 2 turns points into drop-target shelves.
 */

/** Geometric plus — a text "+" never sits optically centered in the circle. */
const PLUS = (
  <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden>
    <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

function requestPointEdit(itemId: string, pointId: string): void {
  window.dispatchEvent(
    new CustomEvent('boardcache:edit-timeline-point', { detail: { itemId, pointId } }),
  );
}

function toggleCollapsed(itemId: string, pointId: string): void {
  // View-ish state: syncs to team rooms but never lands in undo history.
  runSilent((draft) => {
    const item = draft.items[itemId];
    if (item?.type !== 'timeline') return;
    const point = item.points.find((p) => p.id === pointId);
    if (point) point.collapsed = !point.collapsed;
  });
}

/** One attached item as a clickable thumbnail (dives into its lightbox). */
export function StageThumb({ item, returnTo }: { item: Item; returnTo: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const canvas = await renderItemCanvas(item, 2);
        canvas.toBlob((blob) => {
          if (blob && alive) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          }
        });
      } catch {
        /* placeholder stays */
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item]);
  return (
    <button
      type="button"
      className="timeline-stage-thumb"
      title={item.name ?? 'Open item'}
      data-testid={`timeline-stage-thumb-${item.id}`}
      onClick={(e) => {
        e.stopPropagation();
        const session = useSessionStore.getState();
        // Remember the origin so the lightbox offers a way straight back.
        session.setLightboxReturn(returnTo);
        session.setLightbox(item.id);
      }}
    >
      {url ? <img src={url} alt="" /> : <span className="timeline-stage-thumb-ph" />}
    </button>
  );
}

function stagePointBody(
  item: TimelineItem,
  point: TimelineItem['points'][number],
  attached: Item[],
) {
  return (
    <div className="timeline-stage-body">
      {point.date && <span className="timeline-date">{point.date}</span>}
      <span className="timeline-label">{point.label}</span>
      {point.description && <span className="timeline-desc">{point.description}</span>}
      {attached.length > 0 && (
        <div className="timeline-stage-thumbs">
          {attached.map((it) => (
            <StageThumb key={it.id} item={it} returnTo={item.id} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Lightbox stage: the readable timeline — points with descriptions expanded
 *  and their attached items as clickable thumbnails. Tabs at the top switch
 *  between the horizontal (columns along a spine) and vertical (staggered
 *  center-spine) layouts; the default follows the canvas orientation. */
export function TimelineStage({ item }: { item: TimelineItem }) {
  const itemsById = useDocumentStore((s) => s.doc.items);
  const [view, setView] = useState<'horizontal' | 'vertical'>(item.orientation);
  const attachedOf = (point: TimelineItem['points'][number]) =>
    point.itemIds.map((id) => itemsById[id]).filter((it): it is Item => it !== undefined);

  return (
    <div className="timeline-stage-wrap" data-testid="timeline-stage">
      <div className="seg" role="tablist" aria-label="Timeline layout">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'horizontal'}
          className={view === 'horizontal' ? 'active' : ''}
          data-testid="timeline-stage-tab-h"
          onClick={() => setView('horizontal')}
        >
          Horizontal
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'vertical'}
          className={view === 'vertical' ? 'active' : ''}
          data-testid="timeline-stage-tab-v"
          onClick={() => setView('vertical')}
        >
          Vertical
        </button>
      </div>
      <div className="timeline-stage-list">
        {item.name && <h2 className="timeline-stage-title">{item.name}</h2>}
        {view === 'horizontal' ? (
          <div className="timeline-stage-h">
            {item.points.map((point, i) => (
              <div
                className={`timeline-stage-col ${i % 2 === 0 ? 'top' : 'bottom'}`}
                key={point.id}
              >
                <span
                  className="timeline-stage-dot"
                  style={{ background: pointColor(item, point) }}
                />
                {stagePointBody(item, point, attachedOf(point))}
              </div>
            ))}
          </div>
        ) : (
          <div className="timeline-stage-v">
            {item.points.map((point, i) => (
              <div
                className={`timeline-stage-row ${i % 2 === 0 ? 'left' : 'right'}`}
                key={point.id}
              >
                <span
                  className="timeline-stage-dot"
                  style={{ background: pointColor(item, point) }}
                />
                {stagePointBody(item, point, attachedOf(point))}
              </div>
            ))}
          </div>
        )}
        {item.points.length === 0 && <p className="timeline-empty">No points yet.</p>}
      </div>
    </div>
  );
}

export function TimelineContent({ item, stage = false }: { item: TimelineItem; stage?: boolean }) {
  const horizontal = item.orientation === 'horizontal';
  // Layout from the LIVE box, not the committed doc size: during a resize
  // drag the wrapper changes size continuously while item.width/height only
  // commit on release — computing from the doc made half the layout lag and
  // jump. The observer keeps every coordinate tracking the real box.
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const w = box?.w ?? item.width;
  const h = box?.h ?? item.height;
  // Attached item sizes weight the spacing; positions draw the shelf tints.
  const itemsById = useDocumentStore((s) => s.doc.items);
  // During drags/resizes attached items render at OVERRIDE positions — the
  // tint must track those, not the (lagging) committed doc positions.
  const gestureOverrides = useSessionStore((s) => s.gesture?.overrides ?? null);
  const liveRect = (id: string) => {
    const it = itemsById[id];
    if (!it) return null;
    const o = gestureOverrides?.[id];
    return o
      ? {
          x: o.x ?? it.x,
          y: o.y ?? it.y,
          width: o.width ?? it.width,
          height: o.height ?? it.height,
        }
      : it;
  };
  const slots = timelineSlots({ ...item, width: w, height: h }, itemsById);
  const { lineColor, lineWidth, pointSize } = item.style;
  const mid = horizontal ? h / 2 : w / 2;
  const cardGap = pointSize / 2 + 10;
  // Drop-to-attach highlight while another item is dragged over a point.
  const readOnly = useCanvasReadOnly();
  const dropPointId = useSessionStore((s) =>
    s.timelineDropHover?.itemId === item.id ? s.timelineDropHover.pointId : null,
  );

  const insert = (index: number) => {
    const id = addTimelinePoint(item.id, index);
    requestPointEdit(item.id, id);
  };

  return (
    <div
      ref={rootRef}
      className={`timeline-card${stage ? ' timeline-stage' : ''}`}
      data-testid="timeline-card"
      data-orientation={item.orientation}
    >
      {/* Subtle tint behind each point's attached items (group membership
          hint). Rendered first so the spine and real items paint above. */}
      {slots.map(({ point }) => {
        const attached = point.itemIds.map((id) => liveRect(id)).filter((it) => it !== null);
        if (attached.length === 0) return null;
        // Local coords against the card's LIVE origin (it renders at its
        // own override position mid-gesture).
        const own = gestureOverrides?.[item.id];
        const baseX = own?.x ?? item.x;
        const baseY = own?.y ?? item.y;
        const pad = 12;
        const minX = Math.min(...attached.map((it) => it.x)) - baseX - pad;
        const minY = Math.min(...attached.map((it) => it.y)) - baseY - pad;
        const maxX = Math.max(...attached.map((it) => it.x + it.width)) - baseX + pad;
        const maxY = Math.max(...attached.map((it) => it.y + it.height)) - baseY + pad;
        const accent = pointColor(item, point);
        return (
          <div
            key={`shelf-${point.id}`}
            className="timeline-shelf-bg"
            data-testid={`timeline-shelf-${point.id}`}
            style={{
              left: minX,
              top: minY,
              width: maxX - minX,
              height: maxY - minY,
              background: `${accent}14`,
              borderColor: `${accent}2e`,
            }}
          />
        );
      })}
      <svg className="timeline-svg" width="100%" height="100%" aria-hidden>
        {horizontal ? (
          <line
            x1={12}
            y1={mid}
            x2={w - 12}
            y2={mid}
            stroke={lineColor}
            strokeWidth={lineWidth}
            strokeLinecap="round"
          />
        ) : (
          <line
            x1={mid}
            y1={12}
            x2={mid}
            y2={h - 12}
            stroke={lineColor}
            strokeWidth={lineWidth}
            strokeLinecap="round"
          />
        )}
        {slots.map(({ point, along }) => (
          <g key={point.id}>
            {point.id === dropPointId && (
              <circle
                className="timeline-drop-ring"
                cx={horizontal ? along : mid}
                cy={horizontal ? mid : along}
                r={pointSize / 2 + 8}
                fill="none"
                stroke={pointColor(item, point)}
                strokeWidth={2.5}
              />
            )}
            <circle
              cx={horizontal ? along : mid}
              cy={horizontal ? mid : along}
              r={pointSize / 2}
              fill={pointColor(item, point)}
              stroke="var(--panel-solid, #fff)"
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>

      {slots.map(({ point, along, before }) => {
        const expanded = stage || (!point.collapsed && point.description);
        // Explicit width: absolutely-positioned boxes shrink-to-fit against
        // the container edge, which would crush cards near the ends. Centred
        // on the point, but never past the card's ends: the translate is at
        // least "my near edge at 0" (-along) and at most "my far edge at the
        // end" (-100% + len - along). clamp() is min, value, max.
        const len = horizontal ? w : h;
        const centred = `clamp(${-along}px, -50%, calc(-100% + ${len - along}px))`;
        const cardStyle = horizontal
          ? {
              left: along,
              transform: `translateX(${centred})`,
              ...(before ? { bottom: h - mid + cardGap } : { top: mid + cardGap }),
              width: Math.min(300, Math.max(180, w / Math.max(2, slots.length))),
            }
          : {
              top: along,
              transform: `translateY(${centred})`,
              ...(before ? { right: w - mid + cardGap } : { left: mid + cardGap }),
              width: Math.max(80, mid - cardGap - 8),
            };
        return (
          <div
            key={point.id}
            className={`timeline-point${before ? ' before' : ' after'}`}
            style={cardStyle}
            data-testid={`timeline-point-${point.id}`}
            onDoubleClick={(e) => {
              if (canvasReadOnly()) return;
              e.stopPropagation();
              requestPointEdit(item.id, point.id);
            }}
          >
            {point.date && <span className="timeline-date">{point.date}</span>}
            <span className="timeline-label" style={{ color: pointColor(item, point) }}>
              {point.label}
              {point.description && !stage && (
                <button
                  type="button"
                  className="timeline-chevron"
                  aria-label={point.collapsed ? 'Show description' : 'Hide description'}
                  data-testid={`timeline-toggle-${point.id}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapsed(item.id, point.id);
                  }}
                >
                  {point.collapsed ? '▸' : '▾'}
                </button>
              )}
            </span>
            {expanded ? <span className="timeline-desc">{point.description}</span> : null}
          </div>
        );
      })}

      {!readOnly && !stage && (
        <>
          {/* Insert between neighbouring points (appears on hover). */}
          {slots.slice(0, -1).map(({ along }, i) => {
            const nextAlong = slots[i + 1]!.along;
            const at = (along + nextAlong) / 2;
            return (
              <button
                key={`ins-${i}`}
                type="button"
                className="timeline-insert"
                style={
                  horizontal
                    ? { left: at, top: mid, transform: 'translate(-50%, -50%)' }
                    : { top: at, left: mid, transform: 'translate(-50%, -50%)' }
                }
                title="Insert point"
                data-testid={`timeline-insert-${i}`}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  insert(i + 1);
                }}
              >
                {PLUS}
              </button>
            );
          })}
          {/* Append at the end (always visible). */}
          <button
            type="button"
            className="timeline-insert timeline-append"
            style={
              horizontal
                ? { right: 2, top: mid, transform: 'translateY(-50%)' }
                : { bottom: 2, left: mid, transform: 'translateX(-50%)' }
            }
            title="Add point"
            data-testid="timeline-append"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              insert(item.points.length);
            }}
          >
            {PLUS}
          </button>
        </>
      )}
    </div>
  );
}
