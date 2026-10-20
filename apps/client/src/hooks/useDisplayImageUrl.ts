import { useEffect, useState } from 'react';
import type { ImageItem } from '@boardcache/schema';
import { renderImageBlob } from '../lib/media/imageExport';
import { VIEWER } from '../lib/viewerMode';
import { useAssetUrl } from './useAssetUrl';

/**
 * Resolve the URL to show for an image, baking in its crop and flips. Cropped
 * or flipped images are rendered to a temporary blob so previews/viewers show
 * the edited pixels (and measure against them); untouched images use the shared
 * refcounted asset URL. Returns null while loading.
 */
export function useDisplayImageUrl(item: ImageItem, preferPreview = false): string | null {
  const rawUrl = useAssetUrl((preferPreview ? item.previewAssetId : null) ?? item.assetId);
  // The offline viewer can't bake to a canvas (file:// images taint it) — show
  // the raw asset and let ImageContent apply crop/flips via CSS.
  const edited = !VIEWER && (item.crop !== null || item.flipH || item.flipV);
  const [bakedUrl, setBakedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!edited) return;
    let alive = true;
    let objUrl: string | null = null;
    void renderImageBlob(item).then((blob) => {
      if (!alive || !blob) return;
      objUrl = URL.createObjectURL(blob);
      setBakedUrl(objUrl);
    });
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
      setBakedUrl(null);
    };
    // Re-bake only when the pixels change; `item` is read inside but stable here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edited, item.assetId, item.crop, item.flipH, item.flipV]);

  return edited ? bakedUrl : rawUrl;
}
