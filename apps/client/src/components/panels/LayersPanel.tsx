import { Fragment, useMemo, useRef, useState } from 'react';
import type { Item } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import {
  buildLayerTree,
  computeZOrder,
  groupMemberIds,
  previewInsert,
  rootKeys,
} from '../../lib/canvas/layers';
import { mediaMeta } from '../../lib/mediaItems';
import { reorderZ, setItemsHidden, setItemsLocked } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useFloatingWindow } from '../../hooks/useFloatingWindow';
import {
  ChevronRightIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  GripIcon,
  ImageIcon,
  LockIcon,
  PaletteIcon,
  ShapesIcon,
  TypeIcon,
  UnlockIcon,
  VideoIcon,
} from '../icons';

function TypeGlyph({ item }: { item: Item }) {
  switch (item.type) {
    case 'image':
      return <ImageIcon />;
    case 'video':
      return <VideoIcon />;
    case 'text':
      return <TypeIcon />;
    case 'palette':
      return <PaletteIcon />;
    case 'shape':
      return <ShapesIcon />;
    case 'swatch':
      return <span className="layer-swatch" style={{ background: item.color }} />;
    default:
      return <span className="layer-dot" />;
  }
}

type DragInfo = { ctx: string; key: string; siblings: string[] };

/**
 * Floating, draggable Layers window: every item front-to-back (top = highest
 * z), groups in expandable folders, drag the grip to reorder z-index. Rows
 * select on click; a lock toggle per row. Rendered from document data only.
 */
export function LayersPanel() {
  const open = useSessionStore((s) => s.layersOpen);
  const items = useDocumentStore((s) => s.doc.items);
  const groups = useDocumentStore((s) => s.doc.groups);
  const selection = useSessionStore(useShallow((s) => s.selection));

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const win = useFloatingWindow(280);

  const rowRefs = useRef(new Map<string, HTMLElement | null>());
  const dragRef = useRef<DragInfo | null>(null);
  const overRef = useRef(0);
  const [drag, setDrag] = useState<{ ctx: string; key: string; overIndex: number } | null>(null);

  const rows = useMemo(() => buildLayerTree({ items, groups }), [items, groups]);
  const roots = rootKeys(rows);
  const members = groupMemberIds(rows);
  const selSet = useMemo(() => new Set(selection), [selection]);

  if (!open) return null;

  const measureInsert = (clientY: number, siblings: string[], draggedKey: string): number => {
    const others = siblings.filter((k) => k !== draggedKey);
    for (let i = 0; i < others.length; i++) {
      const el = rowRefs.current.get(others[i]!);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return others.length;
  };

  const beginDrag = (ctx: string, key: string, siblings: string[]) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { ctx, key, siblings };
    overRef.current = measureInsert(e.clientY, siblings, key);
    setDrag({ ctx, key, overIndex: overRef.current });

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      overRef.current = measureInsert(ev.clientY, d.siblings, d.key);
      setDrag({ ctx: d.ctx, key: d.key, overIndex: overRef.current });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      const newSiblings = previewInsert(d.siblings, d.key, overRef.current);
      const order =
        d.ctx === 'root'
          ? computeZOrder(newSiblings, members)
          : computeZOrder(roots, { ...members, [d.ctx]: newSiblings });
      reorderZ(order);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Drop indicator: the key the line should sit before (or '__end__').
  const lineBefore = (ctx: string): string | null => {
    if (!drag || drag.ctx !== ctx) return null;
    const others = (ctx === 'root' ? roots : (members[ctx] ?? [])).filter((k) => k !== drag.key);
    return others[drag.overIndex] ?? '__end__';
  };

  const select = (ids: string[]) => useSessionStore.getState().setSelection(ids);

  const dropLine = <div className="layers-drop-line" data-testid="layers-drop-line" />;

  const renderItemRow = (item: Item, ctx: string, siblings: string[], indent: boolean) => {
    const selected = selSet.has(item.id);
    const dragging = drag?.key === item.id;
    return (
      <div
        key={item.id}
        ref={(el) => {
          rowRefs.current.set(item.id, el);
        }}
        className={`layer-row${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}${indent ? ' indent' : ''}${item.hidden ? ' hidden-item' : ''}`}
        data-testid="layer-row"
        onClick={() => select([item.id])}
      >
        <span
          className="layer-grip"
          data-testid="layer-grip"
          onPointerDown={beginDrag(ctx, item.id, siblings)}
          title="Drag to reorder"
        >
          <GripIcon />
        </span>
        <span className="layer-icon">
          <TypeGlyph item={item} />
        </span>
        <span className="layer-name">{mediaMeta(item).title}</span>
        <button
          type="button"
          className={`layer-eye${item.hidden ? ' off' : ''}`}
          data-testid="layer-eye"
          title={item.hidden ? 'Show' : 'Hide'}
          onClick={(e) => {
            e.stopPropagation();
            setItemsHidden([item.id], !item.hidden);
          }}
        >
          {item.hidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
        <button
          type="button"
          className={`layer-lock${item.locked ? ' on' : ''}`}
          title={item.locked ? 'Unlock' : 'Lock'}
          onClick={(e) => {
            e.stopPropagation();
            setItemsLocked([item.id], !item.locked);
          }}
        >
          {item.locked ? <LockIcon /> : <UnlockIcon />}
        </button>
      </div>
    );
  };

  return (
    <div className="layers-window" data-testid="layers-panel" style={win.style}>
      <div
        className="layers-titlebar"
        data-testid="layers-titlebar"
        onPointerDown={win.onTitlePointerDown}
      >
        <span className="layers-title">Layers</span>
        <span className="layers-grab" aria-hidden />
        <button
          type="button"
          className="layers-close"
          data-testid="layers-close"
          onClick={() => useSessionStore.getState().setLayersOpen(false)}
          aria-label="Close layers"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="layers-body">
        {rows.length === 0 && <p className="layers-empty">No items yet.</p>}
        {rows.map((row) => {
          if (row.kind === 'item') {
            return (
              <Fragment key={row.key}>
                {lineBefore('root') === row.key && dropLine}
                {renderItemRow(row.item, 'root', roots, false)}
              </Fragment>
            );
          }
          const expanded = !collapsed.has(row.groupId);
          const memberIds = row.members.map((m) => m.id);
          return (
            <Fragment key={row.key}>
              {lineBefore('root') === row.key && dropLine}
              <div
                className={`layer-row group-row${drag?.key === row.key ? ' dragging' : ''}`}
                data-testid="layer-group-row"
                onClick={() => select(memberIds)}
              >
                <span
                  className="layer-grip"
                  onPointerDown={beginDrag('root', row.key, roots)}
                  title="Drag to reorder group"
                >
                  <GripIcon />
                </span>
                <button
                  type="button"
                  className={`layer-disclosure${expanded ? ' open' : ''}`}
                  data-testid="layer-disclosure"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.groupId)) next.delete(row.groupId);
                      else next.add(row.groupId);
                      return next;
                    });
                  }}
                  aria-label={expanded ? 'Collapse group' : 'Expand group'}
                >
                  <ChevronRightIcon />
                </button>
                <span className="layer-icon">
                  <FolderIcon />
                </span>
                <span className="layer-name">{row.name}</span>
                <span className="layer-count">{row.members.length}</span>
              </div>
              {expanded && (
                <div className="layer-children">
                  {row.members.map((m) => (
                    <Fragment key={m.id}>
                      {lineBefore(row.groupId) === m.id && dropLine}
                      {renderItemRow(m, row.groupId, memberIds, true)}
                    </Fragment>
                  ))}
                  {lineBefore(row.groupId) === '__end__' && dropLine}
                </div>
              )}
            </Fragment>
          );
        })}
        {lineBefore('root') === '__end__' && dropLine}
      </div>
    </div>
  );
}
