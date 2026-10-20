import type { PollItem } from '@boardcache/schema';
import { myPollVotes, votePoll } from '../../state/commands';
import { useCanvasReadOnly } from '../../lib/canvas/readOnly';
import { VIEWER } from '../../lib/viewerMode';

/**
 * Poll cards: options with live result bars; clicking a row casts (or
 * retracts) the current user's vote. Votes are document state, so they
 * mirror instantly into team rooms and sync like any other edit.
 */

function pollCounts(item: PollItem): { counts: Map<string, number>; total: number } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const option of item.options) counts.set(option.id, 0);
  for (const vote of Object.values(item.votes)) {
    for (const id of vote.optionIds) {
      if (counts.has(id)) {
        counts.set(id, counts.get(id)! + 1);
        total += 1;
      }
    }
  }
  return { counts, total };
}

/** Voter names for one option (tooltips). */
function votersFor(item: PollItem, optionId: string): string[] {
  return Object.values(item.votes)
    .filter((v) => v.optionIds.includes(optionId))
    .map((v) => v.name);
}

export function PollContent({ item, stage = false }: { item: PollItem; stage?: boolean }) {
  const { counts, total } = pollCounts(item);
  const readOnly = useCanvasReadOnly();
  const mine = VIEWER ? [] : myPollVotes(item);
  const canVote = !item.closed && !readOnly;

  return (
    <div className={`poll-card${stage ? ' poll-stage' : ''}`} data-testid="poll-card">
      <div className="poll-question">
        {item.question}
        {item.closed && <span className="poll-closed-badge">Closed</span>}
      </div>
      <div className="poll-options">
        {item.options.map((option) => {
          const count = counts.get(option.id) ?? 0;
          const pct = total ? Math.round((count / total) * 100) : 0;
          const chosen = mine.includes(option.id);
          const voters = votersFor(item, option.id);
          return (
            <button
              key={option.id}
              type="button"
              className={`poll-option${chosen ? ' chosen' : ''}`}
              disabled={!canVote}
              title={voters.length ? voters.join(', ') : undefined}
              data-testid={`poll-option-${option.id}`}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (canVote) votePoll(item.id, option.id);
              }}
            >
              <span className="poll-bar" style={{ width: `${pct}%` }} />
              <span className="poll-option-label">
                {chosen && <span className="poll-check">✓</span>}
                {option.label}
              </span>
              <span className="poll-option-count" data-testid={`poll-count-${option.id}`}>
                {count > 0 && `${pct}% · `}
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="poll-footer">
        {total} vote{total === 1 ? '' : 's'}
        {item.multiple ? ' · multiple choice' : ''}
        {stage && Object.keys(item.votes).length > 0 && (
          <span className="poll-voters">
            {Object.values(item.votes)
              .map((v) => v.name)
              .join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}
