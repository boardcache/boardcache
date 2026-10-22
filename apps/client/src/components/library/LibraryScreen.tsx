import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useReducer } from 'react';
import { logDeviceEvent } from '../../lib/deviceLog';
import {
  loadBoardRecord,
  saveBoardRecord,
  createBoard,
  deleteBoard,
  duplicateBoard,
  duplicateTeamBoardAsLocal,
  listBoards,
  openBoard,
  openLockedBoard,
  openLockedBoardWithKey,
  renameBoardRecord,
  revokeSummaries,
} from '../../lib/board/boardLibrary';
import { lockBoard, removeLock } from '../../lib/board/boardLock';
import {
  folderSessionKey,
  lockFolder,
  lockIntoFolder,
  relockFolder,
  releaseFromFolder,
  removeFolderLock,
  unlockFolder,
} from '../../lib/board/folderLock';
import { useLockScreenStore } from '../../lib/lockScreen';
import { haptic, publishWidgetData } from '../../lib/iosNative';
import { createLongPress } from '../../lib/longPress';
import {
  LIBRARY_VIEWS,
  loadLibraryView,
  onLibraryViewChange,
  saveLibraryView,
} from '../../lib/libraryPrefs';
import type { LibraryView } from '../../lib/libraryPrefs';
import { isPhoneViewport } from '../../lib/mobile';
import type { BoardSummary } from '../../lib/board/boardLibrary';
import { formatBytes } from '../../lib/board/boardSize';
import { apiFetch } from '../../lib/sync/apiBase';
import {
  disableBoardSync,
  enableBoardSync,
  markBoardDirty,
  onBoardDeleted,
  useBoardSyncActivity,
} from '../../lib/sync/boardSync';
import {
  addTagToBoards,
  childFolders,
  createFolder,
  deleteFolderTree,
  folderById,
  folderPath,
  isWithinFolder,
  subtreeFolderIds,
  emptyLibraryMeta,
  loadLibraryMeta,
  moveBoards,
  boardsInFolderTree,
  lockedAncestor,
  removeTagFromBoards,
  moveFolder,
  onLibraryMetaChanged,
  renameFolder,
  saveLibraryMeta,
  setBoardOrder,
} from '../../lib/board/libraryMeta';
import type { LibraryFolder, LibraryMeta } from '../../lib/board/libraryMeta';
import type { MenuEntry } from '../../lib/menuBuilders';
import { showNotice } from '../../lib/notices';
import { isEditableTarget } from '../../hooks/useGlobalShortcuts';
import * as DM from '@radix-ui/react-dropdown-menu';
import { RadixEntries } from '../menu/RadixEntries';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from '../ui/Popover';
import { UiDialog } from '../ui/Dialog';
import { confirmDialog, promptText } from '../ui/Prompt';
import {
  FilterIcon,
  CloudDownloadIcon,
  CheckSquareIcon,
  GearIcon,
  TemplateIcon,
  SearchIcon,
  CloseIcon,
  DuplicateIcon,
  FolderIcon,
  LockIcon,
  UnlockIcon,
  FolderInputIcon,
  FolderOpenIcon,
  HamburgerIcon,
  HomeIcon,
  ChevronRightIcon,
  PanelLeftIcon,
  MoonIcon,
  RenameIcon,
  SunIcon,
  TagIcon,
  TrashIcon,
  GridIcon,
  GridSmallIcon,
  ListIcon,
  ExportIcon,
  DownloadIcon,
  BoardsIcon,
  UsersIcon,
  LinkIcon,
  GlobeIcon,
} from '../icons';
import { BoardLockDialog } from '../dialogs/BoardLockDialog';
import type { LockDialogMode } from '../dialogs/BoardLockDialog';
import { SyncStatus } from '../chrome/SyncStatus';
import {
  collectBackupEntries,
  decryptBackup,
  exportBoardsFiles,
  exportTeamBoardsFiles,
  isEncryptedBackup,
  planImport,
  runImport,
  type ImportRow,
} from '../../lib/sync/backup';
import { downloadBlob } from '../../lib/export/download';
import { useCommunityPublish, useCommunityReady } from '../community/CommunityDialogs';
import { UiSelect } from '../ui/Select';

interface TeamBoardRow {
  id: string;
  name: string;
  rev: number;
  updatedAt: string;
  guestSlug: string | null;
  role: string;
}
import { UiTooltip } from '../ui/Tooltip';
import { useDocumentStore } from '../../state/documentStore';
import { resolveTheme, useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString();
}

type SortMode = 'manual' | 'name' | 'date';

const SORT_KEY = 'boardcache:librarySort';

/** One grid, filtered by status — synced/local/team read from the card
 *  chips rather than separate sections, so sorting stays coherent. */
type StatusFilter = 'all' | 'synced' | 'local' | 'team' | 'locked';

const STATUS_KEY = 'boardcache:libraryStatus';

function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/**
 * The board library: click selects (shift/ctrl adds), double-click opens.
 * A sidebar scopes by folder and filters by tag; the header searches and
 * sorts (recency, name, or manual drag order); an action bar operates on the
 * selection (open / rename / duplicate / move / tag / delete).
 */
export function LibraryScreen() {
  const communityReady = useCommunityReady();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  /** First listing resolved — until then the grid shows skeletons, and the
   *  real cards fade in (no pop-in flash on slow IndexedDB reads). */
  const [listLoaded, setListLoaded] = useState(false);
  const [meta, setMeta] = useState<LibraryMeta>(emptyLibraryMeta);
  const [selection, setSelection] = useState<string[]>([]);
  /** Toolbar toggle: plain clicks select additively (no modifier needed). */
  const [multiSelect, setMultiSelect] = useState(false);
  // Touch: press and hold a card to start selecting (the mouse has modifier
  // keys and the marquee; a finger has neither). The hold arms Select mode
  // and adds the card; taps then toggle, as they do behind the Select button.
  const longPress = useMemo(
    () =>
      createLongPress((key) => {
        const [kind, id] = key.split(':', 2) as ['board' | 'folder' | 'team', string];
        setMultiSelect(true);
        const add = (sel: string[]) => (sel.includes(id) ? sel : [...sel, id]);
        if (kind === 'board') setSelection(add);
        else if (kind === 'folder') setFolderSelection(add);
        else setTeamSelection(add);
        navigator.vibrate?.(10);
        haptic('medium');
      }),
    [],
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Phones tuck the two dropdowns behind a filter toggle (second row).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const stored = loadPref(SORT_KEY, 'date');
    return stored === 'name' || stored === 'manual' ? stored : 'date';
  });
  const [viewMode, setViewMode] = useState<LibraryView>(loadLibraryView);
  // Settings → General changes the same preference behind this screen.
  useEffect(() => onLibraryViewChange(setViewMode), []);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const stored = loadPref(STATUS_KEY, 'all');
    return ['synced', 'local', 'team', 'locked'].includes(stored)
      ? (stored as StatusFilter)
      : 'all';
  });
  const [dropZone, setDropZone] = useState<string | null>(null); // 'folder:<id>' | 'tag:<label>'
  // Routed: '/' (home), '/all', '/templates', '/folder/:id' all map to this selection.
  const folderSel = useSessionStore((s) => s.libraryFolder);
  const setFolderSel = useSessionStore((s) => s.setLibraryFolder);
  /** The folder being browsed: null for Home; also null (unused) for All / Templates. */
  const currentFolder =
    folderSel === 'home' || folderSel === 'all' || folderSel === 'templates' ? null : folderSel;
  /** Home or a folder: the grid shows subfolders as tiles and only the boards inside. */
  const browsing = folderSel !== 'all' && folderSel !== 'templates';
  const dragFolderRef = useRef<string | null>(null);
  const [sideCollapsed, setSideCollapsed] = useState(
    () => loadPref('library:sidebar', 'open') === 'closed',
  );
  const toggleSidebar = () => {
    const next = !sideCollapsed;
    setSideCollapsed(next);
    savePref('library:sidebar', next ? 'closed' : 'open');
  };
  const [tagSel, setTagSel] = useState<string[]>([]);
  // Mobile-only offcanvas drawer state; the sidebar is always shown on desktop.
  const [sideOpen, setSideOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<{ id: string; before: boolean } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(
    null,
  );
  const [lockPrompt, setLockPrompt] = useState<{
    mode: LockDialogMode;
    /** folder-open: the folder to enter once unlocked. */
    then?: string;
    id: string;
    name: string;
  } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const marqueeRef = useRef<{
    x0: number;
    y0: number;
    base: string[];
    folderBase: string[];
    active: boolean;
  } | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const liveSummaries = useRef<BoardSummary[]>([]);
  const currentId = useDocumentStore((s) => s.doc.id);
  const theme = useSessionStore((s) => s.theme);
  const resolved = resolveTheme(theme);
  const signedIn = useSyncStore((s) => s.status === 'signedIn');

  const commitMeta = useCallback(async (next: LibraryMeta) => {
    setMeta(next);
    await saveLibraryMeta(next);
  }, []);

  // Refreshes must be SERIALIZED: two interleaved runs can each revoke the
  // other's freshly created thumbnail object URLs, leaving rendered cards
  // pointing at dead blob: srcs (the broken-image glyph, most visible on
  // iOS after a rename kicks off both a direct refresh and a sync-driven
  // one).
  const refreshChain = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(() => {
    const run = refreshChain.current.then(async () => {
      const [next, loadedMeta] = await Promise.all([listBoards(), loadLibraryMeta()]);
      const previous = liveSummaries.current;
      liveSummaries.current = next;
      setBoards(next);
      // The previous thumbnails go once the cards have swapped to the new
      // ones: a card re-mounting in between would otherwise load a dead URL.
      setTimeout(() => revokeSummaries(previous), 2000);
      publishWidgetData({
        boards: next
          .filter((b) => !b.isTemplate)
          .slice(0, 8)
          .map((b) => ({ id: b.id, name: b.name, updatedAt: b.updatedAt })),
      });
      // Taken as stored. The map may name boards this device does not have
      // (unsynced boards on another device, boards not pulled yet): those
      // entries are the account's, and pruning them here once let a folder
      // action on this device push a map without them, bouncing the other
      // device's boards to the root. A deleted board's entries go with the
      // deletion (deleteBoard), not with a refresh.
      setMeta(loadedMeta);
      setSelection((sel) => sel.filter((id) => next.some((b) => b.id === id)));
    });
    refreshChain.current = run.catch(() => {});
    return run;
  }, []);

  // Re-list after each sync pass so boards pulled from the server (and their
  // freshly-rendered thumbnails) appear without having to open them.
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  // Per-board in-flight sync → the card badge flashes "Syncing".
  const syncingBoards = useBoardSyncActivity((s) => s.syncing);

  // Folders/tags synced from another device: re-read them into the index.
  useEffect(
    () =>
      onLibraryMetaChanged((source) => {
        if (source === 'remote') void refresh();
      }),
    [refresh],
  );

  useEffect(() => {
    void refresh()
      .catch(() => undefined)
      .then(() => setListLoaded(true));
  }, [refresh, lastSyncedAt]);
  useEffect(
    () => () => {
      revokeSummaries(liveSummaries.current);
      liveSummaries.current = [];
    },
    [],
  );

  // Fresh profiles get the built-in starters as deletable example templates.
  useEffect(() => {
    void import('../../lib/board/boardTemplates').then(({ ensureSeedTemplates }) =>
      ensureSeedTemplates().then((built) => {
        if (built) void refresh();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Imports now run inside Settings — refresh when they land.
  useEffect(() => {
    const onRefresh = () => void refresh();
    window.addEventListener('boardcache:library-refresh', onRefresh);
    return () => window.removeEventListener('boardcache:library-refresh', onRefresh);
  }, [refresh]);

  // Team boards (server-hosted) render inside the Synced section as cards
  // with a Team badge instead of the sync toggle. Declared before the
  // derived filters below, which fold them in.
  const [teamBoards, setTeamBoards] = useState<TeamBoardRow[]>([]);

  // ── Derived: filter + sort ──

  const tagCounts = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const b of [...boards, ...teamBoards]) {
      for (const tag of meta.boardTags[b.id] ?? []) {
        const key = tag.toLowerCase();
        const e = m.get(key);
        if (e) e.count++;
        else m.set(key, { label: tag, count: 1 });
      }
    }
    return [...m.values()].sort((a, b) =>
      a.label.toLowerCase().localeCompare(b.label.toLowerCase()),
    );
  }, [boards, teamBoards, meta.boardTags]);

  /** Boards in a folder and everything below it. */
  const folderCount = useCallback(
    (folderId: string) =>
      [...boards.filter((b) => !b.isTemplate), ...teamBoards].filter((b) => {
        const f = meta.boardFolders[b.id];
        return f ? isWithinFolder(meta, f, folderId) : false;
      }).length,
    [boards, teamBoards, meta],
  );
  /** Does this board belong in the grid for the current section? */
  // Folder locks: the keys live in lib/board/folderLock (module memory), so a
  // tick re-derives the view after an unlock or re-lock.
  const [lockTick, bumpLocks] = useReducer((n: number) => n + 1, 0);
  /** The locked folder governing `folderId` (itself or an ancestor) while no key is held. */
  const sealedAncestor = useCallback(
    (folderId: string | null) => {
      void lockTick; // the keys are module state; the tick is what changes
      const f = lockedAncestor(meta, folderId);
      return f && !folderSessionKey(f.id) ? f : null;
    },
    [meta, lockTick],
  );
  /** The locked folder a board sits in (through its folder chain), or null. */
  const lockOf = useCallback(
    (boardId: string) => lockedAncestor(meta, meta.boardFolders[boardId] ?? null),
    [meta],
  );
  const inScope = useCallback(
    (boardId: string) => {
      // A sealed folder shows nothing, in any view, until it is unlocked.
      if (sealedAncestor(meta.boardFolders[boardId] ?? null)) return false;
      return folderSel === 'all' || (meta.boardFolders[boardId] ?? null) === currentFolder;
    },
    [folderSel, currentFolder, meta.boardFolders, sealedAncestor],
  );
  /** Go into a folder; a sealed one asks for its password first. */
  const enterFolder = (folderId: string) => {
    const sealed = sealedAncestor(folderId);
    if (sealed) {
      setLockPrompt({ mode: 'folder-open', id: sealed.id, name: sealed.name, then: folderId });
    } else setFolderSel(folderId);
  };
  // A deep link into a sealed folder: ask, and stand in Home meanwhile.
  useEffect(() => {
    if (!listLoaded || !currentFolder) return;
    const sealed = sealedAncestor(currentFolder);
    if (!sealed) return;
    const wanted = currentFolder;
    let live = true;
    void Promise.resolve().then(() => {
      if (!live) return;
      setFolderSel('home');
      setLockPrompt({ mode: 'folder-open', id: sealed.id, name: sealed.name, then: wanted });
    });
    return () => {
      live = false;
    };
  }, [listLoaded, currentFolder, sealedAncestor, setFolderSel]);
  /**
   * Keep boards in step with their folders' locks while keys are held: a
   * board moved or imported into an unlocked locked folder gets encrypted
   * with the folder's key; one moved out (still carrying the folder's salt)
   * gets decrypted. Sealed folders are left alone — no key, no change.
   */
  const reconciling = useRef(false);
  useEffect(() => {
    void lockTick;
    if (!listLoaded || reconciling.current) return;
    void (async () => {
      reconciling.current = true;
      let changed = false;
      try {
        for (const b of boards) {
          if (b.remote || b.isTemplate) continue;
          const expected = lockOf(b.id);
          if (expected?.lock) {
            if (!b.locked && folderSessionKey(expected.id)) {
              if (await lockIntoFolder(expected, b.id)) {
                await markBoardDirty(b.id);
                changed = true;
              }
            }
          } else if (b.locked && b.lockSalt) {
            const owner = meta.folders.find((f) => f.lock?.salt === b.lockSalt);
            if (owner && folderSessionKey(owner.id) && (await releaseFromFolder(owner, b.id))) {
              const doc = await loadBoardRecord(b.id);
              if (doc) await saveBoardRecord(doc, true); // thumbnail back
              await markBoardDirty(b.id);
              changed = true;
            }
          }
        }
      } finally {
        reconciling.current = false;
      }
      if (changed) await refresh();
    })();
  }, [boards, meta, listLoaded, lockTick, lockOf, refresh]);
  // A folder that no longer exists (deleted on another device, stale URL) falls back to Home.
  useEffect(() => {
    if (listLoaded && currentFolder && !folderById(meta, currentFolder)) setFolderSel('home');
  }, [listLoaded, currentFolder, meta, setFolderSel]);
  /** Home + every folder as "A / B" labels, for the move pickers. */
  const folderOptions = useMemo(() => {
    const rows = meta.folders
      .map((f) => ({
        id: f.id,
        label: folderPath(meta, f.id)
          .map((x) => x.name)
          .join(' / '),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    return [{ id: '__root', label: 'Home' }, ...rows];
  }, [meta]);

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tagsWanted = tagSel.map((t) => t.toLowerCase());
    let list = boards.filter((b) => {
      if (b.isTemplate) return false; // personal templates live in the picker
      if (!inScope(b.id)) return false;
      if (q && !b.name.toLowerCase().includes(q)) return false;
      if (tagsWanted.length) {
        const tags = (meta.boardTags[b.id] ?? []).map((t) => t.toLowerCase());
        if (!tagsWanted.some((t) => tags.includes(t))) return false;
      }
      return true;
    });
    if (sortMode === 'name') {
      list = [...list].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    } else if (sortMode === 'manual') {
      const rank = new Map(meta.boardOrder.map((id, i) => [id, i]));
      // Boards not yet ranked keep their incoming (recency) order, after.
      list = list
        .map((b, i) => ({ b, key: rank.has(b.id) ? rank.get(b.id)! : meta.boardOrder.length + i }))
        .sort((a, b) => a.key - b.key)
        .map((d) => d.b);
    }
    // 'date' keeps listBoards' recency order.
    return list;
  }, [boards, meta, search, inScope, tagSel, sortMode]);

  // Team boards respect the same folder/tag/search filters as local cards.
  const teamShown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tagsWanted = tagSel.map((t) => t.toLowerCase());
    return teamBoards.filter((b) => {
      if (!inScope(b.id)) return false;
      if (q && !b.name.toLowerCase().includes(q)) return false;
      if (tagsWanted.length) {
        const tags = (meta.boardTags[b.id] ?? []).map((t) => t.toLowerCase());
        if (!tagsWanted.some((t) => tags.includes(t))) return false;
      }
      return true;
    });
  }, [teamBoards, meta, search, inScope, tagSel]);

  // One grid: local + team cards interleaved, status-filtered, sorted as a
  // single population (the ☁/Team/lock chips carry what the sections said).
  type GridEntry = { kind: 'local'; board: BoardSummary } | { kind: 'team'; board: TeamBoardRow };
  const merged: GridEntry[] = useMemo(() => {
    const locals: GridEntry[] = displayed
      .filter((b) => {
        if (statusFilter === 'synced') return b.synced;
        if (statusFilter === 'local') return !b.synced;
        if (statusFilter === 'locked') return b.locked;
        return statusFilter === 'all';
      })
      .map((board) => ({ kind: 'local' as const, board }));
    const teams: GridEntry[] =
      statusFilter === 'all' || statusFilter === 'team'
        ? teamShown.map((board) => ({ kind: 'team' as const, board }))
        : [];
    const list = [...locals, ...teams];
    // Guard + evidence: a card id must appear once. If it doesn't, drop the
    // repeats and say where they came from, so the cause can be read from
    // the device log instead of guessed at.
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const id = list[i]!.board.id;
      if (seen.has(id)) {
        dupes.push(`${list[i]!.kind}:${id.slice(0, 8)}`);
        list.splice(i, 1);
      } else seen.add(id);
    }
    if (dupes.length) {
      logDeviceEvent('library-duplicate-cards', {
        dupes,
        locals: displayed.length,
        teams: teamShown.length,
        teamRows: teamBoards.length,
        teamIds: teamBoards.map((b) => b.id.slice(0, 8)),
        folder: folderSel,
      });
    }
    if (sortMode === 'name') {
      list.sort((a, b) => a.board.name.toLowerCase().localeCompare(b.board.name.toLowerCase()));
    } else if (sortMode === 'date') {
      list.sort((a, b) => (a.board.updatedAt < b.board.updatedAt ? 1 : -1));
    } else {
      // Manual: ranked ids first (team ids can hold ranks too); the rest keep
      // their incoming order after — same rule `displayed` applies to locals.
      const rank = new Map(meta.boardOrder.map((id, i) => [id, i]));
      return list
        .map((e, i) => ({
          e,
          key: rank.has(e.board.id) ? rank.get(e.board.id)! : meta.boardOrder.length + i,
        }))
        .sort((a, b) => a.key - b.key)
        .map((d) => d.e);
    }
    return list;
  }, [displayed, teamShown, teamBoards, statusFilter, sortMode, meta.boardOrder, folderSel]);

  // ── Selection + keyboard ──

  // Folders select like boards (third track): a click selects, a double
  // click enters; Move / Rename / Export / Delete act on whole folders.
  const [folderSelection, setFolderSelection] = useState<string[]>([]);
  const toggleFolderSelect = (id: string, additive: boolean) => {
    if (!additive) {
      setSelection([]);
      setTeamSelection([]);
    }
    setFolderSelection((sel) => {
      if (!additive) return [id];
      return sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id];
    });
  };

  const toggleSelect = (id: string, additive: boolean) => {
    // Plain clicks keep the tracks exclusive; additive selection (Select
    // mode / modifier keys) mixes local and team boards freely — shared
    // actions (Move, Tags) act on both, type-specific buttons on their own.
    if (!additive) {
      setTeamSelection([]);
      setFolderSelection([]);
    }
    setSelection((sel) => {
      if (!additive) return [id]; // background click / marquee handles deselect
      return sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id];
    });
  };

  // Team cards select separately — local bulk machinery (delete, tags,
  // folders) must never see team ids.
  const [teamSelection, setTeamSelection] = useState<string[]>([]);
  const toggleTeamSelect = (id: string, additive: boolean) => {
    if (!additive) {
      setSelection([]);
      setFolderSelection([]);
    }
    setTeamSelection((sel) => {
      if (!additive) return sel.length === 1 && sel[0] === id ? [] : [id];
      return sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id];
    });
  };

  /** Open a board; a locked one prompts for its password first. */
  const requestOpen = (id: string) => {
    const board = boards.find((b) => b.id === id);
    if (!board) return;
    const folder = board.locked ? lockOf(id) : null;
    if (folder) {
      const key = folderSessionKey(folder.id);
      if (!key) {
        setLockPrompt({ mode: 'folder-open', id: folder.id, name: folder.name });
        return;
      }
      void (async () => {
        if (board.remote) {
          const { downloadBoard } = await import('../../lib/sync/boardSync');
          useSessionStore.getState().setExportBusy('Downloading board');
          const ok = await downloadBoard(id, useSessionStore.getState().setExportProgress).finally(
            () => useSessionStore.getState().setExportBusy(null),
          );
          await refresh();
          if (!ok) return;
        }
        if (!(await openLockedBoardWithKey(id, key))) {
          showNotice(
            'This board was locked on its own, not with the folder. Unlock it by itself.',
            {
              kind: 'info',
            },
          );
        }
      })();
      return;
    }
    if (board.remote && board.locked) {
      // Locked stub: fetch the (still-encrypted) payload first, then ask for
      // the password like any locked board.
      void (async () => {
        const { downloadBoard } = await import('../../lib/sync/boardSync');
        useSessionStore.getState().setExportBusy('Downloading board');
        const ok = await downloadBoard(id, useSessionStore.getState().setExportProgress).finally(
          () => useSessionStore.getState().setExportBusy(null),
        );
        await refresh();
        if (ok) setLockPrompt({ mode: 'open', id, name: board.name });
      })();
      return;
    }
    if (board.locked) setLockPrompt({ mode: 'open', id, name: board.name });
    else void openBoard(id); // remote stubs download inside openBoard
  };

  // id → download fraction (0..1); presence alone marks "in flight".
  const [downloadingIds, setDownloadingIds] = useState<Map<string, number>>(new Map());
  const downloadOne = async (id: string) => {
    setDownloadingIds((prev) => new Map(prev).set(id, 0));
    try {
      const { downloadBoard } = await import('../../lib/sync/boardSync');
      await downloadBoard(id, (f) =>
        setDownloadingIds((prev) => (prev.has(id) ? new Map(prev).set(id, f) : prev)),
      );
    } finally {
      setDownloadingIds((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      await refresh();
    }
  };

  const startLock = (id: string) => {
    const board = boards.find((b) => b.id === id);
    if (!board) return;
    const folder = lockOf(id);
    if (folder) {
      showNotice(
        `“${board.name}” is locked with its folder “${folder.name}”. Lock or unlock the folder instead.`,
        {
          kind: 'info',
        },
      );
      return;
    }
    setLockPrompt({ mode: board.locked ? 'remove' : 'set', id, name: board.name });
  };
  /**
   * Lock a folder: everything inside must be lockable with the one password.
   * A board locked on its own (its own password), a locked subfolder, a team
   * board (lives on the server) or a stub not downloaded yet all block it,
   * each named so the user can sort it out first.
   */
  const startFolderLock = (f: LibraryFolder) => {
    const inside = new Set(boardsInFolderTree(meta, f.id));
    const own = boards.filter((b) => inside.has(b.id) && b.locked && !b.isTemplate);
    const subLocked = meta.folders.filter(
      (x) => x.id !== f.id && x.lock && isWithinFolder(meta, x.id, f.id),
    );
    const team = teamBoards.filter((b) => inside.has(b.id));
    const stubs = boards.filter((b) => inside.has(b.id) && b.remote && !b.locked);
    const names = (xs: { name: string }[]) => xs.map((x) => `“${x.name}”`).join(', ');
    if (own.length) {
      showNotice(
        `Unlock ${names(own)} first: a folder lock needs one password for everything inside.`,
      );
      return;
    }
    if (subLocked.length) {
      showNotice(
        `Remove the lock on ${names(subLocked)} first; a folder lock covers its subfolders.`,
      );
      return;
    }
    if (team.length) {
      showNotice(`Team boards can’t be locked; move ${names(team)} out of the folder first.`);
      return;
    }
    if (stubs.length) {
      showNotice(`Download ${names(stubs)} first so it can be encrypted here.`);
      return;
    }
    setLockPrompt({ mode: 'folder-set', id: f.id, name: f.name });
  };
  const folderLockEntries = (f: LibraryFolder): MenuEntry[] => {
    if (!f.lock) {
      return [
        {
          kind: 'action',
          label: 'Lock folder',
          icon: <LockIcon />,
          onSelect: () => startFolderLock(f),
        },
      ];
    }
    if (folderSessionKey(f.id)) {
      return [
        {
          kind: 'action',
          label: 'Lock',
          icon: <LockIcon />,
          onSelect: () => {
            relockFolder(f.id);
            if (currentFolder && isWithinFolder(meta, currentFolder, f.id)) setFolderSel('home');
            finishAction();
            bumpLocks();
          },
        },
        {
          kind: 'action',
          label: 'Remove lock',
          icon: <UnlockIcon />,
          onSelect: () => setLockPrompt({ mode: 'folder-remove', id: f.id, name: f.name }),
        },
      ];
    }
    return [
      {
        kind: 'action',
        label: 'Unlock',
        icon: <UnlockIcon />,
        onSelect: () => setLockPrompt({ mode: 'folder-open', id: f.id, name: f.name }),
      },
    ];
  };

  /** Remove local boards for good (no question asked — callers confirm). */
  const removeBoards = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      await onBoardDeleted(id);
      await deleteBoard(id);
    }
  }, []);
  const deleteBoards = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const label =
        ids.length === 1
          ? `Delete "${boards.find((b) => b.id === ids[0])?.name ?? 'board'}"?`
          : `Delete ${ids.length} boards?`;
      if (!window.confirm(`${label} This cannot be undone.`)) return;
      await removeBoards(ids);
      setSelection([]);
      setMultiSelect(false);
      await refresh();
    },
    [boards, refresh, removeBoards],
  );

  const deleteSelected = useCallback(() => deleteBoards(selection), [deleteBoards, selection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === 'Escape') {
        setSelection([]);
        setTeamSelection([]);
        setFolderSelection([]);
        setMultiSelect(false);
        setTagsOpen(false);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault();
        void deleteSelected();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && folderSelection.length) {
        e.preventDefault();
        void deleteSelectedFolders();
      } else if (e.key === 'Enter' && selection.length === 1) {
        requestOpen(selection[0]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // requestOpen is stable per render and only reads current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, deleteSelected, boards]);

  // ── Manual drag reorder ──

  const reorder = async (targetId: string, before: boolean) => {
    const dragged = dragIdRef.current;
    if (!dragged || dragged === targetId) return;
    const ids = merged.map((e) => e.board.id).filter((id) => id !== dragged);
    let ti = ids.indexOf(targetId);
    if (ti < 0) return;
    if (!before) ti += 1;
    ids.splice(ti, 0, dragged);
    const others = boards.map((b) => b.id).filter((id) => !ids.includes(id));
    await commitMeta(setBoardOrder(meta, [...ids, ...others]));
  };

  /** Board ids carried by a drag (multi-select aware). */
  const draggedIds = (e: React.DragEvent): string[] => {
    try {
      const raw = e.dataTransfer.getData('application/x-boardcache-ids');
      const ids = JSON.parse(raw) as string[];
      if (Array.isArray(ids) && ids.length) return ids.filter((x) => typeof x === 'string');
    } catch {
      /* fall through */
    }
    const single = e.dataTransfer.getData('text/plain');
    return single ? [single] : [];
  };

  const sideDropProps = (
    zone: string,
    apply: (ids: string[]) => void,
    applyFolder?: (folderId: string) => void,
  ) => ({
    onDragOver: (e: React.DragEvent) => {
      // eslint-disable-next-line react-hooks/refs -- event handler, not render
      if (!dragIdRef.current && !(dragFolderRef.current && applyFolder)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropZone((z) => (z === zone ? z : zone));
    },
    onDragLeave: () => setDropZone((z) => (z === zone ? null : z)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const folder = dragFolderRef.current;
      dragFolderRef.current = null;
      if (folder) {
        applyFolder?.(folder);
      } else {
        const ids = draggedIds(e);
        if (ids.length) apply(ids);
      }
      setDropZone(null);
      // eslint-disable-next-line react-hooks/refs -- event handler, not render
      clearDrag();
    },
  });

  const clearDrag = () => {
    dragIdRef.current = null;
    setDragId(null);
    setDropInfo(null);
  };

  // ── Action-bar helpers ──

  // Folder/tag organization applies to BOTH selection tracks — combined,
  // so a mixed multi-selection moves/tags local and team boards together.
  const orgSelection = [...selection, ...teamSelection];
  /** An action on the selection is the end of selecting: clear it and leave select mode. */
  const finishAction = () => {
    setSelection([]);
    setTeamSelection([]);
    setFolderSelection([]);
    setMultiSelect(false);
  };
  /** Move boards into a folder (null = Home). */
  const moveBoardsTo = async (ids: string[], folderId: string | null) => {
    const sealed = sealedAncestor(folderId);
    if (sealed) {
      showNotice(`Unlock “${sealed.name}” before moving boards into it.`);
      return;
    }
    await commitMeta(moveBoards(meta, ids, folderId));
    finishAction();
  };
  /** Move the whole selection — boards and folders — into a folder (null = Home).
   *  A folder never moves into itself or its own subtree (moveFolder refuses). */
  const moveSelectionTo = async (folderId: string | null) => {
    const sealed = sealedAncestor(folderId);
    if (sealed) {
      showNotice(`Unlock “${sealed.name}” before moving things into it.`);
      return;
    }
    let next = moveBoards(meta, orgSelection, folderId);
    for (const id of folderSelection) next = moveFolder(next, id, folderId);
    await commitMeta(next);
    finishAction();
  };
  /**
   * Delete folders with everything inside them: every subfolder, and every
   * local board filed anywhere below (user decision 2026-09-20). Team boards
   * belong to their room, not to a folder — those drop back to Home.
   */
  const deleteFolders = async (ids: string[]) => {
    const roots = ids.filter((id) => !ids.some((o) => o !== id && isWithinFolder(meta, id, o)));
    if (roots.length === 0) return;
    let next = meta;
    const inside = new Set<string>();
    let folderCountGone = 0;
    for (const id of roots) {
      folderCountGone += subtreeFolderIds(next, id).length;
      const r = deleteFolderTree(next, id);
      next = r.meta;
      for (const b of r.boardIds) inside.add(b);
    }
    const localIds = boards.filter((b) => inside.has(b.id)).map((b) => b.id);
    const teamCount = teamBoards.filter((b) => inside.has(b.id)).length;
    const names = roots.map((id) => folderById(meta, id)?.name ?? 'Folder');
    const what = [
      localIds.length === 1 ? '1 board' : `${localIds.length} boards`,
      folderCountGone === 1 ? '1 folder' : `${folderCountGone} folders`,
    ].join(' and ');
    const ok = await confirmDialog({
      title:
        roots.length === 1
          ? `Delete “${names[0]}” and everything in it?`
          : `Delete ${roots.length} folders and everything in them?`,
      body:
        `${what} will be deleted. This cannot be undone.` +
        (teamCount > 0
          ? ` ${teamCount === 1 ? '1 team board' : `${teamCount} team boards`} inside stay with the team and return to Home.`
          : ''),
      confirmLabel: roots.length === 1 ? 'Delete folder' : 'Delete folders',
    });
    if (!ok) return;
    if (currentFolder && !folderById(next, currentFolder)) setFolderSel('home');
    await removeBoards(localIds);
    await commitMeta(next);
    finishAction();
    await refresh();
  };
  const deleteSelectedFolders = () => deleteFolders(folderSelection);
  /** Local boards inside the selected folders (deep) — what Export acts on. */
  const boardsInSelectedFolders = () =>
    boards
      .filter((b) => !b.isTemplate)
      .map((b) => b.id)
      .filter((id) => {
        const f = meta.boardFolders[id];
        return f ? folderSelection.some((sel) => isWithinFolder(meta, f, sel)) : false;
      });
  // Tags: the popover stays open for several edits; closing it after a
  // change finishes the action. Closing without a change keeps the selection.
  const tagsTouched = useRef(false);

  const unionTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const id of orgSelection) {
      for (const tag of meta.boardTags[id] ?? []) {
        const key = tag.toLowerCase();
        if (!seen.has(key)) seen.set(key, tag);
      }
    }
    return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, teamSelection, meta.boardTags]);

  const addTag = async (raw: string) => {
    setTagDraft('');
    if (!raw.trim()) return;
    tagsTouched.current = true;
    await commitMeta(addTagToBoards(meta, orgSelection, raw));
  };

  // ── Marquee selection (Finder-style): drag on empty space selects, plain
  // background click clears. Shift/ctrl keeps the existing selection as base.
  const onMainPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Marquee is a MOUSE gesture. A touch (or pen) drag on the background is
    // a scroll — starting a marquee there selected boards by accident; touch
    // selection lives behind the multi-select toggle only.
    if (e.pointerType !== 'mouse') return;
    const t = e.target as HTMLElement;
    // Portaled children (select options, popovers, menus) bubble through the
    // React tree but live outside this element in the DOM — ignore them.
    if (!e.currentTarget.contains(t)) return;
    if (
      t.closest(
        '[data-board-id], [data-folder-id], .team-card, button, input, [role="combobox"], .lab-tags',
      )
    )
      return;
    if (!multiSelect) setTeamSelection([]);
    const additive = multiSelect || e.shiftKey || e.ctrlKey || e.metaKey;
    marqueeRef.current = {
      x0: e.clientX,
      y0: e.clientY,
      base: additive ? selection : [],
      folderBase: additive ? folderSelection : [],
      active: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMainPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const m = marqueeRef.current;
    if (!m) return;
    const dx = e.clientX - m.x0;
    const dy = e.clientY - m.y0;
    if (!m.active && Math.hypot(dx, dy) < 5) return;
    m.active = true;
    const left = Math.min(m.x0, e.clientX);
    const top = Math.min(m.y0, e.clientY);
    const width = Math.abs(dx);
    const height = Math.abs(dy);
    setMarqueeRect({ left, top, width, height });
    const hits: string[] = [];
    document.querySelectorAll<HTMLElement>('[data-board-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < left + width && r.right > left && r.top < top + height && r.bottom > top) {
        hits.push(el.dataset.boardId!);
      }
    });
    const merged = [...new Set([...m.base, ...hits])];
    setSelection((prev) =>
      prev.length === merged.length && merged.every((id) => prev.includes(id)) ? prev : merged,
    );
    const folderHits: string[] = [];
    document.querySelectorAll<HTMLElement>('[data-folder-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < left + width && r.right > left && r.top < top + height && r.bottom > top) {
        folderHits.push(el.dataset.folderId!);
      }
    });
    const mergedFolders = [...new Set([...m.folderBase, ...folderHits])];
    setFolderSelection((prev) =>
      prev.length === mergedFolders.length && mergedFolders.every((id) => prev.includes(id))
        ? prev
        : mergedFolders,
    );
  };

  const endMarquee = () => {
    const m = marqueeRef.current;
    marqueeRef.current = null;
    setMarqueeRect(null);
    // A plain background tap clears — except in multi-select mode, where a
    // stray tap must never wipe a selection in progress (Esc/toggle exit).
    if (m && !m.active && !multiSelect) {
      setSelection([]);
      setFolderSelection([]);
    }
  };

  /** Convert a local board into a team room (Team plan; server enforces). */
  const convertToTeam = async (id: string) => {
    const ok = await confirmDialog({
      title: 'Convert to a team board?',
      body:
        'Team boards are stored readable on the server so real-time collaboration can work — ' +
        'this board will leave end-to-end encryption. Its items and assets move into a new ' +
        'team room and the local copy is removed. Any member can duplicate it back to a ' +
        'private local board later.',
      confirmLabel: 'Convert',
    });
    if (!ok) return;
    const session = useSessionStore.getState();
    session.setExportBusy('Converting to team board');
    try {
      const { convertBoardToTeam, openTeamBoard } = await import('../../lib/sync/collab');
      const res = await convertBoardToTeam(id, (done, total) =>
        useSessionStore.getState().setExportProgress(total ? done / total : 1),
      );
      if (!res.ok) {
        const { showNotice } = await import('../../lib/notices');
        showNotice(res.error, { id: 'team-convert', kind: 'warn' });
        return;
      }
      await refresh();
      await openTeamBoard(res.teamId);
    } finally {
      useSessionStore.getState().setExportBusy(null);
    }
  };

  // ── Board context menu (right-click a card): entries built at open time
  // from the effective selection (state may not have applied yet).
  const buildBoardMenu = (ids: string[]): MenuEntry[] => {
    const single = ids.length === 1;
    const anyLocked = ids.some((id) => boards.find((b) => b.id === id)?.locked);
    const remoteIds = ids.filter((id) => boards.find((b) => b.id === id)?.remote);
    if (remoteIds.length > 0) {
      // Not-yet-downloaded boards only offer Download — every other action
      // needs (or would destroy) the local copy.
      return [
        {
          kind: 'action',
          label: remoteIds.length > 1 ? `Download ${remoteIds.length} boards` : 'Download',
          icon: <DownloadIcon />,
          onSelect: () => {
            void (async () => {
              for (const id of remoteIds) await downloadOne(id);
              setSelection([]);
            })();
          },
        },
      ];
    }
    const entries: MenuEntry[] = [];
    if (single) {
      entries.push({
        kind: 'action',
        label: 'Open',
        icon: <FolderOpenIcon />,
        onSelect: () => requestOpen(ids[0]!),
      });
      entries.push({
        kind: 'action',
        label: 'Rename',
        icon: <RenameIcon />,
        onSelect: () => setRenaming(ids[0]!),
      });
      if (signedIn) {
        // Publishing renders covers from the open canvas — open, then launch.
        entries.push({
          kind: 'action',
          label: 'Publish to Community',
          icon: <GlobeIcon />,
          disabled: anyLocked,
          onSelect: () => {
            void openBoard(ids[0]!).then((ok) => {
              if (ok) useCommunityPublish.getState().toggle(true);
            });
          },
        });
        entries.push({
          kind: 'action',
          label: 'Convert to Team Board',
          icon: <UsersIcon />,
          disabled: anyLocked,
          onSelect: () => void convertToTeam(ids[0]!),
        });
      }
    }
    entries.push({
      kind: 'action',
      label: ids.length > 1 ? `Duplicate ${ids.length} boards` : 'Duplicate',
      icon: <DuplicateIcon />,
      disabled: anyLocked, // duplication needs the decrypted document
      onSelect: () => {
        void (async () => {
          for (const id of ids) await duplicateBoard(id);
          finishAction();
          await refresh();
        })();
      },
    });
    entries.push({
      kind: 'submenu',
      label: 'Move to',
      icon: <FolderInputIcon />,
      children: folderOptions.map(
        (o): MenuEntry => ({
          kind: 'action',
          label: o.label,
          onSelect: () => void moveBoardsTo(ids, o.id === '__root' ? null : o.id),
        }),
      ),
    });
    entries.push({
      kind: 'action',
      label: 'Tags',
      icon: <TagIcon />,
      onSelect: () => setTagsOpen(true),
    });
    entries.push({
      kind: 'action',
      label: ids.length > 1 ? `Export ${ids.length} boards` : 'Export board',
      icon: <DownloadIcon />,
      onSelect: () => {
        void (async () => {
          const out = await exportBoardsFiles(ids);
          if (out) downloadBlob(out.blob, out.filename);
          finishAction();
        })();
      },
    });
    if (single) {
      const locked = boards.find((b) => b.id === ids[0])?.locked;
      const withFolder = Boolean(lockOf(ids[0]!));
      entries.push({
        kind: 'action',
        label: withFolder ? 'Locked with its folder' : locked ? 'Unlock board' : 'Lock board',
        icon: locked ? <UnlockIcon /> : <LockIcon />,
        disabled: withFolder,
        onSelect: () => startLock(ids[0]!),
      });
    }
    entries.push({ kind: 'separator' });
    entries.push({
      kind: 'action',
      label: 'Delete',
      danger: true,
      icon: <TrashIcon />,
      onSelect: () => void deleteBoards(ids),
    });
    return entries;
  };

  const templates = boards.filter((b) => b.isTemplate);
  const startFromTemplate = async (t: BoardSummary) => {
    const name = await promptText({
      title: 'New board from template',
      label: 'Name',
      placeholder: t.name,
      hint: `Creates a fresh board from “${t.name}” — the template stays untouched.`,
      confirmLabel: 'Create',
    });
    if (name === null) return;
    const { createBoardFromUserTemplate } = await import('../../lib/board/boardLibrary');
    await createBoardFromUserTemplate(t.id, name.trim() || t.name);
  };

  // ── Folders: Home holds top-level folders; every folder can hold folders. ──
  const askNewFolder = async () => {
    const name = await promptText({
      title: 'New folder',
      label: 'Folder name',
      placeholder: 'Folder name',
      confirmLabel: 'Create',
    });
    if (name === null || !name.trim()) return;
    const { meta: next, id } = createFolder(meta, name, currentFolder);
    await commitMeta(next);
    setFolderSel(id);
    setSideOpen(false); // phones: the drawer gives way to the new folder
  };
  const askRenameFolder = async (f: LibraryFolder) => {
    const next = await promptText({
      title: 'Rename folder',
      label: 'Folder name',
      initial: f.name,
      confirmLabel: 'Rename',
    });
    if (next !== null) await commitMeta(renameFolder(meta, f.id, next));
  };
  const askDeleteFolder = (f: LibraryFolder) => deleteFolders([f.id]);
  const buildFolderMenu = (f: LibraryFolder): MenuEntry[] => [
    { kind: 'action', label: 'Open', icon: <FolderOpenIcon />, onSelect: () => enterFolder(f.id) },
    {
      kind: 'action',
      label: 'Rename',
      icon: <RenameIcon />,
      onSelect: () => void askRenameFolder(f),
    },
    ...folderLockEntries(f),
    {
      kind: 'submenu',
      label: 'Move to',
      icon: <FolderInputIcon />,
      children: folderOptions
        .filter((o) => o.id === '__root' || !isWithinFolder(meta, o.id, f.id))
        .filter((o) => o.id === '__root' || !sealedAncestor(o.id))
        .map(
          (o): MenuEntry => ({
            kind: 'action',
            label: o.label,
            onSelect: () =>
              void commitMeta(moveFolder(meta, f.id, o.id === '__root' ? null : o.id)),
          }),
        ),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Delete',
      icon: <TrashIcon />,
      disabled: Boolean(sealedAncestor(f.id)),
      onSelect: () => void askDeleteFolder(f),
    },
  ];
  /** Dropping into a sealed folder is refused: there is no key to encrypt with. */
  const folderZone = (f: LibraryFolder) =>
    sideDropProps(
      `folder:${f.id}`,
      (ids) => {
        const sealed = sealedAncestor(f.id);
        if (sealed) showNotice(`Unlock “${sealed.name}” before moving boards into it.`);
        else void moveBoardsTo(ids, f.id);
      },
      (folderId) => {
        const sealed = sealedAncestor(f.id);
        if (sealed) showNotice(`Unlock “${sealed.name}” before moving folders into it.`);
        else void commitMeta(moveFolder(meta, folderId, f.id));
      },
    );
  /** A folder in the grid: click to go in, drop boards or folders on it. */
  const renderFolderTile = (f: LibraryFolder) => {
    const count = folderCount(f.id);
    const sub = childFolders(meta, f.id).length;
    const sealed = Boolean(sealedAncestor(f.id));
    return (
      <div
        key={f.id}
        className={`board-card folder-card${folderSelection.includes(f.id) ? ' selected' : ''}${dropZone === `folder:${f.id}` ? ' drop-target' : ''}`}
        data-testid="folder-card"
        data-folder-id={f.id}
        role="button"
        tabIndex={0}
        title={`${f.name} — double-click to open`}
        onClick={(e) => {
          if (longPress.claimClick()) return;
          const additive = multiSelect || e.shiftKey || e.ctrlKey || e.metaKey;
          // Phones: a plain tap opens (like boards); selection lives behind Select.
          // Tablets run the desktop index: a tap selects, a double tap opens.
          if (!additive && isPhoneViewport()) return enterFolder(f.id);
          toggleFolderSelect(f.id, additive);
        }}
        onDoubleClick={() => enterFolder(f.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') enterFolder(f.id);
        }}
        onContextMenu={(e) => {
          if (longPress.claimContextMenu(e)) return;
          e.preventDefault();
          if (!folderSelection.includes(f.id)) toggleFolderSelect(f.id, false);
          setCtxMenu({ x: e.clientX, y: e.clientY, entries: buildFolderMenu(f) });
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          longPress.handlers(`folder:${f.id}`).onPointerDown(e);
        }}
        draggable
        onDragStart={(e) => {
          if (longPress.blockDrag(e)) return;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('application/x-boardcache-folder', f.id);
          dragFolderRef.current = f.id;
        }}
        onDragEnd={() => {
          dragFolderRef.current = null;
          setDropZone(null);
        }}
        {...folderZone(f)}
      >
        <div className="board-thumb folder-thumb">
          <FolderIcon size={60} />
        </div>
        {f.lock && (
          <span
            className="folder-lock-badge"
            title={sealed ? 'Locked' : 'Unlocked for this session'}
            data-testid={sealed ? 'folder-locked-badge' : 'folder-unlocked-badge'}
          >
            {sealed ? <LockIcon size={13} /> : <UnlockIcon size={13} />}
          </span>
        )}
        <div className="board-meta">
          <span className="board-name folder-name">{f.name}</span>
          <span className="board-updated">
            {sealed
              ? 'Locked'
              : `${count === 1 ? '1 board' : `${count} boards`}${sub > 0 ? ` · ${sub === 1 ? '1 folder' : `${sub} folders`}` : ''}`}
          </span>
        </div>
      </div>
    );
  };
  /** Sidebar tree: a row per folder, indented by depth, subfolders under their parent. */
  const renderFolderRows = (parentId: string | null, depth: number): React.ReactNode =>
    childFolders(meta, parentId).map((f) => (
      <Fragment key={f.id}>
        <div
          className={`lib-side-row lib-folder${folderSel === f.id ? ' active' : ''}${dropZone === `folder:${f.id}` ? ' drop-target' : ''}`}
          data-testid={`library-folder-${f.name}`}
          style={depth ? { paddingLeft: 8 + depth * 14 } : undefined}
          {...folderZone(f)}
        >
          <button
            type="button"
            className="lib-row-main"
            onClick={() => {
              enterFolder(f.id);
              setSideOpen(false);
            }}
            onDoubleClick={() => void askRenameFolder(f)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY, entries: buildFolderMenu(f) });
            }}
            title="Double-click to rename"
          >
            <FolderIcon />
            <span className="lib-row-label">{f.name}</span>
          </button>
          <span className="lib-count" title={sealedAncestor(f.id) ? 'Locked' : undefined}>
            {sealedAncestor(f.id) ? <LockIcon size={12} /> : folderCount(f.id)}
          </span>
          <button
            type="button"
            className="lib-row-x"
            title="Delete folder and everything in it"
            aria-label={`Delete folder ${f.name}`}
            onClick={() => void askDeleteFolder(f)}
          >
            <CloseIcon />
          </button>
        </div>
        {renderFolderRows(f.id, depth + 1)}
      </Fragment>
    ));
  const crumbs = currentFolder ? folderPath(meta, currentFolder) : [];

  const renderCard = (board: BoardSummary) => {
    const selected = selection.includes(board.id);
    const manual = sortMode === 'manual';
    const thumbUrl =
      (resolved === 'dark' ? board.thumbnailDarkUrl : board.thumbnailLightUrl) ??
      board.thumbnailUrl;
    return (
      <div
        key={board.id}
        className={[
          'board-card',
          board.id === currentId ? 'current' : '',
          selected ? 'selected' : '',
          dragId === board.id ? 'dragging' : '',
          dropInfo?.id === board.id ? (dropInfo.before ? 'drop-before' : 'drop-after') : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid="board-card"
        data-board-id={board.id}
        {...longPress.handlers(`board:${board.id}`)}
        onClick={(e) => {
          if (longPress.claimClick()) return;
          const additive = multiSelect || e.shiftKey || e.ctrlKey || e.metaKey;
          // Phones: a plain tap opens the board (no double-tap); selection
          // lives behind the multi-select toggle. Tablets run the desktop index.
          if (!additive && isPhoneViewport()) return requestOpen(board.id);
          toggleSelect(board.id, additive);
        }}
        onDoubleClick={() => requestOpen(board.id)}
        onContextMenu={(e) => {
          if (longPress.claimContextMenu(e)) return;
          e.preventDefault();
          const ids = selection.includes(board.id) ? selection : [board.id];
          if (ids !== selection) setSelection(ids);
          setCtxMenu({ x: e.clientX, y: e.clientY, entries: buildBoardMenu(ids) });
        }}
        draggable
        onDragStart={(e) => {
          if (longPress.blockDrag(e)) return;
          // Always draggable: onto sidebar folders/tags to organize, and (in
          // manual sort) between cards to reorder.
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', board.id);
          const ids = selection.includes(board.id) ? selection : [board.id];
          e.dataTransfer.setData('application/x-boardcache-ids', JSON.stringify(ids));
          dragIdRef.current = board.id;
          setDragId(board.id);
        }}
        onDragOver={(e) => {
          if (!manual || dragIdRef.current === board.id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          const before = e.clientX < rect.left + rect.width / 2;
          setDropInfo((prev) =>
            prev?.id === board.id && prev.before === before ? prev : { id: board.id, before },
          );
        }}
        onDrop={(e) => {
          if (!manual) return;
          e.preventDefault();
          void reorder(board.id, dropInfo?.before ?? true);
          clearDrag();
        }}
        onDragEnd={clearDrag}
      >
        <div className="board-thumb" title={`${board.name} — double-click to open`}>
          {board.locked ? (
            <span className="board-thumb-locked" data-testid="board-locked-badge">
              <LockIcon size={26} />
            </span>
          ) : thumbUrl ? (
            <img src={thumbUrl} alt="" draggable={false} />
          ) : (
            <span className="board-thumb-empty">∅</span>
          )}
        </div>
        <div className="board-meta">
          {renaming === board.id ? (
            <input
              autoFocus
              defaultValue={board.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={async (e) => {
                await renameBoardRecord(board.id, e.target.value);
                await markBoardDirty(board.id);
                setRenaming(null);
                await refresh();
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <button
              type="button"
              className="board-name"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setRenaming(board.id);
              }}
              title="Double-click to rename"
            >
              {board.name}
            </button>
          )}
          <span className="board-updated">
            {formatWhen(board.updatedAt)}
            {board.size != null && !board.locked && (
              <span className="board-size" data-testid="board-size">
                {' · '}
                {formatBytes(board.size)}
              </span>
            )}
          </span>
          {(meta.boardTags[board.id]?.length ?? 0) > 0 && (
            <span className="board-tags">
              {meta.boardTags[board.id]!.map((t) => (
                <span className="board-tag" key={t}>
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="board-card-actions">
          {board.locked && (
            <span className="board-lock-chip" title="Password-locked (encrypted on this device)">
              <LockIcon size={11} /> Locked
            </span>
          )}
          {board.remote ? (
            <button
              type="button"
              className="board-sync board-download"
              data-testid="board-download"
              disabled={downloadingIds.has(board.id)}
              onClick={(e) => {
                e.stopPropagation();
                void downloadOne(board.id);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              title="Listed from your account — click to download this board and its media to this device"
            >
              {downloadingIds.has(board.id)
                ? `Downloading ${Math.round((downloadingIds.get(board.id) ?? 0) * 100)}%`
                : '⬇ Download'}
            </button>
          ) : (
            <button
              type="button"
              className={`board-sync${board.synced ? ' on' : ''}${syncingBoards[board.id] ? ' busy' : ''}`}
              data-testid="board-sync-toggle"
              onClick={async (e) => {
                e.stopPropagation();
                if (!signedIn) {
                  useSessionStore.getState().setSyncDialogOpen(true);
                  return;
                }
                if (board.synced) await disableBoardSync(board.id);
                else await enableBoardSync(board.id);
                await refresh();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              title={
                board.synced
                  ? signedIn
                    ? 'Synced to your account — click to stop syncing'
                    : 'Sync is paused — sign in to resume syncing this board'
                  : signedIn
                    ? 'Sync this board to your account'
                    : 'Sign in to sync this board'
              }
            >
              {syncingBoards[board.id]
                ? '☁ Syncing'
                : board.synced
                  ? signedIn
                    ? '☁ Synced'
                    : '☁ Paused'
                  : '☁ Sync'}
            </button>
          )}
        </div>
      </div>
    );
  };

  const refreshTeamBoards = useCallback(async () => {
    if (!signedIn) {
      setTeamBoards([]);
      return;
    }
    const rows = await apiFetch('/api/team', { credentials: 'include' })
      .then(async (r) => (r.ok ? ((await r.json()) as { boards: TeamBoardRow[] }).boards : []))
      .catch(() => [] as TeamBoardRow[]);
    setTeamBoards(rows);
  }, [signedIn]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!signedIn) {
        if (!cancelled) setTeamBoards([]);
        return;
      }
      const rows = await apiFetch('/api/team', { credentials: 'include' })
        .then(async (r) => (r.ok ? ((await r.json()) as { boards: TeamBoardRow[] }).boards : []))
        .catch(() => [] as TeamBoardRow[]);
      if (!cancelled) setTeamBoards(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  // Team board actions (server-side; parity with local controls where they
  // make sense — rename for members, delete for owners, guest link copy).
  const [teamRenaming, setTeamRenaming] = useState<string | null>(null);
  const renameTeamBoard = async (id: string, name: string) => {
    setTeamRenaming(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    await apiFetch(`/api/team/${id}/name`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => {});
    await refreshTeamBoards();
  };
  const deleteTeamBoards = async (ids: string[]) => {
    const names = teamBoards.filter((b) => ids.includes(b.id)).map((b) => b.name);
    const ok = window.confirm(
      `Delete ${names.length === 1 ? `“${names[0]}”` : `${names.length} team boards`} for ALL members? This also removes the boards' media from the server.`,
    );
    if (!ok) return;
    for (const id of ids) {
      await apiFetch(`/api/team/${id}`, { method: 'DELETE', credentials: 'include' }).catch(
        () => {},
      );
    }
    finishAction();
    await refreshTeamBoards();
  };
  const teamMenuEntries = (board: TeamBoardRow): MenuEntry[] => [
    { kind: 'action', label: 'Open', icon: <FolderOpenIcon />, onSelect: () => openTeam(board.id) },
    {
      kind: 'action',
      label: 'Rename',
      icon: <RenameIcon />,
      onSelect: () => setTeamRenaming(board.id),
    },
    {
      kind: 'action',
      label: 'Duplicate as local board',
      icon: <DuplicateIcon />,
      onSelect: () => {
        void (async () => {
          useSessionStore.getState().setExportBusy('Duplicating team board');
          try {
            await duplicateTeamBoardAsLocal(board.id);
          } finally {
            useSessionStore.getState().setExportBusy(null);
          }
          await refresh();
        })();
      },
    },
    ...(board.guestSlug
      ? [
          {
            kind: 'action' as const,
            label: 'Copy guest link',
            icon: <LinkIcon />,
            onSelect: () => {
              void navigator.clipboard.writeText(`${location.origin}/guest/${board.guestSlug}`);
            },
          },
        ]
      : []),
    ...(board.role === 'owner'
      ? [
          {
            kind: 'action' as const,
            label: 'Delete for everyone',
            icon: <TrashIcon />,
            danger: true,
            onSelect: () => void deleteTeamBoards([board.id]),
          },
        ]
      : []),
  ];

  /** Name-first creation: the custom prompt, null = user cancelled. */
  const askBoardName = (kind: 'board' | 'team board') =>
    promptText({
      title: 'Name your board',
      label: 'Name',
      placeholder: kind === 'team board' ? 'Team board' : 'Untitled board',
      confirmLabel: 'Create',
    });

  /** A board made while a folder is open belongs to that folder. The move
   *  lands after the board opens (creation switches to the canvas), which is
   *  fine: the index reloads its meta when it comes back. A sealed folder is
   *  never "open", so no key question arises here. */
  const fileInOpenFolder = async (boardId: string) => {
    if (!currentFolder || sealedAncestor(currentFolder)) return;
    await commitMeta(moveBoards(meta, [boardId], currentFolder));
  };

  // ── .boardcache files dropped on the index ──
  // They import into the folder being browsed, with the app-wide progress
  // overlay saying which board is being written and how far along it is.
  const BOARD_FILE_RE = /\.(boardcache|refboard)(\.enc)?$|\.zip$/i;
  const [fileDropOver, setFileDropOver] = useState(false);
  const fileDropDepth = useRef(0);
  const draggingFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const importDroppedFiles = async (dropped: File[]) => {
    const files = dropped.filter((f) => BOARD_FILE_RE.test(f.name));
    if (!files.length) {
      await confirmDialog({
        title: 'Nothing to import',
        body: 'Drop .boardcache files (or a backup .zip) here to add them to this folder.',
        confirmLabel: 'OK',
      });
      return;
    }
    const session = useSessionStore.getState();
    const errors: string[] = [];
    session.setExportBusy('Reading boards');
    session.setExportProgress(null);
    try {
      const rows: ImportRow[] = [];
      for (const file of files) {
        let blob: Blob = file;
        try {
          if (await isEncryptedBackup(blob)) {
            session.setExportBusy(null);
            const passphrase = await promptText({
              title: 'Encrypted board file',
              label: 'Passphrase',
              hint: `${file.name} was exported with a passphrase.`,
              confirmLabel: 'Unlock',
            });
            session.setExportBusy('Reading boards');
            if (!passphrase) continue;
            try {
              blob = await decryptBackup(blob, passphrase);
            } catch {
              errors.push(`${file.name}: wrong passphrase (or the file is corrupted)`);
              continue;
            }
          }
          const entries = await collectBackupEntries(blob, file.name.replace(/\.enc$/i, ''));
          rows.push(...(await planImport(entries)));
        } catch (err) {
          errors.push(`${file.name}: ${err instanceof Error ? err.message : 'unreadable file'}`);
        }
      }
      if (rows.length) {
        const res = await runImport(
          rows,
          rows.map(() => 'keep'),
          (step) => {
            session.setExportBusy(
              rows.length > 1
                ? `Importing ${step.name} (${step.index + 1} of ${step.count})`
                : `Importing ${step.name}`,
            );
            session.setExportProgress(step.fraction);
          },
        );
        errors.push(...res.errors);
        // Into the folder being browsed (Home needs nothing). One write for
        // the batch, on the stored copy rather than this render's.
        if (res.importedIds.length && currentFolder && !sealedAncestor(currentFolder)) {
          await commitMeta(moveBoards(await loadLibraryMeta(), res.importedIds, currentFolder));
        }
        await refresh();
      }
    } finally {
      session.setExportBusy(null);
      session.setExportProgress(null);
    }
    if (errors.length) {
      await confirmDialog({
        title: errors.length === 1 ? 'One file did not import' : 'Some files did not import',
        body: errors.join('\n'),
        confirmLabel: 'OK',
      });
    }
  };
  // A file dropped anywhere else on the index must not navigate the page
  // to it; only the grid area is the drop zone.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  const createNamedBoard = async () => {
    const name = await askBoardName('board');
    if (name === null) return;
    try {
      const id = await createBoard(name.trim() || 'Untitled board');
      await fileInOpenFolder(id);
    } catch (err) {
      // A storage failure here used to vanish into the console: the dialog
      // closed and nothing happened.
      await confirmDialog({
        title: 'Couldn’t create the board',
        body: `${err instanceof Error ? err.message : String(err)}. Boards are kept in this browser’s storage; private browsing or a full disk can refuse it.`,
        confirmLabel: 'OK',
      });
    }
  };

  const createTeamBoard = async () => {
    const name = await askBoardName('team board');
    if (name === null) return;
    const res = await apiFetch('/api/team', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: name.trim() || 'Team board' }),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(error ?? 'Couldn’t create the team board.');
      return;
    }
    const { id } = (await res.json()) as { id: string };
    await fileInOpenFolder(id);
    const { openTeamBoard } = await import('../../lib/sync/collab');
    await openTeamBoard(id);
  };

  const openTeam = (id: string) => {
    void import('../../lib/sync/collab').then((m) => m.openTeamBoard(id));
  };

  const renderTeamCard = (board: TeamBoardRow) => (
    <div
      key={board.id}
      className={`board-card team-card${teamSelection.includes(board.id) ? ' selected' : ''}`}
      data-testid="team-board-card"
      {...longPress.handlers(`team:${board.id}`)}
      onClick={(e) => {
        if (longPress.claimClick()) return;
        const additive = multiSelect || e.shiftKey || e.ctrlKey || e.metaKey;
        if (!additive && isPhoneViewport()) return openTeam(board.id);
        toggleTeamSelect(board.id, additive);
      }}
      onDoubleClick={() => openTeam(board.id)}
      onContextMenu={(e) => {
        if (longPress.claimContextMenu(e)) return;
        e.preventDefault();
        if (!teamSelection.includes(board.id)) setTeamSelection([board.id]);
        setCtxMenu({ x: e.clientX, y: e.clientY, entries: teamMenuEntries(board) });
      }}
      title="Double-click to open (live team board)"
      draggable
      onDragStart={(e) => {
        if (longPress.blockDrag(e)) return;
        // Draggable onto sidebar folders/tags — same organization as local
        // boards (stored per device; the server never sees it).
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', board.id);
        const ids = teamSelection.includes(board.id) ? teamSelection : [board.id];
        e.dataTransfer.setData('application/x-boardcache-ids', JSON.stringify(ids));
        dragIdRef.current = board.id;
        setDragId(board.id);
      }}
      onDragEnd={clearDrag}
    >
      <TeamThumb boardId={board.id} theme={resolved} version={board.updatedAt} />
      <div className="board-meta">
        {teamRenaming === board.id ? (
          <input
            autoFocus
            defaultValue={board.name}
            data-testid="team-rename-input"
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => void renameTeamBoard(board.id, e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setTeamRenaming(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="board-name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              openTeam(board.id);
            }}
            title="Double-click to open"
          >
            {board.name}
          </button>
        )}
        <span className="board-updated">{formatWhen(board.updatedAt)}</span>
        {(meta.boardTags[board.id]?.length ?? 0) > 0 && (
          <span className="board-tags">
            {meta.boardTags[board.id]!.map((t) => (
              <span className="board-tag" key={t}>
                {t}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="board-card-actions">
        <span className="board-sync on team-badge" data-testid="team-board-badge">
          <UsersIcon size={11} /> Team Board
        </span>
      </div>
    </div>
  );

  // Signed in, the tile asks Local vs Team in a proper dialog (a dropdown
  // reads oddly hanging off a card); signed out it just creates locally.
  const [newBoardAsk, setNewBoardAsk] = useState(false);
  const newBoardTile = (
    <button
      type="button"
      className="new-board-card"
      data-testid="new-board-card"
      onClick={() => {
        if (signedIn) setNewBoardAsk(true);
        else void createNamedBoard();
      }}
    >
      <span className="new-board-plus">+</span>
      <span className="new-board-label">New Board</span>
    </button>
  );

  return (
    <div className="library-screen" data-testid="library-screen">
      <header className="library-header">
        <div className="library-header-left">
          <UiTooltip label="Folders & tags">
            <button
              type="button"
              className="library-menu-btn"
              onClick={() => setSideOpen(true)}
              aria-label="Folders and tags"
              data-testid="library-menu-btn"
            >
              <HamburgerIcon size={18} />
            </button>
          </UiTooltip>
          <UiTooltip label={sideCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
            <button
              type="button"
              className="library-icon-btn library-side-toggle header-mobile-hidden"
              aria-label={sideCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-pressed={!sideCollapsed}
              data-testid="library-sidebar-toggle"
              onClick={toggleSidebar}
            >
              <PanelLeftIcon size={16} />
            </button>
          </UiTooltip>
        </div>
        <img
          src={resolved === 'dark' ? '/logo-dark.svg' : '/logo.svg'}
          alt="boardCache"
          className="library-logo"
        />
        <div className="library-actions">
          <span className="header-mobile-hidden">
            <SyncStatus />
          </span>
          <UiTooltip label="Settings (profile, plan, appearance)">
            <button
              type="button"
              className="library-icon-btn header-mobile-hidden"
              data-testid="library-settings"
              aria-label="Settings"
              onClick={() => useSessionStore.getState().setSettingsOpen(true)}
            >
              <GearIcon size={16} />
            </button>
          </UiTooltip>
          <UiTooltip label="Lock screen">
            <button
              type="button"
              className="library-theme-toggle"
              onClick={() => void useLockScreenStore.getState().requestLock()}
              aria-label="Lock screen"
              data-testid="lock-screen-toggle"
            >
              <LockIcon />
            </button>
          </UiTooltip>
          <UiTooltip
            label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme (System: Settings → Theme)`}
          >
            <button
              type="button"
              className="library-theme-toggle"
              onClick={() =>
                useSessionStore.getState().setTheme(resolved === 'dark' ? 'light' : 'dark')
              }
              aria-label="Toggle light/dark theme"
              data-testid="theme-toggle"
            >
              {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </UiTooltip>
        </div>
      </header>

      <div className={`library-body${sideCollapsed ? ' side-collapsed' : ''}`}>
        {sideOpen && (
          <div
            className="library-side-backdrop"
            data-testid="library-side-backdrop"
            onClick={() => setSideOpen(false)}
          />
        )}
        <aside
          className={`library-sidebar${sideOpen ? ' open' : ''}`}
          data-testid="library-sidebar"
        >
          <div className="lib-side-navgroup">
            <button
              type="button"
              className={`lib-side-nav${folderSel === 'home' ? ' active' : ''}${dropZone === 'folder:home' ? ' drop-target' : ''}`}
              data-testid="library-side-myboards"
              onClick={() => {
                setFolderSel('home');
                setSideOpen(false);
              }}
              {...sideDropProps(
                'folder:home',
                (ids) => void moveBoardsTo(ids, null),
                (folderId) => void commitMeta(moveFolder(meta, folderId, null)),
              )}
            >
              <HomeIcon size={16} /> Home
              <span className="lib-count">
                {boards.filter((b) => !b.isTemplate).length + teamBoards.length}
              </span>
            </button>
            <button
              type="button"
              className={`lib-side-nav${folderSel === 'all' ? ' active' : ''}`}
              data-testid="library-folder-all"
              onClick={() => {
                setFolderSel('all');
                setSideOpen(false);
              }}
            >
              <BoardsIcon size={16} /> All Boards
            </button>
            <button
              type="button"
              className={`lib-side-nav${folderSel === 'templates' ? ' active' : ''}`}
              data-testid="library-side-templates"
              onClick={() => {
                setFolderSel('templates');
                setSideOpen(false);
              }}
            >
              <TemplateIcon size={16} /> My Templates
              <span className="lib-count">{templates.length}</span>
            </button>
            {communityReady && (
              <button
                type="button"
                className="lib-side-nav"
                data-testid="library-side-community"
                onClick={() => {
                  setSideOpen(false);
                  // Always land on the community HOME — a stale profile/detail
                  // sub-route from the last visit must not stick.
                  useSessionStore.getState().setCommunityRoute(null);
                  useSessionStore.getState().setView('community');
                }}
              >
                <GlobeIcon size={16} /> Community
              </button>
            )}
          </div>
          <div className="lib-side-head">Folders</div>
          {renderFolderRows(null, 0)}
          <button
            type="button"
            className="lib-side-add"
            data-testid="library-new-folder"
            title={
              currentFolder
                ? `New folder inside “${folderById(meta, currentFolder)?.name}”`
                : undefined
            }
            onClick={() => void askNewFolder()}
          >
            + New folder
          </button>

          {tagCounts.length > 0 && (
            <>
              <div className="lib-side-head lib-side-subhead">
                <span>Tags</span>
                {tagSel.length > 0 && (
                  <button type="button" className="lib-clear" onClick={() => setTagSel([])}>
                    Clear
                  </button>
                )}
              </div>
              {tagCounts.map((t) => {
                const active = tagSel.some((s) => s.toLowerCase() === t.label.toLowerCase());
                return (
                  <button
                    key={t.label}
                    type="button"
                    className={`lib-side-row lib-tag${active ? ' active' : ''}${dropZone === `tag:${t.label}` ? ' drop-target' : ''}`}
                    data-testid={`library-tag-${t.label}`}
                    {...sideDropProps(
                      `tag:${t.label}`,
                      (ids) => void commitMeta(addTagToBoards(meta, ids, t.label)),
                    )}
                    onClick={() =>
                      setTagSel((sel) =>
                        active
                          ? sel.filter((s) => s.toLowerCase() !== t.label.toLowerCase())
                          : [...sel, t.label],
                      )
                    }
                  >
                    <span className="lib-row-label">{t.label}</span>
                    <span className="lib-count">{t.count}</span>
                  </button>
                );
              })}
            </>
          )}
          <div className="lib-side-actions">
            <SyncStatus testId="sync-status-drawer" />
            <button
              type="button"
              className="lib-side-action"
              data-testid="library-side-backup"
              onClick={() => {
                setSideOpen(false);
                useSessionStore.getState().setSettingsSection('export');
                useSessionStore.getState().setSettingsOpen(true);
              }}
            >
              <ExportIcon size={15} /> Backup
            </button>
            <button
              type="button"
              className="lib-side-action"
              data-testid="library-side-import"
              onClick={() => {
                setSideOpen(false);
                useSessionStore.getState().setSettingsSection('import');
                useSessionStore.getState().setSettingsOpen(true);
              }}
            >
              <DownloadIcon size={15} /> Import
            </button>
            <button
              type="button"
              className="lib-side-action lib-side-action-last"
              data-testid="library-side-settings"
              onClick={() => {
                setSideOpen(false);
                useSessionStore.getState().setSettingsOpen(true);
              }}
            >
              <GearIcon size={15} /> Settings
            </button>
          </div>
        </aside>

        <div
          className={`library-main${fileDropOver ? ' file-drop-over' : ''}`}
          data-testid="library-main"
          onPointerDown={onMainPointerDown}
          onPointerMove={onMainPointerMove}
          onPointerUp={endMarquee}
          onPointerCancel={endMarquee}
          onDragEnter={(e) => {
            if (!draggingFiles(e)) return;
            e.preventDefault();
            fileDropDepth.current += 1;
            setFileDropOver(true);
          }}
          onDragOver={(e) => {
            if (!draggingFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={(e) => {
            if (!draggingFiles(e)) return;
            fileDropDepth.current = Math.max(0, fileDropDepth.current - 1);
            if (fileDropDepth.current === 0) setFileDropOver(false);
          }}
          onDrop={(e) => {
            if (!draggingFiles(e)) return;
            e.preventDefault();
            fileDropDepth.current = 0;
            setFileDropOver(false);
            void importDroppedFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="library-sticky">
            <div className="library-toolbar" data-testid="library-action-bar">
              <div className="library-toolbar-info">
                <div className="lab-search">
                  <UiTooltip label="Search boards">
                    <button
                      type="button"
                      aria-label="Search boards"
                      aria-expanded={searchOpen || search !== ''}
                      data-testid="library-search-btn"
                      onClick={() => setSearchOpen((o) => !o)}
                    >
                      <SearchIcon size={15} />
                    </button>
                  </UiTooltip>
                  {(searchOpen || search !== '') && (
                    <input
                      className="library-search"
                      value={search}
                      autoFocus
                      placeholder="Search boards"
                      data-testid="library-search"
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Escape') {
                          setSearch('');
                          setSearchOpen(false);
                        }
                      }}
                      onBlur={() => {
                        if (!search) setSearchOpen(false);
                      }}
                    />
                  )}
                  {search.trim() !== '' && (
                    <button
                      type="button"
                      className="lab-deep-search"
                      data-testid="library-deep-search"
                      title="Full-content search: text, PDFs, OCR, transcripts — every downloaded board"
                      onClick={() => {
                        const s = useSessionStore.getState();
                        s.setBoardSearchPrefill(search.trim());
                        s.setBoardSearchOpen(true);
                      }}
                    >
                      Search inside boards for “{search.trim()}” →
                    </button>
                  )}
                </div>
                <UiTooltip label="Filter & sort">
                  <button
                    type="button"
                    className={`lab-filter-toggle${filtersOpen ? ' active' : ''}`}
                    aria-label="Filter and sort"
                    aria-expanded={filtersOpen}
                    data-testid="lab-filter-toggle"
                    onClick={() => setFiltersOpen((v) => !v)}
                  >
                    <FilterIcon size={15} />
                  </button>
                </UiTooltip>
                <div className={`lab-filter-selects${filtersOpen ? ' open' : ''}`}>
                  <UiSelect
                    value={statusFilter}
                    ariaLabel="Filter boards by status"
                    testId="library-status"
                    options={[
                      { value: 'all', label: 'All boards' },
                      { value: 'synced', label: '☁ Synced' },
                      { value: 'local', label: 'On this device' },
                      { value: 'team', label: 'Team' },
                      { value: 'locked', label: 'Locked' },
                    ]}
                    onChange={(v) => {
                      const f = v as StatusFilter;
                      setStatusFilter(f);
                      savePref(STATUS_KEY, f);
                    }}
                  />
                  <UiSelect
                    value={sortMode}
                    ariaLabel="Sort boards"
                    testId="library-sort"
                    options={[
                      { value: 'date', label: 'Recent' },
                      { value: 'name', label: 'Name' },
                      { value: 'manual', label: 'Manual' },
                    ]}
                    onChange={(v) => {
                      const mode = v as SortMode;
                      setSortMode(mode);
                      savePref(SORT_KEY, mode);
                    }}
                  />
                </div>
                <div className="library-view-switch" role="group" aria-label="View">
                  {(
                    [
                      { mode: 'compact', icon: <GridSmallIcon size={15} /> },
                      { mode: 'cards', icon: <GridIcon size={15} /> },
                      { mode: 'list', icon: <ListIcon size={15} /> },
                    ] as const
                  )
                    .map((v) => ({
                      ...v,
                      label: LIBRARY_VIEWS.find((o) => o.value === v.mode)!.label,
                    }))
                    .map((v) => (
                      <UiTooltip key={v.mode} label={v.label}>
                        <button
                          type="button"
                          className={viewMode === v.mode ? 'active' : ''}
                          aria-pressed={viewMode === v.mode}
                          aria-label={v.label}
                          data-testid={`library-view-${v.mode}`}
                          onClick={() => {
                            setViewMode(v.mode);
                            saveLibraryView(v.mode);
                          }}
                        >
                          {v.icon}
                        </button>
                      </UiTooltip>
                    ))}
                </div>
                <UiTooltip
                  label={multiSelect ? 'Exit multi-select (Esc)' : 'Select multiple boards'}
                >
                  <button
                    type="button"
                    className={multiSelect ? 'lab-multiselect active' : 'lab-multiselect'}
                    aria-pressed={multiSelect}
                    data-testid="library-multiselect"
                    onClick={() => {
                      if (multiSelect) {
                        setSelection([]);
                        setTeamSelection([]);
                      }
                      setMultiSelect((m) => !m);
                    }}
                  >
                    <CheckSquareIcon size={15} /> <span className="lib-label">Select</span>
                  </button>
                </UiTooltip>
                {(selection.length + teamSelection.length + folderSelection.length > 0 ||
                  multiSelect) && (
                  <span className="lab-count">
                    {selection.length + teamSelection.length + folderSelection.length} selected
                  </span>
                )}
              </div>
              {/* Selection actions only exist while something is selected. */}
              <div className="library-toolbar-actions">
                {teamSelection.length > 0 && (
                  <>
                    <button
                      type="button"
                      data-testid="team-lib-rename"
                      title="Rename"
                      disabled={teamSelection.length !== 1}
                      onClick={() => setTeamRenaming(teamSelection[0]!)}
                    >
                      <RenameIcon size={14} /> <span className="lib-label">Rename</span>
                    </button>
                    <button
                      type="button"
                      data-testid="team-lib-duplicate"
                      title="Copies the board (and its media) to a local board on this device"
                      onClick={async () => {
                        useSessionStore.getState().setExportBusy('Duplicating team board');
                        try {
                          for (const id of teamSelection) await duplicateTeamBoardAsLocal(id);
                        } finally {
                          useSessionStore.getState().setExportBusy(null);
                        }
                        finishAction();
                        await refresh();
                      }}
                    >
                      <DuplicateIcon size={14} /> <span className="lib-label">Duplicate</span>
                    </button>
                    <button
                      type="button"
                      data-testid="team-lib-export"
                      title="Export (.boardcache, several as a zip)"
                      onClick={() => {
                        void (async () => {
                          useSessionStore.getState().setExportBusy('Exporting team board');
                          try {
                            const out = await exportTeamBoardsFiles(teamSelection);
                            if (out) downloadBlob(out.blob, out.filename);
                          } finally {
                            useSessionStore.getState().setExportBusy(null);
                          }
                          finishAction();
                        })();
                      }}
                    >
                      <DownloadIcon size={14} /> <span className="lib-label">Export</span>
                    </button>
                    <button
                      type="button"
                      data-testid="team-lib-delete"
                      disabled={teamSelection.some(
                        (id) => teamBoards.find((b) => b.id === id)?.role !== 'owner',
                      )}
                      title="Owners only — deletes the board for every member"
                      onClick={() => void deleteTeamBoards(teamSelection)}
                    >
                      <TrashIcon size={14} /> <span className="lib-label">Delete</span>
                    </button>
                  </>
                )}
                {/* Actions appear once something IS selected — arming select
                  mode alone keeps the toolbar clean ("0 selected" is the
                  only feedback). */}
                {selection.length > 0 && (
                  <>
                    <button
                      type="button"
                      data-testid="library-rename"
                      title="Rename"
                      disabled={selection.length !== 1}
                      onClick={() => setRenaming(selection[0]!)}
                    >
                      <RenameIcon size={14} /> <span className="lib-label">Rename</span>
                    </button>
                    <button
                      type="button"
                      data-testid="library-duplicate"
                      title="Duplicate"
                      disabled={selection.length === 0}
                      onClick={async () => {
                        for (const id of selection) await duplicateBoard(id);
                        finishAction();
                        await refresh();
                      }}
                    >
                      <DuplicateIcon size={14} /> <span className="lib-label">Duplicate</span>
                    </button>
                    {selection.some((id) => boards.find((b) => b.id === id)?.remote) && (
                      <button
                        type="button"
                        data-testid="library-download-selected"
                        title="Download the selected synced boards to this device"
                        onClick={() => {
                          void (async () => {
                            const remote = selection.filter(
                              (id) => boards.find((b) => b.id === id)?.remote,
                            );
                            for (const id of remote) await downloadOne(id);
                            finishAction();
                          })();
                        }}
                      >
                        <CloudDownloadIcon size={14} />{' '}
                        <span className="lib-label">
                          Download{' '}
                          {selection.filter((id) => boards.find((b) => b.id === id)?.remote).length}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="library-export"
                      title="Export (.boardcache, several as a zip)"
                      disabled={selection.length === 0}
                      onClick={() => {
                        void (async () => {
                          const out = await exportBoardsFiles(selection);
                          if (out) downloadBlob(out.blob, out.filename);
                          finishAction();
                        })();
                      }}
                    >
                      <DownloadIcon size={14} /> <span className="lib-label">Export</span>
                    </button>
                    {signedIn && (
                      <button
                        type="button"
                        data-testid="library-publish"
                        title="Publish to the community"
                        disabled={
                          selection.length !== 1 ||
                          Boolean(boards.find((b) => b.id === selection[0])?.locked)
                        }
                        onClick={() => {
                          void openBoard(selection[0]!).then((ok) => {
                            if (ok) useCommunityPublish.getState().toggle(true);
                          });
                        }}
                      >
                        <GlobeIcon size={14} /> <span className="lib-label">Publish</span>
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="library-lock"
                      title={
                        selection.length === 1 && lockOf(selection[0]!)
                          ? 'Locked with its folder'
                          : 'Lock / unlock'
                      }
                      disabled={selection.length !== 1 || Boolean(lockOf(selection[0]!))}
                      onClick={() => startLock(selection[0]!)}
                    >
                      {boards.find((b) => b.id === selection[0])?.locked ? (
                        <>
                          <UnlockIcon size={14} /> <span className="lib-label">Unlock</span>
                        </>
                      ) : (
                        <>
                          <LockIcon size={14} /> <span className="lib-label">Lock</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      data-testid="library-delete"
                      title="Delete"
                      disabled={selection.length === 0}
                      onClick={() => void deleteSelected()}
                    >
                      <TrashIcon size={14} /> <span className="lib-label">Delete</span>
                    </button>
                  </>
                )}
                {folderSelection.length > 0 && orgSelection.length === 0 && (
                  <>
                    <button
                      type="button"
                      data-testid="library-folder-open"
                      title="Open folder"
                      disabled={folderSelection.length !== 1}
                      onClick={() => enterFolder(folderSelection[0]!)}
                    >
                      <FolderOpenIcon size={14} /> <span className="lib-label">Open</span>
                    </button>
                    <button
                      type="button"
                      data-testid="library-folder-rename"
                      title="Rename folder"
                      disabled={folderSelection.length !== 1}
                      onClick={() => {
                        const f = folderById(meta, folderSelection[0]!);
                        if (f) void askRenameFolder(f);
                      }}
                    >
                      <RenameIcon size={14} /> <span className="lib-label">Rename</span>
                    </button>
                    {folderSelection.length === 1 &&
                      (() => {
                        const f = folderById(meta, folderSelection[0]!);
                        if (!f) return null;
                        const sealed = f.lock && !folderSessionKey(f.id);
                        return (
                          <button
                            type="button"
                            data-testid="library-folder-lock"
                            title={
                              !f.lock
                                ? 'Lock folder'
                                : sealed
                                  ? 'Unlock folder'
                                  : 'Lock folder (keep the password)'
                            }
                            onClick={() => {
                              if (!f.lock) startFolderLock(f);
                              else if (sealed)
                                setLockPrompt({ mode: 'folder-open', id: f.id, name: f.name });
                              else {
                                relockFolder(f.id);
                                finishAction();
                                bumpLocks();
                              }
                            }}
                          >
                            {f.lock && sealed ? <UnlockIcon size={14} /> : <LockIcon size={14} />}{' '}
                            <span className="lib-label">
                              {!f.lock ? 'Lock' : sealed ? 'Unlock' : 'Lock'}
                            </span>
                          </button>
                        );
                      })()}
                    <button
                      type="button"
                      data-testid="library-folder-export"
                      title="Export every board inside (.boardcache, several as a zip)"
                      disabled={boardsInSelectedFolders().length === 0}
                      onClick={() => {
                        void (async () => {
                          const out = await exportBoardsFiles(boardsInSelectedFolders());
                          if (out) downloadBlob(out.blob, out.filename);
                          finishAction();
                        })();
                      }}
                    >
                      <DownloadIcon size={14} /> <span className="lib-label">Export</span>
                    </button>
                    <button
                      type="button"
                      data-testid="library-folder-delete"
                      title="Delete folder and everything in it"
                      onClick={() => void deleteSelectedFolders()}
                    >
                      <TrashIcon size={14} /> <span className="lib-label">Delete</span>
                    </button>
                  </>
                )}
                {orgSelection.length + folderSelection.length > 0 && (
                  <>
                    {/* Move: inline dropdown on desktop; on phones a compact icon
                  that opens a folder-picking dialog instead. */}
                    <span className="lab-move-desktop">
                      <UiSelect
                        value=""
                        placeholder="Move"
                        ariaLabel="Move to folder"
                        testId="library-move"
                        options={folderOptions
                          .filter(
                            (o) =>
                              o.id === '__root' ||
                              !folderSelection.some((sel) => isWithinFolder(meta, o.id, sel)),
                          )
                          .map((o) => ({ value: o.id, label: o.label }))}
                        onChange={(v) => {
                          void moveSelectionTo(v === '__root' ? null : v);
                        }}
                      />
                    </span>
                    <button
                      type="button"
                      className="lab-move-mobile"
                      data-testid="library-move-mobile"
                      title="Move to folder"
                      aria-label="Move to folder"
                      disabled={orgSelection.length + folderSelection.length === 0}
                      onClick={() => setMoveOpen(true)}
                    >
                      <FolderInputIcon size={14} />
                    </button>
                    <UiPopover
                      open={tagsOpen}
                      onOpenChange={(open) => {
                        setTagsOpen(open);
                        if (!open && tagsTouched.current) {
                          tagsTouched.current = false;
                          finishAction();
                        }
                      }}
                    >
                      <UiPopoverTrigger asChild>
                        <button
                          type="button"
                          data-testid="library-tags"
                          title="Tags"
                          disabled={orgSelection.length === 0}
                        >
                          <TagIcon size={14} /> <span className="lib-label">Tags</span>
                        </button>
                      </UiPopoverTrigger>
                      <UiPopoverContent className="lab-tags" align="end">
                        <div className="lab-tags-body" data-testid="library-tag-editor">
                          <div className="tag-chips">
                            {unionTags.map((tag) => (
                              <span className="tag-chip" key={tag}>
                                <span className="tag-chip-label">{tag}</span>
                                <button
                                  type="button"
                                  className="tag-chip-remove"
                                  aria-label={`Remove tag ${tag}`}
                                  onClick={() => {
                                    tagsTouched.current = true;
                                    void commitMeta(removeTagFromBoards(meta, orgSelection, tag));
                                  }}
                                >
                                  <CloseIcon />
                                </button>
                              </span>
                            ))}
                            {unionTags.length === 0 && (
                              <span className="tag-empty">No tags yet</span>
                            )}
                          </div>
                          <input
                            className="tag-input"
                            value={tagDraft}
                            autoFocus
                            placeholder="Add a tag"
                            data-testid="library-tag-input"
                            onChange={(e) => setTagDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') return;
                              e.stopPropagation();
                              if (e.key === 'Enter' || e.key === ',') {
                                e.preventDefault();
                                void addTag(tagDraft);
                              }
                            }}
                            onBlur={() => void addTag(tagDraft)}
                          />
                        </div>
                      </UiPopoverContent>
                    </UiPopover>
                  </>
                )}
              </div>
            </div>
            {crumbs.length > 0 && (
              <nav className="library-crumbs" aria-label="Folder path" data-testid="library-crumbs">
                <button
                  type="button"
                  className="library-crumb"
                  onClick={() => setFolderSel('home')}
                >
                  <HomeIcon size={14} /> Home
                </button>
                {crumbs.map((f, i) => (
                  <Fragment key={f.id}>
                    <span className="library-crumb-sep" aria-hidden>
                      <ChevronRightIcon size={13} />
                    </span>
                    {i === crumbs.length - 1 ? (
                      <span className="library-crumb current" aria-current="page">
                        {f.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="library-crumb"
                        onClick={() => setFolderSel(f.id)}
                      >
                        {f.name}
                      </button>
                    )}
                  </Fragment>
                ))}
              </nav>
            )}
          </div>

          {!listLoaded ? (
            <div
              className={`library-grid view-${viewMode}`}
              data-testid="library-loading"
              aria-label="Loading boards"
            >
              {Array.from({ length: 6 }, (_, i) => (
                <div className="board-card board-skeleton" key={i} aria-hidden>
                  <div className="board-thumb" />
                  <div className="board-meta">
                    <span className="skeleton-line" />
                    <span className="skeleton-line short" />
                  </div>
                </div>
              ))}
            </div>
          ) : folderSel !== 'templates' ? (
            <div className={`library-grid view-${viewMode} library-grid-in`}>
              {newBoardTile}
              {browsing && childFolders(meta, currentFolder).map(renderFolderTile)}
              {merged.map((e) =>
                e.kind === 'team' ? renderTeamCard(e.board) : renderCard(e.board),
              )}
              {merged.length === 0 && (
                <p className="library-empty">
                  {boards.length === 0 && teamBoards.length === 0
                    ? 'No boards yet — create one or import a .refboard file.'
                    : currentFolder && !search.trim() && tagSel.length === 0
                      ? 'No boards in this folder yet — drag some in, or move them here.'
                      : 'No boards match the current filter.'}
                </p>
              )}
            </div>
          ) : null}

          {/* Templates live ONLY in their sidebar section — never appended
              under the boards grid. */}
          {folderSel === 'templates' && (
            <section className="library-templates-section" data-testid="library-templates-section">
              <h2 className="library-section-title">My Templates</h2>
              {templates.length === 0 && (
                <p className="library-empty" data-testid="templates-empty">
                  No templates yet. Open any board and choose <b>File → Save as Template</b> — it
                  will appear here with a preview, ready to start new boards from.
                </p>
              )}
              <div className={`library-grid view-${viewMode}`}>
                {templates.map((t) => {
                  const thumbUrl =
                    (resolved === 'dark' ? t.thumbnailDarkUrl : t.thumbnailLightUrl) ??
                    t.thumbnailUrl;
                  return (
                    <div
                      key={t.id}
                      className="board-card template-card"
                      data-testid="template-card"
                      // The library marquee captures pointers on anything it
                      // doesn't recognize — template cards handle their own.
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div
                        className="board-thumb"
                        role="button"
                        tabIndex={0}
                        title={`${t.name} — start a new board from this template`}
                        onClick={() => void startFromTemplate(t)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void startFromTemplate(t);
                        }}
                      >
                        {thumbUrl ? (
                          <img src={thumbUrl} alt="" draggable={false} />
                        ) : (
                          <span className="board-thumb-empty">∅</span>
                        )}
                      </div>
                      <div className="board-card-info">
                        <span className="board-card-name">
                          {t.name}
                          {t.synced && <span className="template-mine-sync"> ☁</span>}
                        </span>
                        <span className="template-card-actions">
                          <button
                            type="button"
                            data-testid="template-card-edit"
                            title="Edit the template"
                            onClick={() => requestOpen(t.id)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            data-testid="template-card-duplicate"
                            title="Duplicate the template"
                            onClick={() =>
                              void import('../../lib/board/boardLibrary')
                                .then((m) => m.duplicateTemplate(t.id))
                                .then(refresh)
                            }
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            data-testid="template-card-delete"
                            title="Delete the template"
                            onClick={() => void deleteBoard(t.id).then(refresh)}
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {marqueeRect && (
        <div
          className="library-marquee"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      )}

      {moveOpen && (
        <UiDialog
          title="Move to folder"
          onClose={() => setMoveOpen(false)}
          className="ui-prompt-sheet"
          testId="library-move-dialog"
        >
          <div className="move-dialog-list">
            {folderOptions.map((o) => (
              <button
                key={o.id}
                type="button"
                data-testid="move-dialog-folder"
                onClick={() => {
                  setMoveOpen(false);
                  void moveSelectionTo(o.id === '__root' ? null : o.id);
                }}
              >
                {o.id === '__root' ? <HomeIcon size={15} /> : <FolderIcon size={15} />} {o.label}
              </button>
            ))}
          </div>
        </UiDialog>
      )}

      {newBoardAsk && (
        <UiDialog
          title="Create a board"
          onClose={() => setNewBoardAsk(false)}
          className="newboard-sheet"
          testId="new-board-dialog"
        >
          <div className="newboard-choices">
            <button
              type="button"
              className="newboard-choice"
              data-testid="new-board-local"
              onClick={() => {
                setNewBoardAsk(false);
                void createNamedBoard();
              }}
            >
              <BoardsIcon size={30} />
              <span className="newboard-choice-title">Local Board</span>
              <span className="newboard-choice-hint">
                Private to this device. Optional ☁ Sync — end-to-end encrypted.
              </span>
            </button>
            <button
              type="button"
              className="newboard-choice"
              data-testid="new-board-team"
              onClick={() => {
                setNewBoardAsk(false);
                void createTeamBoard();
              }}
            >
              <UsersIcon size={30} />
              <span className="newboard-choice-title">Team Board</span>
              <span className="newboard-choice-hint">
                Real-time collaboration with members and guests. Stored readable on the server.
              </span>
            </button>
          </div>
        </UiDialog>
      )}
      {lockPrompt && (
        <BoardLockDialog
          mode={lockPrompt.mode}
          boardName={lockPrompt.name}
          onClose={() => setLockPrompt(null)}
          onSubmit={async (password) => {
            if (lockPrompt.mode === 'folder-set') {
              const ids = boardsInFolderTree(meta, lockPrompt.id).filter((id) =>
                boards.some((b) => b.id === id && !b.isTemplate),
              );
              const next = await lockFolder(meta, lockPrompt.id, password, ids);
              for (const id of ids) await markBoardDirty(id);
              await commitMeta(next);
              if (currentFolder && isWithinFolder(meta, currentFolder, lockPrompt.id)) {
                setFolderSel('home');
              }
              finishAction();
              bumpLocks();
              await refresh();
              return null;
            }
            if (lockPrompt.mode === 'folder-open') {
              const f = folderById(meta, lockPrompt.id);
              if (!f || !(await unlockFolder(f, password))) return 'Wrong password.';
              bumpLocks();
              if (lockPrompt.then) setFolderSel(lockPrompt.then);
              return null;
            }
            if (lockPrompt.mode === 'folder-remove') {
              const f = folderById(meta, lockPrompt.id);
              if (!f) return null;
              const ids = boardsInFolderTree(meta, f.id).filter((id) =>
                boards.some((b) => b.id === id && b.locked && b.lockSalt === f.lock?.salt),
              );
              const next = await removeFolderLock(meta, f, password, ids);
              if (!next) return 'Wrong password.';
              for (const id of ids) {
                const doc = await loadBoardRecord(id);
                if (doc) await saveBoardRecord(doc, true); // thumbnails back
                await markBoardDirty(id);
              }
              await commitMeta(next);
              finishAction();
              bumpLocks();
              await refresh();
              return null;
            }
            if (lockPrompt.mode === 'set') {
              await lockBoard(lockPrompt.id, password);
              await markBoardDirty(lockPrompt.id); // synced boards push the locked state
              await refresh();
              return null;
            }
            if (lockPrompt.mode === 'remove') {
              const ok = await removeLock(lockPrompt.id, password);
              if (!ok) return 'Wrong password.';
              // The doc + assets are plaintext again — render the preview now
              // instead of waiting for the board to be opened and closed.
              const doc = await loadBoardRecord(lockPrompt.id);
              if (doc) await saveBoardRecord(doc, true);
              await markBoardDirty(lockPrompt.id);
              await refresh();
              return null;
            }
            const ok = await openLockedBoard(lockPrompt.id, password);
            return ok ? null : 'Wrong password.';
          }}
        />
      )}

      {ctxMenu && (
        <DM.Root open onOpenChange={(open) => !open && setCtxMenu(null)}>
          <DM.Trigger asChild>
            <span
              style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, width: 0, height: 0 }}
              aria-hidden
            />
          </DM.Trigger>
          <DM.Portal>
            <DM.Content
              className="menu-panel menu-list context-menu"
              data-testid="library-context-menu"
              align="start"
              side="bottom"
              sideOffset={2}
              collisionPadding={8}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <RadixEntries entries={ctxMenu.entries} />
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      )}
      <BuildStamp />
    </div>
  );
}

/**
 * Tiny build stamp (bottom corner of the library). Tapping it shows the
 * device's actual runtime state — build id, service worker registrations,
 * user agent — the exact data needed when a device "runs old code".
 */
function BuildStamp() {
  const build = String(import.meta.env.VITE_BUILD_ID ?? 'dev');
  const show = async () => {
    let sw = 'unsupported';
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      sw = regs.length
        ? regs
            .map((r) => `${r.active?.scriptURL ?? 'none'}${r.waiting ? ' (+waiting)' : ''}`)
            .join('; ')
        : 'none';
    } catch {
      /* unavailable */
    }
    window.alert(`boardCache build ${build}\nSW: ${sw}\nUA: ${navigator.userAgent}`);
  };
  return (
    <button
      type="button"
      className="build-stamp"
      data-testid="build-stamp"
      onClick={() => void show()}
    >
      v{build.slice(-6)}
    </button>
  );
}

/** Team-board thumbnail: fetched (not <img src>) so a board that hasn't been
 *  visited yet renders a quiet placeholder instead of console 404s. */
function TeamThumb({
  boardId,
  theme,
  version,
}: {
  boardId: string;
  theme: string;
  version: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void apiFetch(
      `/api/team/${boardId}/thumbnail?theme=${theme}&v=${encodeURIComponent(version)}`,
      { credentials: 'include' },
    )
      .then(async (r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [boardId, theme, version]);
  return <div className="board-thumb">{url && <img src={url} alt="" draggable={false} />}</div>;
}
