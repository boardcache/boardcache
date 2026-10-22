import { z } from 'zod';
import type { Item } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import type { BoardTool } from '../../lib/tools/registry';
import { createPaletteItem, createTextBox } from '../../lib/import/createItems';
import { openSpotNear } from '../../lib/canvas/placeSpot';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { getCanvasContainer } from '../../lib/canvas/canvasDom';
import {
  availablePhotoSources,
  importStockResult,
  loadStockKeys,
  searchStock,
  type StockResult,
} from './stock';

/**
 * Board tools the Stock Media plugin contributes to the assistant. Search
 * fans out across every source the user has available (keyless ones always
 * work; API keys widen the pool) — the assistant gets REAL image URLs
 * instead of hallucinating them.
 */

async function searchAvailablePhotos(query: string, count: number): Promise<StockResult[]> {
  const outcome = await searchStock(query, 'photo', availablePhotoSources(), loadStockKeys());
  if (outcome.results.length === 0 && Object.keys(outcome.errors).length > 0) {
    throw new Error(Object.values(outcome.errors).join(' · '));
  }
  return outcome.results.slice(0, count);
}

const searchStockPhotosTool: BoardTool = {
  name: 'search_stock_photos',
  description:
    'Search stock photos across the Stock Media sources available on this device (Wikimedia Commons always; Openverse when the user ticked it in the Stock Media dialog; Unsplash/Pexels/Pixabay when the user added keys). Returns REAL image URLs to pass to import_from_url. Never invent, guess, or recall image URLs from memory — they will fail; always search with this tool instead.',
  parameters: z.object({
    query: z
      .string()
      .min(2)
      .describe('Concrete visual search terms, e.g. "tokyo neon street night"'),
    count: z.number().int().min(1).max(12).default(6),
  }),
  access: 'external',
  execute: async (args: { query: string; count: number }) => {
    const photos = await searchAvailablePhotos(args.query, args.count);
    return {
      photos: photos.map((p) => ({
        url: p.fullUrl,
        source: p.source,
        creator: p.author,
        license: p.license ?? null,
        page: p.pageUrl,
      })),
    };
  },
};

const createMoodboardTool: BoardTool = {
  name: 'create_moodboard',
  description:
    'Assemble a themed moodboard in one reliable step: a title+brief text block, a color palette, real stock photos (searched via the Stock Media sources — never invented URLs), mood words, and optionally a Google Font specimen, all laid out together. Prefer this over many single-item calls when the user asks to create/build/seed a board or "add some inspiration"; refine afterwards with the smaller tools.',
  parameters: z.object({
    title: z.string().min(1),
    brief: z.string().min(1).describe('2–5 sentences of markdown describing the concept'),
    colors: z.array(z.string()).min(3).max(10).describe('#rrggbb values that express the theme'),
    moodWords: z.array(z.string()).max(10).default([]).describe('3–8 evocative single words'),
    photoQuery: z.string().min(2).describe('Concrete visual search terms for stock photos'),
    photoCount: z.number().int().min(0).max(6).default(4),
    fontFamily: z
      .string()
      .optional()
      .describe('A Google Fonts family that fits the theme, e.g. "Space Grotesk"'),
  }),
  access: 'external',
  execute: async (
    args: {
      title: string;
      brief: string;
      colors: string[];
      moodWords: string[];
      photoQuery: string;
      photoCount: number;
      fontFamily?: string;
    },
    ctx,
  ) => {
    // Reserve one clear block for the whole composition, then lay out from
    // its top-left: text column on the left, photos flowing on the right.
    const center = openSpotNear(ctx.viewCenter(), 1600, 1000);
    const tl = { x: center.x - 800, y: center.y - 500 };

    const briefId = createTextBox(
      { x: tl.x, y: tl.y },
      400,
      `# ${args.title}\n\n${args.brief}`,
      'Moodboard brief',
    );
    const paletteId = createPaletteItem(
      { x: tl.x, y: tl.y + 360 },
      args.colors.map((color) => ({ id: newId(), color })),
      { name: args.title },
    );
    let moodWordsId: string | null = null;
    if (args.moodWords.length) {
      moodWordsId = createTextBox(
        { x: tl.x, y: tl.y + 480 },
        400,
        `### Mood\n\n${args.moodWords.map((w) => `**${w}**`).join(' · ')}`,
        'Mood words',
      );
    }

    const warnings: string[] = [];

    // Photos: search wide across available sources, import until enough
    // land — a dead link, CORS-blocked host or slow download just moves to
    // the next candidate. Collision-aware placement flows them to the
    // right of the text column.
    const photoIds: string[] = [];
    if (args.photoCount > 0) {
      let candidates: StockResult[] = [];
      try {
        candidates = await searchAvailablePhotos(
          args.photoQuery,
          Math.min(12, args.photoCount * 3),
        );
      } catch (err) {
        warnings.push(err instanceof Error ? err.message : 'Photo search failed.');
      }
      const seed = { x: tl.x + 900, y: tl.y + 260 };
      for (const photo of candidates) {
        if (photoIds.length >= args.photoCount) break;
        try {
          photoIds.push(...(await importStockResult(photo, seed)));
        } catch {
          /* dead link / blocked host — try the next candidate */
        }
      }
      if (photoIds.length === 0 && candidates.length > 0) {
        warnings.push('None of the stock photos could be imported.');
      }
    }

    let fontIds: string[] = [];
    if (args.fontFamily) {
      try {
        const { importGoogleFont } = await import('../../lib/integrations/googleFonts');
        fontIds = await importGoogleFont(args.fontFamily, { x: tl.x, y: tl.y + 640 });
      } catch (err) {
        warnings.push(
          err instanceof Error ? err.message : `Importing the font "${args.fontFamily}" failed.`,
        );
      }
    }

    const allIds = [briefId, paletteId, moodWordsId, ...photoIds, ...fontIds].filter(
      (id): id is string => !!id,
    );
    const doc = ctx.doc();
    const items = allIds.map((id) => doc.items[id]).filter((i): i is Item => !!i);
    if (items.length) {
      const minX = Math.min(...items.map((i) => i.x));
      const minY = Math.min(...items.map((i) => i.y));
      const maxX = Math.max(...items.map((i) => i.x + i.width));
      const maxY = Math.max(...items.map((i) => i.y + i.height));
      fitViewportTo(
        { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        getCanvasContainer(),
      );
    }
    return {
      briefId,
      paletteId,
      moodWordsId,
      photoIds,
      fontIds,
      ...(warnings.length ? { warnings } : {}),
    };
  },
};

export const stockBoardTools: BoardTool[] = [searchStockPhotosTool, createMoodboardTool];
