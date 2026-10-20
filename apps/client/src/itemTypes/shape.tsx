import type { ShapeItem } from '@boardcache/schema';
import { ShapeContent } from '../components/items/ShapeContent';
import { defineItemType } from './registry';
import { drawShape } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { baseText } from '../lib/search/extract';
import { shapeToSvg } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

function ShapeCard({ item }: { item: ShapeItem }) {
  return (
    <span className="gallery-shape">
      <ShapeContent item={item} />
    </span>
  );
}

function ShapeStage({ item }: { item: ShapeItem }) {
  return (
    <div
      className="lightbox-shape"
      style={{ aspectRatio: `${Math.max(1, item.width)} / ${Math.max(1, item.height)}` }}
    >
      <ShapeContent item={item} />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: ShapeItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  // Shape geometry is relative to the item's top-left.
  ctx.translate(x, y);
  drawShape(ctx, item);
}

/** What the board search index sees. */
function searchText(item: ShapeItem): Extracted {
  const title = item.name?.trim() ?? '';
  // Visual types index their base metadata; PDF and htmlembed get deep
  // text through the async extractors below.
  return {
    title: title || ('title' in item ? ((item as { title?: string }).title ?? '') : ''),
    body: baseText(item),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: ShapeItem, _p: PopoutContext): string {
  return `<div class="pad">${shapeToSvg(item)}</div>`;
}

export const shapeType = defineItemType('shape', {
  popout,
  edit: { kind: 'sheet' },
  pdfCategory: 'shape',
  meta: null,
  label: 'Shape',
  searchText,
  thumbnail: paint,
  render: ShapeContent,
  card: ShapeCard,
  stage: ShapeStage,
  cardAspect: null,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
