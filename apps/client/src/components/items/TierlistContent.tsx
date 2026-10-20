import { useRef, useState } from 'react';
import { PencilIcon } from '../icons';
import type { Item, TierlistItem } from '@boardcache/schema';
import { readableTextColor as labelInk } from '../../lib/color/color';
import {
  TIER_HEADER,
  TIER_LABEL_W,
  tierRowHeight,
  updateTier,
} from '../../lib/structure/tierAttach';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { StageThumb } from './TimelineContent';

/**
 * The S–F ranking card. Rows are drop shelves — ranked items are ordinary
 * canvas items positioned over the shelf by tierAttach, so this renders only
 * the card chrome: title bar, colored label cells, shelf lanes, and the
 * drop highlight while a drag hovers a row.
 */

export function TierlistContent({ item }: { item: TierlistItem }) {
  const hover = useSessionStore((s) =>
    s.tierDropHover?.itemId === item.id ? s.tierDropHover.rowId : null,
  );
  const rowH = tierRowHeight(item);

  const openEditor = () =>
    window.dispatchEvent(
      new CustomEvent('boardcache:edit-tierlist', { detail: { itemId: item.id } }),
    );

  return (
    <div className="tierlist-card" data-testid="tierlist-card">
      <div className="tierlist-header" style={{ height: TIER_HEADER }}>
        <span className="tierlist-titles">
          <span className="tierlist-title">{item.title}</span>
          {item.description && (
            <span className="tierlist-desc" data-testid="tierlist-desc">
              {item.description}
            </span>
          )}
        </span>
        <button
          type="button"
          className="tierlist-edit"
          data-testid="tierlist-edit"
          aria-label="Edit tiers"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openEditor();
          }}
        >
          <PencilIcon size={14} />
        </button>
      </div>
      {item.rows.map((row) => (
        <div
          key={row.id}
          className={`tierlist-row${hover === row.id ? ' tierlist-row-hover' : ''}`}
          style={{ height: rowH }}
          data-testid="tierlist-row"
        >
          <span
            className="tierlist-label"
            style={{ width: TIER_LABEL_W, background: row.color, color: labelInk(row.color) }}
          >
            {row.label}
          </span>
          <span className="tierlist-shelf" />
        </div>
      ))}
    </div>
  );
}

/**
 * Lightbox stage: the ranking at full size — colored rows, each ranked item
 * as a clickable raster thumbnail (dives into its own lightbox). Thumbs are
 * DRAGGABLE: reorder within a row or drop on another row to re-rank; every
 * drop commits through updateTier, so the canvas card reflows too.
 */
export function TierlistStage({ item }: { item: TierlistItem }) {
  const itemsById = useDocumentStore((s) => s.doc.items);
  // The drag id lives in a REF — drag events read it synchronously (state
  // alone lags a tick, which breaks same-tick synthetic drags in tests and
  // fast real drags alike). State mirrors it purely for the CSS classes.
  const dragIdRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ rowId: string; index: number } | null>(null);
  const startDrag = (id: string | null) => {
    dragIdRef.current = id;
    setDragId(id);
  };

  /** Insertion index inside a shelf from the pointer x vs slot midpoints. */
  const indexAt = (shelf: HTMLElement, clientX: number): number => {
    const slots = [...shelf.querySelectorAll<HTMLElement>('.tier-stage-slot')];
    let index = slots.length;
    for (let i = 0; i < slots.length; i++) {
      const r = slots[i]!.getBoundingClientRect();
      if (clientX < r.left + r.width / 2) {
        index = i;
        break;
      }
    }
    return index;
  };

  const drop = (rowId: string, index: number) => {
    const id = dragIdRef.current;
    startDrag(null);
    setOver(null);
    if (!id) return;
    updateTier(item.id, 'Reorder tier list', (t) => {
      // Adjust for removing the item from BEFORE the insertion point.
      const target = t.rows.find((r) => r.id === rowId);
      if (!target) return;
      const priorIndex = target.itemIds.indexOf(id);
      for (const r of t.rows) r.itemIds = r.itemIds.filter((x) => x !== id);
      const at = priorIndex >= 0 && priorIndex < index ? index - 1 : index;
      target.itemIds.splice(Math.min(at, target.itemIds.length), 0, id);
    });
  };

  return (
    <div className="tier-stage" data-testid="tierlist-stage">
      <h2 className="tier-stage-title">{item.name ?? item.title}</h2>
      {item.description && (
        <p className="tier-stage-desc" data-testid="tier-stage-desc">
          {item.description}
        </p>
      )}
      {item.rows.map((row) => {
        const ranked = row.itemIds
          .map((id) => itemsById[id])
          .filter((it): it is Item => it !== undefined);
        return (
          <div className="tier-stage-row" key={row.id} data-testid="tierlist-stage-row">
            <span
              className="tier-stage-label"
              style={{ background: row.color, color: labelInk(row.color) }}
            >
              {row.label}
            </span>
            <div
              className="tier-stage-shelf"
              data-testid="tier-stage-shelf"
              onDragOver={(e) => {
                if (!dragIdRef.current) return;
                e.preventDefault();
                setOver({ rowId: row.id, index: indexAt(e.currentTarget, e.clientX) });
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setOver((o) => (o?.rowId === row.id ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(row.id, indexAt(e.currentTarget, e.clientX));
              }}
            >
              {ranked.length === 0 ? (
                <span className="tier-stage-empty">—</span>
              ) : (
                ranked.map((it, i) => (
                  <span
                    key={it.id}
                    className={`tier-stage-slot${
                      over?.rowId === row.id && over.index === i ? ' drop-before' : ''
                    }${dragId === it.id ? ' dragging' : ''}`}
                    draggable
                    data-testid="tier-stage-slot"
                    onDragStart={(e) => {
                      startDrag(it.id);
                      e.dataTransfer.setData('text/plain', it.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      startDrag(null);
                      setOver(null);
                    }}
                  >
                    <StageThumb item={it} returnTo={item.id} />
                  </span>
                ))
              )}
              {over?.rowId === row.id && over.index === ranked.length && (
                <span className="tier-stage-slot drop-end" aria-hidden />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
