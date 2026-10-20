import { apiFetch } from './apiBase';
import { listBoards, revokeSummaries } from '../board/boardLibrary';
import { useSyncStore } from '../../state/syncStore';

/**
 * Opt-in board directory: a plaintext {id, name} map published to the server
 * so external producers (the clipper extension) can offer a "send to board"
 * picker. Board CONTENT stays end-to-end encrypted — this shares names only,
 * and only while the toggle is on. Locked boards are never listed.
 */

const FLAG_KEY = 'boardcache:shareBoardDirectory';

export function directoryEnabled(): boolean {
  return localStorage.getItem(FLAG_KEY) === 'on';
}

export function setDirectoryEnabled(on: boolean): void {
  localStorage.setItem(FLAG_KEY, on ? 'on' : 'off');
  void publishBoardDirectory(true);
}

let timer: number | null = null;

/**
 * Republish soon (trailing debounce) — called from the board storage layer
 * on anything that changes the board list or its names (create, save,
 * rename, delete, lock). Cheap: the publish itself no-ops when the list is
 * unchanged, signed out, or sharing is off.
 */
export function scheduleDirectoryPublish(): void {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    void publishBoardDirectory();
  }, 1500);
}

let lastPublished: string | null = null;

/** Push the current directory (or clear it when disabled). Debounced by
 *  content — repeat calls with an unchanged list are no-ops. */
export async function publishBoardDirectory(force = false): Promise<void> {
  if (useSyncStore.getState().status !== 'signedIn') return;
  let boards: { id: string; name: string }[] = [];
  if (directoryEnabled()) {
    const summaries = await listBoards();
    boards = summaries.filter((b) => !b.locked).map((b) => ({ id: b.id, name: b.name }));
    revokeSummaries(summaries);
  }
  const body = JSON.stringify({ boards });
  if (!force && body === lastPublished) return;
  try {
    const res = await apiFetch('/api/board-directory', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body,
    });
    if (res.ok) lastPublished = body;
  } catch {
    /* offline — retried on the next focus/boot */
  }
}
