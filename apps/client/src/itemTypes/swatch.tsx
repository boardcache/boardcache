import type { SwatchItem, PaletteItem } from '@boardcache/schema';
import { colorSetFor } from '../lib/mediaItems';
import { useDocumentStore } from '../state/documentStore';
import { ColorStrip } from './colorStrip';
import { defineItemType } from './registry';
import { ColorStage } from '../components/lightbox/stages';
import type { StageProps, MetaOverride } from './registry';
import { SwatchContent } from '../components/items/SwatchContent';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

/** A grouped swatch shows the whole group's strip; a lone one its colour. */
function SwatchCard({ item }: { item: SwatchItem }) {
  const colors = colorSetFor(useDocumentStore.getState().doc, item);
  if (colors && colors.multi) return <ColorStrip colors={colors.colors} />;
  return <span className="gallery-swatch" style={{ background: item.color }} />;
}

/** Grouped swatches show the whole group's grid; a lone one its colour. */
function Stage({ item, ctx }: StageProps<SwatchItem>) {
  const colors = colorSetFor(useDocumentStore.getState().doc, item);
  if (!colors) return null;
  return (
    <ColorStage
      colors={colors.colors}
      selected={ctx.colorIndex}
      onSelect={ctx.onColorIndex}
      multi={colors.multi}
    />
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: SwatchItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  ctx.fillStyle = item.color;
  ctx.fillRect(x, y, item.width, item.height);
}

/** What the board search index sees. */
function searchText(item: SwatchItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title, body: join(item.color, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: SwatchItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.detail = item.color;
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: SwatchItem | PaletteItem, p: PopoutContext): string {
  const { doc } = p;
  const set = colorSetFor(doc, item);
  if (set && set.multi) {
    return `<div class="palette">${set.colors
      .map(
        (c) =>
          `<div class="pcell" style="background:${escapeHtml(c.color)}"><span>${escapeHtml(c.name ?? c.color)}</span></div>`,
      )
      .join('')}</div>`;
  }
  const color = item.type === 'swatch' ? item.color : (set?.colors[0]?.color ?? '#000');
  return `<div class="swatch" style="background:${escapeHtml(color)}"><span class="badge">${escapeHtml(color)}</span></div>`;
}

export const swatchType = defineItemType('swatch', {
  popout,
  edit: { kind: 'lightbox' },
  pdfCategory: 'color',
  meta,
  label: 'Swatch',
  searchText,
  thumbnail: paint,
  render: SwatchContent,
  card: SwatchCard,
  stage: Stage,
  cardAspect: null,
  cardAsset: null,
  // Group name, else the custom name, else the hex.
  cardCaption: (item, doc) =>
    item.groupId
      ? (doc.groups[item.groupId]?.name ?? 'Color Swatch')
      : (item.name?.trim() ?? '') || item.color.toUpperCase(),
  cardColor: (item) => item.color,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
