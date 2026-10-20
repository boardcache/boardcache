import { useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';
import { syncedBoardIds } from './syncMetaStore';
import { apiFetch } from './apiBase';
import { confirmDialog } from '../../components/ui/Prompt';
import { showNotice } from '../notices';

/**
 * Single-editor leases for SYNCED boards: opening a board another signed-in
 * device is editing asks before taking over; taking over kicks the other
 * device (its next heartbeat learns the lease moved and closes the board).
 * Purely advisory presence — the encrypted sync itself stays conflict-safe.
 */

const HEARTBEAT_MS = 15_000;

function deviceId(): string {
  try {
    let id = localStorage.getItem('boardcache:deviceId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('boardcache:deviceId', id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua)
    ? 'Firefox'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : 'Safari';
  const os = /iPad|Macintosh.*Mobile/.test(ua)
    ? 'iPad'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac/.test(ua)
          ? 'Mac'
          : /Win/.test(ua)
            ? 'Windows'
            : 'Linux';
  return `${browser} on ${os}`;
}

let current: { boardId: string; timer: ReturnType<typeof setInterval> } | null = null;

async function claim(boardId: string, force: boolean): Promise<'ok' | 'held' | 'skip'> {
  const res = await apiFetch(`/api/boards/${boardId}/lease`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ deviceId: deviceId(), label: deviceLabel(), force }),
  }).catch(() => null);
  if (!res) return 'skip'; // offline — presence is advisory only
  if (res.ok) return 'ok';
  if (res.status === 409) return 'held';
  return 'skip';
}

async function holderLabel(boardId: string): Promise<string> {
  const res = await apiFetch(`/api/boards/${boardId}/lease`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ deviceId: deviceId(), label: deviceLabel() }),
  }).catch(() => null);
  if (res?.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { heldBy?: { label?: string } };
    return body.heldBy?.label ?? 'another device';
  }
  return 'another device';
}

/** Kicked: the lease moved to another device — close here with a notice. */
async function onLeaseLost(): Promise<void> {
  stopLease();
  showNotice(
    'This board is now being edited on another device — it was closed here. Reopen it to take editing back.',
    { id: 'edit-lease-lost', sticky: true },
  );
  const { closeBoard } = await import('../board/boardLibrary');
  await closeBoard();
}

/** Start (or move) the lease for the newly opened board. Resolves false when
 *  the user declined to take over — the caller should close the board. */
export async function acquireEditLease(boardId: string, name: string): Promise<boolean> {
  stopLease();
  if (useSyncStore.getState().status !== 'signedIn') return true;
  if (!(await syncedBoardIds()).has(boardId)) return true;

  let got = await claim(boardId, false);
  if (got === 'held') {
    const label = await holderLabel(boardId);
    const take = await confirmDialog({
      title: 'Editing on another device',
      body: `“${name}” is open on ${label}. Take over editing here? The other device will close this board.`,
      confirmLabel: 'Take over',
      cancelLabel: 'Not now',
    });
    if (!take) return false;
    got = await claim(boardId, true);
  }
  if (got !== 'ok') return true; // offline/unknown — never block editing

  const timer = setInterval(() => {
    void (async () => {
      if (current?.boardId !== boardId) return;
      if (useSessionStore.getState().view === 'library') return stopLease();
      const beat = await claim(boardId, false);
      if (beat === 'held') await onLeaseLost();
    })();
  }, HEARTBEAT_MS);
  current = { boardId, timer };
  return true;
}

/** Release the lease (board closed / signed out). */
export function stopLease(): void {
  if (!current) return;
  const { boardId, timer } = current;
  current = null;
  clearInterval(timer);
  void apiFetch(`/api/boards/${boardId}/lease`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ deviceId: deviceId() }),
  }).catch(() => undefined);
}
