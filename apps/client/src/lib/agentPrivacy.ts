import { create } from 'zustand';
import { childFolders, lockedAncestor, subtreeFolderIds } from './board/libraryMeta';
import type { LibraryMeta } from './board/libraryMeta';

/**
 * What agents may see beyond the board they were pointed at (Settings →
 * Privacy). The in-app assistant and outside agents over MCP share one tool
 * surface, so one set of choices covers both; it is kept per device, like
 * the notification choices, because the agents are connected to this device.
 *
 * Library search is the widening one: with it on, a question about one
 * board can pull snippets from any other, so it starts off, and "chosen
 * folders" lets a person say exactly which folders are open to it. Locked
 * boards and boards in locked folders are never searched whatever the
 * choice (the library index leaves them out at rest).
 */

export type LibrarySearchScope = 'off' | 'all' | 'chosen';

export interface AgentPrivacyPrefs {
  librarySearch: LibrarySearchScope;
  /** Folder keys (see `libraryFolderKey` / `filesFolderKey`) searched when
   *  `librarySearch` is 'chosen'. A folder never ticked is closed. */
  chosenFolders: string[];
  /** render_board may hand agents a picture of the open board. */
  render: boolean;
}

export const DEFAULT_AGENT_PRIVACY: AgentPrivacyPrefs = {
  librarySearch: 'off',
  chosenFolders: [],
  render: true,
};

const KEY = 'boardcache:agentPrivacy';

function load(): AgentPrivacyPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_AGENT_PRIVACY;
    const p = JSON.parse(raw) as Partial<AgentPrivacyPrefs>;
    return {
      librarySearch: (['off', 'all', 'chosen'] as const).includes(
        p.librarySearch as LibrarySearchScope,
      )
        ? (p.librarySearch as LibrarySearchScope)
        : 'off',
      chosenFolders: Array.isArray(p.chosenFolders)
        ? p.chosenFolders.filter((k): k is string => typeof k === 'string')
        : [],
      render: p.render !== false,
    };
  } catch {
    return DEFAULT_AGENT_PRIVACY;
  }
}

interface AgentPrivacyState {
  prefs: AgentPrivacyPrefs;
  set: (patch: Partial<AgentPrivacyPrefs>) => void;
}

export const useAgentPrivacy = create<AgentPrivacyState>((set) => ({
  prefs: load(),
  set: (patch) =>
    set((s) => {
      const prefs = { ...s.prefs, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(prefs));
      } catch {
        /* storage unavailable */
      }
      return { prefs };
    }),
}));

/** The current choices (non-hook). */
export const agentPrivacy = (): AgentPrivacyPrefs => useAgentPrivacy.getState().prefs;

// --- folder keys -------------------------------------------------------------

/** Library boards in no folder. */
const HOME_KEY = 'home';
/** The root of the Files folder (desktop). */
const FILES_KEY = 'files';

const libraryFolderKey = (folderId: string | null | undefined): string =>
  folderId ? `folder:${folderId}` : HOME_KEY;
const filesFolderKey = (dir: string): string => (dir ? `files:${dir}` : FILES_KEY);

export interface FolderRow {
  key: string;
  label: string;
  /** Nesting depth for display (0 = top level). */
  depth: number;
  /** Sealed by a folder password: never searched, shown but not tickable. */
  locked: boolean;
}

/**
 * Every folder a person can open to agents, in display order: Home, the
 * library folders as a tree, then the Files folder and its directories when
 * a board folder is chosen on this desktop.
 */
export function agentFolderRows(meta: LibraryMeta, files: { path: string }[] | null): FolderRow[] {
  const rows: FolderRow[] = [{ key: HOME_KEY, label: 'Home', depth: 0, locked: false }];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childFolders(meta, parentId)) {
      rows.push({
        key: libraryFolderKey(f.id),
        label: f.name,
        depth,
        locked: lockedAncestor(meta, f.id) !== null,
      });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  if (files) {
    rows.push({ key: FILES_KEY, label: 'Files', depth: 0, locked: false });
    for (const d of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
      rows.push({
        key: filesFolderKey(d.path),
        label: d.path.split('/').pop() ?? d.path,
        depth: d.path.split('/').length,
        locked: false,
      });
    }
  }
  return rows;
}

/** The keys a tick on `key` carries with it: the folder and everything under it. */
export function folderSubtreeKeys(
  key: string,
  meta: LibraryMeta,
  files: { path: string }[] | null,
): string[] {
  if (key.startsWith('folder:')) {
    const id = key.slice('folder:'.length);
    return subtreeFolderIds(meta, id).map(libraryFolderKey);
  }
  if (key === FILES_KEY) return [FILES_KEY, ...(files ?? []).map((d) => filesFolderKey(d.path))];
  if (key.startsWith('files:')) {
    const dir = key.slice('files:'.length);
    return [
      key,
      ...(files ?? [])
        .filter((d) => d.path.startsWith(`${dir}/`))
        .map((d) => filesFolderKey(d.path)),
    ];
  }
  return [key];
}

/**
 * Whether a board is open to agents' library search under the current
 * choices. Boards in the Files folder are told apart by `inFiles`
 * (board id → directory); every other board is a library board whose
 * folder `meta` knows.
 */
export function agentBoardFilter(
  prefs: AgentPrivacyPrefs,
  meta: LibraryMeta,
  inFiles: Map<string, string>,
): (boardId: string) => boolean {
  if (prefs.librarySearch === 'off') return () => false;
  const chosen = new Set(prefs.chosenFolders);
  return (boardId) => {
    const dir = inFiles.get(boardId);
    if (dir === undefined) {
      const folderId = meta.boardFolders[boardId] ?? null;
      if (lockedAncestor(meta, folderId)) return false;
      return prefs.librarySearch === 'all' || chosen.has(libraryFolderKey(folderId));
    }
    return prefs.librarySearch === 'all' || chosen.has(filesFolderKey(dir));
  };
}
