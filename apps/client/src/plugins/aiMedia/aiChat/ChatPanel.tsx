import { revealItemPage } from '../../../lib/board/pages';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  ArrowUpIcon,
  CloseIcon,
  ExpandIcon,
  FitIcon,
  GearIcon,
  SparkleIcon,
  TelescopeIcon,
  BrainIcon,
} from '../../../components/icons';
import { useAssetUrl } from '../../../hooks/useAssetUrl';
import type { Item } from '@boardcache/schema';
import { renderMarkdown } from '../../../lib/text/markdown';
import { ensureHostedAi, enabledModels, useAIStore } from '../../../state/aiStore';
import { useDocumentStore } from '../../../state/documentStore';
import { useSessionStore } from '../../../state/sessionStore';
import { AGENT_PROVIDERS } from './adapters';
import type { AgentProviderId, NeutralMessage } from './adapters';
import { runAgentTurn } from './agent';
import { buildSystemPrompt } from './context';
import { mediaMeta } from '../../../lib/mediaItems';
import { fitViewportTo } from '../../../lib/canvas/viewportActions';
import { getCanvasContainer } from '../../../lib/canvas/canvasDom';
import { rotatedRectAABB } from '../../../lib/canvas/geometry';

/**
 * The contextual AI chat dock: converse about the board, act on it through
 * the tool registry. Docked right of the canvas by default; drag the header
 * to float it anywhere (edges tile it), resize it, or toggle it from the
 * corner cluster. Selection is live context; @ tags specific items.
 * Every conversation is kept as a thread per board (locally, images
 * stripped) — the History list reopens or deletes past threads.
 */

/** Select an item and fly the canvas to it (citation chips + inline cites). */
function revealItem(itemId: string): void {
  const session = useSessionStore.getState();
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item) return;
  if (session.view !== 'canvas') session.setView('canvas');
  revealItemPage(itemId);
  session.setSelection([itemId]);
  fitViewportTo(rotatedRectAABB(item), getCanvasContainer());
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Inline citations (progressive half of the citations UI): the system prompt
 * asks the model to cite items as [[item:ID]]; valid live ids become
 * clickable cite chips in the rendered reply, invalid ones degrade to
 * nothing. Runs AFTER markdown rendering — the tokens pass through markdown
 * as plain text.
 */
function injectInlineCitations(html: string): string {
  const items = useDocumentStore.getState().doc.items;
  return html.replace(/\[\[item:([A-Za-z0-9-]{6,64})\]\]/g, (_all, id: string) => {
    const item = items[id];
    if (!item) return '';
    const title = mediaMeta(item).title;
    return `<button type="button" class="chat-cite" data-item-ref="${escapeHtml(id)}" title="Jump to ${escapeHtml(title)}">${escapeHtml(title.length > 32 ? `${title.slice(0, 31)}…` : title)}</button>`;
  });
}

/** Assistant reply: markdown body (with inline cites) + a Sources chip row. */
function AssistantMessage({ entry }: { entry: DisplayEntry }) {
  const doc = useDocumentStore((s) => s.doc);
  const liveSources = (entry.sources ?? []).filter((id) => doc.items[id]);
  return (
    <div className="chat-msg assistant" data-testid="chat-assistant-msg">
      <div
        className="md-rendered"
        onClick={(e) => {
          const cite = (e.target as HTMLElement).closest?.('.chat-cite');
          const id = cite?.getAttribute('data-item-ref');
          if (id) revealItem(id);
        }}
        dangerouslySetInnerHTML={{ __html: injectInlineCitations(renderMarkdown(entry.text)) }}
      />
      {liveSources.length > 0 && (
        <div className="chat-sources" data-testid="chat-sources">
          <span className="chat-sources-label">Sources</span>
          {liveSources.map((id) => (
            <button
              key={id}
              type="button"
              className="chat-source-chip"
              data-testid={`chat-source-${id}`}
              onClick={() => revealItem(id)}
            >
              {(() => {
                const t = mediaMeta(doc.items[id]!).title;
                return t.length > 28 ? `${t.slice(0, 27)}…` : t;
              })()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface DisplayEntry {
  kind: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
  ok?: boolean;
  /** Items whose content the model read for this reply (citations row). */
  sources?: string[];
}

interface PanelPos {
  x: number;
  y: number;
}

interface PanelSize {
  w: number;
  h: number;
}

const MIN_W = 320;
const DEEP_PREF = 'refboard.chat.deep';
const MIN_H = 260;
const MIN_FS = 11;
const MAX_FS = 18;

interface ChatState {
  open: boolean;
  busy: string | null;
  /** Deep-research mode armed: the next sends run the research pipeline. */
  research: boolean;
  /** Think harder: hosted turns go to the frontier model at its own price. */
  deep: boolean;
  entries: DisplayEntry[];
  history: NeutralMessage[];
  boardId: string | null;
  threadId: string | null;
  /** The item this conversation is about (per-item chats), else null. */
  itemId: string | null;
  /** null = docked at the default right edge. */
  pos: PanelPos | null;
  size: PanelSize;
  opacity: number;
  fontSize: number;
  toggle: () => void;
  setResearch: (on: boolean) => void;
  setDeep: (on: boolean) => void;
  newThread: () => void;
  openThread: (id: string) => void;
  /** Open (or lazily prepare) the conversation attached to an item. */
  openItemThread: (itemId: string) => void;
  /** Persist the live conversation into its board's thread list. */
  persistActive: () => void;
  deleteThread: (id: string) => void;
  setPos: (pos: PanelPos | null) => void;
  setSize: (size: PanelSize) => void;
  setOpacity: (opacity: number) => void;
  setFontSize: (fontSize: number) => void;
}

const PANEL_PREF = 'boardcache:chatPanel';

interface PanelPrefs {
  pos: PanelPos | null;
  size: PanelSize;
  opacity: number;
  fontSize: number;
}

function loadPanelPrefs(): PanelPrefs {
  const defaults: PanelPrefs = { pos: null, size: { w: 350, h: 520 }, opacity: 1, fontSize: 13 };
  try {
    const raw = JSON.parse(localStorage.getItem(PANEL_PREF) ?? '{}') as Partial<PanelPrefs>;
    return {
      pos: raw.pos ?? null,
      size: raw.size ?? defaults.size,
      opacity: raw.opacity ?? 1,
      fontSize: raw.fontSize ?? 13,
    };
  } catch {
    return defaults;
  }
}

function savePanelPrefs(state: ChatState) {
  try {
    const { pos, size, opacity, fontSize } = state;
    localStorage.setItem(PANEL_PREF, JSON.stringify({ pos, size, opacity, fontSize }));
  } catch {
    /* storage unavailable */
  }
}

// --- per-board conversation threads (local only, images stripped) ---------------

interface ChatThread {
  id: string;
  title: string;
  updatedAt: number;
  entries: DisplayEntry[];
  history: NeutralMessage[];
  /** Set for per-item conversations ("chat with item"). */
  itemId?: string;
}

interface ThreadStore {
  activeId: string | null;
  threads: ChatThread[];
}

const LOG_PREF = 'boardcache:chatLog:';
const MAX_THREADS = 20;
const LOG_MAX_ENTRIES = 60;
const LOG_MAX_HISTORY = 40;

function newThreadId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `t-${Math.random().toString(36).slice(2)}`;
}

function threadTitle(entries: DisplayEntry[]): string {
  const first = entries.find((e) => e.kind === 'user');
  const text = (first?.text ?? 'Conversation').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function loadThreadStore(boardId: string): ThreadStore {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_PREF + boardId) ?? 'null') as
      | (Partial<ThreadStore> & { entries?: DisplayEntry[]; history?: NeutralMessage[] })
      | null;
    if (!raw) return { activeId: null, threads: [] };
    // Migrate the pre-thread single-transcript shape.
    if (Array.isArray(raw.entries)) {
      const id = newThreadId();
      return {
        activeId: id,
        threads: [
          {
            id,
            title: threadTitle(raw.entries),
            updatedAt: Date.now(),
            entries: raw.entries,
            history: raw.history ?? [],
          },
        ],
      };
    }
    return { activeId: raw.activeId ?? null, threads: raw.threads ?? [] };
  } catch {
    return { activeId: null, threads: [] };
  }
}

function storeThreadStore(boardId: string, data: ThreadStore) {
  try {
    const threads = [...data.threads]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_THREADS);
    localStorage.setItem(LOG_PREF + boardId, JSON.stringify({ ...data, threads }));
  } catch {
    /* storage unavailable / full — the chat just won't persist */
  }
}

/** Upsert the live conversation into its board's thread list. */
function saveActiveThread(
  boardId: string,
  threadId: string,
  entries: DisplayEntry[],
  history: NeutralMessage[],
  itemId?: string | null,
) {
  const store = loadThreadStore(boardId);
  store.activeId = threadId;
  if (entries.length === 0 && history.length === 0) {
    storeThreadStore(boardId, store);
    return;
  }
  const slimHistory = history.slice(-LOG_MAX_HISTORY).map((m) => {
    if (m.role === 'user' && m.images) {
      const { images: _drop, ...rest } = m;
      return rest;
    }
    return m;
  });
  const thread: ChatThread = {
    id: threadId,
    title: threadTitle(entries),
    updatedAt: Date.now(),
    entries: entries.slice(-LOG_MAX_ENTRIES),
    history: slimHistory,
    ...(itemId ? { itemId } : {}),
  };
  const at = store.threads.findIndex((t) => t.id === threadId);
  if (at >= 0) store.threads[at] = thread;
  else store.threads.push(thread);
  storeThreadStore(boardId, store);
}

export const useChatStore = create<ChatState>((set, get) => ({
  open: false,
  busy: null,
  research: false,
  setResearch: (research) => set({ research }),
  deep: localStorage.getItem(DEEP_PREF) === '1',
  setDeep: (deep) => {
    localStorage.setItem(DEEP_PREF, deep ? '1' : '0');
    set({ deep });
  },
  entries: [],
  history: [],
  boardId: null,
  threadId: null,
  itemId: null,
  ...loadPanelPrefs(),
  toggle: () => set({ open: !get().open }),
  newThread: () => {
    const { boardId, entries } = get();
    if (entries.length === 0) return; // already a fresh thread
    const threadId = newThreadId();
    set({ entries: [], history: [], threadId, itemId: null, busy: null });
    if (boardId) {
      const store = loadThreadStore(boardId);
      store.activeId = threadId;
      storeThreadStore(boardId, store);
    }
  },
  openThread: (id) => {
    const { boardId } = get();
    if (!boardId) return;
    const store = loadThreadStore(boardId);
    const thread = store.threads.find((t) => t.id === id);
    if (!thread) return;
    set({
      entries: thread.entries,
      history: thread.history,
      threadId: id,
      itemId: thread.itemId ?? null,
      busy: null,
    });
    store.activeId = id;
    storeThreadStore(boardId, store);
  },
  openItemThread: (itemId) => {
    // Works before the floating panel ever opened: derive the board id.
    const boardId = get().boardId ?? useDocumentStore.getState().doc.id;
    set({ boardId });
    const store = loadThreadStore(boardId);
    const existing = store.threads.find((t) => t.itemId === itemId);
    if (existing) {
      set({
        entries: existing.entries,
        history: existing.history,
        threadId: existing.id,
        itemId,
        busy: null,
      });
      store.activeId = existing.id;
      storeThreadStore(boardId, store);
      return;
    }
    // No conversation yet — prepare a fresh one; it persists on first send.
    set({ entries: [], history: [], threadId: newThreadId(), itemId, busy: null });
  },
  persistActive: () => {
    const { boardId, threadId, entries, history, itemId } = get();
    if (boardId && threadId) saveActiveThread(boardId, threadId, entries, history, itemId);
  },
  deleteThread: (id) => {
    const { boardId, threadId } = get();
    if (!boardId) return;
    const store = loadThreadStore(boardId);
    store.threads = store.threads.filter((t) => t.id !== id);
    if (store.activeId === id) store.activeId = null;
    storeThreadStore(boardId, store);
    if (threadId === id)
      set({ entries: [], history: [], threadId: newThreadId(), itemId: null, busy: null });
  },
  setPos: (pos) => {
    set({ pos });
    savePanelPrefs(get());
  },
  setSize: (size) => {
    set({ size });
    savePanelPrefs(get());
  },
  setOpacity: (opacity) => {
    set({ opacity });
    savePanelPrefs(get());
  },
  setFontSize: (fontSize) => {
    set({ fontSize });
    savePanelPrefs(get());
  },
}));

const MODEL_PREF = 'boardcache:chatModel';

/** Small visual preview for @-mention rows: real pixels when the item has
 *  any (image/video poster), a color chip for swatches, else a type glyph. */
function MentionThumb({ item }: { item: Item | undefined }) {
  const assetId =
    item?.type === 'image'
      ? (item.previewAssetId ?? item.assetId)
      : item?.type === 'video'
        ? item.posterAssetId
        : item?.type === 'pdf'
          ? null
          : null;
  const url = useAssetUrl(assetId ?? null);
  if (!item) return <span className="chat-mention-thumb" />;
  if (url) return <img className="chat-mention-thumb" src={url} alt="" draggable={false} />;
  if (item.type === 'swatch') {
    return <span className="chat-mention-thumb" style={{ background: item.color }} />;
  }
  if (item.type === 'link') {
    return (
      <span className="chat-mention-thumb" style={{ background: item.background }}>
        🔗
      </span>
    );
  }
  return (
    <span className="chat-mention-thumb chat-mention-thumb-type">
      {item.type.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** An @-mention suggestion / committed tag. */
interface Mention {
  id: string;
  label: string;
  type: string;
}

function mentionLabel(item: { id: string; type: string; name?: string | undefined }): string {
  return item.name?.trim() || `${item.type}-${item.id.slice(0, 4)}`;
}

/** The active "@query" immediately before the caret, if any. */
function detectMention(value: string, caret: number): { q: string; start: number } | null {
  const upToCaret = value.slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(upToCaret);
  if (!m) return null;
  return { q: m[2]!, start: caret - m[2]!.length - 1 };
}

// --- edge tiling (macOS-style drag-and-hold snap) -------------------------------

type SnapZone = 'left' | 'right' | 'top' | 'bottom';

const SNAP_HOLD_MS = 250;
const SNAP_MARGIN = 8;
const SNAP_TOP = 44; // below the menu bar, matches the docked position

function snapZoneAt(x: number, y: number): SnapZone | null {
  if (x < 32) return 'left';
  if (x > window.innerWidth - 32) return 'right';
  if (y < 56) return 'top';
  if (y > window.innerHeight - 32) return 'bottom';
  return null;
}

function snapRect(zone: SnapZone): { x: number; y: number; w: number; h: number } {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const availW = W - SNAP_MARGIN * 2;
  const availH = H - SNAP_TOP - SNAP_MARGIN;
  const halfW = Math.round((availW - SNAP_MARGIN) / 2);
  const halfH = Math.round((availH - SNAP_MARGIN) / 2);
  switch (zone) {
    case 'left':
      return { x: SNAP_MARGIN, y: SNAP_TOP, w: halfW, h: availH };
    case 'right':
      return { x: SNAP_MARGIN + halfW + SNAP_MARGIN, y: SNAP_TOP, w: halfW, h: availH };
    case 'top':
      return { x: SNAP_MARGIN, y: SNAP_TOP, w: availW, h: halfH };
    case 'bottom':
      return { x: SNAP_MARGIN, y: SNAP_TOP + halfH + SNAP_MARGIN, w: availW, h: halfH };
  }
}

export function ChatPanel() {
  const open = useChatStore((s) => s.open);
  const view = useSessionStore((s) => s.view);
  // The assistant is board-scoped: closing the board (or entering the
  // gallery/index) closes the window — it must never float over the index,
  // and reopening on a different board must not show a stale thread.
  useEffect(() => {
    if (view !== 'canvas' && useChatStore.getState().open) {
      useChatStore.setState({ open: false });
    }
  }, [view]);
  return open && view === 'canvas' ? <ChatPanelBody /> : null;
}

function ChatPanelBody() {
  const entries = useChatStore((s) => s.entries);
  const busy = useChatStore((s) => s.busy);
  const research = useChatStore((s) => s.research);
  const deep = useChatStore((s) => s.deep);
  const deepOp = useAIStore((s) => s.hosted?.ops.deep ?? null);
  const pos = useChatStore((s) => s.pos);
  const size = useChatStore((s) => s.size);
  const opacity = useChatStore((s) => s.opacity);
  const fontSize = useChatStore((s) => s.fontSize);
  const threadId = useChatStore((s) => s.threadId);
  const boardId = useDocumentStore((s) => s.doc.id);
  const selection = useSessionStore((s) => s.selection);
  const doc = useDocumentStore((s) => s.doc);
  const fontFamily = useSessionStore((s) => s.textDefaults.fontFamily);
  useAIStore((s) => s.providers); // re-render when models get enabled
  const hostedInfo = useAIStore((s) => s.hosted);
  useEffect(() => void ensureHostedAi(), []);

  const [draft, setDraft] = useState('');
  const [modelKey, setModelKey] = useState(() => localStorage.getItem(MODEL_PREF) ?? '');
  const [contextPreview, setContextPreview] = useState<string | null>(null);
  const [threadList, setThreadList] = useState<ChatThread[] | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [sideBump, setSideBump] = useState(0); // forces a sidebar re-read
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionQ, setMentionQ] = useState<{ q: string; start: number } | null>(null);
  const [mentionSel, setMentionSel] = useState(0);
  const [snapZone, setSnapZone] = useState<SnapZone | null>(null);
  const snapRef = useRef<{ zone: SnapZone | null; shown: SnapZone | null; timer: number | null }>({
    zone: null,
    shown: null,
    timer: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // A different board = its own threads; reopen the one that was active.
  useEffect(() => {
    const s = useChatStore.getState();
    if (s.boardId === boardId) return;
    const store = loadThreadStore(boardId);
    const thread =
      store.threads.find((t) => t.id === store.activeId) ??
      (store.activeId ? null : [...store.threads].sort((a, b) => b.updatedAt - a.updatedAt)[0]);
    useChatStore.setState({
      boardId,
      threadId: thread?.id ?? store.activeId ?? newThreadId(),
      entries: thread?.entries ?? [],
      history: thread?.history ?? [],
      busy: null,
    });
  }, [boardId]);

  // Persist the live thread as it grows.
  useEffect(() => {
    const s = useChatStore.getState();
    if (s.boardId === boardId && s.threadId && s.entries.length) {
      saveActiveThread(boardId, s.threadId, s.entries, s.history);
    }
  }, [entries, boardId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries, busy]);

  const models = enabledModels().filter((m) =>
    m.providerId === 'hosted'
      ? Boolean(hostedInfo?.ops.agent)
      : (AGENT_PROVIDERS as string[]).includes(m.providerId),
  );
  const active =
    models.find((m) => `${m.providerId}::${m.model}` === modelKey) ?? models[0] ?? null;

  const selectedNames = selection
    .map((id) => doc.items[id])
    .filter(Boolean)
    .map((i) => i!.name || i!.type);

  const suggestions = useMemo<Mention[]>(() => {
    if (!mentionQ) return [];
    const q = mentionQ.q.toLowerCase();
    return Object.values(doc.items)
      .map((item) => ({ id: item.id, label: mentionLabel(item), type: item.type }))
      .filter((m) => !q || m.label.toLowerCase().includes(q) || m.type.toLowerCase().includes(q))
      .slice(0, 40);
  }, [mentionQ, doc.items]);

  const refreshMention = (value: string, caret: number) => {
    setMentionQ(detectMention(value, caret));
    setMentionSel(0);
  };

  const pickMention = (m: Mention) => {
    if (!mentionQ) return;
    const end = mentionQ.start + 1 + mentionQ.q.length;
    const next = `${draft.slice(0, mentionQ.start)}@${m.label} ${draft.slice(end)}`;
    setDraft(next);
    setMentions((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    setMentionQ(null);
    const caret = mentionQ.start + m.label.length + 2;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };

  const refreshThreadList = () => {
    const store = loadThreadStore(boardId);
    setThreadList([...store.threads].sort((a, b) => b.updatedAt - a.updatedAt));
  };

  // Sidebar threads re-read whenever the maximized view is up and the
  // conversation advances (titles/ordering change as messages land).
  // threadId/entries.length are intentional extra deps: the store file
  // changes when the conversation advances, invisibly to React.
  const sideDeps = `${threadId}:${entries.length}:${sideBump}`;
  const sideThreads = useMemo<ChatThread[]>(() => {
    if (!maximized) return [];
    void sideDeps;
    const store = loadThreadStore(boardId);
    return [...store.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [maximized, boardId, sideDeps]);

  const startPanelDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const start = { mx: e.clientX, my: e.clientY, px: rect.left, py: rect.top };
    // The size the panel will have once floating (docked panels stretch taller).
    const dragW = size.w;
    const dragH = Math.min(size.h, window.innerHeight - 16);
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.mx, ev.clientY - start.my) < 3) return;
      moved = true;
      // Fully on-screen, always.
      useChatStore.getState().setPos({
        x: Math.max(8, Math.min(window.innerWidth - dragW - 8, start.px + ev.clientX - start.mx)),
        y: Math.max(8, Math.min(window.innerHeight - dragH - 8, start.py + ev.clientY - start.my)),
      });
      // Edge tiling: entering a zone starts the hold timer; the preview shows
      // after SNAP_HOLD_MS and releasing while it's visible applies the tile.
      const zone = snapZoneAt(ev.clientX, ev.clientY);
      const sr = snapRef.current;
      if (zone !== sr.zone) {
        sr.zone = zone;
        if (sr.timer !== null) {
          clearTimeout(sr.timer);
          sr.timer = null;
        }
        if (sr.shown) {
          sr.shown = null;
          setSnapZone(null);
        }
        if (zone) {
          sr.timer = window.setTimeout(() => {
            sr.shown = zone;
            setSnapZone(zone);
          }, SNAP_HOLD_MS);
        }
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const sr = snapRef.current;
      if (sr.timer !== null) clearTimeout(sr.timer);
      if (sr.shown) {
        const r = snapRect(sr.shown);
        const st = useChatStore.getState();
        st.setPos({ x: r.x, y: r.y });
        st.setSize({ w: r.w, h: r.h });
      }
      sr.zone = null;
      sr.shown = null;
      sr.timer = null;
      setSnapZone(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** Left-edge grip: width only (works docked and floating). */
  const startResizeWest = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const onMove = (ev: PointerEvent) => {
      const w = Math.round(
        Math.max(MIN_W, Math.min(window.innerWidth - 16, rect.right - ev.clientX)),
      );
      useChatStore.getState().setSize({ ...useChatStore.getState().size, w });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** Bottom-right grip: free resize (floating only). */
  const startResizeCorner = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const onMove = (ev: PointerEvent) => {
      useChatStore.getState().setSize({
        w: Math.round(Math.max(MIN_W, Math.min(window.innerWidth - 16, ev.clientX - rect.left))),
        h: Math.round(Math.max(MIN_H, Math.min(window.innerHeight - 16, ev.clientY - rect.top))),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !active) return;
    // Only tags whose "@label" survived editing count.
    const mentionIds = mentions.filter((m) => text.includes(`@${m.label}`)).map((m) => m.id);
    setDraft('');
    setMentions([]);
    setMentionQ(null);
    const push = (entry: DisplayEntry) =>
      useChatStore.setState((s) => ({ entries: [...s.entries, entry] }));
    push({ kind: 'user', text });
    useChatStore.setState({ busy: 'Thinking' });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const focusItemId = useChatStore.getState().itemId;
      const research = useChatStore.getState().research && !focusItemId;
      const deep = useChatStore.getState().deep && active.providerId === 'hosted';
      const history = await runAgentTurn({
        research,
        deep,
        providerId: active.providerId as AgentProviderId | 'hosted',
        model: active.model,
        history: useChatStore.getState().history,
        userText: text,
        mentionIds,
        ...(focusItemId ? { focusItemId } : {}),
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'status') useChatStore.setState({ busy: event.label });
          else if (event.type === 'tool') push({ kind: 'tool', text: event.summary, ok: event.ok });
          else {
            push({
              kind: 'assistant',
              text: event.text,
              ...(event.sources?.length ? { sources: event.sources } : {}),
            });
          }
        },
      });
      useChatStore.setState({ history, busy: null });
      const s = useChatStore.getState();
      if (s.threadId) saveActiveThread(boardId, s.threadId, s.entries, history, s.itemId);
    } catch (err) {
      push({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' });
      useChatStore.setState({ busy: null });
    } finally {
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const floating = pos !== null;
  const floatH = Math.min(size.h, window.innerHeight - 16);
  const vars: React.CSSProperties & Record<'--chat-op' | '--chat-fs', string> = {
    '--chat-op': String(opacity),
    '--chat-fs': `${fontSize}px`,
    fontFamily,
  };
  const style: React.CSSProperties = {
    ...vars,
    width: size.w,
    ...(floating
      ? {
          left: Math.max(8, Math.min(pos.x, window.innerWidth - size.w - 8)),
          top: Math.max(8, Math.min(pos.y, window.innerHeight - floatH - 8)),
          right: 'auto' as const,
          bottom: 'auto' as const,
          height: floatH,
        }
      : {}),
  };

  const preview = snapZone ? snapRect(snapZone) : null;

  return (
    <>
      {preview && (
        <div
          className="chat-snap-preview"
          data-testid="chat-snap-preview"
          style={{ left: preview.x, top: preview.y, width: preview.w, height: preview.h }}
        />
      )}
      <aside
        ref={panelRef}
        className={`chat-panel${floating ? ' floating' : ''}${maximized ? ' maximized' : ''}`}
        style={maximized ? vars : style}
        data-testid="chat-panel"
      >
        {maximized && (
          <nav className="chat-sidebar" data-testid="chat-sidebar">
            <button
              type="button"
              className="chat-sidebar-new"
              data-testid="chat-sidebar-new"
              onClick={() => useChatStore.getState().newThread()}
            >
              + New conversation
            </button>
            <div className="chat-sidebar-list">
              {sideThreads.length === 0 && <p className="chat-empty">No conversations yet.</p>}
              {sideThreads.map((t) => (
                <div
                  key={t.id}
                  className={`chat-thread-row${t.id === threadId ? ' active' : ''}`}
                  data-testid="chat-sidebar-thread"
                >
                  <button
                    type="button"
                    className="chat-thread-open"
                    onClick={() => useChatStore.getState().openThread(t.id)}
                  >
                    <span className="chat-thread-title">{t.title}</span>
                    <span className="chat-thread-date">
                      {new Date(t.updatedAt).toLocaleString([], {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-thread-delete"
                    title="Delete conversation"
                    aria-label="Delete conversation"
                    onClick={() => {
                      useChatStore.getState().deleteThread(t.id);
                      setSideBump((b) => b + 1);
                    }}
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          </nav>
        )}
        <header
          className="chat-head"
          onPointerDown={startPanelDrag}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            setMaximized((m) => !m);
          }}
          data-testid="chat-head"
        >
          <span className="chat-title">
            <SparkleIcon size={14} /> Board Assistant
          </span>
          <div className="chat-head-actions">
            <button
              type="button"
              title="Show exactly what context is sent to the model"
              data-testid="chat-context-preview"
              onClick={() => void buildSystemPrompt().then(setContextPreview)}
            >
              Context
            </button>
            {!maximized && (
              <button
                type="button"
                title="Past conversations on this board"
                data-testid="chat-history"
                onClick={refreshThreadList}
              >
                History
              </button>
            )}
            <button
              type="button"
              title="Start a new conversation"
              data-testid="chat-new"
              onClick={() => useChatStore.getState().newThread()}
            >
              New
            </button>
            <button
              type="button"
              title={maximized ? 'Exit full screen' : 'Full screen with conversation sidebar'}
              aria-label={maximized ? 'Exit full screen' : 'Full screen'}
              data-testid="chat-maximize"
              onClick={() => setMaximized((m) => !m)}
            >
              {maximized ? <FitIcon size={14} /> : <ExpandIcon size={14} />}
            </button>
            <button
              type="button"
              aria-label="Close"
              data-testid="chat-close"
              onClick={() => useChatStore.getState().toggle()}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </header>

        {models.length === 0 ? (
          <p className="chat-empty" data-testid="chat-nomodels">
            Enable a text model first (Settings → Plugins → AI Generation). Anthropic, OpenAI, xAI
            and Ollama models can drive the assistant.
          </p>
        ) : (
          <>
            <div className="chat-scroll" ref={scrollRef} data-testid="chat-scroll">
              {entries.length === 0 && (
                <p className="chat-empty">
                  Ask about the board or tell me what to change — “organize these into a grid”,
                  “summarize the notes”, “add a palette from this photo”. Selected items are my
                  context; type @ to tag a specific item.
                </p>
              )}
              {entries.map((entry, i) =>
                entry.kind === 'tool' ? (
                  <div
                    key={i}
                    className={`chat-toolchip${entry.ok === false ? ' failed' : ''}`}
                    data-testid="chat-toolchip"
                  >
                    <GearIcon size={12} /> {entry.text}
                  </div>
                ) : entry.kind === 'user' ? (
                  <div key={i} className="chat-msg user" data-testid="chat-user-msg">
                    {entry.text}
                  </div>
                ) : entry.kind === 'error' ? (
                  <div key={i} className="chat-msg error" role="alert">
                    {entry.text}
                  </div>
                ) : (
                  <AssistantMessage key={i} entry={entry} />
                ),
              )}
              {busy && (
                <div className="chat-busy" data-testid="chat-busy">
                  <span className="pending-import-spinner" aria-hidden /> {busy}
                  <button type="button" onClick={stop} data-testid="chat-stop">
                    Stop
                  </button>
                </div>
              )}
            </div>

            <footer className="chat-foot">
              {mentionQ !== null && suggestions.length > 0 && (
                <div className="chat-mention-pop" data-testid="chat-mention-pop">
                  {suggestions.map((m, i) => (
                    <button
                      type="button"
                      key={m.id}
                      className={`chat-mention-row${i === mentionSel ? ' active' : ''}`}
                      data-testid="chat-mention-row"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickMention(m);
                      }}
                    >
                      <MentionThumb item={doc.items[m.id]} />
                      <span className="chat-mention-label">@{m.label}</span>
                      <span className="chat-mention-type">{m.type}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedNames.length > 0 && (
                <div className="chat-chips" data-testid="chat-selection-chips">
                  {selectedNames.slice(0, 4).map((n, i) => (
                    <span className="chat-chip" key={i}>
                      {n}
                    </span>
                  ))}
                  {selectedNames.length > 4 && (
                    <span className="chat-chip">+{selectedNames.length - 4}</span>
                  )}
                </div>
              )}
              <div className="chat-composer">
                <textarea
                  ref={inputRef}
                  className="chat-input"
                  value={draft}
                  placeholder={
                    research
                      ? 'Deep research armed — name a topic to build a sourced board'
                      : 'Ask or instruct @ tags an item'
                  }
                  data-testid="chat-input"
                  rows={2}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    refreshMention(
                      e.target.value,
                      e.target.selectionStart ?? e.target.value.length,
                    );
                  }}
                  onClick={(e) => {
                    const el = e.currentTarget;
                    refreshMention(el.value, el.selectionStart ?? el.value.length);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (mentionQ !== null && suggestions.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setMentionSel((s) => (s + 1) % suggestions.length);
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setMentionSel((s) => (s - 1 + suggestions.length) % suggestions.length);
                        return;
                      }
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        pickMention(suggestions[mentionSel] ?? suggestions[0]!);
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setMentionQ(null);
                        return;
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="chat-composer-row">
                  <button
                    type="button"
                    className="chat-font-btn"
                    title="Smaller text"
                    aria-label="Smaller text"
                    data-testid="chat-font-minus"
                    disabled={fontSize <= MIN_FS}
                    onClick={() =>
                      useChatStore.getState().setFontSize(Math.max(MIN_FS, fontSize - 1))
                    }
                  >
                    A−
                  </button>
                  <button
                    type="button"
                    className="chat-font-btn"
                    title="Larger text"
                    aria-label="Larger text"
                    data-testid="chat-font-plus"
                    disabled={fontSize >= MAX_FS}
                    onClick={() =>
                      useChatStore.getState().setFontSize(Math.min(MAX_FS, fontSize + 1))
                    }
                  >
                    A+
                  </button>
                  <button
                    type="button"
                    className={research ? 'chat-research-btn active' : 'chat-research-btn'}
                    title="Deep research: search, read pages, and build a sourced evidence board"
                    aria-pressed={research}
                    data-testid="chat-research-toggle"
                    onClick={() => useChatStore.getState().setResearch(!research)}
                  >
                    <TelescopeIcon size={14} />
                  </button>
                  {active?.providerId === 'hosted' && deepOp && (
                    <button
                      type="button"
                      className={deep ? 'chat-research-btn active' : 'chat-research-btn'}
                      title={`Think harder: the frontier model (${deepOp.model}), ${deepOp.credits} credits a step`}
                      aria-pressed={deep}
                      data-testid="chat-deep-toggle"
                      onClick={() => useChatStore.getState().setDeep(!deep)}
                    >
                      <BrainIcon size={14} />
                    </button>
                  )}
                  <select
                    className="chat-model"
                    value={active ? `${active.providerId}::${active.model}` : ''}
                    data-testid="chat-model"
                    onChange={(e) => {
                      setModelKey(e.target.value);
                      localStorage.setItem(MODEL_PREF, e.target.value);
                    }}
                  >
                    {models.map((m) => (
                      <option
                        key={`${m.providerId}::${m.model}`}
                        value={`${m.providerId}::${m.model}`}
                      >
                        {m.providerId === 'hosted'
                          ? 'boardCache Cloud'
                          : `${m.providerId} · ${m.model}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="chat-send"
                    aria-label="Send"
                    title="Send"
                    disabled={!draft.trim() || busy !== null}
                    data-testid="chat-send"
                    onClick={() => void send()}
                  >
                    <ArrowUpIcon size={15} />
                  </button>
                </div>
              </div>
            </footer>
          </>
        )}

        <div
          className="chat-resize-w"
          onPointerDown={startResizeWest}
          data-testid="chat-resize-w"
        />
        {floating && (
          <div
            className="chat-resize-se"
            onPointerDown={startResizeCorner}
            data-testid="chat-resize-se"
          />
        )}

        {threadList !== null && (
          <div className="chat-context-overlay" data-testid="chat-history-overlay">
            <div className="chat-context-box">
              <header>
                <strong>Conversations on this board</strong>
                <button type="button" onClick={() => setThreadList(null)} aria-label="Close">
                  <CloseIcon size={14} />
                </button>
              </header>
              <div className="chat-thread-list">
                {threadList.length === 0 && (
                  <p className="chat-empty">No saved conversations yet.</p>
                )}
                {threadList.map((t) => (
                  <div
                    key={t.id}
                    className={`chat-thread-row${t.id === threadId ? ' active' : ''}`}
                    data-testid="chat-thread-row"
                  >
                    <button
                      type="button"
                      className="chat-thread-open"
                      onClick={() => {
                        useChatStore.getState().openThread(t.id);
                        setThreadList(null);
                      }}
                    >
                      <span className="chat-thread-title">{t.title}</span>
                      <span className="chat-thread-date">
                        {new Date(t.updatedAt).toLocaleString([], {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="chat-thread-delete"
                      title="Delete conversation"
                      aria-label="Delete conversation"
                      data-testid="chat-thread-delete"
                      onClick={() => {
                        useChatStore.getState().deleteThread(t.id);
                        refreshThreadList();
                      }}
                    >
                      <CloseIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {contextPreview !== null && (
          <div className="chat-context-overlay" data-testid="chat-context-overlay">
            <div className="chat-context-box">
              <header>
                <strong>Sent to the model (live)</strong>
                <button type="button" onClick={() => setContextPreview(null)} aria-label="Close">
                  <CloseIcon size={14} />
                </button>
              </header>
              <pre>{contextPreview}</pre>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
