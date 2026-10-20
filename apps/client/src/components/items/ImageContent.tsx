import type { ImageItem } from '@boardcache/schema';
import { useAssetMissing, useAssetUrl } from '../../hooks/useAssetUrl';
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

function FlatImageContent({ item }: { item: ImageItem }) {
  // Display rendition on the canvas; the lightbox shows the original.
  const url = useAssetUrl(item.previewAssetId ?? item.assetId);
  // Live filter preview (from the adjustments panel) wins over the stored value.
  const preview = useSessionStore((s) =>
    s.filterPreview?.id === item.id ? s.filterPreview.filters : null,
  );
  const shownAssetId = item.previewAssetId ?? item.assetId;
  const fetching = useTeamAssetFetching([shownAssetId]);
  const missing = useAssetMissing(shownAssetId);
  if (!url) {
    if (fetching) return <AssetLoadingBox label="image" />;
    return missing ? (
      <AssetMissingBox assetId={shownAssetId} label="image" />
    ) : (
      <div className="item-placeholder" />
    );
  }
  const flip = `scale(${item.flipH ? -1 : 1}, ${item.flipV ? -1 : 1})`;
  const filter = filterCss(preview ?? item.filters);

  // Cropped: the item box shows only region `crop` of the source. Blow the
  // image up so that region fills the box, and offset it so the region's
  // top-left lands at the box origin. Flip wraps the clip so the visible
  // pixels mirror correctly.
  if (item.crop) {
    const c = item.crop;
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

  return (
    <img
      src={url}
      alt={item.name ?? ''}
      draggable={false}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'fill',
        transform: flip,
        filter,
      }}
    />
  );
}
