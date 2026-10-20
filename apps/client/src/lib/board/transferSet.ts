import type { CanvasDocument, Connection, Group, Item } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { isInsideGroup } from '../canvas/grouping';

/**
 * What travels when items are sent to another board: the items themselves,
 * every group whose members ALL go (so a sent group arrives as a group, name
 * and background included), and the connections that stay inside the set.
 * Partially-sent groups are left behind — their sent members arrive loose.
 */
export interface TransferSet {
  items: Item[];
  groups: Group[];
  connections: Connection[];
}

export function collectTransfer(doc: CanvasDocument, itemIds: string[]): TransferSet {
  const items = itemIds
    .map((id) => doc.items[id])
    .filter((i): i is Item => i !== undefined)
    .map((i) => ({ ...i }));
  const ids = new Set(items.map((i) => i.id));

  const groups = Object.values(doc.groups).filter((g) => {
    const members = Object.values(doc.items).filter((i) => isInsideGroup(doc, i, g.id));
    return members.length > 0 && members.every((m) => ids.has(m.id));
  });
  const groupIds = new Set(groups.map((g) => g.id));
  const inside = (ep: Connection['from']) =>
    ep.kind === 'item' ? ids.has(ep.id) : groupIds.has(ep.id);
  const connections = Object.values(doc.connections).filter((c) => inside(c.from) && inside(c.to));
  return { items, groups, connections };
}

/**
 * Fresh ids throughout (a copy must never collide with the original), the
 * cluster shifted by (dx, dy) and stacked from `z` up. Items of a group that
 * isn't travelling arrive loose; page stamps are dropped so everything lands
 * on the destination's first page.
 */
export function cloneTransfer(
  set: TransferSet,
  offset: { dx: number; dy: number; z: number },
): TransferSet {
  const itemIds = new Map(set.items.map((i) => [i.id, newId()]));
  const groupIds = new Map(set.groups.map((g) => [g.id, newId()]));
  let z = offset.z;
  const items = set.items.map((item) => {
    const { pageId: _page, ...rest } = item;
    return {
      ...rest,
      id: itemIds.get(item.id)!,
      x: item.x + offset.dx,
      y: item.y + offset.dy,
      zIndex: z++,
      groupId: item.groupId ? (groupIds.get(item.groupId) ?? null) : null,
    } as Item;
  });
  // Nesting travels when the parent travels; otherwise the group lands top level.
  const groups = set.groups.map((g) => {
    const parentId = g.parentId ? groupIds.get(g.parentId) : undefined;
    const { parentId: _p, ...rest } = g;
    return { ...rest, id: groupIds.get(g.id)!, ...(parentId ? { parentId } : {}) };
  });
  const remap = (ep: Connection['from']): Connection['from'] => ({
    kind: ep.kind,
    id: (ep.kind === 'item' ? itemIds.get(ep.id) : groupIds.get(ep.id)) ?? ep.id,
  });
  const connections = set.connections.map((c) => ({
    ...c,
    id: newId(),
    from: remap(c.from),
    to: remap(c.to),
  }));
  return { items, groups, connections };
}

/** Where a sent cluster lands: just right of the destination's content, top-aligned. */
export function landingOffset(
  destBounds: { x: number; y: number; width: number } | null,
  srcBounds: { x: number; y: number } | null,
): { dx: number; dy: number } {
  if (!srcBounds) return { dx: 0, dy: 0 };
  return {
    dx: (destBounds ? destBounds.x + destBounds.width + 80 : 200) - srcBounds.x,
    dy: (destBounds ? destBounds.y : 200) - srcBounds.y,
  };
}
