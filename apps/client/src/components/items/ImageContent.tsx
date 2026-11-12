import type { ImageItem } from '@boardcache/schema';
import { useAssetMissing, useAssetUrl, useThumbUrl } from '../../hooks/useAssetUrl';
import { PREVIEW_MAX } from '../../lib/media/renditions';
import { useDocumentStore } from '../../state/documentStore';
import { filterCss } from '../../lib/media/imageFilters';
import { isPanoImage } from '../../lib/media/pano';
import { useSessionStore } from '../../state/sessionStore';
import { AssetLoadingBox, AssetMissingBox, useTeamAssetFetching } from '../canvas/AssetLoading';
import { PanoView } from './PanoView';

export function ImageContent({ item }: { item: ImageItem }) {
  // 360° equirectangular photos get the interactive pano player instead
  // of a flat img (crop/filters/flips don't apply to the projection).
  const inner = isPanoImage(item) ? <PanoView item={item} /> : <FlatImageContent item={item} />;
  // Outside caption: the box is shared, a bar above or below the picture.
  const outside =
    item.caption && item.captionPlacement === 'outside' && Boolean(item.description?.trim());
  if (!outside) {
    return (
      <>
        {inner}
        <ImageCaption item={item} />
      </>
    );
  }
  const top = item.captionCorner.startsWith('t');
  const right = item.captionCorner.endsWith('r');
  return (
    <div
      className={`image-captioned ${top ? 'caption-top' : 'caption-bottom'}`}
      data-testid="image-captioned"
    >
      <div className="image-area">{inner}</div>
      <div
        className={`image-caption outside${right ? ' align-right' : ''}${item.captionWrap ? ' wrap' : ''}`}
        data-testid="image-caption"
      >
        {item.description}
      </div>
    </div>
  );
}

const CAPTION_POS: Record<ImageItem['captionCorner'], React.CSSProperties> = {
  tl: { top: 8, left: 8 },
  tr: { top: 8, right: 8 },
  bl: { bottom: 8, left: 8 },
  br: { bottom: 8, right: 8 },
};

/** Corner caption overlay: the image's description on a translucent box. */
function ImageCaption({ item }: { item: ImageItem }) {
  if (!item.caption || !item.description?.trim()) return null;
  return (
    <div
      className="image-caption"
      data-testid="image-caption"
      style={{
        ...CAPTION_POS[item.captionCorner],
        background: `rgba(12, 13, 16, ${item.captionOpacity})`,
      }}
    >
      {item.description}
    </div>
  );
}

/** Width in pixels of an image's display rendition (its longest side is
 *  capped at PREVIEW_MAX); the whole image when none was made. */
function renditionWidth(item: ImageItem): number {
  const longest = Math.max(item.naturalWidth, item.naturalHeight);
  return item.naturalWidth * Math.min(1, PREVIEW_MAX / longest);
}

function FlatImageContent({ item }: { item: ImageItem }) {
  // Three copies serve the canvas, chosen by how many device pixels the
  // whole image covers (the selector flips only at the thresholds). Far
  // out, when the image is a few hundred device pixels wide, a small copy
  // stands in: fifty full renditions decoded at once is what runs a phone
  // out of memory. In between, the display rendition. Close in, once the
  // image is drawn wider than that rendition holds, the original takes
  // over, so a hi-res picture is never softer than its pixels where someone
  // is looking closely; zooming back out releases it again. The width that
  // counts is the whole image's, not the item's: a crop shows a slice of
  // the source blown up to the box, so a quarter-wide crop at 500 device
  // pixels needs 2000 pixels of source.
  const tier = useDocumentStore((s) => {
    const px =
      (s.doc.viewport.scale * item.width * (window.devicePixelRatio || 1)) /
      (item.crop?.width ?? 1);
    if (px < 640) return 'small';
    return item.previewAssetId && px > renditionWidth(item) ? 'original' : 'display';
  });
  // An original that is not on this device (absent media) leaves the
  // rendition in place rather than a missing box.
  const originalMiss = useAssetMissing(item.assetId);
  const shownAssetId =
    tier === 'original' && !originalMiss ? item.assetId : (item.previewAssetId ?? item.assetId);
  const small = tier === 'small';
  const thumb = useThumbUrl(shownAssetId, small);
  const full = useAssetUrl(shownAssetId);
  const url = (small && thumb) || full;
  // Live filter preview (from the adjustments panel) wins over the stored value.
  const preview = useSessionStore((s) =>
    s.filterPreview?.id === item.id ? s.filterPreview.filters : null,
  );
  const fetching = useTeamAssetFetching([shownAssetId]);
  const miss = useAssetMissing(shownAssetId);
  if (!url) {
    if (fetching) return <AssetLoadingBox label="image" />;
    return miss ? (
      <AssetMissingBox assetId={shownAssetId} miss={miss} label="image" />
    ) : (
      <div className="item-placeholder" />
    );
  }
  const flip = `scale(${item.flipH ? -1 : 1}, ${item.flipV ? -1 : 1})`;
  const filter = filterCss(preview ?? item.filters);

  // Cropped: the item box shows only region `crop` of the source. Blow the
  // image up so that region fills the box, and offset it so the region's
  // top-left lands at the box origin. Flip wraps the clip so the visible
  // pixels mirror correctly. Uncropped, the same frame holds the image at
  // the box: one element either way, so a crop coming or going (a bake, a
  // restore) changes its source in place. A new element takes even a cached
  // source a frame late, and the box would paint empty for that frame.
  const c = item.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  return (
    <div className="image-crop-frame" style={{ transform: flip }}>
      <img
        src={url}
        alt={item.name ?? ''}
        draggable={false}
        style={{
          position: 'absolute',
          width: `${100 / c.width}%`,
          height: `${100 / c.height}%`,
          left: `${(-c.x / c.width) * 100}%`,
          top: `${(-c.y / c.height) * 100}%`,
          objectFit: 'fill',
          filter,
        }}
      />
    </div>
  );
}
