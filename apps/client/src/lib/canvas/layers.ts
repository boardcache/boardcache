import type { CanvasDocument, Item } from '@boardcache/schema';
import { groupChain } from './grouping';

/**
 * Layer-tree model for the layers panel. Items are shown front-to-back (top of
 * the list = highest z-index, like Figma/Photoshop). Grouped items collapse
 * into folder rows positioned by their frontmost member. Pure + unit-tested.
 */

export type LayerRow =
  | { kind: 'item'; key: string; item: Item }
  | { kind: 'group'; key: string; groupId: string; name: string; members: Item[]; topZ: number };

/** Front-first ordering: higher z first, id descending as a stable tiebreak. */
function byFront(a: Item, b: Item): number {
  return b.zIndex - a.zIndex || (a.id > b.id ? -1 : 1);
}

/** Build the front-to-back row list, folding groups into folder rows. */
export function buildLayerTree(doc: Pick<CanvasDocument, 'items' | 'groups'>): LayerRow[] {
  const grouped = new Map<string, Item[]>();
  const ungrouped: Item[] = [];
  for (const item of Object.values(doc.items)) {
    // Nested groups fold into their outermost ancestor's folder.
    const chain = groupChain(doc, item.groupId);
    const root = chain[chain.length - 1];
    if (root) {
      const arr = grouped.get(root);
      if (arr) arr.push(item);
      else grouped.set(root, [item]);
    } else {
      ungrouped.push(item);
    }
  }

  const rows: LayerRow[] = [];
  for (const item of ungrouped) rows.push({ kind: 'item', key: item.id, item });
  for (const [groupId, members] of grouped) {
    members.sort(byFront);
    rows.push({
      kind: 'group',
      key: `g:${groupId}`,
      groupId,
      name: doc.groups[groupId]?.name ?? 'Group',
      members,
      topZ: Math.max(...members.map((m) => m.zIndex)),
    });
  }

  rows.sort((a, b) => repZ(b) - repZ(a) || (a.key > b.key ? -1 : 1));
  return rows;
}

function repZ(row: LayerRow): number {
  return row.kind === 'item' ? row.item.zIndex : row.topZ;
}

/** Top-level row keys, front-first (for the root sortable context). */
export function rootKeys(rows: LayerRow[]): string[] {
  return rows.map((r) => r.key);
}

/** Per-group member ids, front-first (for each group's sortable context). */
export function groupMemberIds(rows: LayerRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) if (r.kind === 'group') out[r.groupId] = r.members.map((m) => m.id);
  return out;
}

/**
 * Compute the full bottom-to-top id order (what reorderZ consumes) from a
 * front-first root-key order and a per-group member order. Group rows expand
 * to their members in front-first order.
 */
export function computeZOrder(
  rootKeyOrder: string[],
  groupMembers: Record<string, string[]>,
): string[] {
  const frontToBack: string[] = [];
  for (const key of rootKeyOrder) {
    if (key.startsWith('g:')) {
      const gid = key.slice(2);
      for (const id of groupMembers[gid] ?? []) frontToBack.push(id);
    } else {
      frontToBack.push(key);
    }
  }
  return frontToBack.reverse();
}

/** Insert `key` into `keys` at `insertAt` (index among the other keys). */
export function previewInsert(keys: string[], key: string, insertAt: number): string[] {
  const others = keys.filter((k) => k !== key);
  const at = Math.max(0, Math.min(others.length, insertAt));
  return [...others.slice(0, at), key, ...others.slice(at)];
}
