import type { CanvasDocument } from '@boardcache/schema';
import { produce } from 'immer';
import { pruneEmptyGroups } from '../../state/commands';

/**
 * Strip what only makes sense on a live team board before a document
 * becomes a plain local one (Duplicate as local board): polls (their votes
 * come from teammates), task assignees (account identities). Everything else
 * — comments, timers, milestones, links — stays. References to removed
 * items are pruned like a delete would.
 */
export function stripTeamOnly(doc: CanvasDocument): CanvasDocument {
  return produce(doc, (draft) => {
    for (const [id, item] of Object.entries(draft.items)) {
      if (item.type === 'poll') delete draft.items[id];
      else if (item.type === 'project') for (const t of item.tasks) t.assignee = null;
    }
    pruneEmptyGroups(draft);
  });
}
