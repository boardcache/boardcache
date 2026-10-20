import { defineItemType } from './registry';
import type { Extracted } from '../lib/search/extract';
import { baseText } from '../lib/search/extract';
import type { ArrowItem } from '@boardcache/schema';

/** Arrows: a line between two points; the card shows the type label. */
/** What the board search index sees. */
function searchText(item: ArrowItem): Extracted {
  const title = item.name?.trim() ?? '';
  // Visual types index their base metadata; PDF and htmlembed get deep
  // text through the async extractors below.
  return {
    title: title || ('title' in item ? ((item as { title?: string }).title ?? '') : ''),
    body: baseText(item),
  };
}

export const arrowType = defineItemType('arrow', {
  popout: null,
  edit: { kind: 'plugin' },
  pdfCategory: null,
  meta: null,
  label: 'Arrow',
  searchText,
  thumbnail: null,
  render: null,
  card: null,
  stage: null,
  cardAspect: null,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
