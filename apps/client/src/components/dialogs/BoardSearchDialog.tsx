import { revealItemPage } from '../../lib/board/pages';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  boardIndexReady,
  searchBoardHybrid,
  unindexedSummary,
  type BoardSearchHit,
} from '../../lib/search/boardIndex';
import { searchLibrary, type LibrarySearchResult } from '../../lib/board/libraryIndex';
import {
  onSemanticState,
  semanticState,
  semanticEnabled,
  setSemanticEnabled,
} from '../../lib/search/semanticIndex';
import { openBoard } from '../../lib/board/boardLibrary';
import { mediaMeta } from '../../lib/mediaItems';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { getCanvasContainer } from '../../lib/canvas/canvasDom';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * "Find on Board" (Ctrl/Cmd+Shift+F): keyword+semantic search over item
 * CONTENT. Two scopes: the open board (hybrid, live index) and All Boards —
 * every downloaded, unlocked board in the library (keyword; locked and
 * not-downloaded boards are skipped and SAID to be skipped). Picking a hit
 * selects the item and flies to it, opening its board first if needed.
 * cmdk-* classes: content-blocker-safe names (iOS notes).
 */

type Scope = 'board' | 'library';

interface Row {
  key: string;
  itemId: string;
  boardId: string | null; // null = current board
  boardName: string | null;
  title: string;
  type: string;
  snippet: string;
}

export function BoardSearchDialog() {
  const open = useSessionStore((s) => s.boardSearchOpen);
  return open ? <SearchBody /> : null;
}

function SearchBody() {
  const close = () => useSessionStore.getState().setBoardSearchOpen(false);
  const onBoard = useSessionStore.getState().view !== 'library';
  const [scope, setScope] = useState<Scope>(onBoard ? 'board' : 'library');
  const [query, setQuery] = useState(() => {
    // The library search field bridges here with its query pre-filled.
    const prefill = useSessionStore.getState().boardSearchPrefill;
    if (prefill !== null) useSessionStore.getState().setBoardSearchPrefill(null);
    return prefill ?? '';
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [libInfo, setLibInfo] = useState<LibrarySearchResult | null>(null);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    let alive = true;
    void (onBoard ? boardIndexReady() : Promise.resolve()).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Semantic model status for the footer (board scope only).
  const [sem, setSem] = useState(() => ({ ...semanticState(), enabled: semanticEnabled() }));
  useEffect(
    () => onSemanticState(() => setSem({ ...semanticState(), enabled: semanticEnabled() })),
    [],
  );

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const t = setTimeout(() => {
      if (scope === 'board') {
        void searchBoardHybrid(query).then((results) => {
          if (!alive) return;
          setRows(
            results.map((h: BoardSearchHit) => ({
              key: h.id,
              itemId: h.id,
              boardId: null,
              boardName: null,
              title: h.title,
              type: h.type,
              snippet: h.snippet,
            })),
          );
          setIndex(0);
        });
      } else {
        void searchLibrary(query).then((result) => {
          if (!alive) return;
          setLibInfo(result);
          setRows(
            result.hits.map((h) => ({
              key: `${h.boardId}:${h.itemId}`,
              itemId: h.itemId,
              boardId: h.boardId,
              boardName: h.boardName,
              title: h.title,
              type: h.type,
              snippet: h.snippet,
            })),
          );
          setIndex(0);
        });
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, ready, scope, sem.state]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const active = rows[Math.min(index, rows.length - 1)];

  const reveal = (itemId: string) => {
    const session = useSessionStore.getState();
    const item = useDocumentStore.getState().doc.items[itemId];
    if (!item) return;
    if (session.view !== 'canvas') session.setView('canvas');
    session.setSelection([itemId]);
    revealItemPage(item.id);
    fitViewportTo(rotatedRectAABB(item), getCanvasContainer());
  };

  const go = (row: Row | undefined) => {
    if (!row) return;
    close();
    const currentId = useDocumentStore.getState().doc.id;
    if (row.boardId === null || row.boardId === currentId) {
      reveal(row.itemId);
      return;
    }
    void openBoard(row.boardId).then((ok) => {
      if (ok) reveal(row.itemId);
    });
  };

  const label = (row: Row): string => {
    if (row.title) return row.title;
    if (row.boardId === null) {
      const item = useDocumentStore.getState().doc.items[row.itemId];
      if (item) return mediaMeta(item).title;
    }
    return row.type;
  };

  // Short text items derive their title from the body — don't echo it.
  const distinctSnippet = (row: Row): string => {
    const norm = (x: string) =>
      x
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .toLowerCase();
    const s = norm(row.snippet);
    const t = norm(label(row));
    if (!s || s.startsWith(t.slice(0, 80)) || t.startsWith(s.slice(0, 80))) return '';
    return row.snippet;
  };

  /** Multi-page boards: which page a board-scope hit lives on. */
  const pageBadge = (row: Row): string | null => {
    if (row.boardId !== null) return null; // library hits name their board
    const doc = useDocumentStore.getState().doc;
    if (doc.pages.length < 2) return null;
    const item = doc.items[row.itemId];
    if (!item) return null;
    const pid = item.pageId ?? doc.pages[0]!.id;
    return doc.pages.find((p) => p.id === pid)?.name ?? null;
  };

  return createPortal(
    <div className="cmdk-veil" data-testid="board-search" onClick={close}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bsr-scopes" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'board'}
            className={`map-tab${scope === 'board' ? ' active' : ''}`}
            data-testid="bsr-scope-board"
            disabled={!onBoard}
            onClick={() => setScope('board')}
          >
            This board
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'library'}
            className={`map-tab${scope === 'library' ? ' active' : ''}`}
            data-testid="bsr-scope-library"
            onClick={() => setScope('library')}
          >
            All boards
          </button>
        </div>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={query}
          placeholder={
            scope === 'board' ? 'Search board contents' : 'Search every downloaded board'
          }
          data-testid="board-search-input"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, rows.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(active);
            }
          }}
        />
        <div className="cmdk-list" ref={listRef} role="listbox" aria-label="Search results">
          {!ready ? (
            <p className="cmdk-empty">Indexing board</p>
          ) : query.trim() && rows.length === 0 ? (
            <p className="cmdk-empty">
              {scope === 'board' ? 'Nothing on this board matches.' : 'No board matches.'}
            </p>
          ) : !query.trim() ? (
            <p className="cmdk-empty">Search text, code, PDFs, notes, tags</p>
          ) : (
            rows.map((row) => (
              <button
                key={row.key}
                type="button"
                role="option"
                aria-selected={row === active}
                data-active={row === active || undefined}
                className={`cmdk-row bsr-row${row === active ? ' active' : ''}`}
                data-testid={`bsr-${row.key}`}
                onMouseEnter={() => setIndex(rows.indexOf(row))}
                onClick={() => go(row)}
              >
                <span className="cmdk-section">
                  {row.boardName ?? row.type}
                  {pageBadge(row) && <span className="bsr-page"> · {pageBadge(row)}</span>}
                </span>
                <span className="bsr-main">
                  <span className="cmdk-title">{label(row)}</span>
                  {distinctSnippet(row) && (
                    <span className="bsr-snippet">{distinctSnippet(row)}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
        {scope === 'board' ? (
          <CoverageNote onClose={close} />
        ) : (
          libInfo &&
          (libInfo.skippedLocked + libInfo.skippedRemote > 0 ||
            libInfo.semanticBoards !== undefined) && (
            <div className="bsr-coverage" data-testid="bsr-library-skips">
              <span>
                Searched {libInfo.boardsSearched} board{libInfo.boardsSearched === 1 ? '' : 's'}
                {libInfo.semanticBoards !== undefined &&
                  ` · semantic on ${libInfo.semanticBoards} of ${libInfo.boardsSearched} (open a board to index it)`}
                {libInfo.skippedLocked > 0 &&
                  ` · ${libInfo.skippedLocked} locked board${libInfo.skippedLocked === 1 ? '' : 's'} skipped`}
                {libInfo.skippedRemote > 0 &&
                  ` · ${libInfo.skippedRemote} not downloaded on this device`}
              </span>
            </div>
          )
        )}
        <div className="cmdk-hint">
          <span>↑↓ navigate</span>
          <span>↵ jump to item</span>
          <span>esc close</span>
          {scope === 'board' && (
            <span className="bsr-sem" data-testid="semantic-status">
              {!sem.enabled ? (
                <button
                  type="button"
                  className="bsr-sem-btn"
                  data-testid="semantic-enable"
                  title="Also match by meaning, not just keywords. Downloads a ~25 MB model that runs entirely on this device — no account needed, works offline afterwards."
                  onClick={() => void setSemanticEnabled(true)}
                >
                  Enable semantic search
                </button>
              ) : sem.state === 'loading' ? (
                <span>Downloading model {sem.pct}%</span>
              ) : sem.state === 'error' ? (
                <span>Semantic model failed — keyword search only</span>
              ) : (
                <button
                  type="button"
                  className="bsr-sem-btn on"
                  data-testid="semantic-disable"
                  title="Semantic matching is on (local model). Click to turn off."
                  onClick={() => void setSemanticEnabled(false)}
                >
                  Semantic ✓
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "N items aren't text-searchable" awareness line (user decision: OCR is
 *  manual per item, so unindexed content must be visible, not silent). */
function CoverageNote({ onClose }: { onClose: () => void }) {
  const [gaps] = useState(() => unindexedSummary());
  const total = gaps.images.length + gaps.media.length;
  if (total === 0) return null;
  const parts = [
    gaps.images.length
      ? `${gaps.images.length} image${gaps.images.length === 1 ? '' : 's'} without OCR text or a description`
      : '',
    gaps.media.length ? `${gaps.media.length} audio/video without a transcript` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div className="bsr-coverage" data-testid="bsr-coverage">
      <span>
        Content search skips {parts} — Extract Text (OCR), Generate Description, or Transcribe from
        the item’s context menu.
      </span>
      <button
        type="button"
        className="bsr-sem-btn"
        data-testid="bsr-coverage-select"
        onClick={() => {
          const session = useSessionStore.getState();
          onClose();
          if (session.view !== 'canvas') session.setView('canvas');
          session.setSelection([...gaps.images, ...gaps.media]);
        }}
      >
        Select them
      </button>
    </div>
  );
}
