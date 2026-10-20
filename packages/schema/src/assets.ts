import type { CanvasDocument } from './document';
import type { Item } from './items';

/**
 * Every asset reference an item can hold. Centralized so export, import,
 * sync diffing, and garbage collection agree on what "referenced" means.
 */
export function itemAssetIds(item: Item): string[] {
  const ids: Array<string | null | undefined> = [];
  switch (item.type) {
    case 'image':
      ids.push(item.assetId, item.previewAssetId);
      break;
    case 'video':
      ids.push(item.assetId, item.posterAssetId);
      break;
    case 'audio':
      ids.push(item.assetId, item.coverAssetId);
      break;
    case 'pdf':
      ids.push(item.assetId);
      break;
    case 'htmlembed':
      ids.push(item.htmlAssetId, item.posterAssetId);
      break;
    case 'font':
      ids.push(item.assetId);
      break;
    case 'recipe':
      ids.push(item.imageAssetId);
      break;
    case 'palette':
      ids.push(item.sourceAssetId);
      break;
    case 'epub':
      ids.push(item.assetId, item.coverAssetId);
      break;
    case 'iframe':
    case 'map':
      ids.push(item.posterAssetId);
      break;
    case 'playlist':
      for (const track of item.tracks) ids.push(track.assetId, track.coverAssetId);
      break;
    default:
      break;
  }
  return ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** All asset hashes referenced by a document, deduplicated: item media plus
 *  the background images of the board, its pages and its groups. */
export function collectAssetIds(doc: CanvasDocument): string[] {
  const ids = new Set<string>();
  for (const item of Object.values(doc.items)) {
    for (const id of itemAssetIds(item)) ids.add(id);
  }
  const backgrounds = [
    doc.settings.backgroundImage,
    ...doc.pages.map((p) => p.backgroundImage),
    ...Object.values(doc.groups).map((g) => g.backgroundImage),
  ];
  for (const bg of backgrounds) if (bg?.assetId) ids.add(bg.assetId);
  return [...ids];
}
