import { useEffect, useRef } from 'react';
import type { TouchEvent, TouchEventHandler } from 'react';
import type { TextItem } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import { ThemeToggle } from '../../components/chrome/ThemeToggle';
import { PopOutViewButton } from '../../components/chrome/PopOutViewButton';
import { useMobileViewport } from '../../hooks/useMobileViewport';
import {
  BoardsIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  PanelLeftIcon,
} from '../../components/icons';
import { ViewBarButton } from '../../components/chrome/ViewBarButton';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { NoteInspector } from './NoteInspector';
import { NoteHoverPreview } from './NoteHoverPreview';
import { NotesPane, NotesStage } from './NotesPane';
import { NotesSidebar } from './NotesSidebar';
import { NoteModeSwitch } from './NoteModeSwitch';
import { syncUrl } from '../../lib/router';
import { SIDE_MIN, activeNoteId, useNotesUi } from './store';

/**
 * The Notes view (full-screen, gallery chassis): every text box on the
 * board as a note. A folding, resizable sidebar of folders and tags on
 * the left, the open notes as tabs in the middle, and an inspector on the
 * right with the outline, the details, the comments and what the note
 * relates to. Tabs are remembered per board on this device, and the
 * active note is in the URL.
 */
export function NotesView() {
  const boardId = useDocumentStore((s) => s.doc.id);
  const loadFor = useNotesUi((s) => s.loadFor);
  useEffect(() => loadFor(boardId), [boardId, loadFor]);
  // Tabs of notes that left the board go with them.
  const liveIds = useDocumentStore(
    useShallow((s) =>
      Object.values(s.doc.items)
        .filter((i) => i.type === 'text')
        .map((i) => i.id),
    ),
  );
  useEffect(() => {
    const live = new Set(liveIds);
    useNotesUi.getState().prune((id) => live.has(id));
  }, [liveIds]);

  const noteId = useNotesUi(activeNoteId);
  useEffect(() => syncUrl(), [noteId]);
  // Alt+Left / Alt+Right walk the focused pane's tab history, as a browser's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') useNotesUi.getState().goBack();
      else useNotesUi.getState().goForward();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const note = useDocumentStore((s) => {
    const it = noteId ? s.doc.items[noteId] : undefined;
    return it?.type === 'text' ? (it as TextItem) : null;
  });
  const left = useNotesUi((s) => s.left);
  const right = useNotesUi((s) => s.right);
  const leftWidth = useNotesUi((s) => s.leftWidth);
  const sideWide = useNotesUi((s) => s.sideWide);
  const layout = useNotesUi((s) => s.layout);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focused = useNotesUi((s) => s.focused);
  const rightWidth = useNotesUi((s) => s.rightWidth);

  // Phones keep the note underneath and slide one sidebar over it: the
  // list when it is open, else the inspector. A sidebar covers most of the
  // screen so the note shows at its edge, or the whole screen once widened.
  const mobile = useMobileViewport();
  const showLeft = left;
  const showRight = right && !!note && (!mobile || !left);
  const closeSides = () => {
    useNotesUi.getState().setLeft(false);
    useNotesUi.getState().setRight(false);
  };
  const expandHandle = (side: 'left' | 'right') =>
    mobile ? (
      <button
        type="button"
        className="notes-side-expand"
        aria-pressed={sideWide}
        aria-label={sideWide ? 'Shrink the sidebar' : 'Widen the sidebar'}
        title={sideWide ? 'Shrink the sidebar' : 'Widen the sidebar'}
        data-testid={`notes-side-expand-${side}`}
        onClick={() => useNotesUi.getState().setSideWide(!sideWide)}
      >
        {(side === 'left') !== sideWide ? (
          <ChevronsRightIcon size={16} />
        ) : (
          <ChevronsLeftIcon size={16} />
        )}
      </button>
    ) : null;

  const back = () => useSessionStore.getState().setView('canvas');
  const swipes = useEdgeSwipes(mobile, {
    left,
    right: right && !!note,
    canRight: !!note,
    openLeft: () => {
      useNotesUi.getState().setLeft(true);
      useNotesUi.getState().setRight(false);
    },
    openRight: () => {
      useNotesUi.getState().setRight(true);
      useNotesUi.getState().setLeft(false);
    },
    closeLeft: () => useNotesUi.getState().setLeft(false),
    closeRight: () => useNotesUi.getState().setRight(false),
  });
  return (
    <div className="gallery-screen notes-screen" data-testid="notes-screen">
      <header className="gallery-header view-bar notes-bar">
        <div className="gallery-header-left">
          <ViewBarButton
            label="Back to canvas"
            icon={<BoardsIcon size={16} />}
            testId="notes-back"
            onClick={back}
          />
          <ViewBarButton
            label={left ? 'Hide the notes list' : 'Show the notes list'}
            icon={<PanelLeftIcon size={16} />}
            active={left}
            testId="notes-toggle-left"
            onClick={() => {
              useNotesUi.getState().setLeft(!left);
              if (mobile && !left) useNotesUi.getState().setRight(false);
            }}
          />
        </div>
        {note && (
          <div className="notes-bar-center">
            <NoteModeSwitch />
          </div>
        )}
        <div className="gallery-actions">
          <ViewBarButton
            label={right ? 'Hide the inspector' : 'Show the inspector'}
            icon={
              <span className="view-icon-mirror" aria-hidden>
                <PanelLeftIcon size={16} />
              </span>
            }
            active={right}
            testId="notes-toggle-right"
            onClick={() => {
              useNotesUi.getState().setRight(!right);
              if (mobile && !right) useNotesUi.getState().setLeft(false);
            }}
          />
          <PopOutViewButton testId="notes-popout" />
          <ThemeToggle className="view-icon-btn" testId="notes-theme-toggle" />
        </div>
      </header>

      <div className={`notes-body${mobile ? ' notes-one-pane' : ''}`} ref={bodyRef} {...swipes}>
        {!mobile && <NoteHoverPreview within={bodyRef} />}
        {mobile && (showLeft || showRight) && (
          <div className="notes-scrim" data-testid="notes-scrim" aria-hidden onClick={closeSides} />
        )}
        {showLeft && (
          <>
            <div
              style={mobile ? undefined : { width: leftWidth }}
              className="notes-side-box"
              data-side="left"
              data-wide={mobile && sideWide ? '1' : undefined}
            >
              <NotesSidebar />
              {expandHandle('left')}
            </div>
            {!mobile && (
              <Resizer
                side="left"
                width={leftWidth}
                onWidth={(w) => useNotesUi.getState().setLeftWidth(w)}
              />
            )}
          </>
        )}
        {mobile ? <NotesPane id={focused} /> : <NotesStage layout={layout} />}
        {showRight && (
          <>
            {!mobile && (
              <Resizer
                side="right"
                width={rightWidth}
                onWidth={(w) => useNotesUi.getState().setRightWidth(w)}
              />
            )}
            <div
              style={mobile ? undefined : { width: rightWidth }}
              className="notes-side-box"
              data-side="right"
              data-wide={mobile && sideWide ? '1' : undefined}
            >
              <NoteInspector note={note!} />
              {expandHandle('right')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A finger's travel that counts as a swipe, and how near an edge it starts. */
const SWIPE = 48;
const EDGE = 28;

interface SwipeTargets {
  left: boolean;
  right: boolean;
  canRight: boolean;
  openLeft: () => void;
  openRight: () => void;
  closeLeft: () => void;
  closeRight: () => void;
}

/**
 * Phones open and close the sidebars by swiping, as Obsidian does: a swipe
 * in from the left edge opens the notes list, in from the right edge the
 * inspector, and an open pane closes with a swipe back towards its edge.
 * A mostly vertical move is a scroll and is left alone. Off phones the
 * handlers are empty.
 */
function useEdgeSwipes(
  on: boolean,
  t: SwipeTargets,
): {
  onTouchStart?: TouchEventHandler;
  onTouchMove?: TouchEventHandler;
  onTouchEnd?: TouchEventHandler;
} {
  const targets = useRef(t);
  useEffect(() => {
    targets.current = t;
  });
  const gesture = useRef<{ x: number; y: number; edge: 'left' | 'right' | null } | null>(null);
  if (!on) return {};
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      gesture.current = null;
      return;
    }
    const touch = e.touches[0]!;
    const x = touch.clientX;
    const edge = x <= EDGE ? 'left' : x >= window.innerWidth - EDGE ? 'right' : null;
    gesture.current = { x, y: touch.clientY, edge };
  };
  const onTouchMove = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g || e.touches.length !== 1) return;
    const touch = e.touches[0]!;
    const dx = touch.clientX - g.x;
    const dy = touch.clientY - g.y;
    if (Math.abs(dy) > Math.abs(dx)) {
      if (Math.abs(dy) > 16) gesture.current = null; // a scroll
      return;
    }
    if (Math.abs(dx) < SWIPE) return;
    gesture.current = null;
    const { left, right, canRight, openLeft, openRight, closeLeft, closeRight } = targets.current;
    if (dx > 0) {
      if (right) closeRight();
      else if (!left && g.edge === 'left') openLeft();
    } else if (left) closeLeft();
    else if (!right && g.edge === 'right' && canRight) openRight();
  };
  const onTouchEnd = () => {
    gesture.current = null;
  };
  return { onTouchStart, onTouchMove, onTouchEnd };
}

/** The bar between a sidebar and the stage: drag to set the sidebar's width. */
function Resizer({
  side,
  width,
  onWidth,
}: {
  side: 'left' | 'right';
  width: number;
  onWidth: (w: number) => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="notes-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Notes list width' : 'Inspector width'}
      data-testid={`notes-resizer-${side}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        start.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        const max = Math.max(SIDE_MIN, window.innerWidth * 0.5);
        const next = start.current.w + (side === 'left' ? dx : -dx);
        onWidth(Math.round(Math.min(max, Math.max(SIDE_MIN, next))));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    />
  );
}
