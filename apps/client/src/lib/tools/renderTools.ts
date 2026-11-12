import { z } from 'zod';
import type { Item } from '@boardcache/schema';
import { registerBoardTool } from './registry';
import { clip, itemLabel, requireLive } from './shared';
import { agentPrivacy } from '../agentPrivacy';
import { getCanvasContainer } from '../canvas/canvasDom';
import { rectsIntersect, visibleCanvasRect } from '../canvas/coords';
import type { Rect } from '../canvas/coords';
import { contentBounds, renderRegion } from '../media/thumbnail';
import { useSessionStore } from '../../state/sessionStore';
import { offCanvas } from '../board/pages';

/**
 * A picture of the board for the agent that is laying it out blind: the
 * same painter the library thumbnails and PNG export use, over the view,
 * a page or some items, with the items inside the picture listed so a spot
 * in it maps back to an id. Gated by Settings → Privacy (board pictures
 * carry everything in view, photos and embeds included, where the text
 * tools carried only words).
 */

const PAD = 40;
const MAX_SIDE = 2048;

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });

const pad = (r: Rect): Rect => ({
  x: r.x - PAD,
  y: r.y - PAD,
  width: r.width + PAD * 2,
  height: r.height + PAD * 2,
});

registerBoardTool({
  name: 'render_board',
  description:
    'A picture of the board as the person sees it, to check layout and looks after building or arranging. `scope` "view" (default) is what is on screen now; "page" is the whole current page (or `pageId`), which on a single-page board is the whole board; "items" is the given `ids` with a margin. Returns a PNG in `image` (base64), at most `maxWidth` pixels wide (default 1280, up to 2048), the `region` it covers in canvas units, and the `items` inside it with their x, y, width and height, so a spot in the picture maps back to an item. Refuses when the person has turned board pictures for agents off (Settings → Privacy).',
  access: 'read',
  parameters: z.object({
    scope: z.enum(['view', 'page', 'items']).optional(),
    ids: z.array(z.string()).optional().describe('Item ids, for scope "items"'),
    pageId: z.string().optional().describe('A page id, for scope "page"'),
    maxWidth: z.number().int().min(320).max(MAX_SIDE).optional(),
  }),
  execute: async (args, ctx) => {
    if (!agentPrivacy().render) {
      throw new Error(
        'Board pictures for agents are off. The person can turn them on under Settings → Privacy.',
      );
    }
    const doc = ctx.doc();
    const first = doc.pages[0]?.id ?? null;
    const scope = args.scope ?? 'view';
    let pageId: string | null = useSessionStore.getState().activePageId ?? first;
    const pageOf = (i: Item) => i.pageId ?? first;
    let region: Rect | null;
    if (scope === 'items') {
      if (!args.ids?.length) throw new Error('scope "items" needs ids.');
      const live = requireLive(ctx, args.ids);
      const items = live.map((id) => doc.items[id]!);
      pageId = pageOf(items[0]!);
      region = contentBounds(doc, items);
      if (region) region = pad(region);
    } else if (scope === 'page') {
      if (args.pageId !== undefined) {
        if (!doc.pages.some((p) => p.id === args.pageId))
          throw new Error('No such page — get_board_summary lists page ids.');
        pageId = args.pageId;
      }
      const onPage = Object.values(doc.items).filter(
        (i) => !i.hidden && !offCanvas(doc, i) && pageOf(i) === pageId,
      );
      region = contentBounds(doc, onPage);
      if (region) region = pad(region);
    } else {
      const el = getCanvasContainer();
      const w = el?.clientWidth || window.innerWidth;
      const h = el?.clientHeight || window.innerHeight;
      region = visibleCanvasRect(doc.viewport, w, h);
    }
    if (!region || region.width <= 0 || region.height <= 0)
      throw new Error('Nothing to render there: the page is empty.');
    const maxW = args.maxWidth ?? 1280;
    const scale = Math.min(maxW / region.width, MAX_SIDE / region.height, 2);
    const outW = Math.max(1, Math.round(region.width * scale));
    const outH = Math.max(1, Math.round(region.height * scale));
    // The agent wants to see it as the person does: the board's own
    // background, else the theme's canvas colour (the thumbnail painter
    // would leave it transparent for the card to colour).
    const custom = doc.settings.background !== 'default' ? doc.settings.background : null;
    const dark = document.documentElement.dataset.theme === 'dark';
    const themeBg =
      getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() ||
      (dark ? '#1d1d20' : '#fafafa');
    const blob = await renderRegion(
      doc,
      region,
      outW,
      outH,
      custom ?? themeBg,
      dark,
      undefined,
      'contain',
      pageId,
    );
    const inside = Object.values(doc.items)
      .filter((i) => !i.hidden && !offCanvas(doc, i) && pageOf(i) === pageId)
      .filter((i) => rectsIntersect(region, { x: i.x, y: i.y, width: i.width, height: i.height }))
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((i) => ({
        id: i.id,
        type: i.type,
        name: clip(itemLabel(i), 60),
        x: Math.round(i.x),
        y: Math.round(i.y),
        width: Math.round(i.width),
        height: Math.round(i.height),
      }));
    return {
      image: { mimeType: 'image/png', base64: await toBase64(blob) },
      width: outW,
      height: outH,
      scale: Number(scale.toFixed(4)),
      region: {
        x: Math.round(region.x),
        y: Math.round(region.y),
        width: Math.round(region.width),
        height: Math.round(region.height),
      },
      page: pageId,
      items: inside,
    };
  },
});
