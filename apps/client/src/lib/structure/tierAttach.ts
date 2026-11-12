import type { CanvasDocument, Item, TierlistItem } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { runCommand, topZIndex } from '../../state/commands';
import { AUDIO_MIN_HEIGHT } from '../media/audioActions';

/**
 * Tier-list attachments (mirrors the timeline shelf machinery): each row of
 * the S–F card is a drop target. Dropping a canvas item on a row ranks it —
 * the item stays a real canvas item, sized to fit the shelf and laid out
 * left-to-right in row order. Moving the card carries its ranked items.
 * Rotation is ignored — capture zones use the unrotated frame.
 *
 * The card is a zoom card (lib/canvas/cardZoom): its chrome — header,
 * label cells, paddings — is designed at zoom 1 and multiplied by `zoom`,
 * which only a uniform scale (a corner drag) changes; an edge drag changes
 * the box and the shelves reflow into it. `tierShelfBoxes` is the one
 * layout, read by the reflow on release and by the live preview mid-drag.
 */

export interface TierTarget {
  itemId: string;
  rowId: string;
}

export const TIER_HEADER = 40;
/** The label column's smallest width; a long label widens it (`tierLabelWidth`). */
const TIER_LABEL_W = 84;
/** The label's design font size; `tierLabelFont` steps it down for a label
 *  that would not fit its row. */
const TIER_LABEL_FONT = 22;
const LABEL_MAX_W = 220;
const LABEL_PAD = 8;
/** A bold glyph's average width as a share of the font size (estimate: the
 *  layout has no DOM to measure in). */
const GLYPH = 0.62;

/** Greedy word wrap of a label at a font size into a column width. */
export function tierLabelLines(label: string, width: number, font: number): string[] {
  const fits = (s: string) => s.length * font * GLYPH <= width - LABEL_PAD * 2;
  const lines: string[] = [];
  let line = '';
  for (const word of label.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next) || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** The label column's width in design space: wide enough for the longest
 *  word of any label at the design font, between the base and a cap. */
export function tierLabelWidth(tier: Pick<TierlistItem, 'rows'>): number {
  let longest = 0;
  for (const row of tier.rows)
    for (const word of row.label.trim().split(/\s+/))
      longest = Math.max(longest, word.length * TIER_LABEL_FONT * GLYPH);
  return Math.min(LABEL_MAX_W, Math.max(TIER_LABEL_W, Math.ceil(longest) + LABEL_PAD * 2));
}

/** The label font in design space: the design size, stepped down until every
 *  label's lines fit the row height (`rowH`, design space). */
export function tierLabelFont(tier: Pick<TierlistItem, 'rows'>, rowH: number): number {
  const width = tierLabelWidth(tier);
  let font = TIER_LABEL_FONT;
  const room = rowH - LABEL_PAD;
  while (font > 11) {
    const tallest = Math.max(
      ...tier.rows.map((r) => tierLabelLines(r.label, width, font).length * font * 1.15),
    );
    if (tallest <= room) break;
    font -= 1;
  }
  return font;
}
const ROW_PAD = 8;
const ITEM_GAP = 10;
/** How far past the card edges a drop still counts as "on the card". */
const CAPTURE_PAD = 24;
/** Beyond this padding, dropping a ranked item detaches it. */
const DETACH_PAD = 80;
/** Wide items cap at this multiple of the shelf height (keeps panoramas sane). */
const MAX_ASPECT = 2.4;
const MIN_CARD_W = 420;

/** The card's content zoom: set by uniform scales; absent = 1 (cards made before zoom). */
export function tierZoom(tier: Pick<TierlistItem, 'zoom'>): number {
  return tier.zoom ?? 1;
}

/** The height of one row on the canvas (the header, at the card's zoom, excluded). */
function tierRowHeight(tier: TierlistItem): number {
  return tier.rows.length ? (tier.height - TIER_HEADER * tierZoom(tier)) / tier.rows.length : 0;
}

/** The row whose shelf contains `pt`, if any. */
export function tierRowAt(
  doc: CanvasDocument,
  pt: Point,
  exclude: ReadonlySet<string>,
): TierTarget | null {
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'tierlist' || item.locked || exclude.has(item.id)) continue;
    if (item.rows.length === 0) continue;
    const header = TIER_HEADER * tierZoom(item);
    if (
      pt.x < item.x - CAPTURE_PAD ||
      pt.x > item.x + item.width + CAPTURE_PAD ||
      pt.y < item.y + header ||
      pt.y > item.y + item.height + CAPTURE_PAD
    ) {
      continue;
    }
    const rowH = tierRowHeight(item);
    const index = Math.max(
      0,
      Math.min(item.rows.length - 1, Math.floor((pt.y - item.y - header) / rowH)),
    );
    return { itemId: item.id, rowId: item.rows[index]!.id };
  }
  return null;
}

/** The row an item is currently ranked into, if any. */
export function attachedTierRowOf(doc: CanvasDocument, itemId: string): TierTarget | null {
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'tierlist') continue;
    for (const row of item.rows) {
      if (row.itemIds.includes(itemId)) return { itemId: item.id, rowId: row.id };
    }
  }
  return null;
}

/** True when the item's center has left its card's (padded) territory. */
export function outsideTierTerritory(item: Item, tier: TierlistItem): boolean {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return (
    cx < tier.x - DETACH_PAD ||
    cx > tier.x + tier.width + DETACH_PAD ||
    cy < tier.y - DETACH_PAD ||
    cy > tier.y + tier.height + DETACH_PAD
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The size an item takes on a shelf of height `rowH` at zoom `k`: shrunk
 *  (never grown) to fit, players clamped to usable dimensions. */
function shelfSizeFor(
  item: Pick<Item, 'type' | 'width' | 'height'>,
  rowH: number,
  k: number,
): { width: number; height: number } {
  const maxH = Math.max(24 * k, rowH - ROW_PAD * 2 * k);
  const maxW = maxH * MAX_ASPECT;
  if (item.type === 'audio' || item.type === 'playlist') {
    // Players clamp to usable dimensions — a squashed player is dead weight.
    return {
      width: Math.min(Math.max(item.width, 220), Math.max(220, maxW)),
      height: Math.min(Math.max(AUDIO_MIN_HEIGHT, maxH), item.height || maxH),
    };
  }
  const scale = Math.min(1, maxH / item.height, maxW / item.width);
  return { width: item.width * scale, height: item.height * scale };
}

/**
 * Where every ranked item sits for a card at this box and zoom: boxes on
 * the canvas, and the width the card needs to hold its longest row. Pure,
 * so the resize gesture can preview the shelves mid-drag with the same
 * numbers the reflow writes on release. `sizes` lets the preview hand in
 * scaled sizes for a uniform drag.
 */
export function tierShelfBoxes(
  tier: TierlistItem,
  items: Record<string, Item | undefined>,
  sizes?: ReadonlyMap<string, { width: number; height: number }>,
): { boxes: Map<string, Box>; neededWidth: number } {
  const k = tierZoom(tier);
  const rowH = tierRowHeight(tier);
  const boxes = new Map<string, Box>();
  let needed = MIN_CARD_W * k;
  if (rowH <= 0) return { boxes, neededWidth: needed };
  tier.rows.forEach((row, i) => {
    let x = tier.x + (tierLabelWidth(tier) + ROW_PAD) * k;
    const rowTop = tier.y + TIER_HEADER * k + i * rowH;
    for (const id of row.itemIds) {
      const item = items[id];
      if (!item) continue;
      const size = shelfSizeFor({ type: item.type, ...(sizes?.get(id) ?? item) }, rowH, k);
      boxes.set(id, { x, y: rowTop + (rowH - size.height) / 2, ...size });
      x += size.width + ITEM_GAP * k;
    }
    needed = Math.max(needed, x - tier.x + ROW_PAD * k);
  });
  return { boxes, neededWidth: needed };
}

/**
 * Lay every row's items out left-to-right on their shelves, sized to fit;
 * the card grows wider (never narrower) to hold its longest row.
 */
function reshelfTier(draft: CanvasDocument, tier: TierlistItem): void {
  const { boxes, neededWidth } = tierShelfBoxes(tier, draft.items);
  for (const [id, box] of boxes) {
    const item = draft.items[id];
    if (!item) continue;
    const scale = box.width / item.width;
    if ((item.type === 'text' || item.type === 'code') && scale < 1)
      item.fontSize = Math.max(7, item.fontSize * scale);
    // The clamped box is sized for the player at zoom 1.
    if (item.type === 'audio') item.zoom = 1;
    item.x = box.x;
    item.y = box.y;
    item.width = box.width;
    item.height = box.height;
    item.rotation = 0;
  }
  tier.width = Math.max(tier.width, neededWidth);
}

/** Run a labeled mutation on one tier card, then reflow its shelves. */
export function updateTier(
  itemId: string,
  label: string,
  recipe: (tier: TierlistItem, draft: CanvasDocument) => void,
): void {
  runCommand(label, (draft) => {
    const tier = draft.items[itemId];
    if (tier?.type !== 'tierlist') return;
    recipe(tier, draft);
    reshelfTier(draft, tier);
  });
}

/**
 * Rank items into a row (moving them off any other row first, on any card).
 * Dropped items rise above the card and the shelves reflow.
 */
export function attachItemsToTierRow(ids: string[], target: TierTarget): void {
  updateTier(target.itemId, 'Rank on tier list', (tier, draft) => {
    const moving = new Set(ids);
    for (const item of Object.values(draft.items)) {
      if (item.type !== 'tierlist') continue;
      for (const row of item.rows) {
        row.itemIds = row.itemIds.filter((id) => !moving.has(id));
      }
    }
    const row = tier.rows.find((r) => r.id === target.rowId);
    if (!row) return;
    let z = topZIndex(draft) + 1;
    for (const id of ids) {
      const item = draft.items[id];
      if (
        !item ||
        item.type === 'tierlist' ||
        item.type === 'kanban' ||
        item.type === 'timeline' ||
        item.type === 'storyboard'
      )
        continue;
      row.itemIds.push(id);
      item.zIndex = z++;
    }
  });
}

/** Remove items from whatever rows hold them, reflowing affected cards. */
export function detachFromTierRows(ids: string[]): void {
  const moving = new Set(ids);
  runCommand('Remove from tier list', (draft) => {
    for (const item of Object.values(draft.items)) {
      if (item.type !== 'tierlist') continue;
      let touched = false;
      for (const row of item.rows) {
        const next = row.itemIds.filter((id) => !moving.has(id));
        if (next.length !== row.itemIds.length) {
          row.itemIds = next;
          touched = true;
        }
      }
      if (touched) reshelfTier(draft, item);
    }
  });
}
