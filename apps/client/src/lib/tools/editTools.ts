import { z } from 'zod';
import type { BackgroundImage, BoardPage, BoardSettings } from '@boardcache/schema';
import { connectionRelSchema } from '@boardcache/schema';
import {
  addComment,
  duplicateItems,
  moveItemsBy,
  removeComment,
  removeConnection,
  renameBoard,
  renameGroup,
  runCommand,
  setConnectionLabel,
  setConnectionRel,
  swapConnection,
  ungroupItems,
  updateBoardSettings,
  updateGroupBackground,
  updateItems,
} from '../../state/commands';
import { useHistoryStore } from '../../state/history';
import { useSessionStore } from '../../state/sessionStore';
import { deletePage, duplicatePage, renamePage } from '../board/pages';
import { withCarried } from '../canvas/carried';
import {
  addToPresentation,
  removeFromPresentation,
  setPresentationSteps,
  setStepView,
} from '../canvas/presentation';
import { registerBoardTool } from './registry';
import { idsSchema, requireLive, requireType } from './shared';

/**
 * Core tools for everything a person edits around the items: image
 * adjustments, duplicates and nudges, groups, connections, comments, pages,
 * board appearance, the presentation sequence, and undo/redo.
 */

const colorArg = z.string().describe('#rrggbb');

// --- images -------------------------------------------------------------------

registerBoardTool({
  name: 'set_image_options',
  description:
    'Adjust images non-destructively: flip, crop (fractions 0–1 of the original; null clears), filters (brightness/contrast/saturation around 1, grayscale 0–1, invert; null clears), caption overlay (shows the description; corner, inside/outside, opacity), pano (force the 360° viewer on/off; null = auto).',
  parameters: z.object({
    ids: idsSchema,
    flipH: z.boolean().optional(),
    flipV: z.boolean().optional(),
    crop: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1),
      })
      .nullable()
      .optional(),
    filters: z
      .object({
        brightness: z.number().min(0).max(3).optional(),
        contrast: z.number().min(0).max(3).optional(),
        saturation: z.number().min(0).max(3).optional(),
        grayscale: z.number().min(0).max(1).optional(),
        invert: z.boolean().optional(),
      })
      .nullable()
      .optional(),
    caption: z.boolean().optional(),
    captionCorner: z.enum(['tl', 'tr', 'bl', 'br']).optional(),
    captionPlacement: z.enum(['inside', 'outside']).optional(),
    captionOpacity: z.number().min(0).max(1).optional(),
    pano: z.boolean().nullable().optional(),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    const doc = ctx.doc();
    const images = ids.filter((id) => doc.items[id]!.type === 'image');
    if (!images.length) throw new Error('None of those items is an image.');
    updateItems(images, 'Adjust image', (d) => {
      if (d.type !== 'image') return;
      if (args.flipH !== undefined) d.flipH = args.flipH;
      if (args.flipV !== undefined) d.flipV = args.flipV;
      if (args.crop !== undefined) d.crop = args.crop;
      if (args.filters !== undefined) {
        if (args.filters === null) d.filters = null;
        else {
          const f = args.filters;
          const prev = d.filters ?? {
            brightness: 1,
            contrast: 1,
            saturation: 1,
            grayscale: 0,
            invert: false,
          };
          d.filters = {
            brightness: f.brightness ?? prev.brightness,
            contrast: f.contrast ?? prev.contrast,
            saturation: f.saturation ?? prev.saturation,
            grayscale: f.grayscale ?? prev.grayscale,
            invert: f.invert ?? prev.invert,
          };
        }
      }
      if (args.caption !== undefined) d.caption = args.caption;
      if (args.captionCorner) d.captionCorner = args.captionCorner;
      if (args.captionPlacement) d.captionPlacement = args.captionPlacement;
      if (args.captionOpacity !== undefined) d.captionOpacity = args.captionOpacity;
      if (args.pano !== undefined) {
        if (args.pano === null) delete d.pano;
        else d.pano = args.pano;
      }
    });
    return { adjusted: images.length, skipped: ids.length - images.length };
  },
});

// --- duplicate / nudge / groups -----------------------------------------------------

registerBoardTool({
  name: 'duplicate_items',
  description:
    'Duplicate items (connections between duplicated items are copied too). Returns the new ids, in the order given.',
  parameters: z.object({
    ids: idsSchema,
    offset: z.number().min(0).max(2000).default(24).describe('Offset of the copies, canvas units'),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    const created = duplicateItems(ids, 'Duplicate', args.offset);
    return { ids: created };
  },
});

registerBoardTool({
  name: 'nudge_items',
  description:
    'Move items by a relative offset (canvas units). Locked items stay; a container carries the items shelved on it.',
  parameters: z.object({ ids: idsSchema, dx: z.number(), dy: z.number() }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = withCarried(ctx.doc(), requireLive(ctx, args.ids));
    moveItemsBy(ids, args.dx, args.dy);
    return { moved: ids.length };
  },
});

registerBoardTool({
  name: 'ungroup_items',
  description:
    'Dissolve the group(s) these items belong to, one level: members move up to the parent group or to the board.',
  parameters: z.object({ ids: idsSchema.describe('Member item ids (one per group is enough)') }),
  access: 'write',
  execute: (args, ctx) => {
    const ids = requireLive(ctx, args.ids);
    ungroupItems(ids);
    return { ungrouped: ids.length };
  },
});

registerBoardTool({
  name: 'edit_group',
  description:
    'Rename a group and/or set its container background (color + opacity; null clears). Group ids come from get_board_summary or group_items.',
  parameters: z.object({
    groupId: z.string(),
    name: z.string().max(120).optional(),
    background: colorArg.nullable().optional(),
    backgroundOpacity: z.number().min(0).max(1).optional(),
  }),
  access: 'write',
  execute: (args, ctx) => {
    if (!ctx.doc().groups[args.groupId]) throw new Error(`No group ${args.groupId}.`);
    if (args.name !== undefined) renameGroup(args.groupId, args.name);
    if (args.background !== undefined || args.backgroundOpacity !== undefined) {
      updateGroupBackground(args.groupId, {
        ...(args.background !== undefined ? { background: args.background } : {}),
        ...(args.backgroundOpacity !== undefined
          ? { backgroundOpacity: args.backgroundOpacity }
          : {}),
      });
    }
    return { groupId: args.groupId };
  },
});

// --- connections -----------------------------------------------------------------

registerBoardTool({
  name: 'edit_connection',
  description:
    'Change a connection (ids from get_board_summary): its rel, its midpoint label ("" clears), or swap its direction.',
  parameters: z.object({
    id: z.string(),
    rel: connectionRelSchema.optional(),
    label: z.string().max(80).optional(),
    swap: z.boolean().optional(),
  }),
  access: 'write',
  execute: (args, ctx) => {
    if (!ctx.doc().connections[args.id]) throw new Error(`No connection ${args.id}.`);
    if (args.rel) setConnectionRel(args.id, args.rel);
    if (args.label !== undefined) setConnectionLabel(args.id, args.label);
    if (args.swap) swapConnection(args.id);
    return { id: args.id };
  },
});

registerBoardTool({
  name: 'remove_connection',
  description: 'Remove a connection line (ids from get_board_summary).',
  parameters: z.object({ ids: z.array(z.string()).min(1).describe('Connection ids') }),
  access: 'write',
  execute: (args, ctx) => {
    const doc = ctx.doc();
    const live = args.ids.filter((id) => doc.connections[id]);
    for (const id of live) removeConnection(id);
    return { removed: live.length };
  },
});

// --- comments --------------------------------------------------------------------

registerBoardTool({
  name: 'add_comment',
  description:
    'Attach a comment to an item (shown in its comment thread, authored as the current user, or as "Agent" when unnamed).',
  parameters: z.object({ itemId: z.string(), text: z.string().min(1).max(4000) }),
  access: 'write',
  execute: (args, ctx) => {
    requireLive(ctx, [args.itemId]);
    const id = addComment(args.itemId, args.text);
    if (!id) throw new Error('Could not add the comment.');
    return { id };
  },
});

registerBoardTool({
  name: 'remove_comment',
  description: 'Remove a comment (ids from get_items).',
  parameters: z.object({ id: z.string() }),
  access: 'write',
  execute: (args, ctx) => {
    if (!ctx.doc().comments[args.id]) throw new Error(`No comment ${args.id}.`);
    removeComment(args.id);
    return { removed: 1 };
  },
});

// --- pages -----------------------------------------------------------------------

function requirePage(ctx: { doc: () => { pages: BoardPage[] } }, id: string): BoardPage {
  const page = ctx.doc().pages.find((p) => p.id === id);
  if (!page) throw new Error('No such page — get_board_summary lists page ids.');
  return page;
}

registerBoardTool({
  name: 'rename_page',
  description: 'Rename a page.',
  parameters: z.object({ page: z.string(), name: z.string().min(1).max(60) }),
  access: 'write',
  execute: (args, ctx) => {
    requirePage(ctx, args.page);
    renamePage(args.page, args.name);
    return { page: args.page, name: args.name };
  },
});

registerBoardTool({
  name: 'duplicate_page',
  description: 'Duplicate a page with everything on it; returns the new page id.',
  parameters: z.object({ page: z.string() }),
  access: 'write',
  execute: (args, ctx) => {
    requirePage(ctx, args.page);
    const id = duplicatePage(args.page);
    if (!id) throw new Error('Could not duplicate that page.');
    return { page: id };
  },
});

registerBoardTool({
  name: 'delete_page',
  description:
    'Delete a page. mode "move" keeps its items (they move to the first page); mode "delete" removes them too. Destructive: requires confirm=true.',
  parameters: z.object({
    page: z.string(),
    mode: z.enum(['move', 'delete']).default('move'),
    confirm: z.literal(true),
  }),
  access: 'write',
  execute: (args, ctx) => {
    requirePage(ctx, args.page);
    if (ctx.doc().pages.length < 2) throw new Error('A board keeps at least one page.');
    deletePage(args.page, args.mode);
    return { deleted: args.page, mode: args.mode };
  },
});

// --- board appearance / name --------------------------------------------------------

const gridTypeArg = z.enum(['square', 'dots', 'diagonal', 'isometric', 'checker']);

registerBoardTool({
  name: 'set_board_appearance',
  description:
    'Board settings: background color ("default" follows the theme), wallpaper from an image item on the board (null clears), grid visibility/opacity/type, theme id, cover item for the library thumbnail (null = whole board), template flag. With `page`, the same fields become that page\'s overrides (reset=true clears them so the page inherits again).',
  parameters: z.object({
    page: z.string().optional().describe('Page id: set page overrides instead of board settings'),
    reset: z.boolean().optional().describe('Pages only: clear every override'),
    background: z.string().optional().describe('CSS color or "default"'),
    backgroundImage: z
      .object({
        imageId: z.string().describe('An image item on this board'),
        mode: z.enum(['cover', 'contain', 'tile', 'center']).default('cover'),
        opacity: z.number().min(0).max(1).default(1),
      })
      .nullable()
      .optional(),
    gridVisible: z.boolean().optional(),
    gridOpacity: z.number().min(0).max(1).optional(),
    gridType: gridTypeArg.optional(),
    themeId: z.string().nullable().optional().describe('null = the app theme'),
    coverItemId: z.string().nullable().optional(),
    isTemplate: z.boolean().optional(),
  }),
  access: 'write',
  execute: (args, ctx) => {
    let wallpaper: BackgroundImage | null | undefined;
    if (args.backgroundImage === null) wallpaper = null;
    else if (args.backgroundImage) {
      const image = requireType(ctx, args.backgroundImage.imageId, 'image');
      wallpaper = {
        assetId: image.assetId,
        mode: args.backgroundImage.mode,
        opacity: args.backgroundImage.opacity,
      };
    }
    if (args.coverItemId) requireLive(ctx, [args.coverItemId]);
    if (args.page) {
      requirePage(ctx, args.page);
      runCommand('Page appearance', (draft) => {
        const page = draft.pages.find((p) => p.id === args.page);
        if (!page) return;
        if (args.reset) {
          delete page.background;
          delete page.backgroundImage;
          delete page.gridVisible;
          delete page.gridOpacity;
          delete page.gridType;
          delete page.themeId;
        }
        if (args.background !== undefined) page.background = args.background;
        if (wallpaper !== undefined) page.backgroundImage = wallpaper;
        if (args.gridVisible !== undefined) page.gridVisible = args.gridVisible;
        if (args.gridOpacity !== undefined) page.gridOpacity = args.gridOpacity;
        if (args.gridType) page.gridType = args.gridType;
        if (args.themeId === null) delete page.themeId;
        else if (args.themeId) page.themeId = args.themeId;
      });
      return { page: args.page };
    }
    const patch: Partial<BoardSettings> = {};
    if (args.background !== undefined) patch.background = args.background;
    if (wallpaper !== undefined) patch.backgroundImage = wallpaper;
    if (args.gridVisible !== undefined) patch.gridVisible = args.gridVisible;
    if (args.gridOpacity !== undefined) patch.gridOpacity = args.gridOpacity;
    if (args.gridType) patch.gridType = args.gridType;
    if (args.coverItemId !== undefined) patch.coverItemId = args.coverItemId;
    if (args.isTemplate !== undefined) patch.isTemplate = args.isTemplate;
    if (Object.keys(patch).length) updateBoardSettings(patch);
    if (args.themeId !== undefined) {
      runCommand('Board theme', (draft) => {
        if (args.themeId === null) delete draft.settings.themeId;
        else draft.settings.themeId = args.themeId;
      });
    }
    return { updated: Object.keys(patch).length + (args.themeId !== undefined ? 1 : 0) };
  },
});

registerBoardTool({
  name: 'rename_board',
  description: 'Rename the open board.',
  parameters: z.object({ name: z.string().min(1).max(200) }),
  access: 'write',
  execute: (args) => {
    renameBoard(args.name);
    return { name: args.name };
  },
});

// --- presentation -----------------------------------------------------------------

const viewArg = z
  .object({
    x: z.number().describe('World x at the centre of the screen'),
    y: z.number(),
    scale: z.number().positive(),
  })
  .describe('A custom camera for the step; omit to auto-frame the item or group');

registerBoardTool({
  name: 'set_presentation',
  description:
    'Replace the Presentation Mode sequence: an ordered list of steps, each an item id or a group id (the camera frames it), with an optional custom camera. Steps that stay keep their camera unless a new one is given.',
  parameters: z.object({
    steps: z.array(z.object({ id: z.string(), view: viewArg.nullable().optional() })).max(200),
  }),
  access: 'write',
  execute: (args, ctx) => {
    const doc = ctx.doc();
    const unknown = args.steps.filter((s) => !(s.id in doc.items || s.id in doc.groups));
    if (unknown.length) {
      throw new Error(`Not an item or group: ${unknown.map((s) => s.id).join(', ')}.`);
    }
    setPresentationSteps(args.steps.map((s) => s.id));
    for (const s of args.steps) if (s.view !== undefined) setStepView(s.id, s.view);
    return { steps: args.steps.length };
  },
});

registerBoardTool({
  name: 'add_to_presentation',
  description:
    'Append items or groups as presentation steps (ids already in the sequence are skipped).',
  parameters: z.object({ ids: z.array(z.string()).min(1) }),
  access: 'write',
  execute: (args, ctx) => {
    addToPresentation(args.ids);
    return { steps: ctx.doc().presentation.steps.length };
  },
});

registerBoardTool({
  name: 'remove_from_presentation',
  description: 'Remove items or groups from the presentation sequence.',
  parameters: z.object({ ids: z.array(z.string()).min(1) }),
  access: 'write',
  execute: (args, ctx) => {
    removeFromPresentation(args.ids);
    return { steps: ctx.doc().presentation.steps.length };
  },
});

// --- history -----------------------------------------------------------------------

registerBoardTool({
  name: 'undo',
  description:
    'Undo the last change(s) on this board — each earlier tool call is one step, as is each edit the user made. Use redo to reverse it.',
  parameters: z.object({ steps: z.number().int().min(1).max(20).default(1) }),
  access: 'write',
  batch: false,
  execute: (args) => {
    const history = useHistoryStore.getState();
    let undone = 0;
    for (let i = 0; i < args.steps; i++) {
      if (useHistoryStore.getState().index < 0) break;
      history.undo();
      undone++;
    }
    useSessionStore.getState().setSelection([]);
    return { undone };
  },
});

registerBoardTool({
  name: 'redo',
  description: 'Redo change(s) reverted by undo.',
  parameters: z.object({ steps: z.number().int().min(1).max(20).default(1) }),
  access: 'write',
  batch: false,
  execute: (args) => {
    const history = useHistoryStore.getState();
    let redone = 0;
    for (let i = 0; i < args.steps; i++) {
      const { entries, index } = useHistoryStore.getState();
      if (index + 1 >= entries.length) break;
      history.redo();
      redone++;
    }
    return { redone };
  },
});
