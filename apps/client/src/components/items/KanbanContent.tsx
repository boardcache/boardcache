import { useRef, useState } from 'react';
import { CaptionsIcon, PencilIcon, PlusIcon } from '../icons';
import type { Item, KanbanItem } from '@boardcache/schema';
import { promptText } from '../ui/Prompt';
import { mediaMeta } from '../../lib/mediaItems';
import {
  KANBAN_COL_HEAD,
  KANBAN_HEADER,
  KANBAN_TITLE_H,
  kanbanBoxes,
  kanbanColumnWidth,
  kanbanZoom,
  updateKanban,
} from '../../lib/structure/kanbanAttach';
import { VIEWER } from '../../lib/viewerMode';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { ScaledCard, useScaledBox } from './ScaledCard';
import { STAGE_ITEM_DRAG, StageThumb } from './TimelineContent';

/**
 * The kanban card. Columns are drop lanes — filed items are ordinary canvas
 * items positioned over the lane by kanbanAttach, so this renders only the
 * card chrome: title bar, column heads with their counts, the lanes, and
 * the drop highlight while a drag hovers a column. Laid out in design
 * space at the live box (an edge drag reflows the columns as it goes);
 * ScaledCard applies the zoom, which a corner drag grows with the card.
 */

const openEditor = (itemId: string) =>
  window.dispatchEvent(new CustomEvent('boardcache:edit-kanban', { detail: { itemId } }));

/** Ask for a card's text and file it in the column. */
async function askNewCard(kanbanId: string, columnId: string): Promise<void> {
  const text = await promptText({ title: 'New card', label: 'Text', placeholder: 'What to do' });
  if (!text?.trim()) return;
  // Loaded on demand: the viewer never writes, and the creator is heavy.
  const { addKanbanCard } = await import('../../lib/structure/kanbanCard');
  addKanbanCard(kanbanId, columnId, text.trim());
}

const toggleTitles = (itemId: string) =>
  updateKanban(itemId, 'Toggle card titles', (kb) => {
    kb.showTitles = !kb.showTitles;
  });

export function KanbanContent({ item }: { item: KanbanItem }) {
  const hover = useSessionStore((s) =>
    s.kanbanDropHover?.itemId === item.id ? s.kanbanDropHover.columnId : null,
  );
  const itemsById = useDocumentStore((s) => s.doc.items);
  const sized = { ...item, zoom: kanbanZoom(item) };
  const box = useScaledBox(sized, item.width);
  const colW = kanbanColumnWidth({ columns: item.columns, width: box.w }, box.k);
  // Titles sit under each filed card, at the layout's boxes in design space.
  const titles = item.showTitles
    ? [...kanbanBoxes(item, itemsById).boxes].map(([id, b]) => ({
        id,
        title: itemsById[id] ? mediaMeta(itemsById[id]!).title : '',
        left: (b.x - item.x) / box.k,
        top: (b.y + b.height - item.y) / box.k,
        width: b.width / box.k,
      }))
    : [];
  return (
    <ScaledCard item={sized} baseW={item.width}>
      <div className="kb-card" data-testid="kanban-card">
        <div className="kb-header" style={{ height: KANBAN_HEADER }}>
          <span className="kb-titles">
            <span className="kb-title">{item.title}</span>
            {item.description && (
              <span className="kb-desc" data-testid="kanban-desc">
                {item.description}
              </span>
            )}
          </span>
          <button
            type="button"
            className="kb-edit"
            data-testid="kanban-edit"
            aria-label="Edit columns"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openEditor(item.id);
            }}
          >
            <PencilIcon size={14} />
          </button>
        </div>
        <div className="kb-columns">
          {item.columns.map((column) => (
            <div
              key={column.id}
              className={`kb-column${hover === column.id ? ' kb-column-hover' : ''}`}
              style={{ width: colW }}
              data-testid="kanban-column"
            >
              <div className="kb-col-head" style={{ height: KANBAN_COL_HEAD }}>
                <span className="kb-col-dot" style={{ background: column.color }} />
                <span className="kb-col-label">{column.label}</span>
                <span className="kb-col-count" data-testid="kanban-col-count">
                  {column.itemIds.length}
                </span>
                <button
                  type="button"
                  className="kb-col-add"
                  data-testid="kanban-col-add"
                  aria-label={`Add a card to ${column.label}`}
                  title="Add a card"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    void askNewCard(item.id, column.id);
                  }}
                >
                  <PlusIcon size={12} />
                </button>
              </div>
              <div className="kb-lane" />
            </div>
          ))}
        </div>
        {titles.map((t) => (
          <span
            key={t.id}
            className="kb-card-title"
            data-testid="kanban-card-title"
            style={{ left: t.left, top: t.top, width: t.width, height: KANBAN_TITLE_H }}
          >
            {t.title}
          </span>
        ))}
      </div>
    </ScaledCard>
  );
}

/**
 * Lightbox stage: the board at full size — columns side by side, each filed
 * item as a clickable raster thumbnail (dives into its own lightbox). Thumbs
 * are DRAGGABLE: reorder within a column or drop on another to refile;
 * every drop commits through updateKanban, so the canvas card reflows too.
 */
export function KanbanStage({ item }: { item: KanbanItem }) {
  const itemsById = useDocumentStore((s) => s.doc.items);
  const dragIdRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ columnId: string; index: number } | null>(null);
  const startDrag = (id: string | null) => {
    dragIdRef.current = id;
    setDragId(id);
  };

  /** Insertion index inside a lane from the pointer y vs slot midpoints. */
  const indexAt = (lane: HTMLElement, clientY: number): number => {
    const slots = [...lane.querySelectorAll<HTMLElement>('.kb-stage-slot')];
    let index = slots.length;
    for (let i = 0; i < slots.length; i++) {
      const r = slots[i]!.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    return index;
  };

  const drop = (columnId: string, index: number) => {
    const id = dragIdRef.current;
    startDrag(null);
    setOver(null);
    if (!id) return;
    updateKanban(item.id, 'Reorder kanban', (kb) => {
      const target = kb.columns.find((c) => c.id === columnId);
      if (!target) return;
      const priorIndex = target.itemIds.indexOf(id);
      for (const c of kb.columns) c.itemIds = c.itemIds.filter((x) => x !== id);
      const at = priorIndex >= 0 && priorIndex < index ? index - 1 : index;
      target.itemIds.splice(Math.min(at, target.itemIds.length), 0, id);
    });
  };

  return (
    <div className="kb-stage" data-testid="kanban-stage">
      <div className="kb-stage-head">
        <h2 className="kb-stage-title">{item.name ?? item.title}</h2>
        {!VIEWER && (
          <span className="kb-stage-actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-pressed={item.showTitles}
              data-testid="kanban-stage-titles"
              onClick={(e) => {
                e.stopPropagation();
                toggleTitles(item.id);
              }}
            >
              <CaptionsIcon size={14} /> Titles
            </button>
            <button
              type="button"
              className="btn btn-sm"
              data-testid="kanban-stage-edit"
              onClick={(e) => {
                e.stopPropagation();
                openEditor(item.id);
              }}
            >
              <PencilIcon size={14} /> Edit Columns
            </button>
          </span>
        )}
      </div>
      {item.description && (
        <p className="kb-stage-desc" data-testid="kanban-stage-desc">
          {item.description}
        </p>
      )}
      <div className="kb-stage-columns">
        {item.columns.map((column) => {
          const filed = column.itemIds
            .map((id) => itemsById[id])
            .filter((it): it is Item => it !== undefined);
          return (
            <div className="kb-stage-column" key={column.id} data-testid="kanban-stage-column">
              <div className="kb-stage-col-head">
                <span className="kb-col-dot" style={{ background: column.color }} />
                <span className="kb-col-label">{column.label}</span>
                <span className="kb-col-count">{filed.length}</span>
                {!VIEWER && (
                  <button
                    type="button"
                    className="kb-stage-col-add"
                    data-testid="kanban-stage-col-add"
                    aria-label={`Add a card to ${column.label}`}
                    title="Add a card"
                    onClick={(e) => {
                      e.stopPropagation();
                      void askNewCard(item.id, column.id);
                    }}
                  >
                    <PlusIcon size={14} />
                  </button>
                )}
              </div>
              <div
                className="kb-stage-lane"
                data-testid="kanban-stage-lane"
                onDragOver={(e) => {
                  if (!dragIdRef.current) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setOver({ columnId: column.id, index: indexAt(e.currentTarget, e.clientY) });
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setOver((o) => (o?.columnId === column.id ? null : o));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(column.id, indexAt(e.currentTarget, e.clientY));
                }}
              >
                {filed.length === 0 ? (
                  <span className="kb-stage-empty">—</span>
                ) : (
                  filed.map((it, i) => (
                    <span
                      key={it.id}
                      className={`kb-stage-slot${
                        over?.columnId === column.id && over.index === i ? ' drop-before' : ''
                      }${dragId === it.id ? ' dragging' : ''}`}
                      draggable
                      data-testid="kanban-stage-slot"
                      onDragStart={(e) => {
                        startDrag(it.id);
                        e.dataTransfer.setData(STAGE_ITEM_DRAG, it.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        startDrag(null);
                        setOver(null);
                      }}
                    >
                      <StageThumb item={it} returnTo={item.id} />
                      {item.showTitles && (
                        <span className="kb-stage-caption" data-testid="kanban-stage-caption">
                          {mediaMeta(it).title}
                        </span>
                      )}
                    </span>
                  ))
                )}
                {over?.columnId === column.id && over.index === filed.length && (
                  <span className="kb-stage-slot drop-end" aria-hidden />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
