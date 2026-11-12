import { create } from 'zustand';
import {
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
  readStoredScale,
  readStoredWidth,
  steppedScale,
} from '../../lib/readerPrefs';

/**
 * UI state of the Feeds view: the feed on the right, the search, the
 * folders folded shut, which feeds are being refetched, and the reading
 * preferences (the page's width and the text size, remembered on this
 * device). Board data lives on the items.
 */
const WIDTH_KEY = 'boardcache:feedsPageWidth';
const SCALE_KEY = 'boardcache:feedsTextScale';

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the setting lasts the session */
  }
}

interface FeedsState {
  selectedId: string | null;
  query: string;
  collapsed: Set<string>;
  /** Feeds a refresh is running for (the rows and buttons show it). */
  busy: Set<string>;
  /** The reader's width as a share of the stage. */
  pageWidth: number;
  /** The reader's text size, a step of TEXT_SCALES. */
  textScale: number;
  /** The Add RSS Feed dialog, with the folder it opened on. */
  addDialog: { folder: string } | null;
  openAdd: (folder: string) => void;
  closeAdd: () => void;
  setSelected: (id: string | null) => void;
  setQuery: (q: string) => void;
  toggleFolder: (path: string) => void;
  setBusy: (ids: string[], busy: boolean) => void;
  setPageWidth: (pct: number) => void;
  stepTextScale: (dir: 1 | -1) => void;
}

export const useFeedsUi = create<FeedsState>((set, get) => ({
  selectedId: null,
  query: '',
  collapsed: new Set(),
  busy: new Set(),
  addDialog: null,
  openAdd: (folder) => set({ addDialog: { folder } }),
  closeAdd: () => set({ addDialog: null }),
  pageWidth: readStoredWidth(WIDTH_KEY, PAGE_WIDTH_MAX), // the entries take the whole stage until narrowed
  textScale: readStoredScale(SCALE_KEY),
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
  setSelected: (selectedId) => set({ selectedId }),
  setQuery: (query) => set({ query }),
  toggleFolder: (path) => {
    const collapsed = new Set(get().collapsed);
    if (collapsed.has(path)) collapsed.delete(path);
    else collapsed.add(path);
    set({ collapsed });
  },
  setBusy: (ids, on) => {
    const busy = new Set(get().busy);
    for (const id of ids) {
      if (on) busy.add(id);
      else busy.delete(id);
    }
    set({ busy });
  },
}));
