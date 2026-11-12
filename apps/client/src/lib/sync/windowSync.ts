import { applyPatches } from 'immer';
import type { Patch } from 'immer';
import { newId } from '@boardcache/schema';
import { loadBoardRecord } from '../board/boardLibrary';
import { collabActive } from '../../state/collabStore';
import { useDocumentStore } from '../../state/documentStore';

/**
 * The same board open in two windows of one browser (a view popped out
 * beside the canvas) stays one board: every command's patches go over a
 * BroadcastChannel to the sibling windows, which apply them the way a
 * team room's patches are applied, without an undo entry of their own.
 * Each window numbers what it sends; a gap means a window missed
 * something (asleep, just opened), and it reloads the board from storage
 * instead of guessing. Team boards are left to their room, which already
 * carries every window's edits. Nothing is sent when no sibling listens:
 * a BroadcastChannel without a second window is a no-op.
 */

const CHANNEL = 'boardcache-doc';

interface PatchMsg {
  boardId: string;
  from: string;
  seq: number;
  patches: Patch[];
}

const windowId = newId();
let seq = 0;
const seen = new Map<string, number>();
let channel: BroadcastChannel | null = null;
let applying = false;

function open(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL);
  return channel;
}

/** True while a sibling's patches land here: the autosave stays out of it
 *  (the window that made the change saves it). */
export function applyingWindowSync(): boolean {
  return applying;
}

/** Mirror a local command's patches to the other windows of this board. */
export function broadcastPatches(patches: Patch[]): void {
  if (patches.length === 0 || collabActive()) return;
  const ch = open();
  if (!ch) return;
  const doc = useDocumentStore.getState().doc;
  const shared = patches.filter((p) => p.path[0] !== 'viewport');
  if (shared.length === 0) return;
  ch.postMessage({
    boardId: doc.id,
    from: windowId,
    seq: ++seq,
    patches: shared,
  } satisfies PatchMsg);
}

let reloading: Promise<void> | null = null;
/** The board as storage has it, in place of a copy that fell behind. */
function reloadFromStorage(boardId: string): Promise<void> {
  if (reloading) return reloading;
  reloading = (async () => {
    try {
      const fresh = await loadBoardRecord(boardId);
      const store = useDocumentStore.getState();
      if (!fresh || store.doc.id !== boardId) return;
      applying = true;
      store.replaceDoc({ ...fresh, viewport: store.doc.viewport });
    } finally {
      applying = false;
      reloading = null;
    }
  })();
  return reloading;
}

let started = false;
/** Mount once: take the other windows' patches for the open board. */
export function startWindowSync(): void {
  if (started) return;
  started = true;
  const ch = open();
  if (!ch) return;
  ch.addEventListener('message', (e: MessageEvent<PatchMsg>) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object' || msg.from === windowId || !Array.isArray(msg.patches))
      return;
    const store = useDocumentStore.getState();
    if (msg.boardId !== store.doc.id || collabActive()) return;
    const last = seen.get(msg.from);
    seen.set(msg.from, msg.seq);
    if (last !== undefined && msg.seq !== last + 1) {
      void reloadFromStorage(msg.boardId);
      return;
    }
    try {
      const next = applyPatches(store.doc, msg.patches);
      applying = true;
      store.replaceDoc({ ...next, viewport: store.doc.viewport });
    } catch {
      void reloadFromStorage(msg.boardId);
    } finally {
      applying = false;
    }
  });
  // A window that was asleep may have missed messages the channel never
  // queues for it: coming back, it checks storage once.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const { doc } = useDocumentStore.getState();
    if (doc.id && !collabActive() && seen.size > 0) void reloadFromStorage(doc.id);
  });
}
