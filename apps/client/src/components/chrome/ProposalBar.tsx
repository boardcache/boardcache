import {
  canRevertProposal,
  keepProposal,
  revertProposal,
  useProposals,
} from '../../lib/agentProposals';
import { runBoardTool } from '../../lib/tools/registry';
import { useDocumentStore } from '../../state/documentStore';
import { useHistoryStore } from '../../state/history';
import { useSessionStore } from '../../state/sessionStore';

/**
 * The review bar for held agent changes: how many items an agent touched,
 * Show (select and frame them), Keep, Undo all. Sits under the top chrome
 * while a proposal is open on the board in view.
 */
export function ProposalBar() {
  const pending = useProposals((s) => s.pending);
  const docId = useDocumentStore((s) => s.doc.id);
  const onCanvas = useSessionStore((s) => s.view === 'canvas');
  // Undo all depends on the history's tip: subscribing re-renders when it moves.
  useHistoryStore((s) => s.index);
  if (!pending || pending.boardId !== docId || !onCanvas) return null;
  const n = pending.itemIds.size;
  const revertable = canRevertProposal();
  const show = () => {
    const live = [...pending.itemIds].filter((id) => useDocumentStore.getState().doc.items[id]);
    useSessionStore.getState().setSelection(live);
    if (live.length) void runBoardTool('focus_viewport', { ids: live });
  };
  return (
    <div className="proposal-bar" role="status" data-testid="proposal-bar">
      <span className="proposal-text">
        <b>{pending.agent}</b> changed {n === 1 ? '1 item' : `${n} items`}. Held for review: the
        board does not sync until you keep it.
      </span>
      <span className="btns">
        <button type="button" className="btn btn-sm" data-testid="proposal-show" onClick={show}>
          Show
        </button>
        <button
          type="button"
          className="btn btn-sm"
          data-testid="proposal-undo"
          disabled={!revertable}
          title={
            revertable
              ? 'Take back everything the agent did'
              : 'You edited since the agent did; use Undo for single steps'
          }
          onClick={() => revertProposal()}
        >
          Undo all
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          data-testid="proposal-keep"
          onClick={() => keepProposal()}
        >
          Keep
        </button>
      </span>
    </div>
  );
}
