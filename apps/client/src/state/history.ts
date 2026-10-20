import { applyPatches, enablePatches } from 'immer';
import type { Patch } from 'immer';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { collabNotifyPatches } from '../lib/sync/collab';
import { useDocumentStore } from './documentStore';

enablePatches();

/**
 * History is patches, never snapshots (rule 3.4). Each command pushes
 * { patches, inversePatches, label }; undo/redo applies them — O(size of
 * the change). The dirty indicator derives from index vs savedIndex, so it
 * cannot drift out of sync.
 */
interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

const HISTORY_LIMIT = 200;

interface HistoryState {
  entries: HistoryEntry[];
  /** Index of the last applied entry; -1 when at the initial state. */
  index: number;
  /** Value of `index` when the document was last persisted. */
  savedIndex: number;

  push: (entry: HistoryEntry) => void;
  /** Merge every entry after `sinceIndex` into ONE labeled entry (tool turns:
   *  one assistant action = one undo step). No-op if nothing was pushed. */
  coalesceSince: (sinceIndex: number, label: string) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  markSaved: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  subscribeWithSelector((set, get) => ({
    entries: [],
    index: -1,
    savedIndex: -1,

    push: (entry) =>
      set((state) => {
        // Branching discards the redo tail.
        let entries = [...state.entries.slice(0, state.index + 1), entry];
        let savedIndex = state.savedIndex > state.index ? -2 : state.savedIndex;
        if (entries.length > HISTORY_LIMIT) {
          const dropped = entries.length - HISTORY_LIMIT;
          entries = entries.slice(dropped);
          savedIndex = savedIndex >= 0 ? savedIndex - dropped : savedIndex;
        }
        return { entries, index: entries.length - 1, savedIndex };
      }),

    coalesceSince: (sinceIndex, label) =>
      set((state) => {
        // Only coalesce a linear run that's still on top of the stack.
        if (state.index <= sinceIndex || sinceIndex < -1) return state;
        const kept = state.entries.slice(0, sinceIndex + 1);
        const merged = state.entries.slice(sinceIndex + 1, state.index + 1);
        if (merged.length <= 1 && merged[0]?.label === label) return state;
        const entry: HistoryEntry = {
          label,
          patches: merged.flatMap((e) => e.patches),
          // Inverse patches revert newest-first.
          inversePatches: [...merged].reverse().flatMap((e) => e.inversePatches),
        };
        const entries = [...kept, entry];
        const savedIndex = state.savedIndex > sinceIndex ? -2 : state.savedIndex;
        return { entries, index: entries.length - 1, savedIndex };
      }),

    undo: () => {
      const { entries, index } = get();
      const entry = entries[index];
      if (!entry) return;
      const { doc, replaceDoc } = useDocumentStore.getState();
      replaceDoc(applyPatches(doc, entry.inversePatches));
      collabNotifyPatches(entry.inversePatches);
      set({ index: index - 1 });
    },

    redo: () => {
      const { entries, index } = get();
      const entry = entries[index + 1];
      if (!entry) return;
      const { doc, replaceDoc } = useDocumentStore.getState();
      replaceDoc(applyPatches(doc, entry.patches));
      collabNotifyPatches(entry.patches);
      set({ index: index + 1 });
    },

    clear: () => set({ entries: [], index: -1, savedIndex: -1 }),

    markSaved: () => set((state) => ({ savedIndex: state.index })),
  })),
);

/** True when the document differs from the last-saved state. */
export function isDirty(): boolean {
  const { index, savedIndex } = useHistoryStore.getState();
  return index !== savedIndex;
}
