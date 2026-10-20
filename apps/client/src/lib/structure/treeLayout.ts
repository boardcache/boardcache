import type { Item, TreeItem, TreeNode } from '@boardcache/schema';

/**
 * Pure tree / mind-map layout. Tiled subtree algorithm: every node owns a
 * content block (its card plus the shelf of attached canvas items under it);
 * a subtree's breadth is the sum of its children's breadths (min its own),
 * centered over them. 'tree' lays depth downward, 'mindmap' rightward —
 * same math with the axes swapped.
 */

const TREE_TITLE_H = 40;
const NODE_W = 156;
const NODE_H = 44;
/** Label row height when a node carries attachments (items sit below it,
 *  INSIDE the node box). */
const NODE_LABEL_H = 34;
const NODE_PAD = 8;
/** Label typography (mirrors .tree-node / .tree-node-root): the size steps
 *  down until the label fits in three lines; past that it clips. */
const LABEL_FONT = 13;
const ROOT_FONT = 14;
const MIN_FONT = 9;
const MAX_LINES = 3;
const LINE_H = 1.25;
const LABEL_PAD_X = 10;
const LABEL_PAD_Y = 5;

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Text width in px at a font size; canvas metrics when there is a DOM,
 *  else an Inter-ish estimate (tests, node). */
function textWidth(text: string, fontPx: number): number {
  if (measureCtx === undefined) {
    measureCtx =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (measureCtx) {
    measureCtx.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
    return measureCtx.measureText(text).width;
  }
  return text.length * fontPx * 0.58;
}

/** Greedy word wrap; a word longer than the line is broken by character. */
function wrapLabel(label: string, fontPx: number, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  const push = () => {
    if (cur) lines.push(cur);
    cur = '';
  };
  for (const word of label.trim().split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, fontPx) <= maxW) {
      cur = next;
      continue;
    }
    push();
    if (textWidth(word, fontPx) <= maxW) {
      cur = word;
      continue;
    }
    let piece = '';
    for (const ch of word) {
      if (textWidth(piece + ch, fontPx) > maxW && piece) {
        lines.push(piece);
        piece = '';
      }
      piece += ch;
    }
    cur = piece;
  }
  push();
  return lines.length ? lines : [''];
}

/** The label's lines and font size for a card of width w. */
function fitLabel(label: string, root: boolean, w: number): { lines: string[]; fontSize: number } {
  const maxW = w - LABEL_PAD_X * 2;
  let fontSize = root ? ROOT_FONT : LABEL_FONT;
  for (; fontSize > MIN_FONT; fontSize--) {
    const lines = wrapLabel(label, fontSize, maxW);
    if (lines.length <= MAX_LINES) return { lines, fontSize };
  }
  return { lines: wrapLabel(label, fontSize, maxW).slice(0, MAX_LINES), fontSize };
}

/** Height the label row needs for its lines. */
function labelRowHeight(lines: string[], fontSize: number, shelved: boolean): number {
  const text = lines.length * fontSize * LINE_H + LABEL_PAD_Y * 2;
  return Math.max(shelved ? NODE_LABEL_H : NODE_H, Math.ceil(text));
}
/** Gap between sibling subtrees (breadth axis). */
const SIBLING_GAP = 22;
/** Gap between depth levels (beyond the deepest shelf in the level). */
const LEVEL_GAP = 46;
/** Attached items shrink to fit this square, keeping aspect. */
const TREE_SHELF_ITEM = 110;
const SHELF_GAP = 8;
const SHELF_COLS = 3;
const PADDING = 24;

interface TreeNodeBox {
  node: TreeNode;
  /** Node card rect, item-local coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** The label, wrapped to the card at `fontSize` (the DOM and the painter
   *  draw exactly these lines, so nothing spills past the border). */
  lines: string[];
  fontSize: number;
  /** Height of the label row (the whole card when nothing is shelved). */
  labelRow: number;
  /** Where the attached-item shelf starts (item-local; grid offsets add). */
  shelfX: number;
  shelfY: number;
}

export interface TreeLayout {
  boxes: Map<string, TreeNodeBox>;
  /** Attached-item offsets per node, keyed by item id, relative to the CARD's
   *  top-left (shelf flows along the depth axis, under/right of the card). */
  shelves: Map<string, Record<string, { dx: number; dy: number; w: number; h: number }>>;
  /** Required card size, including padding + title bar. */
  width: number;
  height: number;
  /** Root-first parent→children adjacency (stable node order). */
  childrenOf: Map<string | null, TreeNode[]>;
}

/** Normalized shelf size: EXACT fit to the shelf square, aspect kept. The
 *  result depends only on the item's aspect ratio, so re-layouts of a scaled
 *  card never compound. */
export function treeShelfSize(item: Item): { w: number; h: number } {
  const scale = TREE_SHELF_ITEM / Math.max(1, Math.max(item.width, item.height));
  return { w: item.width * scale, h: item.height * scale };
}

interface ShelfPlan {
  offsets: Record<string, { dx: number; dy: number; w: number; h: number }>;
  w: number;
  h: number;
}

/** Grid the attached items in rows of up to three under the node card. */
function planShelf(items: Item[]): ShelfPlan {
  const offsets: ShelfPlan['offsets'] = {};
  let w = 0;
  let y = 0;
  for (let r = 0; r * SHELF_COLS < items.length; r++) {
    const row = items.slice(r * SHELF_COLS, (r + 1) * SHELF_COLS);
    const sizes = row.map(treeShelfSize);
    const rowW = sizes.reduce((a, s) => a + s.w, 0) + (row.length - 1) * SHELF_GAP;
    const rowH = Math.max(...sizes.map((s) => s.h));
    let x = 0;
    row.forEach((it, i) => {
      offsets[it.id] = { dx: x, dy: y, w: sizes[i]!.w, h: sizes[i]!.h };
      x += sizes[i]!.w + SHELF_GAP;
    });
    w = Math.max(w, rowW);
    y += rowH + SHELF_GAP;
  }
  return { offsets, w, h: y > 0 ? y - SHELF_GAP : 0 };
}

export function computeTreeLayout(tree: TreeItem, itemsById?: Record<string, Item>): TreeLayout {
  const childrenOf = new Map<string | null, TreeNode[]>();
  for (const node of tree.nodes) {
    const key =
      node.parentId != null && tree.nodes.some((n) => n.id === node.parentId)
        ? node.parentId
        : null;
    (childrenOf.get(key) ?? childrenOf.set(key, []).get(key)!).push(node);
  }
  const roots = childrenOf.get(null) ?? [];
  const horizontal = tree.mode === 'mindmap';

  const shelves = new Map<string, ShelfPlan>();
  const labels = new Map<string, { lines: string[]; fontSize: number; labelRow: number }>();
  /** The node BOX dims — items live inside it, under the label row. */
  const boxSize = (node: TreeNode): { w: number; h: number } => {
    const shelf = shelves.get(node.id)!;
    const w = shelf.h === 0 ? NODE_W : Math.max(NODE_W, shelf.w + NODE_PAD * 2);
    let label = labels.get(node.id);
    if (!label) {
      const fit = fitLabel(node.label, node.parentId === null, w);
      label = { ...fit, labelRow: labelRowHeight(fit.lines, fit.fontSize, shelf.h > 0) };
      labels.set(node.id, label);
    }
    if (shelf.h === 0) return { w, h: label.labelRow };
    return { w, h: label.labelRow + shelf.h + NODE_PAD };
  };
  const contentSize = (node: TreeNode): { b: number; d: number } => {
    // breadth (across siblings) and depth (toward children) of the block.
    const attached = itemsById
      ? node.itemIds.map((id) => itemsById[id]).filter((it): it is Item => it !== undefined)
      : [];
    shelves.set(node.id, planShelf(attached));
    const { w, h } = boxSize(node);
    return horizontal ? { b: h, d: w } : { b: w, d: h };
  };

  // First pass: subtree breadth.
  const breadth = new Map<string, number>();
  const measure = (node: TreeNode): number => {
    const own = contentSize(node).b;
    const kids = childrenOf.get(node.id) ?? [];
    const kidsB =
      kids.reduce((a, k) => a + measure(k), 0) + Math.max(0, kids.length - 1) * SIBLING_GAP;
    const b = Math.max(own, kidsB);
    breadth.set(node.id, b);
    return b;
  };
  roots.forEach(measure);

  // Second pass: place blocks. Depth advances by the level's deepest block.
  const boxes = new Map<string, TreeNodeBox>();
  const place = (node: TreeNode, bStart: number, dStart: number, depth: number): void => {
    const size = contentSize(node);
    const b = breadth.get(node.id) ?? size.b;
    const bCenter = bStart + b / 2;
    const shelf = shelves.get(node.id)!;
    const box = boxSize(node);
    const label = labels.get(node.id)!;
    const x = horizontal ? dStart : bCenter - box.w / 2;
    const y = horizontal ? bCenter - box.h / 2 : dStart;
    boxes.set(node.id, {
      node,
      x,
      y,
      w: box.w,
      h: box.h,
      depth,
      lines: label.lines,
      fontSize: label.fontSize,
      labelRow: label.labelRow,
      // Items sit INSIDE the box, centered under the label row.
      shelfX: x + (box.w - shelf.w) / 2,
      shelfY: y + label.labelRow,
    });
    const kids = childrenOf.get(node.id) ?? [];
    if (kids.length === 0) return;
    const childD = dStart + size.d + LEVEL_GAP;
    const kidsB =
      kids.reduce((a, k) => a + (breadth.get(k.id) ?? 0), 0) + (kids.length - 1) * SIBLING_GAP;
    let cursor = bCenter - kidsB / 2;
    for (const kid of kids) {
      const kb = breadth.get(kid.id) ?? 0;
      place(kid, cursor, childD, depth + 1);
      cursor += kb + SIBLING_GAP;
    }
  };
  let rootCursor = 0;
  for (const root of roots) {
    place(root, rootCursor, 0, 0);
    rootCursor += (breadth.get(root.id) ?? 0) + SIBLING_GAP * 2;
  }

  // Normalize into padded card space (below the title bar) + measure extents.
  let maxX = 0;
  let maxY = 0;
  let minX = Infinity;
  let minY = Infinity;
  for (const box of boxes.values()) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  if (minX === Infinity) {
    minX = 0;
    minY = 0;
  }
  const offX = PADDING - minX;
  const offY = TREE_TITLE_H + PADDING - minY;
  for (const box of boxes.values()) {
    box.x += offX;
    box.y += offY;
    box.shelfX += offX;
    box.shelfY += offY;
  }

  const shelfOut = new Map<
    string,
    Record<string, { dx: number; dy: number; w: number; h: number }>
  >();
  for (const [nodeId, plan] of shelves) {
    if (Object.keys(plan.offsets).length > 0) shelfOut.set(nodeId, plan.offsets);
  }

  return {
    boxes,
    shelves: shelfOut,
    width: Math.max(320, maxX - minX + PADDING * 2),
    height: Math.max(160, maxY - minY + PADDING * 2 + TREE_TITLE_H),
    childrenOf,
  };
}
