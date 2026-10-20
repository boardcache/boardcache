import type { Item } from '@boardcache/schema';
import type { ItemOf, ItemType, ItemTypeDefinition } from './registry';
import { arrowType } from './arrow';
import { audioType } from './audio';
import { codeType } from './code';
import { epubType } from './epub';
import { fontType } from './font';
import { htmlembedType } from './htmlembed';
import { iframeType } from './iframe';
import { imageType } from './image';
import { linkType } from './link';
import { mapType } from './map';
import { paletteType } from './palette';
import { pdfType } from './pdf';
import { playlistType } from './playlist';
import { pollType } from './poll';
import { projectType } from './project';
import { qrType } from './qr';
import { recipeType } from './recipe';
import { rssType } from './rss';
import { shapeType } from './shape';
import { storyboardType } from './storyboard';
import { swatchType } from './swatch';
import { tasklistType } from './tasklist';
import { textType } from './text';
import { tierlistType } from './tierlist';
import { caseType } from './case';
import { timeType } from './time';
import { timelineType } from './timeline';
import { titleType } from './title';
import { treeType } from './tree';
import { videoType } from './video';

export type { CardDnd, CardProps, ItemTypeDefinition, StageContext } from './registry';

/**
 * Every item type the schema declares, with what it contributes to each
 * surface. The mapped type makes the object exhaustive: a type added to the
 * schema without a definition here, or a definition missing a slot, is a
 * compile error.
 */
const ITEM_TYPES: { [K in ItemType]: ItemTypeDefinition<ItemOf<K>> } = {
  arrow: arrowType,
  audio: audioType,
  code: codeType,
  epub: epubType,
  font: fontType,
  htmlembed: htmlembedType,
  iframe: iframeType,
  image: imageType,
  link: linkType,
  map: mapType,
  palette: paletteType,
  pdf: pdfType,
  playlist: playlistType,
  poll: pollType,
  project: projectType,
  qr: qrType,
  recipe: recipeType,
  rss: rssType,
  shape: shapeType,
  storyboard: storyboardType,
  swatch: swatchType,
  tasklist: tasklistType,
  text: textType,
  tierlist: tierlistType,
  case: caseType,
  time: timeType,
  timeline: timelineType,
  title: titleType,
  tree: treeType,
  video: videoType,
};

/** The definition for an item (typed loosely: callers dispatch on the item they hold). */
export function itemType(item: Item): ItemTypeDefinition {
  return ITEM_TYPES[item.type] as unknown as ItemTypeDefinition;
}
