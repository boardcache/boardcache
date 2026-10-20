import type { ComponentType, CSSProperties } from 'react';
import type { CanvasDocument, Item } from '@boardcache/schema';
import type { PaintContext } from '../lib/media/paint';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import type { PdfCategory } from '../lib/export/pdfCategories';
import type { Extracted } from '../lib/search/extract';

/**
 * The item-type registry: what each type contributes to each surface, in one
 * place per type (src/itemTypes/<type>.tsx). Surfaces read a definition and
 * never switch on `item.type` themselves.
 *
 * Every slot is required. A slot set to `null` is a stated choice ("this type
 * has no card image"), not an omission — so adding a type means filling in
 * every surface, and the compiler says so. The exhaustive map in ./index.ts
 * ties the definitions to the schema's type union the same way.
 *
 * Surfaces covered: the canvas renderer, the gallery card, the lightbox stage,
 * the thumbnail painter, the type label and metadata, search text, the Asset
 * PDF section, the edit entry and the pop-out window — every surface that
 * used to switch on `item.type`. e2e/item-surfaces.spec.ts guards them.
 */

export type ItemType = Item['type'];
export type ItemOf<K extends ItemType> = Extract<Item, { type: K }>;

type CardLayout = 'masonry' | 'grid';

export interface CardDnd {
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  /** This card is being dragged. */
  dragging: boolean;
  /** Show a drop indicator on this card's leading/trailing edge. */
  dropEdge: 'before' | 'after' | null;
}

export interface CardProps<T extends Item = Item> {
  item: T;
  layout: CardLayout;
  captions: boolean;
  dnd?: CardDnd;
}

/** What the lightbox shell shares with a stage. */
export interface StageContext {
  /** Host element for stage-owned controls (the image zoom pill). */
  controlsHost: HTMLElement | null;
  /** Close the lightbox. */
  close: () => void;
  /** Selected colour cell (swatch groups and palettes share it with the details tab). */
  colorIndex: number;
  onColorIndex: (i: number) => void;
}

export interface StageProps<T extends Item = Item> {
  item: T;
  ctx: StageContext;
}

/** Title/detail overrides for the lightbox panel and captions. */
export interface MetaOverride {
  title?: string;
  detail?: string | null;
}

/** How "edit this item" reaches the type's editor (see lib/itemEditors.ts). */
type EditEntry =
  | { kind: 'inline' } // contenteditable in place
  | { kind: 'sheet' } // the floating style panel, a bottom sheet on mobile
  | { kind: 'adjust' } // the image adjustments panel
  | { kind: 'lightbox' } // the lightbox sidebar holds the editor
  | { kind: 'event'; event: string } // a window event the type's dialog listens for
  | { kind: 'plugin' }; // the plugin's "Edit" item-menu action, when it has one

export interface ItemTypeDefinition<T extends Item = Item> {
  /** Human-facing type name ("Tier List"). */
  label: string;
  /** Title and detail line for the lightbox panel and captions; `null` uses the item name and label. */
  meta: ((item: T, base: { title: string }) => MetaOverride) | null;
  /** What the board search index sees. */
  searchText: (item: T) => Extracted;
  /** The Asset PDF section this type prints under; `null` leaves it out. */
  pdfCategory: PdfCategory | null;
  /** How "Edit" reaches this type's editor; `null` means not editable. */
  edit: EditEntry | null;
  /** Self-contained HTML for the item's own pop-out window; `null` shows the generic card. */
  popout: ((item: T, p: PopoutContext) => Promise<string> | string) | null;
  /** Canvas content, inside the item box; `null` shows a placeholder naming the type. */
  render: ComponentType<{ item: T }> | null;
  /** Painter for board thumbnails, snapshots and PDF cells; `null` draws a grey box. */
  thumbnail: ((item: T, paint: PaintContext) => void | Promise<void>) | null;
  /** Gallery card thumb content; `null` shows the generic type label. */
  card: ComponentType<{ item: T }> | null;
  /** Lightbox stage (the full-size view); `null` shows the generic type/title stage. */
  stage: ComponentType<StageProps<T>> | null;
  /** Card height ÷ width in masonry; `null` derives it from the item's box. */
  cardAspect: ((item: T) => number) | null;
  /** Asset hash the card shows as an image before `card` gets a turn (posters, covers). */
  cardAsset: ((item: T) => string | null) | null;
  /** Caption text; `null` uses the item's media title. */
  cardCaption: ((item: T, doc: CanvasDocument) => string) | null;
  /** A solid colour standing in for the item in tiny collages (group cards). */
  cardColor: ((item: T) => string | null) | null;
  /** Extra style on the thumb frame (a title card is paper edge to edge). */
  cardFrameStyle: ((item: T) => CSSProperties | undefined) | null;
  /** Show the play badge (playable media). */
  cardPlayBadge: boolean;
  /** Replace the whole card (a link card opens its URL and edits inline). */
  cardComponent: ComponentType<CardProps<T>> | null;
}

/** Declare one type's definition with its item type inferred from the key. */
export function defineItemType<K extends ItemType>(
  _type: K,
  definition: ItemTypeDefinition<ItemOf<K>>,
): ItemTypeDefinition<ItemOf<K>> {
  return definition;
}
