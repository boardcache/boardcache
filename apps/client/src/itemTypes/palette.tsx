import type { PaletteItem, SwatchItem } from '@boardcache/schema';
import { colorSetFor, mediaMeta } from '../lib/mediaItems';
import { useDocumentStore } from '../state/documentStore';
import { ColorStrip } from './colorStrip';
import { defineItemType } from './registry';
import { ColorStage } from '../components/lightbox/stages';
import type { StageProps, MetaOverride } from './registry';
import { PaletteContent } from '../components/items/PaletteContent';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

function PaletteCard({ item }: { item: PaletteItem }) {
  const colors = colorSetFor(useDocumentStore.getState().doc, item);
  if (colors && colors.multi) return <ColorStrip colors={colors.colors} />;
  return <span className="gallery-generic">{mediaMeta(item).typeLabel}</span>;
}

function Stage({ item, ctx }: StageProps<PaletteItem>) {
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
function paint(item: PaletteItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  const cell = item.width / Math.max(1, item.colors.length);
  item.colors.forEach((entry, i) => {
    ctx.fillStyle = entry.color;
    ctx.fillRect(x + i * cell, y, cell + 0.5, item.height);
  });
}

/** What the board search index sees. */
function searchText(item: PaletteItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title,
    body: join(...item.colors.map((c) => join(c.name, c.color)), baseText(item)),
  };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: PaletteItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.detail = `${item.colors.length} colors`;
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: PaletteItem | SwatchItem, p: PopoutContext): string {
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

export const paletteType = defineItemType('palette', {
  popout,
  edit: { kind: 'lightbox' },
  pdfCategory: 'color',
  meta,
  label: 'Palette',
  searchText,
  thumbnail: paint,
  render: PaletteContent,
  card: PaletteCard,
  stage: Stage,
  cardAspect: null,
  cardAsset: null,
  cardCaption: null,
  cardColor: (item) => item.colors[0]?.color ?? null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
