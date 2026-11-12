import { useCollabStore } from '../state/collabStore';

/**
 * Which reminders this device has already shown. A reminder on a board of
 * your own stamps the item (`notifiedAt`), a silent write that syncs so no
 * device fires it twice. On a team board that stamp would be shared with
 * every member, and the first client to fire would silence the rest, so
 * there each device keeps its own ledger here and the item stays unstamped.
 */

const KEY = 'boardcache:reminded';
const MAX = 2000;

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Whether `boardId` is open as a live team room on this client. */
export function isTeamRoom(boardId: string): boolean {
  return useCollabStore.getState().boardId === boardId;
}

export function remindedHere(key: string): boolean {
  return read().includes(key);
}

export function markRemindedHere(key: string): void {
  try {
    const list = read().filter((k) => k !== key);
    list.push(key);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* no storage: the reminder may show again after a reload */
  }
}
