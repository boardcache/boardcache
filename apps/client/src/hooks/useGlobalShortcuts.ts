import { activePageId as pagesActiveId, switchPage } from '../lib/board/pages';
import { useLockScreenStore } from '../lib/lockScreen';
import { canvasReadOnly } from '../lib/canvas/readOnly';
import { useEffect } from 'react';
import { copySelection, cutSelection } from '../lib/import/clipboard';
import { groupSelection, ungroupSelection } from '../lib/canvas/groupActions';
import {
  fitViewportTo,
  resetView,
  zoomInAt,
  zoomOutAt,
  zoomTo100,
  zoomToFit,
} from '../lib/canvas/viewportActions';
import { clientToCanvas } from '../lib/canvas/canvasDom';
import { createTextItem } from '../lib/import/createItems';
import {
  duplicateItems,
  moveItemsBy,
  removeConnection,
  removeItems,
  reorderItems,
} from '../state/commands';
import { useDocumentStore } from '../state/documentStore';
import { useHistoryStore } from '../state/history';
import { useSessionStore } from '../state/sessionStore';
import { VIEWER } from '../lib/viewerMode';
import {
  goToStep,
  presentGo,
  presentResetZoom,
  presentZoom,
  stopPresentation,
} from '../lib/canvas/presentation';
import type { ToolId } from '../state/sessionStore';
import { parentGroup } from '../lib/canvas/grouping';

/** Single-key tool shortcuts (no modifier), Excalidraw-style. */
const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  h: 'pan',
  r: 'shape:rect',
  o: 'shape:ellipse',
  d: 'shape:diamond',
  a: 'shape:arrow',
  l: 'shape:line',
  p: 'shape:draw',
  b: 'shape:path',
  s: 'shape:star',
};

/** True when the event targets a text-editing element — canvas shortcuts must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

const NUDGE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Global keyboard map: viewport navigation, tools, selection, editing.
 * Paste (files + items) is handled by the window 'paste' listener in App.
 */
export function useGlobalShortcuts(getContainer: () => HTMLElement | null) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (useLockScreenStore.getState().locked) return;
      // Presentation Mode owns the keyboard: arrows / Space / Enter / paging
      // step, Escape ends. Nothing else edits or navigates meanwhile.
      if (useSessionStore.getState().presenting) {
        // A lightbox opened from the show owns the keys until it closes.
        if (useSessionStore.getState().lightboxId) return;
        if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown'].includes(e.key)) {
          e.preventDefault();
          presentGo(1);
        } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
          e.preventDefault();
          presentGo(-1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          stopPresentation();
        } else if (e.key === 'Home') {
          e.preventDefault();
          goToStep(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          goToStep(Number.MAX_SAFE_INTEGER);
        } else if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          presentZoom(1.25); // a closer look at the step
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          presentZoom(0.8);
        } else if (e.key === '0') {
          e.preventDefault();
          presentResetZoom();
        }
        return;
      }
      // An open menu/select owns the keyboard (typeahead, arrows) — letting
      // keys through would flip tools while the user types in a menu.
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-radix-menu-content], [role="menu"], [role="listbox"]')) return;
      const session = useSessionStore.getState();
      // Command palette: available on every view (the browser's print dialog
      // loses this one). The palette component owns the keyboard once open.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!session.paletteOpen) session.setPaletteOpen(true);
        return;
      }
      // Find on Board: content search — the open board, or the whole library
      // (All Boards scope) from the index.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f' && !e.altKey) {
        if (
          session.view === 'canvas' ||
          session.view === 'gallery' ||
          session.view === 'plugin' ||
          session.view === 'library'
        ) {
          e.preventDefault();
          if (!session.boardSearchOpen) session.setBoardSearchOpen(true);
          return;
        }
      }
      if (session.paletteOpen || session.boardSearchOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      // Plugin views (Projects) edit the document too — undo/redo must work
      // there; everything else below is canvas-only.
      if (session.view === 'plugin' && session.lightboxId === null && mod) {
        const key = e.key.toLowerCase();
        if (key === 'z' && e.shiftKey) useHistoryStore.getState().redo();
        else if (key === 'z') useHistoryStore.getState().undo();
        else if (key === 'y') useHistoryStore.getState().redo();
        else return;
        e.preventDefault();
        return;
      }
      // The lightbox owns the keyboard while open; library/gallery screens
      // don't take canvas shortcuts.
      if (session.lightboxId !== null || session.view !== 'canvas') return;

      // A read-only canvas (the viewer, or the pan tool locking the board)
      // keeps navigation, selection and copy; nothing that would change the
      // board. Tool keys stay so the lock can be released from the keyboard.
      if (canvasReadOnly()) {
        const key = e.key.toLowerCase();
        if (mod) {
          if (['d', 'x', 'g', 'z', 'y'].includes(key) || e.key === '[' || e.key === ']') return;
        } else if (
          e.key === 'Delete' ||
          e.key === 'Backspace' ||
          NUDGE_KEYS[e.key] ||
          e.code === 'KeyC' ||
          key === 't' ||
          (VIEWER && TOOL_KEYS[key])
        ) {
          return;
        }
      }

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault(); // stop page scroll
        session.setSpaceHeld(true);
        return;
      }

      // Plain "c" held → crop mode (Ctrl/Cmd+C stays copy, handled below).
      if (!mod && e.code === 'KeyC' && !e.repeat) {
        session.setCropHeld(true);
        return;
      }

      if (mod) {
        const key = e.key.toLowerCase();
        if (e.key === '=' || e.key === '+') zoomInAt(getContainer());
        else if (e.key === '-') zoomOutAt(getContainer());
        else if (e.key === '0' && e.shiftKey) resetView();
        else if (e.key === '0') zoomTo100(getContainer());
        else if (key === 'z' && e.shiftKey) useHistoryStore.getState().redo();
        else if (key === 'z') useHistoryStore.getState().undo();
        else if (key === 'y') useHistoryStore.getState().redo();
        else if (key === 'a') {
          session.setSelection(
            Object.values(useDocumentStore.getState().doc.items)
              .filter((i) => !i.hidden && !i.locked)
              .map((i) => i.id),
          );
        } else if (key === 'd') {
          const ids = duplicateItems(session.selection);
          if (ids.length) session.setSelection(ids);
        } else if (key === 'c') copySelection();
        else if (key === 'x') cutSelection();
        else if (key === 'g' && e.shiftKey) ungroupSelection();
        else if (key === 'g') groupSelection();
        else if (e.key === ']') reorderItems(session.selection, e.shiftKey ? 'front' : 'forward');
        else if (e.key === '[') reorderItems(session.selection, e.shiftKey ? 'back' : 'backward');
        else return; // unhandled mod-combo (incl. mod+V → paste event)
        e.preventDefault();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (session.selectedConnectionId) {
          removeConnection(session.selectedConnectionId);
          session.setSelectedConnection(null);
        } else {
          removeItems(session.selection);
          session.clearSelection();
        }
        e.preventDefault();
        return;
      }

      const nudge = NUDGE_KEYS[e.key];
      if (nudge) {
        const factor = e.shiftKey ? 10 : 1;
        moveItemsBy(session.selection, nudge[0] * factor, nudge[1] * factor, 'Nudge');
        if (session.selection.length) e.preventDefault();
        return;
      }

      if (e.key === 'Escape') {
        // Node editing ends first; then a draw tool returns to select;
        // otherwise clear the selection.
        if (session.selectedConnectionId) session.setSelectedConnection(null);
        else if (session.pathEditId) session.setPathEditId(null);
        else if (session.isolatedGroupId) {
          // Nested isolation unwinds one level per Escape.
          session.setIsolatedGroup(
            parentGroup(useDocumentStore.getState().doc, session.isolatedGroupId),
          );
          session.clearSelection();
        } else if (session.tool !== 'select' && session.tool !== 'pan') session.setTool('select');
        else session.clearSelection();
        return;
      }
      if (e.key === '?') {
        session.setShortcutsOpen(!session.shortcutsOpen);
        e.preventDefault();
        return;
      }
      if (e.key.toLowerCase() === 't') {
        createTextItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2));
        e.preventDefault();
        return;
      }
      if (e.key.toLowerCase() === 'f') {
        // Fit the selection; with nothing selected, fit everything.
        const { doc } = useDocumentStore.getState();
        const items = session.selection
          .map((id) => doc.items[id])
          .filter((i): i is NonNullable<typeof i> => !!i);
        if (items.length > 0) {
          const minX = Math.min(...items.map((i) => i.x));
          const minY = Math.min(...items.map((i) => i.y));
          const maxX = Math.max(...items.map((i) => i.x + i.width));
          const maxY = Math.max(...items.map((i) => i.y + i.height));
          fitViewportTo(
            { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
            getContainer(),
          );
        } else {
          zoomToFit(getContainer());
        }
        e.preventDefault();
        return;
      }
      if (e.key.toLowerCase() === 'g') {
        session.setView('gallery');
        return;
      }
      // Pages: PageUp/PageDown cycle sheets (multi-page boards only).
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        const doc = useDocumentStore.getState().doc;
        if (doc.pages.length > 1) {
          e.preventDefault();
          const cur = pagesActiveId(doc);
          const idx = Math.max(
            0,
            doc.pages.findIndex((p) => p.id === cur),
          );
          const next =
            doc.pages[
              (idx + (e.key === 'PageDown' ? 1 : doc.pages.length - 1)) % doc.pages.length
            ]!;
          switchPage(next.id);
        }
        return;
      }
      if (e.key.toLowerCase() === 'm') {
        session.setMinimapOpen(!session.minimapOpen);
        return;
      }
      const toolKey = TOOL_KEYS[e.key.toLowerCase()];
      if (toolKey) session.setTool(toolKey);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') useSessionStore.getState().setSpaceHeld(false);
      if (e.code === 'KeyC') useSessionStore.getState().setCropHeld(false);
    };

    const onBlur = () => {
      useSessionStore.getState().setSpaceHeld(false);
      useSessionStore.getState().setCropHeld(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [getContainer]);
}
