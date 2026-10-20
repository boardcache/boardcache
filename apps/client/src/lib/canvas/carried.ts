import type { CanvasDocument, Item } from '@boardcache/schema';

/**
 * Containers carry what is shelved on them: a timeline its point
 * attachments, a tier list its ranked items, a storyboard its framed shots,
 * a tree its node attachments. Moving the container moves them too — by
 * gesture (lib/canvas/gestures) and by tool (move_items, nudge_items) alike.
 */

/** The ids a container holds, in shelf order (not recursive). */
function heldIds(item: Item): string[] {
  switch (item.type) {
    case 'timeline':
      return item.points.flatMap((p) => p.itemIds);
    case 'tierlist':
      return item.rows.flatMap((r) => r.itemIds);
    case 'storyboard':
      return item.panels.flatMap((p) => p.itemIds);
    case 'tree':
      return item.nodes.flatMap((n) => n.itemIds);
    default:
      return [];
  }
}

/**
 * `ids` plus every unlocked item a container among them carries (one level:
 * what a container holds is never itself a container). Order preserved,
 * ids deduplicated; missing ids dropped.
 */
export function withCarried(doc: Pick<CanvasDocument, 'items'>, ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (doc.items[id] && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of [...out]) {
    for (const held of heldIds(doc.items[id]!)) {
      const item = doc.items[held];
      if (item && !item.locked && !seen.has(held)) {
        seen.add(held);
        out.push(held);
      }
    }
  }
  return out;
}
