import type { ImageItem } from '@boardcache/schema';
import { useDisplayImageUrl } from '../hooks/useDisplayImageUrl';
import { filterCss } from '../lib/media/imageFilters';
import { defineItemType } from './registry';
import { PanoView } from '../components/items/PanoView';
import { isPanoImage } from '../lib/media/pano';
import { ZoomableImage } from '../components/lightbox/ZoomableImage';
import type { StageProps, MetaOverride } from './registry';
import { ImageContent } from '../components/items/ImageContent';
import { memo, decodeImageCanvas, drawImageCaption, captionReserve } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { getAssetBlob } from '../lib/board/assetStore';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

/** Image preview that reflects the item's crop, flips, and filters. */
function ImageCard({ item }: { item: ImageItem }) {
  const url = useDisplayImageUrl(item, true); // grid thumbs: rendition is plenty
  return url ? (
    <img src={url} alt="" draggable={false} style={{ filter: filterCss(item.filters) }} />
  ) : (
    <span className="gallery-generic" />
  );
}

function ImageStage({ item, ctx }: StageProps<ImageItem>) {
  return isPanoImage(item) ? (
    <div className="lightbox-pano" onClick={(e) => e.stopPropagation()}>
      <PanoView item={item} stage />
    </div>
  ) : (
    <ZoomableImage item={item} controlsHost={ctx.controlsHost} />
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
async function paint(item: ImageItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  const size = Math.max(item.width, item.height) * 3;
  // The display rendition is ample for thumbnails/snapshots/PDF cells and
  // decodes far faster than a multi-megapixel original.
  const srcId = item.previewAssetId ?? item.assetId;
  const src = await memo(p.cache, `img:${srcId}@${Math.round(size)}`, async () => {
    const blob = await getAssetBlob(srcId);
    return blob ? decodeImageCanvas(blob, size) : null;
  });
  // An outside caption takes a strip of the box; the picture gets the rest.
  const strip = captionReserve(ctx, item);
  const iy = y + (strip && item.captionCorner.startsWith('t') ? strip : 0);
  const ih = item.height - strip;
  if (src) {
    // Mirror the DOM (ImageContent): the box shows only the crop region,
    // flipped about its own centre, with the item's adjustments applied.
    // Drawing the whole source into the box squashed every cropped image.
    const c = item.crop;
    const sx = c ? c.x * src.width : 0;
    const sy = c ? c.y * src.height : 0;
    const sw = c ? c.width * src.width : src.width;
    const sh = c ? c.height * src.height : src.height;
    ctx.save();
    if (item.flipH || item.flipV) {
      ctx.translate(x + item.width / 2, iy + ih / 2);
      ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
      ctx.translate(-(x + item.width / 2), -(iy + ih / 2));
    }
    const filter = filterCss(item.filters);
    if (filter) ctx.filter = filter;
    ctx.drawImage(src, sx, sy, Math.max(1, sw), Math.max(1, sh), x, iy, item.width, ih);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(127,127,127,0.3)';
    ctx.fillRect(x, iy, item.width, ih);
  }
  drawImageCaption(ctx, item, x, y, p.card);
}

/** What the board search index sees. */
function searchText(item: ImageItem): Extracted {
  const title = item.name?.trim() ?? '';
  // Manual per-item OCR + AI description (never automatic — user
  // decision); the OCR sentinel means "ran, found nothing" and must not
  // pollute the index.
  const ocr = item.ocrText && item.ocrText !== '(no text found)' ? item.ocrText : '';
  return { title, body: join(ocr, item.description, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: ImageItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.detail = `${item.naturalWidth} × ${item.naturalHeight}`;
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
async function popout(item: ImageItem, p: PopoutContext): Promise<string> {
  const { mintUrl } = p;
  const blob = await getAssetBlob(item.assetId);
  if (!blob) return `<div class="msg">Image unavailable</div>`;
  return `<img src="${mintUrl(blob)}" alt="${escapeHtml(item.name ?? '')}">`;
}

export const imageType = defineItemType('image', {
  popout,
  edit: { kind: 'adjust' },
  pdfCategory: 'image',
  meta,
  label: 'Image',
  searchText,
  thumbnail: paint,
  render: ImageContent,
  card: ImageCard,
  stage: ImageStage,
  cardAspect: null,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
