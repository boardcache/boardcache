import { z } from 'zod';
import type { CanvasDocument, Item } from '@boardcache/schema';
import { openSpotNear } from '../canvas/placeSpot';
import type { ToolContext } from './registry';

/** Helpers shared by the core tool files (coreTools, containerTools, editTools). */

export const idsSchema = z.array(z.string()).min(1).describe('Item ids');

export const positionSchema = {
  x: z.number().optional().describe('Canvas x (center). Omit to place at the current view center.'),
  y: z.number().optional().describe('Canvas y (center). Omit to place at the current view center.'),
};

export function placeAt(ctx: ToolContext, x?: number, y?: number) {
  if (x !== undefined && y !== undefined) return { x, y };
  const c = ctx.viewCenter();
  // No explicit position → nearest open spot so repeated adds don't stack.
  // (Creators that know their real size refine this again; this covers the
  // tools that build items directly, e.g. shapes and text boxes.)
  return openSpotNear({ x: x ?? c.x, y: y ?? c.y });
}

export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

export function liveIds(doc: CanvasDocument, ids: string[]): { live: string[]; missing: string[] } {
  const live: string[] = [];
  const missing: string[] = [];
  for (const id of ids) (doc.items[id] ? live : missing).push(id);
  return { live, missing };
}

export function requireLive(ctx: ToolContext, ids: string[]): string[] {
  const { live, missing } = liveIds(ctx.doc(), ids);
  if (missing.length) {
    throw new Error(
      `No such item(s): ${missing.join(', ')} — use get_board_summary for valid ids.`,
    );
  }
  return live;
}

/** The item, which must be of the given type. */
export function requireType<T extends Item['type']>(
  ctx: ToolContext,
  id: string,
  type: T,
): Extract<Item, { type: T }> {
  const [live] = requireLive(ctx, [id]);
  const item = ctx.doc().items[live!]!;
  if (item.type !== type) throw new Error(`Item ${id} is a ${item.type}, not a ${type}.`);
  return item as Extract<Item, { type: T }>;
}

/** Resolve "id or label" references the way agents give them. */
export function byIdOrLabel<T extends { id: string; label: string }>(
  list: readonly T[],
  ref: string,
  what: string,
): T {
  const hit = list.find((e) => e.id === ref) ?? list.find((e) => e.label === ref);
  if (!hit) {
    throw new Error(
      `No ${what} "${ref}" — have: ${list.map((e) => e.label).join(', ') || 'none'}.`,
    );
  }
  return hit;
}
