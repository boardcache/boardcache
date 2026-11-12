import { create } from 'zustand';

/**
 * What syncs once signed in: every board in the library, or only the boards
 * the ☁ Sync button on each card was pressed for. The choice follows the
 * account (settingsSync carries it as an app preference); localStorage is
 * the offline copy. "Every board" enrols boards during each sync pass (see
 * boardSync `enrolEveryBoard`), so a board made or imported anywhere is
 * pushed as soon as it is saved. Templates and boards in the Files folder
 * are left to their own opt-ins.
 */

const KEY = 'boardcache:syncAll';

interface SyncScopeState {
  all: boolean;
  setAll: (all: boolean) => void;
}

export const useSyncScope = create<SyncScopeState>((set) => ({
  all: (() => {
    try {
      return localStorage.getItem(KEY) === 'on';
    } catch {
      return false;
    }
  })(),
  setAll: (all) => {
    try {
      localStorage.setItem(KEY, all ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    set({ all });
    // Turning it on enrols the library on the next pass, now.
    if (all) void import('./boardSync').then((m) => m.syncSoon());
  },
}));

/** Whether every library board syncs (non-hook). */
export const syncAllBoards = (): boolean => useSyncScope.getState().all;
