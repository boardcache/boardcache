import type { CanvasDocument } from '@boardcache/schema';
import { collectAssetIds, fixtureDocument } from '@boardcache/schema';
import { deleteAsset, hasAsset } from './board/assetStore';
import { missingOnServer, pullAssets, pushAssets } from './sync/assetSync';
import { flushCurrentBoard, listBoards } from './board/boardLibrary';
import {
  devSimulateRemoteEdit,
  disableBoardSync,
  enableBoardSync,
  reconcile,
} from './sync/boardSync';
import { canPasteNow } from './import/pasteAction';
import { getSharedAudio } from './media/audioRegistry';
import { allSyncMeta } from './sync/syncMetaStore';
import { clientToCanvas } from './canvas/canvasDom';
import { useAppUpdate } from './appUpdate';
import { activeBoardTools, activeLibraryTools, runBoardTool, runToolTurn } from './tools/registry';
import './tools/coreTools'; // register the core toolset
import './tools/containerTools';
import './tools/editTools';
import { seedMediaBoard, seedStressBoard } from './stressSeed';
import { getPlatformCaps } from './platform';
import { lodStats } from './canvas/lod';
import { useCollabStore } from '../state/collabStore';
import { useDocumentStore } from '../state/documentStore';
import { useHistoryStore } from '../state/history';
import { useSessionStore } from '../state/sessionStore';

/**
 * Dev/test-only hooks (gated behind import.meta.env.DEV in App). The E2E
 * suite asserts against the document — the DOM is just a projection of it
 * (rule 3.1) — and the perf smoke test drives the stress seeder.
 */
// Long-task accounting for perfStats (main-thread stalls > 50ms).
let longTaskCount = 0;
let longTaskTotal = 0;
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTaskCount += 1;
      longTaskTotal += entry.duration;
    }
  }).observe({ type: 'longtask', buffered: true });
} catch {
  /* longtask unsupported — counters stay 0 */
}

interface BoardcacheDevTools {
  getDoc: () => CanvasDocument;
  /** Flush the board content index, then search it (e2e + console debugging). */
  searchBoard: (query: string) => Promise<{ id: string; type: string; snippet: string }[]>;
  semanticStats: () => Promise<{ enabled: boolean; state: string; vectors: number }>;
  rerankStats: () => Promise<{ enabled: boolean; state: string; reranks: number }>;
  clipStats: () => Promise<{ enabled: boolean; state: string; vectors: number; searches: number }>;
  searchLibrary: (query: string) => Promise<{
    hits: { boardId: string; boardName: string; itemId: string; snippet: string }[];
    boardsSearched: number;
    skippedLocked: number;
    skippedRemote: number;
    semanticBoards?: number;
  }>;
  getPlatformCaps: () => { rss: boolean; ai: boolean; screenshot: boolean; fontTtf: boolean };
  lodStats: () => { built: number; cached: number; pending: number };
  getSelection: () => string[];
  /** Test-only: the live team peers (presence fields included). */
  teamPeers: () => unknown[];
  /** Test-only: drive the busy overlay (label + optional progress fraction). */
  setBusy: (label: string | null, fraction?: number | null) => void;
  setSelection: (ids: string[]) => void;
  /** Light/dark preference, as Settings sets it (specs flip the theme with it). */
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  /** Tests: pretend a newer build is waiting (shows the Update pill). */
  simulateUpdate: () => void;
  historyLength: () => number;
  seedStress: (count?: number, seed?: number) => Promise<void>;
  /** Media-heavy seed (large JPEGs through the real import pipeline). */
  seedMedia: (count?: number) => Promise<void>;
  /** Long-task counts + decoded-image estimate for perf evaluation. */
  perfStats: () => {
    longTasks: number;
    longTaskMs: number;
    mountedImages: number;
    decodedMB: number;
  };
  resetPerfStats: () => void;
  setViewport: (x: number, y: number, scale: number) => void;
  /** Close the live IndexedDB handle WITHOUT clearing the cache — simulates
   *  iOS severing the connection while the page sleeps. */
  killDb: () => Promise<void>;
  /** Show the current board's canvas (tests boot at the library now). */
  openCanvas: () => void;
  /** Create a generic HTML embed (exercises the htmlembed item). */
  addHtmlEmbed: (html: string, title?: string) => Promise<string>;
  /** Board tool registry (headless testing + console driving). */
  listTools: () => { name: string; access: string; description: string }[];
  runTool: (name: string, args?: unknown) => Promise<unknown>;
  /** Run several tool calls as one undo step (like an assistant turn). */
  runToolTurn: (label: string, calls: { name: string; args?: unknown }[]) => Promise<unknown[]>;
  /** Persist the current board so a reload of /b/:id reopens it. */
  flushBoard: () => Promise<void>;
  /** Replace the open board's content with the schema fixture (one item of
   *  every type, all on one page) — the per-surface screenshot spec. */
  loadFixture: () => Promise<void>;
  /** Whether Paste would have content (internal or OS clipboard). */
  canPaste: () => boolean;
  /** Playback state of an audio item's shared element (tests/debugging). */
  audioState: (id: string) => { paused: boolean; currentTime: number; duration: number } | null;
}

/** Sync hooks, exercised by the sync E2E. */
interface BoardcacheSyncDevTools {
  assetIds: () => string[];
  hasAsset: (hash: string) => Promise<boolean>;
  deleteLocalAsset: (hash: string) => Promise<void>;
  missingOnServer: (hashes: string[]) => Promise<string[]>;
  pushAssets: (hashes: string[]) => Promise<number>;
  pullAssets: (hashes: string[]) => Promise<number>;
  // boards
  currentBoardId: () => string;
  enableBoardSync: (id: string) => Promise<void>;
  disableBoardSync: (id: string) => Promise<void>;
  reconcile: () => Promise<void>;
  simulateRemoteEdit: (id: string) => Promise<void>;
  /** Test-only: re-key the first NON-remote board record to `id` (simulates
   *  a kept-local board colliding with a server id after sign-out). */
  rewriteLocalBoardId: (id: string) => Promise<string>;
  syncMeta: () => Promise<unknown[]>;
  boards: () => Promise<
    Array<{ id: string; name: string; synced: boolean; locked: boolean; remote: boolean }>
  >;
  /** Test-only: push UI state into the sync store (activity/progress/detail). */
  setSyncUi: (update: Record<string, unknown>) => void;
  /** Test-only: one account-notice poll now instead of in 30s. */
  pollNotices: () => Promise<void>;
}

declare global {
  interface Window {
    __boardcache?: BoardcacheDevTools;
    __boardcacheStress?: (count?: number, seed?: number) => Promise<void>;
    __boardcacheSync?: BoardcacheSyncDevTools;
  }
}

export function exposeDevTools(): void {
  window.__boardcache = {
    getDoc: () => useDocumentStore.getState().doc,
    searchBoard: async (query) => {
      const { boardIndexReady, searchBoardHybrid } = await import('./search/boardIndex');
      await boardIndexReady();
      const hits = await searchBoardHybrid(query);
      return hits.map((h) => ({ id: h.id, type: h.type, snippet: h.snippet }));
    },
    semanticStats: async () => {
      const { semanticStats } = await import('./search/semanticIndex');
      return semanticStats();
    },
    rerankStats: async () => {
      const { rerankStats } = await import('./search/semanticIndex');
      return rerankStats();
    },
    clipStats: async () => {
      const { clipStats } = await import('./search/clipIndex');
      return clipStats();
    },
    searchLibrary: async (query) => {
      const { searchLibrary } = await import('./board/libraryIndex');
      return searchLibrary(query);
    },
    getPlatformCaps,
    lodStats,
    getSelection: () => useSessionStore.getState().selection,
    teamPeers: () => Object.values(useCollabStore.getState().peers),
    setBusy: (label, fraction = null) => {
      const s = useSessionStore.getState();
      s.setExportBusy(label);
      if (fraction !== null) s.setExportProgress(fraction);
    },
    setSelection: (ids) => useSessionStore.getState().setSelection(ids),
    setTheme: (theme) => useSessionStore.getState().setTheme(theme),
    simulateUpdate: () => useAppUpdate.getState().setReady(() => {}),
    historyLength: () => useHistoryStore.getState().entries.length,
    seedStress: seedStressBoard,
    seedMedia: seedMediaBoard,
    perfStats: () => ({
      longTasks: longTaskCount,
      longTaskMs: Math.round(longTaskTotal),
      mountedImages: document.querySelectorAll('.canvas-item img').length,
      decodedMB: Math.round(
        [...document.querySelectorAll<HTMLImageElement>('.canvas-item img')].reduce(
          (sum, img) => sum + img.naturalWidth * img.naturalHeight * 4,
          0,
        ) / 1048576,
      ),
    }),
    resetPerfStats: () => {
      longTaskCount = 0;
      longTaskTotal = 0;
    },
    setViewport: (x, y, scale) => useDocumentStore.getState().setViewport({ x, y, scale }),
    killDb: async () => {
      const { getDb } = await import('./db');
      (await getDb()).close();
    },
    openCanvas: () => useSessionStore.getState().setView('canvas'),
    addHtmlEmbed: async (html: string, title?: string) => {
      const { createHtmlEmbed } = await import('./import/createItems');
      const at = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
      return createHtmlEmbed(at, { html, ...(title ? { title } : {}) });
    },
    listTools: () =>
      [...activeBoardTools(), ...activeLibraryTools()].map((t) => ({
        name: t.name,
        access: t.access,
        description: t.description,
      })),
    runTool: (name, args) => runBoardTool(name, args),
    runToolTurn: (label, calls) =>
      runToolTurn(label, async () => {
        const out: unknown[] = [];
        for (const call of calls) out.push(await runBoardTool(call.name, call.args));
        return out;
      }),
    flushBoard: flushCurrentBoard,
    loadFixture: async () => {
      const { doc, replaceDoc } = useDocumentStore.getState();
      const fixture = fixtureDocument();
      // Every item on one page, visible, and spaced on a grid so framing one
      // shows only that one; the spec frames each in turn.
      const items = Object.fromEntries(
        Object.entries(fixture.items).map(([id, item], i) => {
          const { pageId: _page, hidden: _hidden, ...rest } = item;
          return [id, { ...rest, x: (i % 6) * 1600, y: Math.floor(i / 6) * 1400 } as typeof item];
        }),
      );
      replaceDoc({ ...fixture, id: doc.id, name: doc.name, pages: [], items });
      await flushCurrentBoard();
    },
    canPaste: canPasteNow,
    audioState: (id) => {
      const el = getSharedAudio(id);
      return el ? { paused: el.paused, currentTime: el.currentTime, duration: el.duration } : null;
    },
  };
  window.__boardcacheStress = seedStressBoard;
  window.__boardcacheSync = {
    assetIds: () => collectAssetIds(useDocumentStore.getState().doc),
    hasAsset,
    deleteLocalAsset: deleteAsset,
    missingOnServer,
    pushAssets: async (hashes: string[]) => (await pushAssets(hashes)).pushed,
    pullAssets,
    currentBoardId: () => useDocumentStore.getState().doc.id,
    enableBoardSync,
    disableBoardSync,
    reconcile,
    simulateRemoteEdit: (id) => devSimulateRemoteEdit(id),
    rewriteLocalBoardId: async (id) => {
      const { getDb } = await import('./db');
      const db = await getDb();
      const rec = (await db.getAll('boards')).find((r) => !r.remote);
      if (!rec) throw new Error('no local board');
      await db.delete('boards', rec.id);
      const doc =
        rec.doc && typeof rec.doc === 'object'
          ? { ...(rec.doc as Record<string, unknown>), id }
          : rec.doc;
      await db.put('boards', { ...rec, id, doc } as never);
      return rec.name;
    },
    pollNotices: async () => {
      const { pollUserNotices } = await import('./sync/userNotices');
      await pollUserNotices();
    },
    setSyncUi: (update) => {
      void import('../state/syncStore').then(({ useSyncStore }) =>
        useSyncStore.setState(update as never),
      );
    },
    syncMeta: allSyncMeta,
    boards: async () =>
      (await listBoards()).map((b) => ({
        id: b.id,
        name: b.name,
        synced: b.synced,
        locked: b.locked,
        remote: b.remote,
      })),
  };
}
