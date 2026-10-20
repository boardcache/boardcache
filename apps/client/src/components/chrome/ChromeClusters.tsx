import { useEffect, useState } from 'react';
import { useLockScreenStore } from '../../lib/lockScreen';
import { getCanvasContainer, lastPointerCanvas } from '../../lib/canvas/canvasDom';
import { createSwatchItem } from '../../lib/import/createItems';
import { closeBoard } from '../../lib/board/boardLibrary';
import { formatBytes } from '../../lib/board/boardSize';
import { pickColorViaScreen } from '../../lib/color/pickColor';
import { useBoardSize } from '../../hooks/useBoardSize';
import { zoomInAt, zoomOutAt, zoomTo100, zoomToFit } from '../../lib/canvas/viewportActions';
import { ShapeToolbar } from '../canvas/ShapeToolbar';
import { SyncStatus } from './SyncStatus';
import { useCollabStore } from '../../state/collabStore';
import { UiTooltip } from '../ui/Tooltip';
import { renameBoard } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useHistoryStore } from '../../state/history';
import { resolveTheme, useSessionStore } from '../../state/sessionStore';
import {
  CloseIcon,
  CursorIcon,
  DotIcon,
  EyedropperIcon,
  ExpandIcon,
  FitIcon,
  LockIcon,
  MinusIcon,
  MouseIcon,
  MoonIcon,
  PlusIcon,
  RedoIcon,
  SunIcon,
  UndoIcon,
  ZoomInIcon,
} from '../icons';

/** Top-center tool cluster: tools, fit, undo/redo. */
export function ToolCluster() {
  const tool = useSessionStore((s) => s.tool);
  const setTool = useSessionStore((s) => s.setTool);
  const wheelMode = useSessionStore((s) => s.wheelMode);
  const canUndo = useHistoryStore((s) => s.index >= 0);
  const canRedo = useHistoryStore((s) => s.index < s.entries.length - 1);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const pickSwatch = async () => {
    const color = await pickColorViaScreen();
    if (color) {
      createSwatchItem(lastPointerCanvas(), color);
    }
  };

  return (
    <div className="chrome-cluster tool-cluster" role="toolbar" aria-label="Tools">
      <UiTooltip
        label={
          tool === 'pan'
            ? 'View-only / pan — click for select (V)'
            : 'Select — click to lock the canvas: view-only / pan (H, or hold Space)'
        }
      >
        <button
          type="button"
          aria-pressed={tool === 'pan'}
          data-testid="tool-toggle"
          onClick={() => setTool(tool === 'select' ? 'pan' : 'select')}
        >
          {tool === 'pan' ? <LockIcon /> : <CursorIcon />}
        </button>
      </UiTooltip>
      <UiTooltip
        label={
          wheelMode === 'zoom'
            ? 'Scroll zooms — click to make scrolling pan'
            : 'Scroll pans — click to make scrolling zoom (Shift = fine zoom)'
        }
      >
        <button
          type="button"
          aria-pressed={wheelMode === 'zoom'}
          data-testid="wheel-zoom-toggle"
          onClick={() =>
            useSessionStore.getState().setWheelMode(wheelMode === 'zoom' ? 'pan' : 'zoom')
          }
        >
          {wheelMode === 'zoom' ? <ZoomInIcon /> : <MouseIcon />}
        </button>
      </UiTooltip>
      <UiTooltip label="Pick a color swatch">
        <button type="button" onClick={() => void pickSwatch()} aria-label="Pick a color swatch">
          <EyedropperIcon />
        </button>
      </UiTooltip>
      <ShapeToolbar />
      <UiTooltip label="Fit content">
        <button
          type="button"
          onClick={() => zoomToFit(getCanvasContainer())}
          aria-label="Fit content"
        >
          <FitIcon />
        </button>
      </UiTooltip>
      <UiTooltip label="Undo (Ctrl+Z)">
        <button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo">
          <UndoIcon />
        </button>
      </UiTooltip>
      <UiTooltip label="Redo (Ctrl+Shift+Z)">
        <button type="button" onClick={redo} disabled={!canRedo} aria-label="Redo">
          <RedoIcon />
        </button>
      </UiTooltip>
    </div>
  );
}

/** Top-right: theme toggle + fullscreen. */
export function TopRightCluster() {
  const theme = useSessionStore((s) => s.theme);
  const setTheme = useSessionStore((s) => s.setTheme);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const resolved = resolveTheme(theme);

  return (
    <div className="chrome-cluster top-right-cluster" role="toolbar" aria-label="Appearance">
      <UiTooltip label="Lock screen">
        <button
          type="button"
          className="top-right-lock"
          onClick={() => void useLockScreenStore.getState().requestLock()}
          aria-label="Lock screen"
          data-testid="lock-screen-toggle"
        >
          <LockIcon />
        </button>
      </UiTooltip>
      <UiTooltip label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}>
        <button
          type="button"
          onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
          data-testid="theme-toggle"
        >
          {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </UiTooltip>
      <UiTooltip label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        <button
          type="button"
          className="top-right-fullscreen"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen();
          }}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          <ExpandIcon />
        </button>
      </UiTooltip>
      <UiTooltip label="Close board">
        <button
          type="button"
          className="top-right-close"
          onClick={() => void closeBoard()}
          aria-label="Close board"
          data-testid="close-board"
        >
          <CloseIcon />
        </button>
      </UiTooltip>
    </div>
  );
}

/** Bottom-left status pill: board name · item count · save state. */
export function StatusPill() {
  const boardId = useDocumentStore((s) => s.doc.id);
  const boardName = useDocumentStore((s) => s.doc.name);
  const pageForCount = useSessionStore((s) => s.activePageId);
  const itemCount = useDocumentStore((s) => {
    const first = s.doc.pages[0]?.id ?? null;
    const active =
      pageForCount && s.doc.pages.some((p) => p.id === pageForCount) ? pageForCount : first;
    let n = 0;
    for (const it of Object.values(s.doc.items))
      if ((it.pageId ?? first) === (active ?? first)) n++;
    return n;
  });
  const dirty = useHistoryStore((s) => s.index !== s.savedIndex);
  const collab = useCollabStore((s) => s.status);
  const sizeBytes = useBoardSize();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startRename = () => {
    setDraft(boardName);
    setEditing(true);
  };
  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== boardName) renameBoard(next);
    setEditing(false);
  };

  return (
    <div className="status-pill">
      {editing ? (
        <span className="status-segment status-name">
          <DotIcon />
          <input
            className="status-name-input"
            data-testid="board-name-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setEditing(false);
            }}
          />
        </span>
      ) : (
        <UiTooltip label="Rename board">
          <button
            type="button"
            className="status-segment status-name"
            data-testid="board-name"
            onClick={startRename}
          >
            <DotIcon />
            {boardName}
          </button>
        </UiTooltip>
      )}
      <span className="pill-divider" />
      <UiTooltip label="Browse all items in the gallery">
        <button
          type="button"
          className="status-segment"
          data-testid="item-count"
          disabled={itemCount === 0}
          onClick={() => useSessionStore.getState().setView('gallery')}
        >
          {itemCount} {itemCount === 1 ? 'Item' : 'Items'}
        </button>
      </UiTooltip>
      <span className="pill-divider" />
      {collab !== 'off' ? (
        // Team boards persist through their live room — local save/sync
        // states would be lies here.
        <UiTooltip label="Team board — changes save on the server as you make them">
          <span className="status-segment save-state" data-testid="save-state" tabIndex={-1}>
            <DotIcon color={collab === 'online' ? '#3ecf6e' : '#e8a13c'} />
            {collab === 'online' ? 'Live' : 'Reconnecting'}
          </span>
        </UiTooltip>
      ) : (
        <>
          <UiTooltip
            label={
              dirty
                ? 'Changes not yet saved'
                : 'All changes saved locally — estimated board size (document + media)'
            }
          >
            <span className="status-segment save-state" data-testid="save-state" tabIndex={-1}>
              <DotIcon color={dirty ? '#e8a13c' : '#3ecf6e'} />
              {dirty ? 'Saving' : 'Saved'}
              {sizeBytes !== null ? ` (${formatBytes(sizeBytes)})` : ''}
            </span>
          </UiTooltip>
          <span className="pill-divider" />
          <SyncStatus boardId={boardId} />
        </>
      )}
    </div>
  );
}

/** Bottom-center zoom pill: − · percent · +. */
export function ZoomPill() {
  const percent = useDocumentStore((s) => Math.round(s.doc.viewport.scale * 100));

  return (
    <div className="zoom-pill" role="toolbar" aria-label="Zoom">
      <UiTooltip label="Zoom out (Ctrl+-)">
        <button type="button" onClick={() => zoomOutAt(getCanvasContainer())} aria-label="Zoom out">
          <MinusIcon />
        </button>
      </UiTooltip>
      <span className="pill-divider" />
      <UiTooltip label="Zoom to 100% (Ctrl+0)">
        <button
          type="button"
          className="zoom-percent"
          data-testid="zoom-level"
          onClick={() => zoomTo100(getCanvasContainer())}
        >
          {percent}%
        </button>
      </UiTooltip>
      <span className="pill-divider" />
      <UiTooltip label="Zoom in (Ctrl+=)">
        <button type="button" onClick={() => zoomInAt(getCanvasContainer())} aria-label="Zoom in">
          <PlusIcon />
        </button>
      </UiTooltip>
    </div>
  );
}
