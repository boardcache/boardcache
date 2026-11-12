import { create } from 'zustand';
import type { EmailView } from '../../components/items/EmailReader';
import type { MailFolder, MailSummary } from './mailApi';

/**
 * UI state of the Email view: the account in view ('board' is the board's
 * own archive), its folders and the pages read so far (kept for the
 * session), the open message, the search, the folded folders, the compose
 * sheet and the account editor. Accounts are plugin settings; archived
 * messages are items.
 */

export const BOARD_ACCOUNT = 'board';

/** A page of a mailbox as read, newest first. */
export interface FolderPage {
  messages: MailSummary[];
  exists: number;
  firstSeq: number;
  loading: boolean;
  error: string | null;
  /** Nothing older to ask for. */
  done: boolean;
}

/** A message fetched from an account, parsed for the reader. */
export interface OpenMessage {
  key: string;
  view: EmailView;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  /** The source bytes, for saving to the board. */
  raw: Uint8Array;
  loading?: false;
}

export interface ComposeDraft {
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  /** The body as HTML when the message came with one (an edited draft). */
  html?: string | null;
  inReplyTo?: string;
  references?: string;
  /** The draft under edit: replaced once the message is sent or saved again. */
  draft?: { folder: string; uid: number };
}

/** The three panes a phone shows one at a time. */
type EmailPane = 'folders' | 'list' | 'reader';

/** Desktop pane widths, kept on the device. */
const PANE_LIMITS = {
  side: { min: 160, max: 420, fallback: 240 },
  list: { min: 240, max: 640, fallback: 340 },
} as const;
const widthKey = (pane: 'side' | 'list') => `boardcache:email${pane === 'side' ? 'Side' : 'List'}W`;
const clampWidth = (pane: 'side' | 'list', w: number) =>
  Math.round(Math.min(PANE_LIMITS[pane].max, Math.max(PANE_LIMITS[pane].min, w)));
function readWidth(pane: 'side' | 'list'): number {
  try {
    const n = Number(localStorage.getItem(widthKey(pane)));
    if (Number.isFinite(n) && n > 0) return clampWidth(pane, n);
  } catch {
    /* private mode */
  }
  return PANE_LIMITS[pane].fallback;
}

interface EmailState {
  accountId: string;
  /** The folder in view per account (a path); '' = the archive's root. */
  folder: Record<string, string>;
  /** The open message per account: an item id (board) or a uid (account). */
  selected: Record<string, string | null>;
  query: string;
  collapsed: Set<string>;
  folders: Record<string, { list: MailFolder[]; loading: boolean; error: string | null }>;
  pages: Record<string, FolderPage>;
  open: Record<
    string,
    OpenMessage | { key: string; loading: true } | { key: string; error: string }
  >;
  compose: ComposeDraft | null;
  accountDialog: { id: string | null } | null;
  pane: EmailPane;
  sideW: number;
  listW: number;
  setPaneWidth: (pane: 'side' | 'list', w: number) => void;
  setAccount: (id: string) => void;
  setFolder: (accountId: string, path: string) => void;
  setSelected: (accountId: string, id: string | null) => void;
  setQuery: (q: string) => void;
  toggleFolder: (path: string) => void;
  setFolders: (accountId: string, state: EmailState['folders'][string]) => void;
  setPage: (key: string, page: Partial<FolderPage>) => void;
  /** Drops a folder's page so it is read afresh when next in view. */
  forgetPage: (key: string) => void;
  setPageMessages: (key: string, fn: (list: MailSummary[]) => MailSummary[]) => void;
  setOpen: (key: string, state: EmailState['open'][string] | null) => void;
  setCompose: (draft: ComposeDraft | null) => void;
  setAccountDialog: (d: { id: string | null } | null) => void;
  setPane: (pane: EmailPane) => void;
}

export const pageKey = (accountId: string, folder: string) => `${accountId}\u0000${folder}`;
export const openKey = (accountId: string, folder: string, uid: number) =>
  `${accountId}\u0000${folder}\u0000${uid}`;

export const emptyPage = (): FolderPage => ({
  messages: [],
  exists: 0,
  firstSeq: 0,
  loading: false,
  error: null,
  done: false,
});

export const useEmailUi = create<EmailState>((set, get) => ({
  accountId: BOARD_ACCOUNT,
  folder: {},
  selected: {},
  query: '',
  collapsed: new Set(),
  folders: {},
  pages: {},
  open: {},
  compose: null,
  accountDialog: null,
  pane: 'list',
  sideW: readWidth('side'),
  listW: readWidth('list'),
  setPaneWidth: (pane, w) => {
    const width = clampWidth(pane, w);
    try {
      localStorage.setItem(widthKey(pane), String(width));
    } catch {
      /* private mode */
    }
    set(pane === 'side' ? { sideW: width } : { listW: width });
  },
  setAccount: (accountId) => set({ accountId, query: '', pane: 'list' }),
  setFolder: (accountId, path) =>
    set((s) => ({ folder: { ...s.folder, [accountId]: path }, pane: 'list' })),
  setSelected: (accountId, id) =>
    set((s) => ({
      selected: { ...s.selected, [accountId]: id },
      pane: id ? 'reader' : 'list',
    })),
  setQuery: (query) => set({ query }),
  toggleFolder: (path) => {
    const collapsed = new Set(get().collapsed);
    if (collapsed.has(path)) collapsed.delete(path);
    else collapsed.add(path);
    set({ collapsed });
  },
  setFolders: (accountId, state) => set((s) => ({ folders: { ...s.folders, [accountId]: state } })),
  setPage: (key, page) =>
    set((s) => ({ pages: { ...s.pages, [key]: { ...(s.pages[key] ?? emptyPage()), ...page } } })),
  forgetPage: (key) =>
    set((s) => {
      const pages = { ...s.pages };
      delete pages[key];
      return { pages };
    }),
  setPageMessages: (key, fn) =>
    set((s) => {
      const have = s.pages[key] ?? emptyPage();
      return { pages: { ...s.pages, [key]: { ...have, messages: fn(have.messages) } } };
    }),
  setOpen: (key, state) =>
    set((s) => {
      const open = { ...s.open };
      if (state) open[key] = state;
      else delete open[key];
      return { open };
    }),
  setCompose: (compose) => set({ compose }),
  setAccountDialog: (accountDialog) => set({ accountDialog }),
  setPane: (pane) => set({ pane }),
}));
