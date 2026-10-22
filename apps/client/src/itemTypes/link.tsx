import { useState } from 'react';
import type { LinkItem } from '@boardcache/schema';
import { PencilIcon } from '../components/icons';
import { readableTextColor } from '../lib/color/color';
import { openUrl } from '../lib/text/itemUrl';
import { updateItems } from '../state/commands';
import { defineItemType } from './registry';
import type { CardProps, MetaOverride } from './registry';
import { LinkContent } from '../components/items/LinkContent';
import { colorLuminance } from '../lib/media/paint';
import { cardZoom } from '../lib/canvas/cardZoom';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';

const LINK_ASPECT = 0.62; // tall enough for the inline edit view

/** Inline editor shown over a link thumb on demand: label, URL, and color. */
function LinkEdit({ item, onClose }: { item: LinkItem; onClose: () => void }) {
  const [label, setLabel] = useState(item.label);
  const [url, setUrl] = useState(item.url);
  const commit = () =>
    updateItems([item.id], 'Edit link', (d) => {
      if (d.type !== 'link') return;
      d.label = label.trim() || 'Link';
      d.url = url.trim();
    });
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      commit();
      onClose();
    } else if (e.key === 'Escape') onClose();
  };
  return (
    <div className="gallery-link-edit" onClick={(e) => e.stopPropagation()}>
      <input
        className="gallery-link-input"
        value={label}
        placeholder="Label"
        autoFocus
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={keys}
        data-testid="gallery-link-label-input"
      />
      <input
        className="gallery-link-input"
        value={url}
        placeholder="https://"
        onChange={(e) => setUrl(e.target.value)}
        onBlur={commit}
        onKeyDown={keys}
        data-testid="gallery-link-url-input"
      />
      <div className="gallery-link-edit-actions">
        <input
          type="color"
          className="gallery-link-color"
          value={item.background}
          title="Background color"
          onChange={(e) =>
            updateItems([item.id], 'Recolor link', (d) => {
              if (d.type === 'link') d.background = e.target.value;
            })
          }
        />
        <button
          type="button"
          className="gallery-link-done"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            commit();
            onClose();
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** Link/button card: the whole cell is the button's color. Click opens the
 *  URL; hovering reveals an edit affordance (there's no lightbox detail view). */
function LinkCard({ item, layout, captions, dnd }: CardProps<LinkItem>) {
  const [editing, setEditing] = useState(false);
  const fg = readableTextColor(item.background);
  const aspect = layout === 'grid' ? 1 : 1 / LINK_ASPECT;
  const dndClass = dnd
    ? ` draggable${dnd.dragging ? ' dragging' : ''}${dnd.dropEdge ? ` drop-${dnd.dropEdge}` : ''}`
    : '';
  return (
    <div
      className={`gallery-card type-link${dndClass}`}
      data-testid="gallery-card"
      data-item-id={item.id}
      title={item.url || undefined}
      draggable={dnd && !editing ? true : undefined}
      onDragStart={dnd?.onDragStart}
      onDragOver={dnd?.onDragOver}
      onDrop={dnd?.onDrop}
      onDragEnd={dnd?.onDragEnd}
    >
      <div
        className="gallery-thumb gallery-link-thumb"
        style={
          editing
            ? { background: item.background, color: fg, minHeight: 168 }
            : {
                aspectRatio: layout === 'grid' ? '1 / 1' : `${aspect}`,
                background: item.background,
                color: fg,
              }
        }
      >
        {editing ? (
          <LinkEdit item={item} onClose={() => setEditing(false)} />
        ) : (
          <>
            <button
              type="button"
              className="gallery-link-open"
              style={{ color: fg }}
              onClick={() => item.url && openUrl(item.url)}
              data-testid="gallery-link-open"
            >
              <span className="link-item-label">{item.label || 'Link'}</span>
              <span className="link-item-arrow" aria-hidden>
                ↗
              </span>
            </button>
            <button
              type="button"
              className="gallery-link-edit-btn"
              style={{ color: fg }}
              onClick={() => setEditing(true)}
              title="Edit link"
              aria-label="Edit link"
              data-testid="gallery-link-edit"
            >
              <PencilIcon />
            </button>
          </>
        )}
      </div>
      {captions && <span className="gallery-caption">{item.url || item.label}</span>}
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: LinkItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  // The canvas link button: colored pill with its label, at its content zoom.
  const k = cardZoom(item);
  ctx.fillStyle = item.background;
  ctx.beginPath();
  ctx.roundRect(x, y, item.width, item.height, Math.min(8 * k, item.height / 2));
  ctx.fill();
  const lum = colorLuminance(item.background);
  ctx.fillStyle = lum > 0.55 ? '#1b1f24' : '#ffffff';
  ctx.font = `600 ${15 * k}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.label || 'Link', x + item.width / 2, y + item.height / 2, item.width - 28 * k);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: LinkItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title: title || item.label, body: join(item.url, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: LinkItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.label || item.url || 'Link';
  out.detail = item.url || null;
  return out;
}

export const linkType = defineItemType('link', {
  popout: null,
  edit: { kind: 'sheet' },
  pdfCategory: 'link',
  meta,
  label: 'Link',
  searchText,
  thumbnail: paint,
  render: LinkContent,
  card: null,
  stage: null,
  cardAspect: () => LINK_ASPECT,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: LinkCard,
});
