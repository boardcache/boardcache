import {
  activePageId as revealActivePageId,
  addPage,
  revealItemPage,
  switchPage,
} from '../board/pages';
import { z } from 'zod';
import type { CanvasDocument, Item, ShapeItem } from '@boardcache/schema';
import { connectionRelSchema, newId } from '@boardcache/schema';
import {
  alignItems,
  distributeItems,
  matchItemSize,
  organizeSelection,
  spreadItems,
} from '../canvas/arrange';
import { getCanvasContainer } from '../canvas/canvasDom';
import { mapExternalUrl } from '../integrations/mapEmbed';
import {
  createHtmlEmbed,
  createLinkItem,
  createPaletteItem,
  createSwatchItem,
  createTextBox,
  createCaseItem,
} from '../import/createItems';
import { fitViewportTo } from '../canvas/viewportActions';
import {
  addConnection,
  addItems,
  groupItems,
  removeItems,
  reorderItems,
  runCommand,
  setConnectionLabel,
  topZIndex,
  updateItems,
} from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { linkEvidence, membershipsOf, unlinkEvidence } from '../structure/cases';
import { attachedTierRowOf } from '../structure/tierAttach';
import { attachedTreeNodeOf } from '../structure/treeAttach';
import { attachedPointOf } from '../structure/timelineAttach';
import { attachedPanelOf } from '../structure/storyboardAttach';
import { withCarried } from '../canvas/carried';
import { measureMarkdownHeight } from '../text/markdown';
import { registerBoardTool } from './registry';
import { clip, idsSchema, liveIds, placeAt, positionSchema, requireLive } from './shared';

/**
 * Core board tools: the deterministic action surface over the canvas.
 * Read tools return compact JSON (token-friendly); write tools go through the
 * normal command layer, so undo/redo, sync and autosave all apply.
 */

// --- serialization helpers ----------------------------------------------------

const round = (n: number) => Math.round(n);

/** One-line summary of an item for inventories. */
function itemBrief(item: Item) {
  return {
    id: item.id,
    type: item.type,
    ...(item.name ? { name: item.name } : {}),
    x: round(item.x),
    y: round(item.y),
    width: round(item.width),
    height: round(item.height),
    ...(item.groupId ? { groupId: item.groupId } : {}),
    ...(item.tags?.length ? { tags: item.tags } : {}),
    ...(item.status ? { status: item.status } : {}),
    ...(item.weight ? { weight: item.weight } : {}),
    ...(item.locked ? { locked: true } : {}),
    ...(item.hidden ? { hidden: true } : {}),
  };
}

/** Fuller detail, with type-specific content (still bounded). */
function itemDetail(item: Item) {
  const base = {
    ...itemBrief(item),
    rotation: item.rotation,
    zIndex: item.zIndex,
    opacity: item.opacity,
    ...(item.notes ? { notes: clip(item.notes, 2000) } : {}),
    ...(item.linkUrl ? { linkUrl: item.linkUrl } : {}),
    ...(item.source ? { source: item.source } : {}),
  };
  switch (item.type) {
    case 'image':
      return {
        ...base,
        ...(item.ocrText ? { ocrText: clip(item.ocrText, 4000) } : {}),
        ...(item.description ? { description: clip(item.description, 2000) } : {}),
        ...(item.caption ? { caption: true, captionCorner: item.captionCorner } : {}),
        ...(item.flipH || item.flipV ? { flipH: item.flipH, flipV: item.flipV } : {}),
        ...(item.crop ? { crop: item.crop } : {}),
        ...(item.filters ? { filters: item.filters } : {}),
      };
    case 'text':
      return {
        ...base,
        text: clip(item.text, 4000),
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        color: item.color,
        background: item.background,
        align: item.align,
        verticalAlign: item.verticalAlign,
      };
    case 'code':
      return { ...base, code: clip(item.code, 4000), language: item.language };
    case 'swatch':
      return { ...base, color: item.color };
    case 'palette':
      return { ...base, colors: item.colors.map((c) => c.color) };
    case 'shape':
      return { ...base, shape: item.shape, fill: item.fill, stroke: item.stroke };
    case 'link':
      return { ...base, label: item.label, url: item.url, background: item.background };
    case 'title':
      return {
        ...base,
        text: item.text,
        fontFamily: item.fontFamily,
        color: item.color,
        background: item.background,
        bold: item.bold,
        italic: item.italic,
        alignH: item.alignH,
        alignV: item.alignV,
      };
    case 'epub':
      return {
        ...base,
        bookTitle: item.bookTitle ?? null,
        author: item.author ?? null,
        bookmarks: item.bookmarks.map((b) => b.label),
      };
    case 'iframe':
      return { ...base, url: item.url };
    case 'map':
      return {
        ...base,
        provider: item.provider,
        mode: item.mapMode,
        center: { lat: item.lat, lng: item.lng },
        zoom: item.zoom,
        place: item.query || null,
        ...(item.mapMode === 'directions'
          ? { origin: item.origin, destination: item.destination, travelMode: item.travelMode }
          : {}),
        url: mapExternalUrl(item),
      };
    case 'rss':
      return {
        ...base,
        url: item.url,
        feedTitle: item.feedTitle,
        entries: item.entries.slice(0, 10).map((e) => ({ title: e.title, link: e.link })),
      };
    case 'font':
      return { ...base, family: item.family };
    case 'qr':
      return { ...base, text: item.text };
    case 'tierlist':
      return {
        ...base,
        title: item.title,
        description: item.description || undefined,
        rows: item.rows.map((r) => ({
          id: r.id,
          label: r.label,
          color: r.color,
          itemIds: r.itemIds,
        })),
      };
    case 'case':
      return {
        ...base,
        title: item.title,
        question: item.question || undefined,
        conclusions: item.conclusions,
        evidence: item.evidence,
      };
    case 'storyboard':
      return {
        ...base,
        title: item.title,
        aspect: item.aspect,
        panels: item.panels.map((p) => ({
          id: p.id,
          label: p.label,
          scene: p.scene,
          action: p.action,
          duration: p.duration,
          itemIds: p.itemIds,
        })),
      };
    case 'project':
      return {
        ...base,
        title: item.title,
        description: item.description || undefined,
        status: item.status,
        startDate: item.startDate ?? undefined,
        endDate: item.endDate ?? undefined,
        itemIds: item.itemIds,
        milestones: item.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          status: m.status,
          startDate: m.startDate ?? undefined,
          endDate: m.endDate ?? undefined,
          dependsOn: m.dependsOn,
          itemIds: m.itemIds,
        })),
        tasks: item.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          milestoneId: t.milestoneId ?? undefined,
          due: t.due ?? undefined,
          start: t.start ?? undefined,
          end: t.end ?? undefined,
          subtasks: t.subtasks.map((st) => ({
            label: st.label,
            done: st.done,
            due: st.due ?? undefined,
          })),
          itemIds: t.itemIds,
        })),
      };
    case 'tree':
      return {
        ...base,
        title: item.title,
        mode: item.mode,
        nodes: item.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          parentId: n.parentId,
          ...(n.color ? { color: n.color } : {}),
          itemIds: n.itemIds,
        })),
      };
    case 'timeline':
      return {
        ...base,
        orientation: item.orientation,
        scaleMode: item.scaleMode,
        style: item.style,
        points: item.points.map((p) => ({
          id: p.id,
          label: p.label,
          date: p.date || undefined,
          description: p.description || undefined,
          ...(p.color ? { color: p.color } : {}),
          itemIds: p.itemIds,
        })),
      };
    case 'tasklist':
      return {
        ...base,
        title: item.title,
        background: item.background,
        color: item.color,
        tasks: item.tasks.map((t) => ({
          id: t.id,
          label: t.label,
          done: t.done,
          note: t.note || undefined,
          due: t.due ?? undefined,
        })),
      };
    case 'poll': {
      const tally: Record<string, number> = {};
      for (const option of item.options) {
        tally[option.label] = Object.values(item.votes).filter((v) =>
          v.optionIds.includes(option.id),
        ).length;
      }
      return {
        ...base,
        question: item.question,
        closed: item.closed,
        multiple: item.multiple,
        results: tally,
        voters: Object.values(item.votes).map((v) => v.name),
      };
    }
    case 'recipe':
      return {
        ...base,
        title: item.title,
        servings: item.servings,
        totalMin: item.totalMin,
        ingredients: item.ingredients.slice(0, 40),
        steps: item.steps.slice(0, 40).map((step) => clip(step, 300)),
        sourceUrl: item.sourceUrl,
      };
    case 'time':
      return {
        ...base,
        mode: item.mode,
        face: item.face,
        timezone: item.timezone,
        targetAt: item.targetAt,
        running:
          item.mode === 'stopwatch'
            ? item.startedAt !== null
            : item.mode === 'pomodoro'
              ? item.phaseEndAt !== null
              : null,
      };
    case 'htmlembed':
      return { ...base, title: item.title ?? null };
    case 'audio':
      return {
        ...base,
        title: item.title ?? null,
        artist: item.artist ?? null,
        ...(item.transcript ? { transcript: clip(item.transcript, 6000) } : {}),
      };
    case 'video':
      return {
        ...base,
        ...(item.transcript ? { transcript: clip(item.transcript, 6000) } : {}),
        ...(item.markers.length
          ? { markers: item.markers.map((m) => ({ time: m.time, label: m.label })) }
          : {}),
      };
    default:
      return base;
  }
}

/** Where an item sits in the board's structures: cases it is evidence in,
 *  the container (tier row, tree node, timeline point, storyboard panel)
 *  holding it, comments on it. */
function itemContext(doc: CanvasDocument, id: string) {
  const cases = membershipsOf(doc.items, id).map((m) => ({
    caseId: m.caseId,
    conclusion: m.conclusion.label,
    stance: m.stance,
  }));
  const tier = attachedTierRowOf(doc, id);
  const node = attachedTreeNodeOf(doc, id);
  const point = attachedPointOf(doc, id);
  const panel = attachedPanelOf(doc, id);
  const comments = Object.values(doc.comments)
    .filter((c) => c.itemId === id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((c) => ({ id: c.id, author: c.author, text: clip(c.text, 1000), createdAt: c.createdAt }));
  const connections = Object.values(doc.connections)
    .filter(
      (c) =>
        (c.from.kind === 'item' && c.from.id === id) || (c.to.kind === 'item' && c.to.id === id),
    )
    .map((c) => ({
      id: c.id,
      from: c.from.id,
      to: c.to.id,
      rel: c.rel,
      ...(c.label ? { label: c.label } : {}),
    }));
  return {
    ...(cases.length ? { cases } : {}),
    ...(tier ? { tierlist: { id: tier.itemId, rowId: tier.rowId } } : {}),
    ...(node ? { tree: { id: node.itemId, nodeId: node.nodeId } } : {}),
    ...(point ? { timeline: { id: point.itemId, pointId: point.pointId } } : {}),
    ...(panel ? { storyboard: { id: panel.itemId, panelId: panel.panelId } } : {}),
    ...(comments.length ? { comments } : {}),
    ...(connections.length ? { connections } : {}),
  };
}

const INVENTORY_CAP = 150;
const CONNECTION_CAP = 200;

// --- read tools -----------------------------------------------------------------

registerBoardTool({
  name: 'get_board_summary',
  description:
    'Overview of the current board: name, item inventory (id, type, name, position, size, tags) and groups. Call this first to learn what is on the board and get valid item ids.',
  parameters: z.object({}),
  access: 'read',
  execute: (_args, ctx) => {
    const doc = ctx.doc();
    const items = Object.values(doc.items).sort((a, b) => a.y - b.y || a.x - b.x);
    const firstPg = doc.pages[0]?.id ?? null;
    return {
      boardName: doc.name,
      itemCount: items.length,
      ...(doc.pages.length > 1
        ? {
            pages: doc.pages.map((p) => ({
              id: p.id,
              name: p.name,
              items: items.filter((i) => (i.pageId ?? firstPg) === p.id).length,
            })),
            activePage: revealActivePageId(doc),
          }
        : {}),
      items: items.slice(0, INVENTORY_CAP).map(itemBrief),
      ...(items.length > INVENTORY_CAP
        ? { truncated: `${items.length - INVENTORY_CAP} more items not shown` }
        : {}),
      groups: Object.values(doc.groups).map((g) => ({
        id: g.id,
        name: g.name ?? null,
        ...(g.parentId ? { parentId: g.parentId } : {}),
        members: items.filter((i) => i.groupId === g.id).map((i) => i.id),
      })),
      ...(Object.keys(doc.connections).length
        ? {
            connections: Object.values(doc.connections)
              .slice(0, CONNECTION_CAP)
              .map((c) => ({
                id: c.id,
                from: c.from.kind === 'item' ? c.from.id : { group: c.from.id },
                to: c.to.kind === 'item' ? c.to.id : { group: c.to.id },
                rel: c.rel,
                ...(c.label ? { label: c.label } : {}),
              })),
          }
        : {}),
      ...(doc.presentation.steps.length
        ? { presentation: doc.presentation.steps.map((s) => s.id) }
        : {}),
      selection: ctx.selection(),
    };
  },
});

registerBoardTool({
  name: 'get_items',
  description:
    'Full detail for specific items: text content, colors, URLs, notes, tags, geometry. Use after get_board_summary when you need contents.',
  parameters: z.object({ ids: idsSchema }),
  access: 'read',
  execute: (args, ctx) => {
    const doc = ctx.doc();
    const { live, missing } = liveIds(doc, args.ids);
    return {
      items: live.map((id) => ({ ...itemDetail(doc.items[id]!), ...itemContext(doc, id) })),
      ...(missing.length ? { missing } : {}),
    };
  },
});

registerBoardTool({
  name: 'search_board',
  description:
    'Keyword search over the full CONTENT of every item on the board — text, code, PDF text, webpage/embed bodies, RSS entries, recipes, notes, tags, URLs. Returns matching item ids with snippets; follow up with get_items for full detail. Prefer this over guessing ids from the summary on large boards.',
  parameters: z.object({
    query: z.string().min(1).describe('Search terms (plain keywords, not a question).'),
    limit: z.number().int().min(1).max(30).optional().describe('Max hits (default 12).'),
  }),
  access: 'read',
  execute: async (args) => {
    const { boardIndexReady, searchBoardHybrid, unindexedSummary } =
      await import('../search/boardIndex');
    await boardIndexReady(); // pick up edits made moments ago
    const hits = await searchBoardHybrid(args.query, args.limit ?? 12);
    const gaps = unindexedSummary();
    return {
      count: hits.length,
      hits: hits.map((h) => ({ id: h.id, type: h.type, title: h.title, snippet: h.snippet })),
      ...(gaps.images.length + gaps.media.length > 0
        ? {
            note: `Content not searchable for ${gaps.images.length} image(s) without OCR and ${gaps.media.length} audio/video item(s); their names/notes/tags still match. Suggest the user run Extract Text (OCR) on relevant images.`,
          }
        : {}),
    };
  },
});

registerBoardTool({
  name: 'get_selection',
  description: 'The items the user currently has selected on the canvas, with full detail.',
  parameters: z.object({}),
  access: 'read',
  execute: (_args, ctx) => {
    const doc = ctx.doc();
    const ids = ctx.selection().filter((id) => doc.items[id]);
    return { count: ids.length, items: ids.map((id) => itemDetail(doc.items[id]!)) };
  },
});

// --- create tools ---------------------------------------------------------------

registerBoardTool({
  name: 'add_markdown_text',
  description:
    'Add a markdown text box to the board. Supports headings, lists, bold/italic, links, code, tables.',
  parameters: z.object({
    text: z.string().min(1),
    width: z.number().min(120).max(1200).optional(),
    ...positionSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const width = args.width ?? 380;
    const id = createTextBox({ x: at.x - width / 2, y: at.y - 100 }, width, args.text, 'Add text');
    return { id };
  },
});

const SHAPE_KINDS = ['rect', 'ellipse', 'diamond', 'star', 'polygon'] as const;

registerBoardTool({
  name: 'add_shape',
  description: 'Add a shape (rect, ellipse, diamond, star or polygon) with optional fill/stroke.',
  parameters: z.object({
    shape: z.enum(SHAPE_KINDS),
    width: z.number().min(8).max(4000).default(220),
    height: z.number().min(8).max(4000).default(160),
    fill: z.string().nullable().optional().describe('CSS color or null for no fill'),
    stroke: z.string().nullable().optional(),
    cornerRadius: z.number().min(0).optional().describe('rect only'),
    sides: z.number().int().min(3).max(24).optional().describe('polygon/star'),
    ...positionSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const { doc } = useDocumentStore.getState();
    const item: ShapeItem = {
      id: newId(),
      type: 'shape',
      x: at.x - args.width / 2,
      y: at.y - args.height / 2,
      width: args.width,
      height: args.height,
      rotation: 0,
      zIndex: topZIndex(doc) + 1,
      locked: false,
      opacity: 1,
      groupId: null,
      shape: args.shape,
      fill: args.fill ?? null,
      stroke: args.stroke ?? (args.fill ? null : '#4f8ef7'),
      strokeWidth: 2,
      dashed: false,
      cornerRadius: args.cornerRadius ?? 0,
      sides: args.sides ?? 5,
      innerRadiusRatio: 0.5,
      flipDiagonal: false,
      points: null,
      pathNodes: null,
      pathClosed: false,
    };
    addItems([item], 'Add shape');
    return { id: item.id };
  },
});

registerBoardTool({
  name: 'add_link_button',
  description: 'Add a colored link button that opens a URL.',
  parameters: z.object({
    label: z.string().min(1),
    url: z.string().min(1),
    background: z.string().optional().describe('#rrggbb'),
    ...positionSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const id = createLinkItem(at);
    updateItems([id], 'Set link', (d) => {
      if (d.type !== 'link') return;
      d.label = args.label;
      d.url = args.url;
      if (args.background) d.background = args.background;
    });
    return { id };
  },
});

registerBoardTool({
  name: 'add_swatch',
  description: 'Add a single color swatch.',
  parameters: z.object({
    color: z.string().describe('#rrggbb'),
    name: z.string().optional(),
    ...positionSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const id = createSwatchItem(at, args.color, args.name);
    return { id };
  },
});

registerBoardTool({
  name: 'add_palette',
  description: 'Add a color palette (a strip of 2–12 colors).',
  parameters: z.object({
    colors: z.array(z.string()).min(2).max(12).describe('#rrggbb values'),
    name: z.string().optional(),
    ...positionSchema,
  }),
  access: 'write',
  execute: (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const id = createPaletteItem(
      at,
      args.colors.map((color) => ({ id: newId(), color })),
      args.name !== undefined ? { name: args.name } : {},
    );
    return { id };
  },
});

registerBoardTool({
  name: 'add_html_embed',
  description:
    'Add a document box rendering self-contained HTML (inline CSS only; scripts are stripped by sandboxing). Good for tables, reports, formatted content beyond markdown.',
  parameters: z.object({
    html: z.string().min(1).describe('A complete standalone HTML document'),
    title: z.string().optional(),
    width: z.number().min(200).max(1600).optional(),
    height: z.number().min(150).max(2000).optional(),
    ...positionSchema,
  }),
  access: 'write',
  execute: async (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    const id = await createHtmlEmbed(at, {
      html: args.html,
      ...(args.title ? { title: args.title } : {}),
      ...(args.width ? { width: args.width } : {}),
      ...(args.height ? { height: args.height } : {}),
    });
    return { id };
  },
});

// --- edit / transform tools -------------------------------------------------------

registerBoardTool({
  name: 'edit_text',
  description:
    'Replace the content of a text item (markdown), a title (one line) or a code snippet (the source).',
  parameters: z.object({ id: z.string(), text: z.string() }),
  access: 'write',
  execute: (args, ctx) => {
    const [id] = requireLive(ctx, [args.id]);
    const item = ctx.doc().items[id!]!;
    if (item.type !== 'text' && item.type !== 'title' && item.type !== 'code') {
      throw new Error(`Item ${id} is a ${item.type}, not text, title or code.`);
    }
    updateItems([id!], 'Edit text', (d) => {
      // A text box still fitted to its content keeps fitting the new text;
      // a hand-sized one keeps its size (the editor itself only grows).
      const fitted =
        d.type === 'text' &&
        (d.autoHeight ||
          Math.abs(d.height - measureMarkdownHeight(d.text, d.width, d.fontSize, d.fontFamily)) <
            4);
      if (d.type === 'text' || d.type === 'title') d.text = args.text;
      if (d.type === 'code') d.code = args.text;
      if (d.type === 'text' && fitted) {
        d.height = measureMarkdownHeight(d.text, d.width, d.fontSize, d.fontFamily);
      }
    });
    return { id };
  },
});

registerBoardTool({
  name: 'move_items',
  description:
    'Move items to absolute canvas positions (x/y = item top-left). A container (timeline, tier list, tree, storyboard) carries the items shelved on it, as dragging does.',
  parameters: z.object({
    moves: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })).min(1),
  }),
  access: 'write',
  execute: (args, ctx) => {
    requireLive(
      ctx,
      args.moves.map((m) => m.id),
    );
    const doc = ctx.doc();
    const explicit = new Set(args.moves.map((m) => m.id));
    // Shelved items follow their container by the container's own delta.
    const carried: { id: string; dx: number; dy: number }[] = [];
    for (const m of args.moves) {
      const container = doc.items[m.id]!;
      if (container.locked) continue;
      const dx = m.x - container.x;
      const dy = m.y - container.y;
      for (const id of withCarried(doc, [m.id])) {
        if (id !== m.id && !explicit.has(id)) carried.push({ id, dx, dy });
      }
    }
    runCommand('Move items', (draft) => {
      for (const m of args.moves) {
        const item = draft.items[m.id];
        if (item && !item.locked) {
          item.x = m.x;
          item.y = m.y;
        }
      }
      for (const c of carried) {
        const item = draft.items[c.id];
        if (item) {
          item.x += c.dx;
          item.y += c.dy;
        }
      }
    });
    return { moved: args.moves.length, carried: carried.length };
  },
});

registerBoardTool({
  name: 'resize_item',
  description: 'Resize an item (canvas units).',
  parameters: z.object({
    id: z.string(),
    width: z.number().min(8).max(8000),
    height: z.number().min(8).max(8000),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const [id] = requireLive(ctx, [args.id]);
    updateItems([id!], 'Resize', (d) => {
      d.width = args.width;
      d.height = args.height;
    });
    return { id };
  },
});

registerBoardTool({
  name: 'arrange_items',
  description:
    'Tidy items: align to an edge, distribute evenly along an axis, match width or height to the first item, organize into a compact masonry grid, or spread (push overlapping items apart minimally while KEEPING the rough layout — run it after building a board; text boxes auto-grow, so guessed positions often collide).',
  parameters: z.object({
    ids: idsSchema,
    operation: z.enum(['align', 'distribute', 'match', 'organize', 'spread']),
    edge: z
      .enum(['left', 'centerX', 'right', 'top', 'middleY', 'bottom'])
      .optional()
      .describe('align only'),
    axis: z.enum(['x', 'y']).optional().describe('distribute only'),
    dimension: z.enum(['width', 'height']).optional().describe('match only'),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    if (args.operation === 'align') {
      if (!args.edge) throw new Error('align needs `edge`.');
      alignItems(ids, args.edge);
    } else if (args.operation === 'distribute') {
      if (!args.axis) throw new Error('distribute needs `axis`.');
      if (ids.length < 3) throw new Error('distribute needs at least 3 items.');
      distributeItems(ids, args.axis);
    } else if (args.operation === 'match') {
      if (!args.dimension) throw new Error('match needs `dimension`.');
      matchItemSize(ids, args.dimension);
    } else if (args.operation === 'spread') {
      spreadItems(ids);
    } else {
      organizeSelection(ids);
    }
    return { arranged: ids.length, operation: args.operation };
  },
});

registerBoardTool({
  name: 'group_items',
  description: 'Group 2+ items so they move together. Returns the group id.',
  parameters: z.object({ ids: idsSchema.describe('2+ item ids'), name: z.string().optional() }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    const groupId = groupItems(ids, args.name);
    if (!groupId) throw new Error('Grouping needs at least 2 existing items.');
    return { groupId };
  },
});

registerBoardTool({
  name: 'add_case',
  description:
    'Add a case: a question with competing conclusions, each scored by the evidence linked to it (see link_evidence). Returns the case id and its conclusion ids.',
  parameters: z.object({
    title: z.string().optional(),
    question: z.string().optional().describe('What the conclusions answer'),
    conclusions: z.array(z.string()).min(1).describe('Conclusion labels'),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  access: 'write',
  execute: (args) => {
    const conclusions = args.conclusions.map((label) => ({ id: newId(), label }));
    const id = createCaseItem(
      { x: args.x ?? 400, y: args.y ?? 300 },
      {
        ...(args.title ? { title: args.title } : {}),
        ...(args.question ? { question: args.question } : {}),
        conclusions,
      },
    );
    return { id, conclusions };
  },
});

registerBoardTool({
  name: 'link_evidence',
  description:
    'Link items to one conclusion of a case as evidence for ("supports") or against ("contradicts") it; each item counts by its strength (weight, set with set_item_meta). Stance "none" unlinks the items from that conclusion (or from the whole case when no conclusion is given). The conclusion may be given by id or label.',
  parameters: z.object({
    caseId: z.string(),
    ids: idsSchema,
    conclusion: z.string().optional(),
    stance: z.enum(['supports', 'contradicts', 'none']).default('supports'),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    const card = ctx.doc().items[args.caseId];
    if (card?.type !== 'case') throw new Error(`${args.caseId} is not a case`);
    const conclusion = args.conclusion
      ? card.conclusions.find((c) => c.id === args.conclusion || c.label === args.conclusion)
      : undefined;
    if (args.stance === 'none') {
      unlinkEvidence(card.id, ids, conclusion?.id);
      return { unlinked: ids.length };
    }
    if (!conclusion) throw new Error('conclusion (id or label) is required to link');
    linkEvidence(card.id, ids, conclusion.id, args.stance);
    return { linked: ids.length, conclusion: conclusion.label, stance: args.stance };
  },
});

registerBoardTool({
  name: 'set_item_meta',
  description:
    'Update item metadata: display name, note, tags (replaces the tag list), evidence status (confirmed/unverified/debunked, "none" clears), evidence strength (weight 1–5, 0 clears), source (capture provenance: url/title/capturedAt/quote/siteName/author; null clears), linkUrl (a URL attached to any item; "" clears), opacity, rotation, locked, hidden (off-canvas but kept).',
  parameters: z.object({
    ids: idsSchema,
    name: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(['confirmed', 'unverified', 'debunked', 'none']).optional(),
    weight: z.number().int().min(0).max(5).optional(),
    description: z
      .string()
      .optional()
      .describe('Image description (search metadata + the caption overlay text); images only'),
    source: z
      .object({
        url: z.string(),
        title: z.string().optional(),
        capturedAt: z.string().optional(),
        quote: z.string().optional(),
        siteName: z.string().optional(),
        author: z.string().optional(),
      })
      .nullable()
      .optional(),
    linkUrl: z.string().optional(),
    opacity: z.number().min(0).max(1).optional(),
    rotation: z.number().min(-360).max(360).optional(),
    locked: z.boolean().optional(),
    hidden: z.boolean().optional(),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    updateItems(ids, 'Edit item', (d) => {
      if (args.name !== undefined) d.name = args.name;
      if (args.linkUrl !== undefined) {
        if (args.linkUrl) d.linkUrl = args.linkUrl;
        else delete d.linkUrl;
      }
      if (args.hidden !== undefined) {
        if (args.hidden) d.hidden = true;
        else delete d.hidden;
      }
      if (args.notes !== undefined) {
        if (args.notes) d.notes = args.notes;
        else delete d.notes;
      }
      if (args.tags !== undefined) {
        if (args.tags.length) d.tags = args.tags;
        else delete d.tags;
      }
      if (args.status !== undefined) {
        if (args.status === 'none') delete d.status;
        else d.status = args.status;
      }
      if (args.weight !== undefined) {
        if (args.weight === 0) delete d.weight;
        else d.weight = args.weight;
      }
      if (args.description !== undefined && d.type === 'image') {
        d.description = args.description || null;
      }
      if (args.source !== undefined) {
        if (args.source === null) delete d.source;
        else d.source = args.source;
      }
      if (args.opacity !== undefined) d.opacity = args.opacity;
      if (args.rotation !== undefined) d.rotation = args.rotation;
      if (args.locked !== undefined) d.locked = args.locked;
    });
    return { updated: ids.length };
  },
});

registerBoardTool({
  name: 'set_z_order',
  description: 'Bring items forward/to front or send backward/to back.',
  parameters: z.object({
    ids: idsSchema,
    position: z.enum(['front', 'forward', 'backward', 'back']),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    reorderItems(ids, args.position);
    return { reordered: ids.length };
  },
});

registerBoardTool({
  name: 'delete_items',
  description:
    'Delete items from the board. Destructive: requires confirm=true. The user can undo.',
  parameters: z.object({
    ids: idsSchema,
    confirm: z.literal(true).describe('Must be true — acknowledges this deletes the items'),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    removeItems(ids, 'Delete items');
    return { deleted: ids.length };
  },
});

registerBoardTool({
  name: 'embed_webpage',
  description:
    'Put a live webpage on the board as an embed card (renders the page, with a server-side screenshot preview). Use for the KEY sources of a research board — one or two per board; claim/quote cards connect to it with rel "cites". Pages that refuse framing (X-Frame-Options/CSP — most news and government sites) automatically become a LINK BUTTON instead; the result says which happened.',
  parameters: z.object({
    url: z.string().min(8).describe('The http(s) page URL to embed'),
    ...positionSchema,
  }),
  access: 'external',
  execute: async (args, ctx) => {
    const at = placeAt(ctx, args.x, args.y);
    // Frame-blocking headers render as a BLANK iframe client-side — probe
    // them through the server before committing to an embed.
    let verdict: { embeddable: boolean; reason?: string | null; title?: string | null } = {
      embeddable: true,
    };
    try {
      const { hasSyncServer, apiFetch } = await import('../sync/apiBase');
      if (hasSyncServer()) {
        const res = await apiFetch('/api/embedcheck', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ url: args.url }),
        });
        if (res.ok) {
          verdict = (await res.json()) as typeof verdict;
        }
      }
    } catch {
      /* probe unavailable → embed optimistically, as before */
    }
    if (!verdict.embeddable) {
      const { createLinkItem } = await import('../import/createItems');
      const id = createLinkItem(at);
      const label =
        verdict.title?.trim() ||
        (() => {
          try {
            const u = new URL(args.url);
            return u.hostname.replace(/^www\./, '');
          } catch {
            return args.url;
          }
        })();
      updateItems([id], 'Set link', (d) => {
        if (d.type !== 'link') return;
        d.label = label;
        d.url = args.url;
      });
      return {
        id,
        kind: 'link',
        note: `Page refuses embedding (${verdict.reason ?? 'framing blocked'}) — added a link button instead.`,
      };
    }
    const { createIframeItem } = await import('../import/createItems');
    const id = createIframeItem(at, args.url);
    return { id, kind: 'embed' };
  },
});

registerBoardTool({
  name: 'read_webpage',
  description:
    'Fetch and read a webpage: returns its title, author, site name, published date, lead image URL, and the readable main text. THE research tool — quote text verbatim from the returned `text` (never from memory), then stamp cards with set_item_meta {source: {url, title, author, quote, capturedAt}} and wire them with connect_items. For images/PDFs/media use import_from_url instead.',
  parameters: z.object({
    url: z.string().min(8).describe('The http(s) page URL to read'),
  }),
  access: 'external',
  execute: async (args) => {
    const { hasSyncServer, apiFetch } = await import('../sync/apiBase');
    if (!hasSyncServer()) {
      return { error: 'Reading webpages needs the sync server (sign in to use research tools).' };
    }
    const res = await apiFetch('/api/readpage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ url: args.url }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string; text?: string } | null;
    if (!res.ok || !json) {
      return { error: json?.error ?? `Could not read that page (${res.status}).` };
    }
    return json;
  },
});

registerBoardTool({
  name: 'create_page',
  description:
    'Add a new PAGE (a separate sheet inside this board, like Figma pages) and switch to it. New items then land on it. Use for multi-page boards — e.g. one research subtopic per page when the user asks for that.',
  parameters: z.object({ name: z.string().min(1).max(60) }),
  access: 'write',
  execute: (args) => {
    const id = addPage(args.name);
    return { id, active: true };
  },
});

registerBoardTool({
  name: 'switch_page',
  description: 'Switch the canvas to another page (ids come from get_board_summary).',
  parameters: z.object({ page: z.string().describe('Page id') }),
  access: 'write',
  execute: (args, ctx) => {
    if (!ctx.doc().pages.some((p) => p.id === args.page)) {
      throw new Error('No such page — get_board_summary lists page ids.');
    }
    switchPage(args.page);
    return { active: args.page };
  },
});

registerBoardTool({
  name: 'move_to_page',
  description:
    'Move items to another page. Connections whose two ends would land on different pages are removed (connections are page-internal).',
  parameters: z.object({
    ids: idsSchema,
    page: z.string().describe('Target page id (from get_board_summary)'),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const doc = ctx.doc();
    if (!doc.pages.some((p) => p.id === args.page)) {
      throw new Error('No such page — get_board_summary lists page ids.');
    }
    const ids = requireLive(ctx, args.ids);
    const first = doc.pages[0]?.id;
    runCommand('Move to page', (draft) => {
      for (const id of ids) {
        const item = draft.items[id];
        if (!item) continue;
        if (args.page === first) delete item.pageId;
        else item.pageId = args.page;
      }
      // Prune connections split across pages by this move.
      const pageOf = (id: string) => draft.items[id]?.pageId ?? first;
      for (const [cid, c] of Object.entries(draft.connections)) {
        if (
          c.from.kind === 'item' &&
          c.to.kind === 'item' &&
          pageOf(c.from.id) !== pageOf(c.to.id)
        ) {
          delete draft.connections[cid];
        }
      }
    });
    // What left this page can't stay selected here — its box and controls would linger.
    const moved = new Set(ids);
    const session = useSessionStore.getState();
    session.setSelection(session.selection.filter((id) => !moved.has(id)));
    return { moved: ids.length, page: args.page };
  },
});

registerBoardTool({
  name: 'add_storyboard',
  description:
    'Create a storyboard card: a grid of aspect-locked shot panels (label, scene slug, action, optional duration). Attach frame images afterwards by creating them and calling frame_in_storyboard.',
  parameters: z.object({
    title: z.string().default('Storyboard'),
    aspect: z.enum(['16:9', '9:16', '4:3', '2.39:1']).default('16:9'),
    columns: z.number().int().min(1).max(8).default(3),
    x: z.number(),
    y: z.number(),
    panels: z
      .array(
        z.object({
          label: z.string().min(1).max(60),
          scene: z.string().max(120).default(''),
          action: z.string().max(400).default(''),
          move: z.string().max(60).default(''),
          lens: z.string().max(30).default(''),
          duration: z.number().min(0).nullable().default(null),
        }),
      )
      .min(1)
      .max(40),
  }),
  access: 'write',
  execute: async (args) => {
    const { createStoryboardItem } = await import('../import/createItems');
    const { newId } = await import('@boardcache/schema');
    const id = createStoryboardItem(
      { x: args.x, y: args.y },
      {
        title: args.title,
        aspect: args.aspect,
        columns: args.columns,
        panels: args.panels.map((p) => ({
          id: newId(),
          label: p.label,
          scene: p.scene,
          action: p.action,
          move: p.move,
          lens: p.lens,
          duration: p.duration,
          itemIds: [],
          freeArrange: false,
        })),
      },
    );
    return { id };
  },
});

registerBoardTool({
  name: 'frame_in_storyboard',
  description:
    'Put an existing item (usually an image) into a storyboard panel as its frame. The item is fitted into the aspect box; a previous frame is set free below the card.',
  parameters: z.object({
    storyboardId: z.string(),
    panelId: z.string().describe('From get_items on the storyboard.'),
    itemId: z.string(),
  }),
  access: 'write',
  execute: async (args, ctx) => {
    const [sbId, itemId] = requireLive(ctx, [args.storyboardId, args.itemId]);
    const sb = ctx.doc().items[sbId!];
    if (sb?.type !== 'storyboard') throw new Error('storyboardId is not a storyboard.');
    if (!sb.panels.some((p) => p.id === args.panelId)) {
      throw new Error('No such panel on that storyboard.');
    }
    const { attachItemsToPanel } = await import('../structure/storyboardAttach');
    attachItemsToPanel([itemId!], { itemId: sbId!, panelId: args.panelId });
    return { ok: true };
  },
});

registerBoardTool({
  name: 'storyboard_from_markers',
  description:
    "Turn a video item's time markers into a storyboard: one panel per marker, framed with the frame captured at that time. Durations come from marker gaps. Needs a file-backed video with markers.",
  parameters: z.object({ videoId: z.string() }),
  access: 'write',
  execute: async (args, ctx) => {
    const [videoId] = requireLive(ctx, [args.videoId]);
    const { storyboardFromMarkers } = await import('../structure/storyboardFromMarkers');
    const id = await storyboardFromMarkers(videoId!);
    return { id };
  },
});

registerBoardTool({
  name: 'set_media_markers',
  description:
    'Replace the time markers (chapters) on an audio or video item. Times in seconds; markers are sorted. Use after reading a transcript to chapter an episode.',
  parameters: z.object({
    id: z.string(),
    markers: z
      .array(
        z.object({
          time: z.number().min(0).describe('Seconds from the start.'),
          label: z.string().min(1).max(120),
        }),
      )
      .max(100),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const [id] = requireLive(ctx, [args.id]);
    const item = ctx.doc().items[id!];
    if (!item || (item.type !== 'audio' && item.type !== 'video')) {
      throw new Error('set_media_markers only works on audio and video items.');
    }
    const markers = [...args.markers].sort((a, b) => a.time - b.time);
    updateItems([id!], 'Set chapters', (d) => {
      if (d.type === 'audio' || d.type === 'video') d.markers = markers;
    });
    return { id, count: markers.length };
  },
});

registerBoardTool({
  name: 'connect_items',
  description:
    'Draw a typed connection line between two items. The rel says what the link MEANS (research vocabulary): supports, contradicts, causes, cites (a claim cites its source), depends, partof, follows (chronology), inspires, duplicates, or plain relates. Optional short label shown at the midpoint. Use after creating claim/quote/source cards to wire the evidence graph.',
  parameters: z.object({
    from: z.string().describe('Item id the line starts at'),
    to: z.string().describe('Item id the line points to'),
    rel: connectionRelSchema.default('relates'),
    label: z.string().max(80).optional().describe('Short midpoint label, e.g. "answers?"'),
  }),
  access: 'write',
  execute: (args, ctx) => {
    requireLive(ctx, [args.from, args.to]);
    const doc = ctx.doc();
    const first = doc.pages[0]?.id ?? null;
    const pageOf = (id: string) => doc.items[id]?.pageId ?? first;
    if (pageOf(args.from) !== pageOf(args.to)) {
      return { error: 'Both items must be on the same page to connect them.' };
    }
    const id = addConnection(
      { kind: 'item', id: args.from },
      { kind: 'item', id: args.to },
      args.rel,
    );
    if (!id) return { error: 'Could not connect (same item, or already connected).' };
    if (args.label) setConnectionLabel(id, args.label);
    return { id, rel: args.rel };
  },
});

registerBoardTool({
  name: 'import_from_url',
  description:
    'Import media from a URL onto the board: images, video, audio, PDF, fonts, text/Markdown, .boardcache boards, or YouTube/Vimeo links (embedded as players). Downloads may take a moment. When importing an image from a source page, pass `description` (what the image shows / the source caption) and `source` — they land in the item metadata and power captions and the bibliography.',
  parameters: z.object({
    url: z.string().min(4).describe('The http(s) URL to import'),
    description: z
      .string()
      .max(500)
      .optional()
      .describe('Image description / caption from the source'),
    source: z
      .object({
        url: z.string(),
        title: z.string().optional(),
        capturedAt: z.string().optional(),
        siteName: z.string().optional(),
        author: z.string().optional(),
      })
      .optional()
      .describe('Provenance of the page this media came from'),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  access: 'external',
  execute: async (args) => {
    const { importFromUrl } = await import('../import/importFromUrl');
    const point =
      args.x !== undefined && args.y !== undefined ? { x: args.x, y: args.y } : undefined;
    const result = await importFromUrl(args.url, point);
    if (args.description || args.source) {
      updateItems(result.ids, 'Import metadata', (d) => {
        if (args.description && d.type === 'image' && !d.description) {
          d.description = args.description;
        }
        if (args.source && !d.source) d.source = args.source;
      });
    }
    return { kind: result.kind, ids: result.ids };
  },
});

registerBoardTool({
  name: 'select_items',
  description: 'Select items on the canvas (highlights them for the user).',
  parameters: z.object({ ids: z.array(z.string()) }),
  access: 'write',
  execute: (args, ctx) => {
    const doc = ctx.doc();
    const live = args.ids.filter((id) => doc.items[id]);
    useSessionStore.getState().setSelection(live);
    return { selected: live.length };
  },
});

registerBoardTool({
  name: 'focus_viewport',
  description: 'Pan/zoom the view to frame the given items (or the whole board).',
  parameters: z.object({ ids: z.array(z.string()).optional() }),
  access: 'write',
  execute: (args, ctx) => {
    const doc = ctx.doc();
    const items = (args.ids?.length ? args.ids : Object.keys(doc.items))
      .map((id) => doc.items[id])
      .filter((i): i is Item => !!i);
    if (!items.length) throw new Error('Nothing to focus on.');
    revealItemPage(items[0]!.id);
    const minX = Math.min(...items.map((i) => i.x));
    const minY = Math.min(...items.map((i) => i.y));
    const maxX = Math.max(...items.map((i) => i.x + i.width));
    const maxY = Math.max(...items.map((i) => i.y + i.height));
    fitViewportTo(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      getCanvasContainer(),
    );
    return { focused: items.length };
  },
});
