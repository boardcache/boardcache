import { create } from 'zustand';
import { useDocumentStore } from '../state/documentStore';
import { useHistoryStore } from '../state/history';

/**
 * Agent changes held for review. While an agent (the in-app assistant or
 * an outside agent over MCP) edits the open board, its history entries are
 * tracked as one proposal: the items it touched are marked on the canvas,
 * a bar offers Keep and Undo all, and the board does not sync until the
 * proposal is kept. The person's own edits are never part of it; once they
 * edit after the agent, Undo all is withdrawn (plain Undo still works).
 * Switching boards keeps whatever is open. Per device; off under Settings
 * → Privacy when a person would rather have the changes land as they come.
 */

interface Proposal {
  boardId: string;
  /** "The assistant" or "An agent". */
  agent: string;
  /** How many history entries the agent made. */
  entries: number;
  /** Items the entries touched (created, edited or deleted). */
  itemIds: Set<string>;
  /** The agent's last history entry, to tell its own tail from later edits. */
  last: object | null;
}

interface ProposalState {
  pending: Proposal | null;
  /** Hold agent changes for review (Settings → Privacy). */
  hold: boolean;
  setHold: (hold: boolean) => void;
}

const KEY = 'boardcache:agentHold';

export const useProposals = create<ProposalState>((set) => ({
  pending: null,
  hold: (() => {
    try {
      return localStorage.getItem(KEY) !== 'off';
    } catch {
      return true;
    }
  })(),
  setHold: (hold) => {
    try {
      localStorage.setItem(KEY, hold ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    set({ hold });
    if (!hold) keepProposal();
  },
}));

/** Whether a board's changes are held, so sync leaves it alone for now. */
export function proposalPending(boardId: string): boolean {
  return useProposals.getState().pending?.boardId === boardId;
}

/** Called after an agent's write ran: the entries since `startIndex` join
 *  the open proposal (or open one). */
export function recordAgentChanges(startIndex: number, agent: string): void {
  const { pending, hold } = useProposals.getState();
  if (!hold) return;
  const h = useHistoryStore.getState();
  if (h.index <= startIndex) return;
  const doc = useDocumentStore.getState().doc;
  const same = pending && pending.boardId === doc.id;
  const itemIds = new Set(same ? pending.itemIds : []);
  const fresh = h.entries.slice(startIndex + 1, h.index + 1);
  for (const e of fresh)
    for (const p of [...e.patches, ...e.inversePatches])
      if (p.path[0] === 'items' && typeof p.path[1] === 'string') itemIds.add(p.path[1]);
  useProposals.setState({
    pending: {
      boardId: doc.id,
      agent,
      entries: (same ? pending.entries : 0) + fresh.length,
      itemIds,
      last: h.entries[h.index] ?? null,
    },
  });
}

/** Undo all is only honest while the agent's entries are still the top of
 *  the stack: nothing of the person's own since, no undo already. */
export function canRevertProposal(): boolean {
  const { pending } = useProposals.getState();
  if (!pending) return false;
  const h = useHistoryStore.getState();
  return h.entries[h.index] === pending.last && h.index + 1 >= pending.entries;
}

/** The changes stay; the board may sync. */
export function keepProposal(): void {
  const { pending } = useProposals.getState();
  if (!pending) return;
  useProposals.setState({ pending: null });
  void import('./sync/boardSync').then((m) => m.markBoardDirty(pending.boardId));
}

/** Every entry of the proposal undone, newest first. */
export function revertProposal(): boolean {
  if (!canRevertProposal()) return false;
  const { pending } = useProposals.getState();
  const h = useHistoryStore.getState();
  for (let k = 0; k < pending!.entries; k++) h.undo();
  useProposals.setState({ pending: null });
  return true;
}

/** Leaving the board keeps what is on it (sync may now carry it). */
useDocumentStore.subscribe((s, prev) => {
  if (s.doc.id !== prev.doc.id) {
    const { pending } = useProposals.getState();
    if (pending && pending.boardId !== s.doc.id) keepProposal();
  }
});
