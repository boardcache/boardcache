import { z } from 'zod';
import type { TierRow, TimelinePoint, TreeNode } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import {
  createPaletteItem,
  createQrItem,
  createTasklistItem,
  createTierListItem,
  createTitleItem,
  createTreeItem,
  TIER_DEFAULT_ROWS,
} from '../import/createItems';
import { createRssItem } from '../integrations/rss';
import { extractPaletteFromAsset } from '../color/paletteExtract';
import { combineIntoPlaylist, updateItems } from '../../state/commands';
import { addConclusion, moveEvidence, removeConclusion, updateCase } from '../structure/cases';
import { attachItemsToTierRow, detachFromTierRows, updateTier } from '../structure/tierAttach';
import { attachItemsToTreeNode, detachFromTreeNodes, updateTree } from '../structure/treeAttach';
import {
  attachItemsToTimelinePoint,
  detachItems,
  updateTimeline,
} from '../structure/timelineAttach';
import { updateStoryboard } from '../structure/storyboardAttach';
import { updateTasklist } from '../structure/tasklist';
import { measureMarkdownHeight } from '../text/markdown';
import { registerBoardTool } from './registry';
import {
  byIdOrLabel,
  idsSchema,
  placeAt,
  positionSchema,
  requireLive,
  requireType,
} from './shared';

/**
 * Core tools for the remaining item types and the container family (tier
 * lists, trees, timelines, storyboards, cases, task lists): creating them,
 * editing their structure, and shelving canvas items into them — the same
 * operations a person does by dragging onto a card.
 */

const colorArg = z.string().describe('#rrggbb');

// --- title ----------------------------------------------------------------------

registerBoardTool({
  name: 'add_title',
  description:
    'Add a title: one line of large display text for a board or section heading (not markdown). Returns the id; restyle later with set_text_style.',
  parameters: z.object({
    text: z.string().min(1).max(200),
    width: z.number().min(80).max(4000).optional(),
    height: z.number().min(40).max(1000).optional(),
    fontFamily: z.string().optional(),
    color: colorArg.nullable().optional().describe('null = theme ink'),
    background: colorArg.nullable().optional().describe('null = transparent'),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    alignH: z.enum(['left', 'center', 'right']).optional(),
    alignV: z.enum(['top', 'middle', 'bottom']).optional(),
    ...positionSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const id = createTitleItem(at, false);
    updateItems([id], 'Set title', (d) => {
      if (d.type !== 'title') return;
      d.text = args.text;
      if (args.width) {
        d.x = at.x - args.width / 2;
        d.width = args.width;
      }
      if (args.height) {
        d.y = at.y - args.height / 2;
        d.height = args.height;
      }
      if (args.fontFamily) d.fontFamily = args.fontFamily;
      if (args.color !== undefined) d.color = args.color;
      if (args.background !== undefined) d.background = args.background;
      if (args.bold !== undefined) d.bold = args.bold;
      if (args.italic !== undefined) d.italic = args.italic;
      if (args.alignH) d.alignH = args.alignH;
      if (args.alignV) d.alignV = args.alignV;
    });
    return { id };
  },
});

registerBoardTool({
  name: 'set_text_style',
  description:
    'Restyle text boxes, titles and code snippets: font size (text/code), font family, color, background (null = transparent), horizontal/vertical alignment, bold/italic (titles), autoHeight (text: grow to fit vs keep height and scroll).',
  parameters: z.object({
    ids: idsSchema,
    fontSize: z.number().min(6).max(400).optional(),
    fontFamily: z.string().optional().describe('CSS font-family stack'),
    color: colorArg.nullable().optional(),
    background: colorArg.nullable().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    autoHeight: z.boolean().optional(),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    const doc = ctx.doc();
    const styleable = ids.filter((id) => ['text', 'title', 'code'].includes(doc.items[id]!.type));
    if (!styleable.length)
      throw new Error('None of those items is a text box, title or code snippet.');
    updateItems(styleable, 'Style text', (d) => {
      if (d.type === 'text') {
        // A box still fitted to its content (never hand-sized) keeps fitting
        // it after the type changes; a hand-sized box keeps its size.
        const fitted =
          d.autoHeight ||
          Math.abs(d.height - measureMarkdownHeight(d.text, d.width, d.fontSize, d.fontFamily)) < 4;
        if (args.fontSize) d.fontSize = args.fontSize;
        if (args.fontFamily) d.fontFamily = args.fontFamily;
        if (args.color) d.color = args.color;
        if (args.background !== undefined) d.background = args.background;
        if (args.align) d.align = args.align;
        if (args.verticalAlign) d.verticalAlign = args.verticalAlign;
        if (args.autoHeight !== undefined) d.autoHeight = args.autoHeight;
        if (fitted && (args.fontSize || args.fontFamily)) {
          d.height = measureMarkdownHeight(d.text, d.width, d.fontSize, d.fontFamily);
        }
      } else if (d.type === 'title') {
        if (args.fontFamily) d.fontFamily = args.fontFamily;
        if (args.color !== undefined) d.color = args.color;
        if (args.background !== undefined) d.background = args.background;
        if (args.align) d.alignH = args.align;
        if (args.verticalAlign) d.alignV = args.verticalAlign;
        if (args.bold !== undefined) d.bold = args.bold;
        if (args.italic !== undefined) d.italic = args.italic;
      } else if (d.type === 'code') {
        if (args.fontSize) d.fontSize = Math.min(40, Math.max(8, args.fontSize));
      }
    });
    return { styled: styleable.length, skipped: ids.length - styleable.length };
  },
});

// --- qr / rss / palette / playlist ------------------------------------------------

registerBoardTool({
  name: 'add_qr_code',
  description: 'Add a QR code encoding a URL or text.',
  parameters: z.object({
    text: z.string().min(1).max(2000),
    color: colorArg.optional().describe('Module color (default black)'),
    background: colorArg.optional().describe('Square fill (default white)'),
    ...positionSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const id = createQrItem(at, args.text);
    if (args.color || args.background) {
      updateItems([id], 'Style QR code', (d) => {
        if (d.type !== 'qr') return;
        if (args.color) d.color = args.color;
        if (args.background) d.background = args.background;
      });
    }
    return { id };
  },
});

registerBoardTool({
  name: 'add_rss_feed',
  description:
    'Add a live RSS/Atom feed reader card for a feed URL (fetched now and on refresh; entries are cached in the board).',
  parameters: z.object({ url: z.string().min(8), ...positionSchema }),
  access: 'external',
  execute: async (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const id = await createRssItem(args.url, at);
    return { id };
  },
});

registerBoardTool({
  name: 'extract_palette',
  description:
    "Extract the dominant colors of an image into a new palette item placed beside it (what the image's Extract Palette action does). Returns the palette id and colors.",
  parameters: z.object({
    imageId: z.string(),
    count: z.number().int().min(2).max(12).default(6),
    name: z.string().optional(),
    ...positionSchema,
  }),
  access: 'write',
  execute: async (args, ctx) => {
    const image = requireType(ctx, args.imageId, 'image');
    const colors = await extractPaletteFromAsset(image.assetId, args.count);
    if (colors.length < 2) throw new Error('Could not read enough colors from that image.');
    const at =
      args.x !== undefined && args.y !== undefined
        ? { x: args.x, y: args.y }
        : { x: image.x + image.width + 40 + 160, y: image.y + 40 };
    const id = createPaletteItem(
      at,
      colors.map((color) => ({ id: newId(), color })),
      { name: args.name ?? `${image.name ?? 'Image'} palette` },
    );
    return { id, colors };
  },
});

registerBoardTool({
  name: 'combine_into_playlist',
  description:
    'Combine 2+ audio items into one playlist player (tracks in the given order). The audio items are replaced by the playlist.',
  parameters: z.object({ ids: idsSchema.describe('Audio item ids, in play order') }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    const id = combineIntoPlaylist(ids);
    if (!id) throw new Error('Needs at least 2 file-backed audio items.');
    return { id };
  },
});

// --- task list -----------------------------------------------------------------

const taskArg = z.object({
  id: z.string().optional().describe('Keep an existing task (from get_items)'),
  label: z.string().min(1).max(300),
  done: z.boolean().optional(),
  note: z.string().max(1000).optional(),
  due: z.string().nullable().optional().describe('ISO datetime; null = none'),
});

registerBoardTool({
  name: 'add_tasklist',
  description:
    'Add a checklist card (title + tasks with optional notes and due dates). For project work with milestones and a kanban use create_project instead.',
  parameters: z.object({
    title: z.string().min(1).max(120).default('Tasks'),
    tasks: z.array(taskArg).min(1).max(60),
    background: colorArg.nullable().optional(),
    color: colorArg.nullable().optional(),
    ...positionSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const id = createTasklistItem(at);
    updateTasklist(id, 'Set tasks', (t) => {
      t.title = args.title;
      if (args.background !== undefined) t.background = args.background;
      if (args.color !== undefined) t.color = args.color;
      t.tasks = args.tasks.map((task) => ({
        id: newId(),
        label: task.label,
        done: task.done ?? false,
        note: task.note ?? '',
        due: task.due ?? null,
        notifiedAt: null,
      }));
    });
    const tasks = ctx.doc().items[id];
    return {
      id,
      tasks:
        tasks?.type === 'tasklist' ? tasks.tasks.map((t) => ({ id: t.id, label: t.label })) : [],
    };
  },
});

registerBoardTool({
  name: 'edit_tasklist',
  description:
    'Edit a checklist card: title, colors, and/or the full task list (tasks with a known id keep their identity; omitted tasks are removed).',
  parameters: z.object({
    id: z.string(),
    title: z.string().min(1).max(120).optional(),
    background: colorArg.nullable().optional(),
    color: colorArg.nullable().optional(),
    tasks: z.array(taskArg).max(60).optional(),
  }),
  access: 'write',
  execute: (args, ctx) => {
    requireType(ctx, args.id, 'tasklist');
    updateTasklist(args.id, 'Edit tasks', (t) => {
      if (args.title) t.title = args.title;
      if (args.background !== undefined) t.background = args.background;
      if (args.color !== undefined) t.color = args.color;
      if (args.tasks) {
        const prev = new Map(t.tasks.map((x) => [x.id, x]));
        t.tasks = args.tasks.map((task) => {
          const old = task.id ? prev.get(task.id) : undefined;
          return {
            id: old?.id ?? newId(),
            label: task.label,
            done: task.done ?? old?.done ?? false,
            note: task.note ?? old?.note ?? '',
            due: task.due === undefined ? (old?.due ?? null) : task.due,
            notifiedAt: old && old.due === (task.due ?? old.due) ? old.notifiedAt : null,
          };
        });
      }
    });
    const item = requireType(ctx, args.id, 'tasklist');
    return {
      id: args.id,
      tasks: item.tasks.map((t) => ({ id: t.id, label: t.label, done: t.done })),
    };
  },
});

// --- tier list -----------------------------------------------------------------

const rowArg = z.object({
  id: z.string().optional().describe('Keep an existing row (from get_items)'),
  label: z.string().min(1).max(40),
  color: colorArg.optional(),
});

function tierRowsOut(rows: TierRow[]) {
  return rows.map((r) => ({ id: r.id, label: r.label, color: r.color, items: r.itemIds.length }));
}

registerBoardTool({
  name: 'add_tierlist',
  description:
    'Add a tier list card (ranking shelves, S–F by default). Rank canvas items into rows afterwards with place_in_tier. Returns the row ids.',
  parameters: z.object({
    title: z.string().min(1).max(120).default('Tier List'),
    description: z.string().max(400).optional(),
    rows: z.array(rowArg).min(1).max(12).optional().describe('Default: S, A, B, C, D, F'),
    width: z.number().min(420).max(4000).optional(),
    ...positionSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const rows: TierRow[] = (args.rows ?? TIER_DEFAULT_ROWS).map((r, i) => ({
      id: newId(),
      label: r.label,
      color: r.color ?? TIER_DEFAULT_ROWS[i % TIER_DEFAULT_ROWS.length]!.color,
      itemIds: [],
    }));
    const id = createTierListItem(at, {
      title: args.title,
      description: args.description ?? '',
      rows,
      ...(args.width ? { width: args.width } : {}),
    });
    return { id, rows: tierRowsOut(rows) };
  },
});

registerBoardTool({
  name: 'edit_tierlist',
  description:
    'Edit a tier list: title, description, and/or its rows in order (rows with a known id or an unchanged label keep their ranked items; dropped rows release theirs onto the canvas).',
  parameters: z.object({
    id: z.string(),
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(400).optional(),
    rows: z.array(rowArg).min(1).max(12).optional(),
  }),
  access: 'write',
  execute: (args, ctx) => {
    requireType(ctx, args.id, 'tierlist');
    updateTier(args.id, 'Edit tier list', (tier) => {
      if (args.title) tier.title = args.title;
      if (args.description !== undefined) tier.description = args.description;
      if (args.rows) {
        const prev = tier.rows;
        tier.rows = args.rows.map((r, i) => {
          const old =
            (r.id ? prev.find((p) => p.id === r.id) : undefined) ??
            prev.find((p) => p.label === r.label);
          return {
            id: old?.id ?? newId(),
            label: r.label,
            color: r.color ?? old?.color ?? TIER_DEFAULT_ROWS[i % TIER_DEFAULT_ROWS.length]!.color,
            itemIds: old?.itemIds ?? [],
          };
        });
      }
    });
    return { id: args.id, rows: tierRowsOut(requireType(ctx, args.id, 'tierlist').rows) };
  },
});

registerBoardTool({
  name: 'place_in_tier',
  description:
    'Rank canvas items into a tier list row (by row id or label), in the given order after any items already there. The items stay real canvas items, sized to the shelf. Row "none" removes them from any tier list.',
  parameters: z.object({
    tierlistId: z.string(),
    row: z.string().describe('Row id or label, or "none"'),
    ids: idsSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const tier = requireType(ctx, args.tierlistId, 'tierlist');
    const ids = requireLive(ctx, args.ids);
    if (args.row === 'none') {
      detachFromTierRows(ids);
      return { removed: ids.length };
    }
    const row = byIdOrLabel(tier.rows, args.row, 'row');
    attachItemsToTierRow(ids, { itemId: tier.id, rowId: row.id });
    return { ranked: ids.length, row: row.label };
  },
});

// --- tree / mind map ------------------------------------------------------------

function treeNodesOut(nodes: TreeNode[]) {
  return nodes.map((n) => ({
    id: n.id,
    label: n.label,
    parentId: n.parentId,
    ...(n.color ? { color: n.color } : {}),
    items: n.itemIds.length,
  }));
}

registerBoardTool({
  name: 'add_tree',
  description:
    'Add a tree (root on top) or mind map (root on the left) card with automatic layout. Give the nodes as a flat list with your own keys: exactly one node has no parent (the root); the others name their parent by key. Attach canvas items to nodes afterwards with attach_to_tree. Returns the node ids.',
  parameters: z.object({
    title: z.string().min(1).max(120).default('Tree'),
    mode: z.enum(['tree', 'mindmap']).default('tree'),
    nodes: z
      .array(
        z.object({
          key: z.string().min(1).describe('Your reference for this node'),
          label: z.string().min(1).max(200),
          parent: z.string().optional().describe('Key of the parent node; omit for the root'),
          color: colorArg.optional(),
        }),
      )
      .min(1)
      .max(200),
    ...positionSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const roots = args.nodes.filter((n) => !n.parent);
    if (roots.length !== 1) {
      throw new Error(`A tree has exactly one root (a node without parent); got ${roots.length}.`);
    }
    const idOf = new Map(args.nodes.map((n) => [n.key, newId()]));
    for (const n of args.nodes) {
      if (n.parent && !idOf.has(n.parent)) throw new Error(`Unknown parent key "${n.parent}".`);
    }
    const nodes: TreeNode[] = args.nodes.map((n) => ({
      id: idOf.get(n.key)!,
      label: n.label,
      parentId: n.parent ? idOf.get(n.parent)! : null,
      ...(n.color ? { color: n.color } : {}),
      itemIds: [],
    }));
    const at = placeAt(ctx, args.x, args.y);
    const id = createTreeItem(at, { title: args.title, mode: args.mode, nodes });
    return {
      id,
      nodes: nodes.map((n, i) => ({ key: args.nodes[i]!.key, id: n.id, label: n.label })),
    };
  },
});

registerBoardTool({
  name: 'edit_tree',
  description:
    "Edit a tree card: title, mode, add nodes under a parent (id or label), rename/recolor nodes, remove nodes (their children move up to the removed node's parent). Returns the full node list.",
  parameters: z.object({
    id: z.string(),
    title: z.string().min(1).max(120).optional(),
    mode: z.enum(['tree', 'mindmap']).optional(),
    add: z
      .array(
        z.object({
          label: z.string().min(1).max(200),
          parent: z.string().describe('Parent node id or label'),
          color: colorArg.optional(),
        }),
      )
      .optional(),
    rename: z
      .array(
        z.object({
          node: z.string().describe('Node id or label'),
          label: z.string().min(1).max(200).optional(),
          color: colorArg.nullable().optional(),
        }),
      )
      .optional(),
    remove: z.array(z.string()).optional().describe('Node ids or labels (never the root)'),
  }),
  access: 'write',
  execute: (args, ctx) => {
    requireType(ctx, args.id, 'tree');
    const added: { id: string; label: string }[] = [];
    updateTree(args.id, 'Edit tree', (tree) => {
      if (args.title) tree.title = args.title;
      if (args.mode) tree.mode = args.mode;
      for (const r of args.rename ?? []) {
        const node = byIdOrLabel(tree.nodes, r.node, 'node');
        if (r.label) node.label = r.label;
        if (r.color === null) delete node.color;
        else if (r.color) node.color = r.color;
      }
      for (const a of args.add ?? []) {
        const parent = byIdOrLabel(tree.nodes, a.parent, 'node');
        const node: TreeNode = {
          id: newId(),
          label: a.label,
          parentId: parent.id,
          ...(a.color ? { color: a.color } : {}),
          itemIds: [],
        };
        tree.nodes.push(node);
        added.push({ id: node.id, label: node.label });
      }
      for (const ref of args.remove ?? []) {
        const node = byIdOrLabel(tree.nodes, ref, 'node');
        if (node.parentId === null) throw new Error('The root node cannot be removed.');
        for (const n of tree.nodes) if (n.parentId === node.id) n.parentId = node.parentId;
        tree.nodes = tree.nodes.filter((n) => n.id !== node.id);
      }
    });
    return { id: args.id, added, nodes: treeNodesOut(requireType(ctx, args.id, 'tree').nodes) };
  },
});

registerBoardTool({
  name: 'attach_to_tree',
  description:
    'Shelve canvas items under a tree node (by node id or label); they stay real items, sized to fit, and the card re-lays out. Node "none" detaches them from any tree.',
  parameters: z.object({
    treeId: z.string(),
    node: z.string().describe('Node id or label, or "none"'),
    ids: idsSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const tree = requireType(ctx, args.treeId, 'tree');
    const ids = requireLive(ctx, args.ids);
    if (args.node === 'none') {
      detachFromTreeNodes(ids);
      return { detached: ids.length };
    }
    const node = byIdOrLabel(tree.nodes, args.node, 'node');
    attachItemsToTreeNode(ids, { itemId: tree.id, nodeId: node.id });
    return { attached: ids.length, node: node.label };
  },
});

// --- timeline -----------------------------------------------------------------

const pointArg = z.object({
  id: z.string().optional().describe('Keep an existing point (from get_items)'),
  label: z.string().min(1).max(120),
  date: z.string().max(60).optional().describe('Display date/era text ("1872", "May 4")'),
  description: z.string().max(2000).optional(),
  color: colorArg.nullable().optional(),
});

registerBoardTool({
  name: 'edit_timeline',
  description:
    'Edit a timeline (created with create_timeline): name, orientation, scale mode ("date" spaces points by their parsed dates when every point has one), line/point style, and/or the full ordered point list (points with a known id or an unchanged label keep their attached items).',
  parameters: z.object({
    id: z.string(),
    name: z.string().max(120).optional(),
    orientation: z.enum(['horizontal', 'vertical']).optional(),
    scaleMode: z.enum(['even', 'date']).optional(),
    style: z
      .object({
        lineColor: colorArg.optional(),
        lineWidth: z.number().min(1).max(12).optional(),
        pointColor: colorArg.optional(),
        pointSize: z.number().min(4).max(24).optional(),
      })
      .optional(),
    points: z.array(pointArg).min(1).max(100).optional(),
  }),
  access: 'write',
  execute: (args, ctx) => {
    requireType(ctx, args.id, 'timeline');
    updateTimeline(args.id, 'Edit timeline', (timeline) => {
      if (args.name !== undefined) timeline.name = args.name;
      if (args.orientation && args.orientation !== timeline.orientation) {
        timeline.orientation = args.orientation;
        const { width, height } = timeline;
        timeline.width = height;
        timeline.height = width;
      }
      if (args.scaleMode) timeline.scaleMode = args.scaleMode;
      if (args.style) {
        const st = args.style;
        timeline.style = {
          lineColor: st.lineColor ?? timeline.style.lineColor,
          lineWidth: st.lineWidth ?? timeline.style.lineWidth,
          pointColor: st.pointColor ?? timeline.style.pointColor,
          pointSize: st.pointSize ?? timeline.style.pointSize,
        };
      }
      if (args.points) {
        const prev = timeline.points;
        timeline.points = args.points.map((p): TimelinePoint => {
          const old =
            (p.id ? prev.find((q) => q.id === p.id) : undefined) ??
            prev.find((q) => q.label === p.label);
          return {
            id: old?.id ?? newId(),
            label: p.label,
            date: p.date ?? old?.date ?? '',
            description: p.description ?? old?.description ?? '',
            color: p.color === undefined ? (old?.color ?? null) : p.color,
            collapsed: old?.collapsed ?? !(p.description ?? ''),
            itemIds: old?.itemIds ?? [],
            freeArrange: old?.freeArrange ?? false,
          };
        });
      }
    });
    const item = requireType(ctx, args.id, 'timeline');
    return {
      id: args.id,
      points: item.points.map((p) => ({ id: p.id, label: p.label, items: p.itemIds.length })),
    };
  },
});

registerBoardTool({
  name: 'attach_to_timeline',
  description:
    'Shelve canvas items at a timeline point (by point id or label): they stay real items, shrink to the shelf size and stack beside the point. Point "none" detaches them from any timeline.',
  parameters: z.object({
    timelineId: z.string(),
    point: z.string().describe('Point id or label, or "none"'),
    ids: idsSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const timeline = requireType(ctx, args.timelineId, 'timeline');
    const ids = requireLive(ctx, args.ids);
    if (args.point === 'none') {
      detachItems(ids);
      return { detached: ids.length };
    }
    const point = byIdOrLabel(timeline.points, args.point, 'point');
    attachItemsToTimelinePoint(ids, { itemId: timeline.id, pointId: point.id });
    return { attached: ids.length, point: point.label };
  },
});

// --- storyboard ---------------------------------------------------------------

registerBoardTool({
  name: 'edit_storyboard',
  description:
    'Edit a storyboard card: title, aspect, columns, and/or the full ordered panel list (panels with a known id or an unchanged label keep their frame).',
  parameters: z.object({
    id: z.string(),
    title: z.string().min(1).max(120).optional(),
    aspect: z.enum(['16:9', '9:16', '4:3', '2.39:1']).optional(),
    columns: z.number().int().min(1).max(8).optional(),
    panels: z
      .array(
        z.object({
          id: z.string().optional(),
          label: z.string().min(1).max(60),
          scene: z.string().max(120).optional(),
          action: z.string().max(400).optional(),
          move: z.string().max(60).optional(),
          lens: z.string().max(30).optional(),
          duration: z.number().min(0).nullable().optional(),
        }),
      )
      .min(1)
      .max(40)
      .optional(),
  }),
  access: 'write',
  execute: (args, ctx) => {
    requireType(ctx, args.id, 'storyboard');
    updateStoryboard(args.id, 'Edit storyboard', (sb) => {
      if (args.title) sb.title = args.title;
      if (args.aspect) sb.aspect = args.aspect;
      if (args.columns) sb.columns = args.columns;
      if (args.panels) {
        const prev = sb.panels;
        sb.panels = args.panels.map((p) => {
          const old =
            (p.id ? prev.find((q) => q.id === p.id) : undefined) ??
            prev.find((q) => q.label === p.label);
          return {
            id: old?.id ?? newId(),
            label: p.label,
            scene: p.scene ?? old?.scene ?? '',
            action: p.action ?? old?.action ?? '',
            move: p.move ?? old?.move ?? '',
            lens: p.lens ?? old?.lens ?? '',
            duration: p.duration === undefined ? (old?.duration ?? null) : p.duration,
            itemIds: old?.itemIds ?? [],
            freeArrange: old?.freeArrange ?? false,
          };
        });
      }
    });
    const item = requireType(ctx, args.id, 'storyboard');
    return { id: args.id, panels: item.panels.map((p) => ({ id: p.id, label: p.label })) };
  },
});

// --- case ---------------------------------------------------------------------

registerBoardTool({
  name: 'edit_case',
  description:
    'Edit a case: title, question, add/rename/remove conclusions (by id or label; removing one drops its evidence links), and move evidence items from one conclusion to another. Returns the conclusions.',
  parameters: z.object({
    id: z.string(),
    title: z.string().max(120).optional(),
    question: z.string().max(400).optional(),
    addConclusions: z.array(z.string().min(1).max(200)).optional(),
    renameConclusions: z
      .array(z.object({ conclusion: z.string(), label: z.string().min(1).max(200) }))
      .optional(),
    removeConclusions: z.array(z.string()).optional(),
    moveEvidence: z
      .array(z.object({ itemId: z.string(), from: z.string(), to: z.string() }))
      .optional()
      .describe('Conclusions by id or label'),
  }),
  access: 'write',
  execute: (args, ctx) => {
    let card = requireType(ctx, args.id, 'case');
    if (args.title !== undefined || args.question !== undefined) {
      updateCase(card.id, 'Edit case', (c) => {
        if (args.title !== undefined) c.title = args.title;
        if (args.question !== undefined) c.question = args.question;
      });
    }
    for (const r of args.renameConclusions ?? []) {
      const target = byIdOrLabel(card.conclusions, r.conclusion, 'conclusion');
      updateCase(card.id, 'Rename conclusion', (c) => {
        const hit = c.conclusions.find((x) => x.id === target.id);
        if (hit) hit.label = r.label;
      });
      card = requireType(ctx, args.id, 'case');
    }
    for (const label of args.addConclusions ?? []) addConclusion(card.id, label);
    card = requireType(ctx, args.id, 'case');
    for (const m of args.moveEvidence ?? []) {
      requireLive(ctx, [m.itemId]);
      const from = byIdOrLabel(card.conclusions, m.from, 'conclusion');
      const to = byIdOrLabel(card.conclusions, m.to, 'conclusion');
      moveEvidence(card.id, m.itemId, from.id, to.id);
    }
    for (const ref of args.removeConclusions ?? []) {
      card = requireType(ctx, args.id, 'case');
      removeConclusion(card.id, byIdOrLabel(card.conclusions, ref, 'conclusion').id);
    }
    card = requireType(ctx, args.id, 'case');
    return {
      id: card.id,
      conclusions: card.conclusions.map((c) => ({
        id: c.id,
        label: c.label,
        evidence: card.evidence.filter((e) => e.conclusionId === c.id).length,
      })),
    };
  },
});
