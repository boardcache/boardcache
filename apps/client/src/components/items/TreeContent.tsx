import { useEffect, useMemo, useRef, useState } from 'react';
import { PencilIcon } from '../icons';
import { createPortal } from 'react-dom';
import type { Item, TreeItem } from '@boardcache/schema';
import { readableTextColor } from '../../lib/color/color';
import { computeTreeLayout, type TreeLayout } from '../../lib/structure/treeLayout';
import { addTreeNode, removeTreeNode, updateTree } from '../../lib/structure/treeAttach';
import { StageThumb } from './TimelineContent';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { canvasReadOnly } from '../../lib/canvas/readOnly';

/**
 * The tree / mind-map card — WYSIWYG (user decision 2026-08-25: no
 * secondary representations). Editing happens on the card exactly as it
 * renders: double-click a node to rename inline; hover chips add a child,
 * recolor, or remove; DRAG a node onto another to re-parent (drop on the
 * middle) or reorder among siblings (drop near the leading/trailing edge).
 * The lightbox stage renders this same component, scaled, plus the attached
 * items as positioned raster thumbnails.
 */

function edgePath(layout: TreeLayout, mode: TreeItem['mode']): string {
  let d = '';
  for (const box of layout.boxes.values()) {
    const parentId = box.node.parentId;
    if (!parentId) continue;
    const parent = layout.boxes.get(parentId);
    if (!parent) continue;
    if (mode === 'mindmap') {
      const x1 = parent.x + parent.w;
      const y1 = parent.y + parent.h / 2;
      const x2 = box.x;
      const y2 = box.y + box.h / 2;
      const mid = (x1 + x2) / 2;
      d += `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2} `;
    } else {
      const x1 = parent.x + parent.w / 2;
      const y1 = parent.y + parent.h;
      const x2 = box.x + box.w / 2;
      const y2 = box.y;
      const mid = (y1 + y2) / 2;
      d += `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2} `;
    }
  }
  return d.trim();
}

type DropZone = 'before' | 'into' | 'after';

interface NodeDrag {
  nodeId: string;
  targetId: string | null;
  zone: DropZone;
}

export function TreeContent({
  item,
  onBackgroundClick,
}: {
  item: TreeItem;
  /** A plain click on a node (canvas: select the card; stage: nothing). */
  onBackgroundClick?: () => void;
}) {
  const itemsById = useDocumentStore((s) => s.doc.items);
  const hoverNode = useSessionStore((s) =>
    s.treeDropHover?.itemId === item.id ? s.treeDropHover.nodeId : null,
  );
  const layout = useMemo(() => computeTreeLayout(item, itemsById), [item, itemsById]);
  const rootRef = useRef<HTMLDivElement>(null);

  // --- inline rename ---------------------------------------------------------
  const [editing, setEditing] = useState<{ nodeId: string; value: string } | null>(null);
  const commitRename = () => {
    const e = editing;
    setEditing(null);
    if (!e) return;
    const node = item.nodes.find((n) => n.id === e.nodeId);
    if (!node || node.label === e.value.trim()) return;
    updateTree(item.id, 'Rename node', (t) => {
      const n = t.nodes.find((x) => x.id === e.nodeId);
      if (n) n.label = e.value.trim() || n.label;
    });
  };

  // --- node dragging (re-parent / reorder) -----------------------------------
  const [drag, setDrag] = useState<NodeDrag | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<NodeDrag | null>(null);
  const setDragBoth = (d: NodeDrag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const descendantsOf = (nodeId: string): Set<string> => {
    const out = new Set<string>([nodeId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of item.nodes) {
        if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
          out.add(n.id);
          grew = true;
        }
      }
    }
    return out;
  };

  const beginNodeDrag = (e: React.PointerEvent, nodeId: string) => {
    if (e.button !== 0 || editing || canvasReadOnly()) return;
    e.stopPropagation();
    const node = item.nodes.find((n) => n.id === nodeId);
    if (!node || node.parentId === null) return; // the root stays put
    const startX = e.clientX;
    const startY = e.clientY;
    const blocked = descendantsOf(nodeId);
    const horizontal = item.mode === 'mindmap';
    let started = false;

    const hitTest = (x: number, y: number): { targetId: string; zone: DropZone } | null => {
      const root = rootRef.current;
      if (!root) return null;
      for (const el of root.querySelectorAll<HTMLElement>('[data-node-id]')) {
        const id = el.dataset.nodeId!;
        if (blocked.has(id)) continue;
        const r = el.getBoundingClientRect();
        const pad = 10;
        if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) {
          continue;
        }
        // Leading/trailing thirds along the BREADTH axis reorder; middle
        // re-parents. Breadth is x in tree mode, y in mind-map mode.
        const t = horizontal ? (y - r.top) / r.height : (x - r.left) / r.width;
        const zone: DropZone = t < 0.3 ? 'before' : t > 0.7 ? 'after' : 'into';
        return { targetId: id, zone };
      }
      return null;
    };

    const onMove = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      started = true;
      setGhost({ x: ev.clientX, y: ev.clientY });
      const hit = hitTest(ev.clientX, ev.clientY);
      setDragBoth({ nodeId, targetId: hit?.targetId ?? null, zone: hit?.zone ?? 'into' });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = dragRef.current;
      setDragBoth(null);
      setGhost(null);
      if (!started) {
        onBackgroundClick?.();
        return;
      }
      if (!d?.targetId || d.targetId === nodeId) return;
      updateTree(item.id, d.zone === 'into' ? 'Re-parent node' : 'Reorder nodes', (t) => {
        const moving = t.nodes.find((n) => n.id === nodeId);
        const target = t.nodes.find((n) => n.id === d.targetId);
        if (!moving || !target) return;
        if (d.zone === 'into') {
          moving.parentId = target.id;
          return;
        }
        // Reorder: become the target's sibling, placed before/after it.
        moving.parentId = target.parentId;
        t.nodes = t.nodes.filter((n) => n.id !== nodeId);
        const at = t.nodes.findIndex((n) => n.id === target.id);
        t.nodes.splice(d.zone === 'before' ? at : at + 1, 0, moving);
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // During a resize gesture the card box follows the override — the content
  // must scale WITH it live, not jump on release.
  const liveWidth = useSessionStore((s) =>
    s.gesture?.kind === 'resize' ? (s.gesture.overrides[item.id]?.width ?? null) : null,
  );
  const cardScale = (liveWidth ?? item.width) / Math.max(1, layout.width);
  return (
    <div className="tree-card" data-testid="tree-card" ref={rootRef}>
      <div
        className="tree-scale"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `scale(${cardScale})`,
        }}
      >
        <div className="tree-header">
          <span className="tree-title">{item.title}</span>
          <button
            type="button"
            className="tree-edit"
            data-testid="tree-edit"
            aria-label="Tree settings"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent('boardcache:edit-tree', { detail: { itemId: item.id } }),
              );
            }}
          >
            <PencilIcon size={14} />
          </button>
        </div>
        <svg className="tree-edges" aria-hidden>
          <path d={edgePath(layout, item.mode)} />
        </svg>
        {[...layout.boxes.values()].map((box) => {
          const isEditing = editing?.nodeId === box.node.id;
          const isDragSource = drag?.nodeId === box.node.id;
          const isDropTarget = drag?.targetId === box.node.id;
          return (
            <div
              key={box.node.id}
              data-node-id={box.node.id}
              className={[
                'tree-node',
                hoverNode === box.node.id ? 'tree-node-hover' : '',
                box.depth === 0 ? 'tree-node-root' : '',
                isDragSource ? 'tree-node-dragging' : '',
                isDropTarget && drag?.zone === 'into' ? 'tree-node-hover' : '',
                isDropTarget && drag?.zone === 'before' ? 'tree-node-before' : '',
                isDropTarget && drag?.zone === 'after' ? 'tree-node-after' : '',
                item.mode === 'mindmap' ? 'tree-node-h' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                fontSize: box.fontSize,
                ['--label-row' as string]: `${box.labelRow}px`,
                ...(box.node.color
                  ? { background: box.node.color, color: readableTextColor(box.node.color) }
                  : {}),
              }}
              data-testid="tree-node"
              onPointerDown={(e) => beginNodeDrag(e, box.node.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing({ nodeId: box.node.id, value: box.node.label });
              }}
            >
              {box.node.itemIds.length > 0 && <span className="tree-node-spacer" aria-hidden />}
              {isEditing ? (
                <input
                  className="tree-node-input"
                  value={editing.value}
                  autoFocus
                  data-testid="tree-node-input"
                  onChange={(e) => setEditing({ nodeId: box.node.id, value: e.target.value })}
                  onBlur={commitRename}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <span className="tree-node-label">
                  {box.lines.map((line, i) => (
                    <span key={i} className="tree-node-line">
                      {line}
                    </span>
                  ))}
                </span>
              )}
              <span className="tree-node-chips" onPointerDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="tree-chip"
                  data-testid="tree-node-add"
                  aria-label={`Add child of ${box.node.label}`}
                  title="Add child"
                  onClick={(e) => {
                    e.stopPropagation();
                    addTreeNode(item.id, box.node.id);
                  }}
                >
                  +
                </button>
                <label
                  className="tree-chip tree-chip-color"
                  title="Node color"
                  style={{ background: box.node.color ?? '#e9ecf1' }}
                >
                  <input
                    type="color"
                    value={box.node.color ?? '#e9ecf1'}
                    aria-label={`${box.node.label} color`}
                    onChange={(e) =>
                      updateTree(item.id, 'Recolor node', (t) => {
                        const n = t.nodes.find((x) => x.id === box.node.id);
                        if (n) n.color = e.target.value;
                      })
                    }
                  />
                </label>
                {item.nodes.length > 1 && (
                  <button
                    type="button"
                    className="tree-chip tree-chip-danger"
                    data-testid="tree-node-remove"
                    aria-label={`Remove ${box.node.label}`}
                    title="Remove node (children re-parent)"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTreeNode(item.id, box.node.id);
                    }}
                  >
                    ✕
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {ghost &&
        drag &&
        createPortal(
          (() => {
            const node = item.nodes.find((n) => n.id === drag.nodeId);
            return (
              <span
                className="tree-drag-ghost"
                data-testid="tree-drag-ghost"
                style={{
                  left: ghost.x,
                  top: ghost.y,
                  ...(node?.color
                    ? { background: node.color, color: readableTextColor(node.color) }
                    : {}),
                }}
              >
                {node?.label ?? ''}
              </span>
            );
          })(),
          document.body,
        )}
    </div>
  );
}

/**
 * Lightbox stage: a zoomable, pannable canvas for the SAME live card. The
 * initial view contain-fits the tree (whichever dimension is the tighter
 * fit); scroll zooms toward the cursor, dragging empty space pans, and
 * double-clicking the background re-fits. All WYSIWYG editing still works.
 */
export function TreeStage({ item }: { item: TreeItem }) {
  const itemsById = useDocumentStore((s) => s.doc.items);
  const layout = useMemo(() => computeTreeLayout(item, itemsById), [item, itemsById]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ s: number; x: number; y: number } | null>(null);

  const fitView = () => {
    const el = wrapRef.current;
    if (!el) return null;
    const s = Math.min((el.clientWidth - 48) / item.width, (el.clientHeight - 48) / item.height);
    const k = Math.min(3, Math.max(0.1, s));
    return {
      s: k,
      x: (el.clientWidth - item.width * k) / 2,
      y: (el.clientHeight - item.height * k) / 2,
    };
  };

  // Contain-fit once per item; later edits keep the user's zoom/pan.
  useEffect(() => {
    const id = requestAnimationFrame(() => setView(fitView()));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Wheel zoom toward the cursor (non-passive — the lightbox must not scroll).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setView((v) => {
        if (!v) return v;
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const next = Math.min(4, Math.max(0.15, v.s * Math.exp(-e.deltaY * 0.0015)));
        const k = next / v.s;
        return { s: next, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Drag empty space to pan (nodes stopPropagation their own pointerdown).
  const beginPan = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const base = view;
    if (!base) return;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      setView({ s: base.s, x: base.x + dx, y: base.y + dy });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const cardS = item.width / Math.max(1, layout.width);
  return (
    <div
      className="tree-stage-live tree-stage-pan"
      data-testid="tree-stage"
      ref={wrapRef}
      onPointerDown={beginPan}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) setView(fitView());
      }}
    >
      {view && (
        <div
          className="tree-stage-world"
          style={{
            width: item.width,
            height: item.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
          }}
        >
          <TreeContent item={item} />
          {item.nodes.map((node) => {
            const box = layout.boxes.get(node.id);
            const shelf = layout.shelves.get(node.id);
            if (!box || !shelf) return null;
            return node.itemIds.map((id) => {
              const attached = itemsById[id] as Item | undefined;
              const off = shelf[id];
              if (!attached || !off) return null;
              return (
                <span
                  key={id}
                  className="tree-stage-thumb-slot"
                  style={{
                    left: (box.shelfX + off.dx) * cardS,
                    top: (box.shelfY + off.dy) * cardS,
                    width: off.w * cardS,
                    height: off.h * cardS,
                  }}
                >
                  <StageThumb item={attached} returnTo={item.id} />
                </span>
              );
            });
          })}
        </div>
      )}
    </div>
  );
}
