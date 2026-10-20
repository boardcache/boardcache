import type { CanvasDocument, Item, TreeItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { computeTreeLayout, treeShelfSize } from './treeLayout';
import { runCommand, topZIndex } from '../../state/commands';

/**
 * Tree / mind-map attachments (third instance of the shelf-container
 * pattern after timelines and tier lists): every NODE is a drop target.
 * Dropping an item on a node attaches it — shelved under the node, sized to
 * fit — and the card re-lays out around it. Moving the card carries its
 * attachments; dragging one clear of the card detaches it.
 */

export interface TreeTarget {
  itemId: string;
  nodeId: string;
}

/** How far past a node card a drop still counts as "on the node". */
const NODE_PAD = 18;
/** Beyond this padding around the card, a dropped attachment detaches. */
const DETACH_PAD = 80;

/** The node whose (padded) card rect contains `pt`, if any. */
export function treeNodeAt(
  doc: CanvasDocument,
  pt: Point,
  exclude: ReadonlySet<string>,
): TreeTarget | null {
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'tree' || item.locked || exclude.has(item.id)) continue;
    if (
      pt.x < item.x ||
      pt.x > item.x + item.width ||
      pt.y < item.y ||
      pt.y > item.y + item.height
    ) {
      continue;
    }
    const layout = computeTreeLayout(item, doc.items);
    const s = item.width / Math.max(1, layout.width);
    for (const box of layout.boxes.values()) {
      if (
        pt.x >= item.x + box.x * s - NODE_PAD &&
        pt.x <= item.x + (box.x + box.w) * s + NODE_PAD &&
        pt.y >= item.y + box.y * s - NODE_PAD &&
        pt.y <= item.y + (box.y + box.h) * s + NODE_PAD
      ) {
        return { itemId: item.id, nodeId: box.node.id };
      }
    }
  }
  return null;
}

/** The node an item is currently attached to, if any. */
export function attachedTreeNodeOf(doc: CanvasDocument, itemId: string): TreeTarget | null {
  for (const item of Object.values(doc.items)) {
    if (item.type !== 'tree') continue;
    for (const node of item.nodes) {
      if (node.itemIds.includes(itemId)) return { itemId: item.id, nodeId: node.id };
    }
  }
  return null;
}

/** True when the item's center has left its tree's (padded) territory. */
export function outsideTreeTerritory(item: Item, tree: TreeItem): boolean {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return (
    cx < tree.x - DETACH_PAD ||
    cx > tree.x + tree.width + DETACH_PAD ||
    cy < tree.y - DETACH_PAD ||
    cy > tree.y + tree.height + DETACH_PAD
  );
}

/** The card's current uniform scale vs its intrinsic layout. */
function treeScale(tree: TreeItem, itemsById: Record<string, Item>): number {
  const layout = computeTreeLayout(tree, itemsById);
  const s = tree.width / Math.max(1, layout.width);
  return Math.min(3, Math.max(0.35, Number.isFinite(s) && s > 0 ? s : 1));
}

/**
 * Re-lay the whole card at a uniform scale (resizing the card scales the
 * WHOLE map — user decision 2026-08-25): the card snaps to intrinsic size ×
 * scale, and every attached item is positioned + sized inside its node.
 */
function relayoutTree(draft: CanvasDocument, tree: TreeItem, scale = 1): void {
  const layout = computeTreeLayout(tree, draft.items);
  tree.width = layout.width * scale;
  tree.height = layout.height * scale;
  for (const node of tree.nodes) {
    const box = layout.boxes.get(node.id);
    const shelf = layout.shelves.get(node.id);
    if (!box || !shelf) continue;
    for (const id of node.itemIds) {
      const item = draft.items[id];
      const off = shelf[id];
      if (!item || !off) continue;
      const size = treeShelfSize(item);
      if (item.type === 'text' || item.type === 'code') {
        const k = (size.w * scale) / item.width;
        if (k !== 1) item.fontSize = Math.max(5, item.fontSize * k);
      }
      item.width = size.w * scale;
      item.height = size.h * scale;
      item.rotation = 0;
      item.x = tree.x + (box.shelfX + off.dx) * scale;
      item.y = tree.y + (box.shelfY + off.dy) * scale;
    }
  }
}

/** Run a labeled mutation on one tree, then re-lay it out (scale kept). */
export function updateTree(
  itemId: string,
  label: string,
  recipe: (tree: TreeItem, draft: CanvasDocument) => void,
): void {
  runCommand(label, (draft) => {
    const tree = draft.items[itemId];
    if (tree?.type !== 'tree') return;
    // Capture the pre-mutation scale so structure edits don't reset zoom.
    const scale = treeScale(tree, draft.items);
    recipe(tree, draft);
    relayoutTree(draft, tree, scale);
  });
}

/** Attach items to a node (moving them off any other node/tree first). */
export function attachItemsToTreeNode(ids: string[], target: TreeTarget): void {
  updateTree(target.itemId, 'Attach to tree', (tree, draft) => {
    const moving = new Set(ids);
    for (const item of Object.values(draft.items)) {
      if (item.type !== 'tree') continue;
      for (const node of item.nodes) {
        node.itemIds = node.itemIds.filter((id) => !moving.has(id));
      }
    }
    const node = tree.nodes.find((n) => n.id === target.nodeId);
    if (!node) return;
    let z = topZIndex(draft) + 1;
    for (const id of ids) {
      const item = draft.items[id];
      if (
        !item ||
        item.type === 'tree' ||
        item.type === 'tierlist' ||
        item.type === 'timeline' ||
        item.type === 'storyboard'
      ) {
        continue;
      }
      node.itemIds.push(id);
      item.zIndex = z++;
    }
  });
}

/** Remove items from whatever nodes hold them, re-laying affected trees. */
export function detachFromTreeNodes(ids: string[]): void {
  const moving = new Set(ids);
  runCommand('Remove from tree', (draft) => {
    for (const item of Object.values(draft.items)) {
      if (item.type !== 'tree') continue;
      let touched = false;
      for (const node of item.nodes) {
        const next = node.itemIds.filter((id) => !moving.has(id));
        if (next.length !== node.itemIds.length) {
          node.itemIds = next;
          touched = true;
        }
      }
      if (touched) relayoutTree(draft, item);
    }
  });
}

/** Add a child node; returns its id. */
export function addTreeNode(itemId: string, parentId: string | null): string {
  const id = newId();
  updateTree(itemId, 'Add node', (tree) => {
    tree.nodes.push({ id, label: 'New node', parentId, itemIds: [] });
  });
  return id;
}

/**
 * Remove a node: its children re-parent to the node's parent, its attached
 * items simply detach (they stay on the canvas where the reflow leaves them).
 */
export function removeTreeNode(itemId: string, nodeId: string): void {
  updateTree(itemId, 'Remove node', (tree) => {
    const node = tree.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    for (const n of tree.nodes) {
      if (n.parentId === nodeId) n.parentId = node.parentId;
    }
    tree.nodes = tree.nodes.filter((n) => n.id !== nodeId);
  });
}
