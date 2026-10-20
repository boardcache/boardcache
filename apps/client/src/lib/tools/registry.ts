import type { ZodType } from 'zod';
import type { z } from 'zod';
import type { CanvasDocument } from '@boardcache/schema';
import { clientToCanvas } from '../canvas/canvasDom';
import type { Point } from '../canvas/coords';
import { useDocumentStore } from '../../state/documentStore';
import { useHistoryStore } from '../../state/history';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Board Tool Registry — the app's programmatic action surface ("Board API").
 * Deterministic, typed, validated operations on the board, registered by core
 * (coreTools) and by plugins (BoardPlugin.tools, active only while enabled).
 *
 * NOT AI-specific: any consumer (the AI chat agent, automation, tests via
 * __boardcache.runTool) drives the same registry. The registry itself is inert —
 * plain functions with zod-validated inputs and no network behavior.
 */

type ToolAccess = 'read' | 'write' | 'external';

export interface ToolContext {
  doc: () => CanvasDocument;
  selection: () => string[];
  /** Canvas point at the middle of the current view (default placement). */
  viewCenter: () => Point;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface BoardTool<S extends ZodType = any> {
  /** snake_case, unique ('add_markdown_text'). */
  name: string;
  /** Written for the model: what it does, when to use it, what it returns. */
  description: string;
  parameters: S;
  /** read = silent; write = mutates the board (undo-batched per turn);
   *  external = leaves the machine / costs money (confirm policy upstream). */
  access: ToolAccess;
  /** false = never coalesced into a turn's undo step (undo/redo themselves). */
  batch?: boolean;
  execute: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown> | unknown;
}

const core: BoardTool[] = [];

export function registerBoardTool<S extends ZodType>(tool: BoardTool<S>): void {
  if (core.some((t) => t.name === tool.name)) return; // HMR double-run
  core.push(tool as BoardTool);
}

/** Tools contributed by plugins, resolved lazily to avoid import cycles. */
let pluginToolSource: (() => BoardTool[]) | null = null;
export function setPluginToolSource(source: () => BoardTool[]): void {
  pluginToolSource = source;
}

/** Every currently-active tool (core + enabled plugins'), name-deduped. */
export function activeBoardTools(): BoardTool[] {
  const seen = new Set<string>();
  const out: BoardTool[] = [];
  for (const tool of [...core, ...(pluginToolSource?.() ?? [])]) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    out.push(tool);
  }
  return out;
}

/** Tools that act on the library rather than the open board (list, open and
 *  create boards, folders, tags, files), registered by lib/agentBridge. They
 *  sit beside the board tools so the assistant and outside agents share one
 *  surface; the agent endpoint lists them separately because they work
 *  without an open board. */
let libraryToolSource: (() => BoardTool[]) | null = null;
export function setLibraryToolSource(source: () => BoardTool[]): void {
  libraryToolSource = source;
}
export function activeLibraryTools(): BoardTool[] {
  return libraryToolSource?.() ?? [];
}

function toolContext(): ToolContext {
  return {
    doc: () => useDocumentStore.getState().doc,
    selection: () => useSessionStore.getState().selection,
    viewCenter: () => clientToCanvas(window.innerWidth / 2, window.innerHeight / 2),
  };
}

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * Validate and run one tool. Failures — unknown tool, bad args, execution
 * errors — come back as structured errors (for the model to self-correct),
 * never as exceptions or half-applied state.
 */
export async function runBoardTool(name: string, args: unknown): Promise<ToolOutcome> {
  const tool =
    activeBoardTools().find((t) => t.name === name) ??
    activeLibraryTools().find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Unknown tool "${name}".` };
  const parsed = (tool.parameters as ZodType).safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: `Invalid arguments — ${issues}` };
  }
  try {
    const result = await tool.execute(parsed.data, toolContext());
    return { ok: true, result: result ?? { done: true } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run a batch of tool calls as ONE undo step ("AI: …"). Commands inside push
 * their usual history entries; on completion they coalesce into a single
 * entry, so one Ctrl+Z reverses everything an assistant turn did.
 */
export async function runToolTurn<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const startIndex = useHistoryStore.getState().index;
  try {
    return await fn();
  } finally {
    useHistoryStore.getState().coalesceSince(startIndex, label);
  }
}
