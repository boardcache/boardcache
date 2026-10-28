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
 */

export interface TierTarget {
  itemId: string;
  rowId: string;
}

export const TIER_HEADER = 40;
export const TIER_LABEL_W = 84;
const ROW_PAD = 8;
const ITEM_GAP = 10;
/** How far past the card edges a drop still counts as "on the card". */
const CAPTURE_PAD = 24;
/** Beyond this padding, dropping a ranked item detaches it. */
const DETACH_PAD = 80;
/** Wide items cap at this multiple of the shelf height (keeps panoramas sane). */
const MAX_ASPECT = 2.4;
const MIN_CARD_W = 420;

/** Per-row vertical geometry (top y offset + height), header excluded. */
export function tierRowHeight(tier: TierlistItem): number {
  return tier.rows.length ? (tier.height - TIER_HEADER) / tier.rows.length : 0;
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
    if (
      pt.x < item.x - CAPTURE_PAD ||
      pt.x > item.x + item.width + CAPTURE_PAD ||
      pt.y < item.y + TIER_HEADER ||
      pt.y > item.y + item.height + CAPTURE_PAD
    ) {
      continue;
    }
    const rowH = tierRowHeight(item);
    const index = Math.max(
      0,
      Math.min(item.rows.length - 1, Math.floor((pt.y - item.y - TIER_HEADER) / rowH)),
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

/** Shrink an item (about its center) to sit on a shelf of height `rowH`. */
function normalizeShelfSize(item: Item, rowH: number): void {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const maxH = Math.max(24, rowH - ROW_PAD * 2);
  const maxW = maxH * MAX_ASPECT;
  if (item.type === 'audio' || item.type === 'playlist') {
    // Players clamp to usable dimensions — a squashed player is dead weight.
    item.width = Math.min(Math.max(item.width, 220), Math.max(220, maxW));
    item.height = Math.min(Math.max(AUDIO_MIN_HEIGHT, maxH), item.height || maxH);
    // The clamped box is sized for the player at zoom 1.
    if (item.type === 'audio') item.zoom = 1;
  } else {
    const scale = Math.min(maxH / item.height, maxW / item.width);
    if (scale < 1) {
      item.width *= scale;
      item.height *= scale;
      if (item.type === 'text' || item.type === 'code') {
        item.fontSize = Math.max(7, item.fontSize * scale);
      }
    }
  }
  item.x = cx - item.width / 2;
  item.y = cy - item.height / 2;
  item.rotation = 0;
}

/**
 * Lay every row's items out left-to-right on their shelves, sized to fit;
 * the card grows wider (never narrower) to hold its longest row.
 */
function reshelfTier(draft: CanvasDocument, tier: TierlistItem): void {
  const rowH = tierRowHeight(tier);
  if (rowH <= 0) return;
  let needed = MIN_CARD_W;
  for (const row of tier.rows) {
    let x = tier.x + TIER_LABEL_W + ROW_PAD;
    const rowTop = tier.y + TIER_HEADER + tier.rows.indexOf(row) * rowH;
    for (const id of row.itemIds) {
      const item = draft.items[id];
      if (!item) continue;
      normalizeShelfSize(item, rowH);
      item.x = x;
      item.y = rowTop + (rowH - item.height) / 2;
      x += item.width + ITEM_GAP;
    }
    needed = Math.max(needed, x - tier.x + ROW_PAD);
  }
  tier.width = Math.max(tier.width, needed);
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
