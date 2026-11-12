import { create } from 'zustand';
import {
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
  readStoredScale,
  readStoredWidth,
  steppedScale,
  TEXT_SCALES,
} from '../../lib/readerPrefs';

/**
 * UI state of the Notes view: the open tabs (per board, remembered on this
 * device), the sidebars and their widths, the search, the tag filter and
 * the folders that are folded shut. Board data lives on the items.
 */

export interface NotesTab {
  id: string;
  noteId: string;
  /** A pinned tab keeps its note: opening another note beside it makes a
   *  new tab, and it cannot be closed until unpinned. */
  pinned?: boolean;
  /** The notes this tab showed before (nearest last) and after a Back. */
  back?: string[];
  forward?: string[];
}

/** How long a double click has, after the single click that replaced the
 *  tab's note, to turn that into a new tab instead. */
const DOUBLE_CLICK_MS = 700;

/** edit = the live page (markup hidden off the caret's line); source = raw. */
export type NotesMode = 'edit' | 'source' | 'preview' | 'split';
export type InspectorTab = 'outline' | 'tasks' | 'info' | 'comments' | 'related' | 'assistant';
/** The order of the notes list: by title either way, or by when they were made. */
export type NotesSort = 'title' | 'title-desc' | 'newest' | 'oldest';
const NOTES_SORTS: NotesSort[] = ['title', 'title-desc', 'newest', 'oldest'];

const LEFT_W_KEY = 'boardcache:notesLeftWidth';
const RIGHT_W_KEY = 'boardcache:notesRightWidth';
const LEFT_OPEN_KEY = 'boardcache:notesLeftOpen';
const RIGHT_OPEN_KEY = 'boardcache:notesRightOpen';
const SIDE_WIDE_KEY = 'boardcache:notesSideWide';
const SHOW_PROPS_KEY = 'boardcache:notesShowProps';
const MODE_KEY = 'boardcache:notesMode';
const INSPECTOR_KEY = 'boardcache:notesInspector';
const WIDTH_KEY = 'boardcache:notesPageWidth';
const SORT_KEY = 'boardcache:notesSort';
const SCALE_KEY = 'boardcache:notesTextScale';
export { PAGE_WIDTH_MAX, PAGE_WIDTH_MIN, TEXT_SCALES };
const tabsKey = (boardId: string) => `boardcache:notesTabs:${boardId}`;

const LEFT_DEFAULT = 260;
const RIGHT_DEFAULT = 360;
export const SIDE_MIN = 180;

function readNumber(key: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n >= SIDE_MIN ? n : fallback;
  } catch {
    return fallback;
  }
}
function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* the setting lasts the session */
  }
}
function readMode(): NotesMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'edit' || v === 'source' || v === 'split' ? v : 'preview';
  } catch {
    return 'preview';
  }
}
function readInspector(): InspectorTab {
  try {
    const v = localStorage.getItem(INSPECTOR_KEY);
    return v === 'tasks' || v === 'info' || v === 'comments' || v === 'related' || v === 'assistant'
      ? v
      : 'outline';
  } catch {
    return 'outline';
  }
}
function readSort(): NotesSort {
  try {
    const v = localStorage.getItem(SORT_KEY) as NotesSort | null;
    return v && NOTES_SORTS.includes(v) ? v : 'title';
  } catch {
    return 'title';
  }
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** The notes open in one part of the stage: its tabs and the active one. */
export interface NotesPane {
  id: string;
  tabs: NotesTab[];
  /** The active tab's id; null shows the empty state. */
  active: string | null;
}

/** How the stage is divided: a pane, or two halves side by side (`row`)
 *  or one above the other (`column`), each a layout of its own. */
export type NotesLayout =
  | { kind: 'pane'; id: string }
  | {
      kind: 'split';
      id: string;
      dir: 'row' | 'column';
      a: NotesLayout;
      b: NotesLayout;
      ratio: number;
    };

/** Where a new pane goes, relative to the one it splits. */
export type SplitSide = 'right' | 'left' | 'below' | 'above';

const SPLIT_MIN = 0.15;

/** Every pane id in a layout, in reading order. */
function paneIds(l: NotesLayout): string[] {
  return l.kind === 'pane' ? [l.id] : [...paneIds(l.a), ...paneIds(l.b)];
}

/** The layout with pane `id` replaced by `by` (removed when `by` is null,
 *  the sibling taking the split's place). */
function replacePane(l: NotesLayout, id: string, by: NotesLayout | null): NotesLayout | null {
  if (l.kind === 'pane') return l.id === id ? by : l;
  const a = replacePane(l.a, id, by);
  const b = replacePane(l.b, id, by);
  if (!a) return b;
  if (!b) return a;
  return a === l.a && b === l.b ? l : { ...l, a, b };
}

function withRatio(l: NotesLayout, id: string, ratio: number): NotesLayout {
  if (l.kind === 'pane') return l;
  if (l.id === id) return { ...l, ratio };
  const a = withRatio(l.a, id, ratio);
  const b = withRatio(l.b, id, ratio);
  return a === l.a && b === l.b ? l : { ...l, a, b };
}

function readLayout(v: unknown, panes: NotesPane[]): NotesLayout | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'pane') {
    return typeof o.id === 'string' && panes.some((p) => p.id === o.id)
      ? { kind: 'pane', id: o.id }
      : null;
  }
  if (o.kind !== 'split') return null;
  const a = readLayout(o.a, panes);
  const b = readLayout(o.b, panes);
  if (!a) return b;
  if (!b) return a;
  const ratio =
    typeof o.ratio === 'number' && o.ratio > SPLIT_MIN && o.ratio < 1 - SPLIT_MIN ? o.ratio : 0.5;
  return {
    kind: 'split',
    id: typeof o.id === 'string' ? o.id : newId(),
    dir: o.dir === 'column' ? 'column' : 'row',
    a,
    b,
    ratio,
  };
}

function readTab(t: unknown): NotesTab | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.noteId !== 'string') return null;
  const ids = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  const tab: NotesTab = { id: o.id, noteId: o.noteId };
  if (o.pinned) tab.pinned = true;
  const back = ids(o.back);
  const forward = ids(o.forward);
  if (back?.length) tab.back = back;
  if (forward?.length) tab.forward = forward;
  return tab;
}

interface NotesState {
  /** The board whose tabs are loaded (tabs are remembered per board). */
  boardId: string | null;
  /** The parts of the stage, each with its own tabs. */
  panes: NotesPane[];
  layout: NotesLayout;
  /** The pane the sidebar, the inspector, the URL and the keys act on. */
  focused: string;
  left: boolean;
  right: boolean;
  leftWidth: number;
  rightWidth: number;
  /** Phones: an open sidebar covers the whole screen rather than most of it. */
  sideWide: boolean;
  inspector: InspectorTab;
  mode: NotesMode;
  /** The page's width as a percentage of the stage (the status bar's slider). */
  pageWidth: number;
  sort: NotesSort;
  /** The text size of the page and the editor, as a factor. */
  textScale: number;
  /** The font of Source mode; '' = the editor's monospace. */
  sourceFont: string;
  /** Whether the properties block shows in the note (the page and the editor). */
  showProps: boolean;
  query: string;
  /** Only notes carrying this tag are listed (null = every note). */
  tag: string | null;
  /** Folder paths folded shut in the sidebar. */
  collapsed: Set<string>;
  /** A heading the outline asked the editor to show: its index among the
   *  note's headings and its source line; bumps `nonce` each time. */
  jump: { index: number; line: number; nonce: number } | null;

  /** The last single click that replaced a tab's note, so a double click
   *  can undo it and open the note in a new tab instead. */
  lastReplace: { paneId: string; tabId: string; noteId: string; at: number } | null;

  loadFor: (boardId: string) => void;
  /** Open a note in a pane (the focused one): in its active tab (whose
   *  history remembers the note it showed), or in a new one (a modifier
   *  click, a double click, a link opened aside, or the active tab is
   *  pinned); the pane's tab already showing the note is activated instead. */
  openNote: (noteId: string, opts?: { newTab?: boolean; pane?: string }) => void;
  /** Divide pane `paneId` (the focused one) and open a note (its active
   *  note) in the new pane on that side. */
  splitPane: (side: SplitSide, opts?: { pane?: string; noteId?: string }) => void;
  /** Close a pane, its tabs with it; the last pane only empties. */
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  /** Back and forward through the notes the focused pane's tab has shown. */
  goBack: () => void;
  goForward: () => void;
  closeTab: (id: string) => void;
  /** Close every tab of the pane but this one (pinned tabs stay). */
  closeOthers: (id: string) => void;
  togglePin: (id: string) => void;
  activate: (id: string) => void;
  /** Put tab `id` where tab `beforeId` is, in pane `paneId` (a drag in a
   *  strip; across strips the tab changes pane). */
  moveTab: (id: string, beforeId: string | null, paneId?: string) => void;
  /** Drop tabs whose notes are gone. */
  prune: (live: (noteId: string) => boolean) => void;
  setLeft: (open: boolean) => void;
  setRight: (open: boolean) => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setSideWide: (wide: boolean) => void;
  setInspector: (tab: InspectorTab) => void;
  setMode: (mode: NotesMode) => void;
  setPageWidth: (pct: number) => void;
  setSort: (sort: NotesSort) => void;
  setSourceFont: (font: string) => void;
  setShowProps: (show: boolean) => void;
  /** Step the text size up or down through TEXT_SCALES. */
  stepTextScale: (dir: 1 | -1) => void;
  setQuery: (q: string) => void;
  setTag: (tag: string | null) => void;
  toggleFolder: (path: string) => void;
  /** The note whose title line takes the focus when its editor opens (a
   *  new note: the name is the first thing to write); null once it has. */
  titleFocusId: string | null;
  setTitleFocus: (id: string | null) => void;
  goToHeading: (index: number, line: number) => void;
  /** A task the Tasks tab asked the editor to show: its index among the
   *  note's boxes and its source line. */
  goToTask: (index: number, line: number) => void;
}

type Stage = Pick<NotesState, 'panes' | 'layout' | 'focused'>;

function persistStage(boardId: string | null, stage: Stage): void {
  if (!boardId) return;
  write(tabsKey(boardId), JSON.stringify(stage));
}

const SOURCE_FONT_KEY = 'boardcache:notesSourceFont';

function readText(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

const freshPane = (): NotesPane => ({ id: newId(), tabs: [], active: null });

export const useNotesUi = create<NotesState>((set, get) => {
  /** The pane by id, else the focused one. */
  const paneOf = (id?: string | null): NotesPane => {
    const { panes, focused } = get();
    return panes.find((p) => p.id === id) ?? panes.find((p) => p.id === focused) ?? panes[0]!;
  };
  /** The pane holding tab `tabId`. */
  const paneOfTab = (tabId: string): NotesPane | undefined =>
    get().panes.find((p) => p.tabs.some((t) => t.id === tabId));
  /** Commit a changed pane (and what else changed), and remember the stage. */
  const commit = (pane: NotesPane, extra: Partial<NotesState> = {}) => {
    const panes = get().panes.map((p) => (p.id === pane.id ? pane : p));
    set({ panes, ...extra });
    const { layout, focused } = get();
    persistStage(get().boardId, { panes, layout, focused });
  };
  /** A pane whose last tab closed goes, unless it is the last one. */
  const dropIfEmpty = (pane: NotesPane) => {
    if (pane.tabs.length || get().panes.length < 2) return commit(pane);
    get().closePane(pane.id);
  };
  const first = freshPane();
  return {
    boardId: null,
    panes: [first],
    layout: { kind: 'pane', id: first.id },
    focused: first.id,
    lastReplace: null,
    left: readBool(LEFT_OPEN_KEY, true),
    right: readBool(RIGHT_OPEN_KEY, true),
    leftWidth: readNumber(LEFT_W_KEY, LEFT_DEFAULT),
    rightWidth: readNumber(RIGHT_W_KEY, RIGHT_DEFAULT),
    sideWide: readBool(SIDE_WIDE_KEY, false),
    inspector: readInspector(),
    mode: readMode(),
    pageWidth: readStoredWidth(WIDTH_KEY),
    sort: readSort(),
    textScale: readStoredScale(SCALE_KEY),
    sourceFont: readText(SOURCE_FONT_KEY),
    showProps: readBool(SHOW_PROPS_KEY, true),
    query: '',
    tag: null,
    collapsed: new Set(),
    jump: null,
    titleFocusId: null,

    loadFor: (boardId) => {
      if (get().boardId === boardId) return;
      // A tab opened before the board was known (the URL's note, applied as
      // the view routes) stays, behind the remembered ones; when a remembered
      // tab already shows its note, that tab (its pin, its history) is the
      // one kept and made active.
      const earlyPane = get().boardId === null ? paneOf() : null;
      let early = earlyPane?.tabs ?? [];
      let earlyActive = early.length ? earlyPane!.active : null;
      let panes: NotesPane[] = [];
      let layout: NotesLayout | null = null;
      let focused: string | null = null;
      try {
        const saved = JSON.parse(localStorage.getItem(tabsKey(boardId)) ?? 'null') as {
          tabs?: unknown[];
          active?: string | null;
          panes?: unknown[];
          layout?: unknown;
          focused?: string;
        } | null;
        const readPane = (p: unknown): NotesPane | null => {
          if (!p || typeof p !== 'object') return null;
          const o = p as { id?: unknown; tabs?: unknown; active?: unknown };
          if (typeof o.id !== 'string' || !Array.isArray(o.tabs)) return null;
          const tabs = o.tabs.map(readTab).filter((t): t is NotesTab => !!t);
          const active = tabs.some((t) => t.id === o.active) ? (o.active as string) : null;
          return { id: o.id, tabs, active };
        };
        if (saved?.panes) {
          panes = saved.panes.map(readPane).filter((p): p is NotesPane => !!p);
          layout = readLayout(saved.layout, panes);
          focused = typeof saved.focused === 'string' ? saved.focused : null;
        } else if (saved?.tabs) {
          // The shape before panes: one strip of tabs.
          const one = readPane({ id: newId(), tabs: saved.tabs, active: saved.active });
          if (one) panes = [one];
        }
      } catch {
        /* a fresh set of tabs */
      }
      // Panes the layout lost, and a layout naming no pane, are made whole.
      const named = layout ? new Set(paneIds(layout)) : new Set<string>();
      panes = panes.filter((p) => !layout || named.has(p.id));
      if (!panes.length) {
        panes = [freshPane()];
        layout = null;
      }
      layout ??= { kind: 'pane', id: panes[0]!.id };
      if (!focused || !panes.some((p) => p.id === focused)) focused = panes[0]!.id;
      // The early tab joins the focused pane.
      const target = panes.find((p) => p.id === focused)!;
      const remembered = target.tabs;
      const earlyActiveTab = early.find((e) => e.id === earlyActive);
      const twin = earlyActiveTab && remembered.find((t) => t.noteId === earlyActiveTab.noteId);
      if (twin) earlyActive = twin.id;
      early = early.filter((e) => !remembered.some((t) => t.noteId === e.noteId));
      const tabs = [...remembered, ...early];
      const active = earlyActive ?? target.active ?? tabs[0]?.id ?? null;
      panes = panes.map((p) => (p.id === target.id ? { ...p, tabs, active } : p));
      set({ boardId, panes, layout, focused, query: '', tag: null, lastReplace: null });
    },
    openNote: (noteId, opts) => {
      const pane = paneOf(opts?.pane);
      const { tabs, active } = pane;
      const { lastReplace } = get();
      const already = tabs.find((t) => t.noteId === noteId);
      const current = tabs.find((t) => t.id === active);
      const focus = { focused: pane.id };
      if (already) {
        // A double click's second click: the first replaced this tab's note
        // a moment ago, so undo that and open the note in a tab of its own.
        const undo =
          opts?.newTab &&
          current &&
          already.id === current.id &&
          lastReplace?.paneId === pane.id &&
          lastReplace.tabId === current.id &&
          lastReplace.noteId === noteId &&
          Date.now() - lastReplace.at < DOUBLE_CLICK_MS &&
          current.back?.length;
        if (undo) {
          const back = current.back!.slice(0, -1);
          const restored: NotesTab = { ...current, noteId: current.back!.at(-1)! };
          if (back.length) restored.back = back;
          else delete restored.back;
          delete restored.forward;
          const tab: NotesTab = { id: newId(), noteId };
          const at = tabs.findIndex((t) => t.id === current.id);
          const next = tabs.map((t) => (t.id === current.id ? restored : t));
          next.splice(at + 1, 0, tab);
          commit({ ...pane, tabs: next, active: tab.id }, { ...focus, lastReplace: null });
          return;
        }
        commit({ ...pane, active: already.id }, focus);
        return;
      }
      if (current && !opts?.newTab && !current.pinned) {
        const replaced: NotesTab = {
          ...current,
          noteId,
          back: [...(current.back ?? []), current.noteId].slice(-50),
        };
        delete replaced.forward;
        const next = tabs.map((t) => (t.id === current.id ? replaced : t));
        commit(
          { ...pane, tabs: next },
          { ...focus, lastReplace: { paneId: pane.id, tabId: current.id, noteId, at: Date.now() } },
        );
        return;
      }
      const tab: NotesTab = { id: newId(), noteId };
      // A new tab goes after the current one (after the pinned run when the
      // current tab is pinned), as browsers place it.
      const at = current ? tabs.findIndex((t) => t.id === current.id) + 1 : tabs.length;
      let slot = at;
      while (slot < tabs.length && tabs[slot]!.pinned) slot++;
      const next = [...tabs.slice(0, slot), tab, ...tabs.slice(slot)];
      commit({ ...pane, tabs: next, active: tab.id }, { ...focus, lastReplace: null });
    },
    splitPane: (side, opts) => {
      const from = paneOf(opts?.pane);
      const noteId = opts?.noteId ?? from.tabs.find((t) => t.id === from.active)?.noteId;
      const pane: NotesPane = { id: newId(), tabs: [], active: null };
      if (noteId) {
        const tab: NotesTab = { id: newId(), noteId };
        pane.tabs = [tab];
        pane.active = tab.id;
      }
      const leaf: NotesLayout = { kind: 'pane', id: pane.id };
      const old: NotesLayout = { kind: 'pane', id: from.id };
      const after = side === 'right' || side === 'below';
      const split: NotesLayout = {
        kind: 'split',
        id: newId(),
        dir: side === 'right' || side === 'left' ? 'row' : 'column',
        a: after ? old : leaf,
        b: after ? leaf : old,
        ratio: 0.5,
      };
      const layout = replacePane(get().layout, from.id, split) ?? split;
      const panes = [...get().panes, pane];
      set({ panes, layout, focused: pane.id, lastReplace: null });
      persistStage(get().boardId, { panes, layout, focused: pane.id });
    },
    closePane: (paneId) => {
      const { panes, layout, focused } = get();
      if (!panes.some((p) => p.id === paneId)) return;
      if (panes.length < 2) {
        commit({ id: paneId, tabs: [], active: null });
        return;
      }
      const nextLayout = replacePane(layout, paneId, null)!;
      const nextPanes = panes.filter((p) => p.id !== paneId);
      const order = paneIds(nextLayout);
      const nextFocused = focused === paneId ? order[0]! : focused;
      set({ panes: nextPanes, layout: nextLayout, focused: nextFocused, lastReplace: null });
      persistStage(get().boardId, { panes: nextPanes, layout: nextLayout, focused: nextFocused });
    },
    focusPane: (paneId) => {
      if (get().focused === paneId || !get().panes.some((p) => p.id === paneId)) return;
      set({ focused: paneId, lastReplace: null });
      const { panes, layout } = get();
      persistStage(get().boardId, { panes, layout, focused: paneId });
    },
    setSplitRatio: (splitId, ratio) => {
      const clamped = Math.min(1 - SPLIT_MIN, Math.max(SPLIT_MIN, ratio));
      const layout = withRatio(get().layout, splitId, clamped);
      set({ layout });
      const { panes, focused } = get();
      persistStage(get().boardId, { panes, layout, focused });
    },
    goBack: () => {
      const pane = paneOf();
      const current = pane.tabs.find((t) => t.id === pane.active);
      const prev = current?.back?.at(-1);
      if (!current || !prev) return;
      const moved: NotesTab = {
        ...current,
        noteId: prev,
        forward: [current.noteId, ...(current.forward ?? [])],
      };
      const back = current.back!.slice(0, -1);
      if (back.length) moved.back = back;
      else delete moved.back;
      const next = pane.tabs.map((t) => (t.id === current.id ? moved : t));
      commit({ ...pane, tabs: next }, { lastReplace: null });
    },
    goForward: () => {
      const pane = paneOf();
      const current = pane.tabs.find((t) => t.id === pane.active);
      const ahead = current?.forward?.[0];
      if (!current || !ahead) return;
      const moved: NotesTab = {
        ...current,
        noteId: ahead,
        back: [...(current.back ?? []), current.noteId],
      };
      const forward = current.forward!.slice(1);
      if (forward.length) moved.forward = forward;
      else delete moved.forward;
      const next = pane.tabs.map((t) => (t.id === current.id ? moved : t));
      commit({ ...pane, tabs: next }, { lastReplace: null });
    },
    closeTab: (id) => {
      const pane = paneOfTab(id);
      if (!pane) return;
      const { tabs, active } = pane;
      const at = tabs.findIndex((t) => t.id === id);
      if (tabs[at]!.pinned) return;
      const next = tabs.filter((t) => t.id !== id);
      const nextActive = active === id ? (next[Math.min(at, next.length - 1)]?.id ?? null) : active;
      dropIfEmpty({ ...pane, tabs: next, active: nextActive });
    },
    closeOthers: (id) => {
      const pane = paneOfTab(id);
      if (!pane) return;
      const next = pane.tabs.filter((t) => t.id === id || t.pinned);
      commit({ ...pane, tabs: next, active: id });
    },
    togglePin: (id) => {
      const pane = paneOfTab(id);
      const tab = pane?.tabs.find((t) => t.id === id);
      if (!pane || !tab) return;
      const toggled: NotesTab = { ...tab };
      if (tab.pinned) delete toggled.pinned;
      else toggled.pinned = true;
      // Pinned tabs lead the strip: a newly pinned tab joins the end of that
      // run, an unpinned one takes the first place after it.
      const rest = pane.tabs.filter((t) => t.id !== id);
      const firstLoose = rest.findIndex((t) => !t.pinned);
      const slot = firstLoose < 0 ? rest.length : firstLoose;
      const next = [...rest.slice(0, slot), toggled, ...rest.slice(slot)];
      commit({ ...pane, tabs: next });
    },
    activate: (id) => {
      const pane = paneOfTab(id);
      if (!pane) return;
      commit({ ...pane, active: id }, { focused: pane.id, lastReplace: null });
    },
    moveTab: (id, beforeId, paneId) => {
      const from = paneOfTab(id);
      if (!from || id === beforeId) return;
      const moving = from.tabs.find((t) => t.id === id)!;
      const to = (paneId && get().panes.find((p) => p.id === paneId)) || from;
      if (to.id === from.id) {
        const rest = from.tabs.filter((t) => t.id !== id);
        const at = beforeId ? rest.findIndex((t) => t.id === beforeId) : rest.length;
        const next = [
          ...rest.slice(0, at < 0 ? rest.length : at),
          moving,
          ...rest.slice(at < 0 ? rest.length : at),
        ];
        commit({ ...from, tabs: next });
        return;
      }
      // Across panes: the tab leaves one strip for the other, active there.
      const left = from.tabs.filter((t) => t.id !== id);
      const leftActive =
        from.active === id
          ? (left[Math.min(from.tabs.indexOf(moving), left.length - 1)]?.id ?? null)
          : from.active;
      const at = beforeId ? to.tabs.findIndex((t) => t.id === beforeId) : to.tabs.length;
      const toTabs = [
        ...to.tabs.slice(0, at < 0 ? to.tabs.length : at),
        moving,
        ...to.tabs.slice(at < 0 ? to.tabs.length : at),
      ];
      const panes = get().panes.map((p) =>
        p.id === from.id
          ? { ...p, tabs: left, active: leftActive }
          : p.id === to.id
            ? { ...p, tabs: toTabs, active: id }
            : p,
      );
      set({ panes, focused: to.id, lastReplace: null });
      persistStage(get().boardId, { panes, layout: get().layout, focused: to.id });
      if (!left.length && panes.length > 1) get().closePane(from.id);
    },
    prune: (live) => {
      const clean = (t: NotesTab): boolean =>
        live(t.noteId) && !t.back?.some((n) => !live(n)) && !t.forward?.some((n) => !live(n));
      if (get().panes.every((p) => p.tabs.every(clean))) return;
      let panes = get().panes.map((pane) => {
        const next = pane.tabs
          .filter((t) => live(t.noteId))
          .map((t) => {
            const tab: NotesTab = { ...t };
            const back = t.back?.filter(live);
            const forward = t.forward?.filter(live);
            if (back?.length) tab.back = back;
            else delete tab.back;
            if (forward?.length) tab.forward = forward;
            else delete tab.forward;
            return tab;
          });
        const active = next.some((t) => t.id === pane.active) ? pane.active : (next[0]?.id ?? null);
        return { ...pane, tabs: next, active };
      });
      // Emptied panes go, the last one stays.
      let layout = get().layout;
      for (const p of panes.filter((p) => !p.tabs.length)) {
        if (panes.length < 2) break;
        layout = replacePane(layout, p.id, null)!;
        panes = panes.filter((q) => q.id !== p.id);
      }
      const focused = panes.some((p) => p.id === get().focused) ? get().focused : panes[0]!.id;
      set({ panes, layout, focused });
      persistStage(get().boardId, { panes, layout, focused });
    },
    setLeft: (left) => {
      set({ left });
      write(LEFT_OPEN_KEY, left ? '1' : '0');
    },
    setRight: (right) => {
      set({ right });
      write(RIGHT_OPEN_KEY, right ? '1' : '0');
    },
    setLeftWidth: (leftWidth) => {
      set({ leftWidth });
      write(LEFT_W_KEY, String(leftWidth));
    },
    setRightWidth: (rightWidth) => {
      set({ rightWidth });
      write(RIGHT_W_KEY, String(rightWidth));
    },
    setSideWide: (sideWide) => {
      set({ sideWide });
      write(SIDE_WIDE_KEY, sideWide ? '1' : '0');
    },
    setInspector: (inspector) => {
      set({ inspector });
      write(INSPECTOR_KEY, inspector);
    },
    setMode: (mode) => {
      set({ mode });
      write(MODE_KEY, mode);
    },
    setPageWidth: (pct) => {
      const pageWidth = Math.round(Math.min(PAGE_WIDTH_MAX, Math.max(PAGE_WIDTH_MIN, pct)));
      set({ pageWidth });
      write(WIDTH_KEY, String(pageWidth));
    },
    stepTextScale: (dir) => {
      const textScale = steppedScale(get().textScale, dir);
      set({ textScale });
      write(SCALE_KEY, String(textScale));
    },
    setSort: (sort) => {
      set({ sort });
      write(SORT_KEY, sort);
    },
    setSourceFont: (sourceFont) => {
      set({ sourceFont });
      write(SOURCE_FONT_KEY, sourceFont || null);
    },
    setShowProps: (showProps) => {
      set({ showProps });
      write(SHOW_PROPS_KEY, showProps ? '1' : '0');
    },
    setQuery: (query) => set({ query }),
    setTag: (tag) => set({ tag }),
    setTitleFocus: (titleFocusId) => set({ titleFocusId }),
    toggleFolder: (path) => {
      const collapsed = new Set(get().collapsed);
      if (collapsed.has(path)) collapsed.delete(path);
      else collapsed.add(path);
      set({ collapsed });
    },
    goToHeading: (index, line) =>
      set((s) => ({ jump: { index, line, nonce: (s.jump?.nonce ?? 0) + 1 } })),
    goToTask: (index, line) =>
      set((s) => ({ jump: { index: -1 - index, line, nonce: (s.jump?.nonce ?? 0) + 1 } })),
  };
});

/** The focused pane. */
function focusedPane(s: NotesState): NotesPane {
  return s.panes.find((p) => p.id === s.focused) ?? s.panes[0]!;
}

/** The note a pane's active tab shows, or null. */
export function paneNoteId(pane: NotesPane | undefined): string | null {
  return pane?.tabs.find((t) => t.id === pane.active)?.noteId ?? null;
}

/** The note the focused pane's active tab shows, or null. */
export function activeNoteId(s: NotesState): string | null {
  return paneNoteId(focusedPane(s));
}

/** Whether any pane has the note open. */
export function noteIsOpen(s: NotesState, noteId: string): boolean {
  return s.panes.some((p) => p.tabs.some((t) => t.noteId === noteId));
}
