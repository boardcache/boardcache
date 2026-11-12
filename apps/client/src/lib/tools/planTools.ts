import { z } from 'zod';
import type { ZodType } from 'zod';
import { activeBoardTools, registerBoardTool, runBoardTool, runToolTurn } from './registry';
import { useHistoryStore } from '../../state/history';

/**
 * apply_plan: a list of board tool calls run as one. Every step is checked
 * before the first runs (the tool exists and takes the arguments), the
 * steps run in order, a later step can use what an earlier one returned
 * (`"$card.id"` for the `id` of the step named `card`), the whole plan is
 * one undo entry, and a step that fails takes the steps before it back
 * with it. `dryRun` stops after the checks. Fewer round trips for an
 * agent, and no half-built boards.
 */

const REF = /^\$([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_.[\]-]+))?$/;
const NOT_IN_PLANS = new Set(['apply_plan', 'undo', 'redo']);
const MAX_STEPS = 60;

const stepSchema = z.object({
  tool: z.string().describe('A board tool name'),
  args: z.record(z.string(), z.unknown()).optional(),
  as: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(40)
    .optional()
    .describe('A name for this step\'s result, for later steps to refer to as "$name.field"'),
});

function pathGet(v: unknown, path: string): unknown {
  let cur = v;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (!part) continue;
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Replace "$name.path" strings anywhere in the arguments with the named step's result. */
function resolve(v: unknown, results: Map<string, unknown>, stepNo: number): unknown {
  if (typeof v === 'string') {
    const m = REF.exec(v);
    if (!m) return v;
    const alias = m[1]!;
    const path = m[2];
    if (!results.has(alias))
      throw new Error(
        `Step ${stepNo} refers to "$${alias}", but no earlier step is named "${alias}".`,
      );
    const got = path ? pathGet(results.get(alias), path) : results.get(alias);
    if (got === undefined)
      throw new Error(`Step ${stepNo}: "${v}" is not in what step "${alias}" returned.`);
    return got;
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, results, stepNo));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = resolve(x, results, stepNo);
    return out;
  }
  return v;
}

registerBoardTool({
  name: 'apply_plan',
  description:
    'Run a list of board tool calls as one: every step is checked first (the tool exists, the arguments fit), then they run in order as a single undo step, and if one fails the steps before it are taken back, so the board is never half-built. A later step can use what an earlier one returned: name a step with `as` and write "$name.id" (or any field, "$name.items[0].id") in a later step\'s arguments. `dryRun` checks without running. Library tools, undo/redo and tools that leave the machine (searches, read_webpage, import_from_url) are not allowed in a plan; call those directly. Up to 60 steps.',
  access: 'write',
  parameters: z.object({
    steps: z.array(stepSchema).min(1).max(MAX_STEPS),
    dryRun: z.boolean().optional(),
  }),
  execute: async (args) => {
    const tools = new Map(activeBoardTools().map((t) => [t.name, t]));
    // Check every step before any runs. References to earlier results are
    // stand-ins here (a string), so a schema that wants a string passes;
    // the real value is checked again when the step runs.
    const names = new Set<string>();
    const checked = args.steps.map((step, k) => {
      const no = k + 1;
      const tool = tools.get(step.tool);
      if (!tool || NOT_IN_PLANS.has(step.tool))
        throw new Error(`Step ${no}: "${step.tool}" is not a board tool a plan may run.`);
      if (tool.access === 'external')
        throw new Error(
          `Step ${no}: "${step.tool}" leaves the machine; call it directly, not in a plan.`,
        );
      const stub = (v: unknown): unknown => {
        if (typeof v === 'string') {
          const m = REF.exec(v);
          if (!m) return v;
          if (!names.has(m[1]!))
            throw new Error(
              `Step ${no} refers to "$${m[1]}", but no earlier step is named "${m[1]}".`,
            );
          return `ref-${m[1]}`;
        }
        if (Array.isArray(v)) return v.map(stub);
        if (v && typeof v === 'object')
          return Object.fromEntries(Object.entries(v).map(([a, b]) => [a, stub(b)]));
        return v;
      };
      const parsed = (tool.parameters as ZodType).safeParse(stub(step.args ?? {}));
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        throw new Error(`Step ${no} (${step.tool}): invalid arguments — ${issues}`);
      }
      if (step.as) names.add(step.as);
      return { no, tool: step.tool, ...(step.as ? { as: step.as } : {}) };
    });
    if (args.dryRun) return { dryRun: true, steps: checked, ok: true };

    const history = useHistoryStore.getState();
    const start = history.index;
    const results = new Map<string, unknown>();
    const done: { step: number; tool: string; as?: string; result: unknown }[] = [];
    try {
      await runToolTurn('Agent: apply_plan', async () => {
        for (const [k, step] of args.steps.entries()) {
          const no = k + 1;
          const realArgs = resolve(step.args ?? {}, results, no);
          const outcome = await runBoardTool(step.tool, realArgs);
          if (!outcome.ok) throw new Error(`Step ${no} (${step.tool}) failed: ${outcome.error}`);
          if (step.as) results.set(step.as, outcome.result);
          done.push({
            step: no,
            tool: step.tool,
            ...(step.as ? { as: step.as } : {}),
            result: outcome.result,
          });
        }
      });
    } catch (err) {
      // Back to where the plan started: nothing of it stays.
      const h = useHistoryStore.getState();
      let guard = 0;
      while (useHistoryStore.getState().index > start && guard++ < MAX_STEPS * 4) h.undo();
      throw new Error(
        `${err instanceof Error ? err.message : String(err)} The ${done.length} step${done.length === 1 ? '' : 's'} before it ${done.length === 1 ? 'was' : 'were'} taken back; the board is as it was.`,
        { cause: err },
      );
    }
    return { applied: done.length, steps: done };
  },
});
