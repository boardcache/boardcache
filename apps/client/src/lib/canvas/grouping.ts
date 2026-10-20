import type { CanvasDocument, Item } from '@boardcache/schema';

/**
 * Groups nest. An item carries its INNERMOST group; a group record carries
 * its parent. "Membership" is deep: a group's members are every item whose
 * chain passes through it. What a click selects — the unit — depends on the
 * isolation level: with nothing isolated, the item's outermost group; inside
 * an isolated group G, the child of G on the item's chain; inside the item's
 * own group, the item itself. Double-clicking a selected unit that is a
 * group isolates it, one level per double-click.
 */

type Groups = Pick<CanvasDocument, 'items' | 'groups'>;

/** The item's group chain, innermost first, ending at a top-level group.
 *  Stops on a dangling or cyclic parent, so a bad doc never hangs. */
export function groupChain(doc: Groups, groupId: string | null | undefined): string[] {
  const chain: string[] = [];
  let id = groupId ?? null;
  while (id && doc.groups[id] && !chain.includes(id)) {
    chain.push(id);
    id = doc.groups[id]!.parentId ?? null;
  }
  return chain;
}

/** True when the item sits inside the group at any depth. */
export function isInsideGroup(doc: Groups, item: Item, groupId: string): boolean {
  return groupChain(doc, item.groupId).includes(groupId);
}

/** Ids of every item in a group, at any depth. */
export function groupMembers(doc: Groups, groupId: string): string[] {
  return Object.values(doc.items)
    .filter((i) => isInsideGroup(doc, i, groupId))
    .map((i) => i.id);
}

/** The group a group nests in, null at the top. */
export function parentGroup(doc: Groups, groupId: string): string | null {
  return doc.groups[groupId]?.parentId ?? null;
}

export type SelectionUnit = { kind: 'item'; id: string } | { kind: 'group'; id: string };

/**
 * What selecting `itemId` selects while `isolated` (null = nothing) is the
 * editing level: the item's outermost group below that level, or the item
 * itself when it sits directly in the isolated group (or in no group). An
 * item outside the isolated group is still its own top-level unit.
 */
export function selectionUnit(doc: Groups, itemId: string, isolated: string | null): SelectionUnit {
  const item = doc.items[itemId];
  if (!item) return { kind: 'item', id: itemId };
  const chain = groupChain(doc, item.groupId); // innermost → outermost
  if (chain.length === 0) return { kind: 'item', id: itemId };
  const level = isolated ? chain.indexOf(isolated) : -1;
  if (level === 0) return { kind: 'item', id: itemId };
  // Below the isolation level (or, outside it / with none, the outermost).
  const unit = level > 0 ? chain[level - 1]! : chain[chain.length - 1]!;
  return { kind: 'group', id: unit };
}

/**
 * Expand a selection so that touching any grouped item pulls in its whole
 * unit at the current isolation level — units select and move as one.
 */
export function expandToGroups(
  doc: Groups,
  ids: string[],
  isolated: string | null = null,
): string[] {
  const out = new Set<string>();
  const seenGroups = new Set<string>();
  for (const id of ids) {
    const unit = selectionUnit(doc, id, isolated);
    if (unit.kind === 'item') {
      out.add(id);
      continue;
    }
    if (seenGroups.has(unit.id)) continue;
    seenGroups.add(unit.id);
    for (const m of groupMembers(doc, unit.id)) out.add(m);
  }
  return [...out];
}

/** The distinct units a selection consists of at the isolation level. */
export function selectionUnits(
  doc: Groups,
  ids: string[],
  isolated: string | null,
): SelectionUnit[] {
  const units: SelectionUnit[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const unit = selectionUnit(doc, id, isolated);
    const key = `${unit.kind}:${unit.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    units.push(unit);
  }
  return units;
}

export interface SelectionGroupState {
  count: number;
  /** 2+ items, all of them swatches → eligible for "Create color swatch". */
  allSwatches: boolean;
  /** Set when the selection is exactly the full membership of one group. */
  groupId: string | null;
  groupName?: string;
}

/** Classify the current selection for the action bar / context menu. The
 *  group it names is the unit at the isolation level: a selected outer group
 *  reads as that group, not as the first subgroup inside it. */
export function selectionGroupState(
  doc: Groups,
  selection: string[],
  isolated: string | null = null,
): SelectionGroupState {
  const items = selection.map((id) => doc.items[id]).filter((i): i is Item => i !== undefined);
  const allSwatches = items.length >= 2 && items.every((i) => i.type === 'swatch');

  let groupId: string | null = null;
  let groupName: string | undefined;
  if (items.length >= 1) {
    const units = selectionUnits(
      doc,
      items.map((i) => i.id),
      isolated,
    );
    if (units.length === 1 && units[0]!.kind === 'group') {
      const g = units[0]!.id;
      if (groupMembers(doc, g).length === items.length) {
        groupId = g;
        groupName = doc.groups[g]?.name;
      }
    }
  }
  return groupName !== undefined
    ? { count: items.length, allSwatches, groupId, groupName }
    : { count: items.length, allSwatches, groupId };
}
