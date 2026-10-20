import { clientToCanvas } from './canvas/canvasDom';
import { canPasteNow, pasteFromAnywhere } from './import/pasteAction';
import { closeBoard, createBoard } from './board/boardLibrary';
import { createTextItem, createSwatchItem } from './import/createItems';
import { pickColorViaInput } from './color/pickColor';
import { resetView, zoomInAt, zoomOutAt, zoomTo100, zoomToFit } from './canvas/viewportActions';
import { getCanvasContainer } from './canvas/canvasDom';
import { organizeItems } from './canvas/arrange';
import { withExportStatus } from './export/exportStatus';
import { exportBoardAsPlainZip, exportFullAsPng, exportViewAsPng } from './board/transfer';
import { copySelection, cutSelection } from './import/clipboard';
import { groupSelection, ungroupSelection } from './canvas/groupActions';
import { duplicateItems, removeItems, reorderItems } from '../state/commands';
import { allThemeFamilies } from './themes';
import { useHistoryStore } from '../state/history';
import { useDocumentStore } from '../state/documentStore';
import { useSessionStore } from '../state/sessionStore';

/**
 * Command palette registry (Ctrl/Cmd+P): a curated, view-aware flat list of
 * the app's actions. Built FRESH each time the palette opens so gating
 * (view, selection, clipboard) is always current. Actions close the palette
 * themselves via the caller.
 */

export interface PaletteCommand {
  id: string;
  title: string;
  section: string;
  /** Extra match terms beyond the title. */
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

const viewCenterCanvas = () => clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);

export function buildPaletteCommands(): PaletteCommand[] {
  const session = useSessionStore.getState();
  const onCanvas =
    session.view === 'canvas' || session.view === 'gallery' || session.view === 'plugin';
  const hasSelection = session.selection.length > 0;
  const cmds: PaletteCommand[] = [];
  const add = (c: PaletteCommand) => cmds.push(c);

  // ── navigation ──────────────────────────────────────────────────────────
  if (onCanvas) {
    add({
      id: 'nav-boards',
      title: 'Go to My Boards',
      section: 'Navigate',
      keywords: 'index library home exit close',
      run: () => void closeBoard(),
    });
    add({
      id: 'nav-gallery',
      title: session.view === 'gallery' ? 'Back to Canvas' : 'Open Gallery View',
      section: 'Navigate',
      keywords: 'grid images',
      run: () => session.setView(session.view === 'gallery' ? 'canvas' : 'gallery'),
    });
    add({
      id: 'nav-projects',
      title: 'Open Projects',
      section: 'Navigate',
      keywords: 'tasks milestones kanban calendar gantt timeline',
      run: () => window.dispatchEvent(new CustomEvent('boardcache:open-projects', { detail: {} })),
    });
    add({
      id: 'graph-view',
      title: 'Graph View',
      section: 'Navigate',
      keywords: 'connections network 3d obsidian',
      run: () => session.setGraphOpen(true),
    });
    add({
      id: 'find-on-board',
      title: 'Find on Board',
      section: 'Navigate',
      keywords: 'search content text pdf grep locate',
      shortcut: 'Ctrl+Shift+F',
      run: () => session.setBoardSearchOpen(true),
    });
  } else if (session.view === 'library') {
    add({
      id: 'find-on-board',
      title: 'Search All Boards',
      section: 'Navigate',
      keywords: 'find content text cross board library grep',
      shortcut: 'Ctrl+Shift+F',
      run: () => session.setBoardSearchOpen(true),
    });
  } else {
    add({
      id: 'nav-boards',
      title: 'Go to My Boards',
      section: 'Navigate',
      keywords: 'index library home',
      run: () => {
        session.setCommunityRoute(null);
        session.setView('library');
      },
    });
  }
  if (session.view !== 'community') {
    add({
      id: 'nav-community',
      title: 'Go to Community',
      section: 'Navigate',
      keywords: 'browse social feed',
      run: () => {
        const go = () => {
          const s = useSessionStore.getState();
          s.setCommunityRoute(null);
          s.setView('community');
        };
        if (onCanvas) void closeBoard().then(go);
        else go();
      },
    });
  }
  add({
    id: 'new-board',
    title: 'New Board',
    section: 'Navigate',
    keywords: 'create blank',
    run: () => void createBoard(),
  });

  // ── settings ────────────────────────────────────────────────────────────
  for (const [id, label] of [
    ['appearance', 'Appearance'],
    ['text', 'Text'],
    ['plugins', 'Plugins'],
    ['sync', 'Sync & Account'],
    ['export', 'Export / Backup'],
    ['import', 'Import'],
  ] as const) {
    add({
      id: `settings-${id}`,
      title: `Settings: ${label}`,
      section: 'Settings',
      keywords: 'preferences options config',
      run: () => {
        session.setSettingsSection(id);
        session.setSettingsOpen(true);
      },
    });
  }
  add({
    id: 'toggle-theme',
    title: 'Toggle Light/Dark Mode',
    section: 'Settings',
    keywords: 'dark light appearance',
    run: () => {
      const s = useSessionStore.getState();
      const dark = document.documentElement.dataset.theme === 'dark';
      s.setTheme(dark ? 'light' : 'dark');
    },
  });
  for (const fam of allThemeFamilies()) {
    add({
      id: `theme-${fam.id}`,
      title: `Color Theme: ${fam.name}`,
      section: 'Settings',
      keywords: 'palette appearance',
      run: () => useSessionStore.getState().setThemeId(fam.id),
    });
  }

  if (!onCanvas) return cmds;

  // ── canvas: view ────────────────────────────────────────────────────────
  add({
    id: 'zoom-fit',
    title: 'Fit Content',
    section: 'View',
    shortcut: 'Shift+1',
    keywords: 'zoom',
    run: () => zoomToFit(getCanvasContainer()),
  });
  add({
    id: 'zoom-100',
    title: 'Zoom to 100%',
    section: 'View',
    shortcut: 'Ctrl+0',
    run: () => zoomTo100(getCanvasContainer()),
  });
  add({
    id: 'zoom-in',
    title: 'Zoom In',
    section: 'View',
    shortcut: 'Ctrl+=',
    run: () => zoomInAt(getCanvasContainer()),
  });
  add({
    id: 'zoom-out',
    title: 'Zoom Out',
    section: 'View',
    shortcut: 'Ctrl+-',
    run: () => zoomOutAt(getCanvasContainer()),
  });
  add({
    id: 'reset-view',
    title: 'Reset View',
    section: 'View',
    shortcut: 'Ctrl+Shift+0',
    run: () => resetView(),
  });
  add({
    id: 'organize',
    title: 'Organize Items',
    section: 'View',
    keywords: 'tidy layout arrange grid',
    run: () => organizeItems(),
  });

  // ── canvas: edit ────────────────────────────────────────────────────────
  add({
    id: 'undo',
    title: 'Undo',
    section: 'Edit',
    shortcut: 'Ctrl+Z',
    run: () => useHistoryStore.getState().undo(),
  });
  add({
    id: 'redo',
    title: 'Redo',
    section: 'Edit',
    shortcut: 'Ctrl+Shift+Z',
    run: () => useHistoryStore.getState().redo(),
  });
  if (canPasteNow()) {
    add({
      id: 'paste',
      title: 'Paste',
      section: 'Edit',
      shortcut: 'Ctrl+V',
      run: () => void pasteFromAnywhere(viewCenterCanvas()),
    });
  }
  add({
    id: 'select-all',
    title: 'Select All',
    section: 'Edit',
    shortcut: 'Ctrl+A',
    run: () =>
      useSessionStore.getState().setSelection(Object.keys(useDocumentStore.getState().doc.items)),
  });

  // ── canvas: add ─────────────────────────────────────────────────────────
  add({
    id: 'add-text',
    title: 'Add Text',
    section: 'Add',
    run: () => createTextItem(viewCenterCanvas()),
  });
  add({
    id: 'add-swatch',
    title: 'Add Swatch',
    section: 'Add',
    keywords: 'color',
    run: () => {
      void pickColorViaInput().then((color) => {
        if (color) createSwatchItem(viewCenterCanvas(), color);
      });
    },
  });

  // ── canvas: selection ───────────────────────────────────────────────────
  if (hasSelection) {
    const sel = session.selection;
    add({
      id: 'sel-copy',
      title: 'Copy Selection',
      section: 'Selection',
      shortcut: 'Ctrl+C',
      run: () => copySelection(),
    });
    add({
      id: 'sel-cut',
      title: 'Cut Selection',
      section: 'Selection',
      shortcut: 'Ctrl+X',
      run: () => cutSelection(),
    });
    add({
      id: 'sel-duplicate',
      title: 'Duplicate Selection',
      section: 'Selection',
      shortcut: 'Ctrl+D',
      run: () => {
        const ids = duplicateItems(sel);
        if (ids.length) useSessionStore.getState().setSelection(ids);
      },
    });
    add({
      id: 'sel-delete',
      title: 'Delete Selection',
      section: 'Selection',
      shortcut: 'Del',
      run: () => {
        removeItems(sel);
        useSessionStore.getState().clearSelection();
      },
    });
    add({
      id: 'sel-group',
      title: 'Group Selection',
      section: 'Selection',
      shortcut: 'Ctrl+G',
      run: () => groupSelection(),
    });
    add({
      id: 'sel-ungroup',
      title: 'Ungroup Selection',
      section: 'Selection',
      shortcut: 'Ctrl+Shift+G',
      run: () => ungroupSelection(),
    });
    add({
      id: 'sel-front',
      title: 'Bring to Front',
      section: 'Selection',
      shortcut: 'Ctrl+Shift+]',
      run: () => reorderItems(sel, 'front'),
    });
    add({
      id: 'sel-back',
      title: 'Send to Back',
      section: 'Selection',
      shortcut: 'Ctrl+Shift+[',
      run: () => reorderItems(sel, 'back'),
    });
  }

  // ── canvas: board / share / export ──────────────────────────────────────
  add({
    id: 'export-view-png',
    title: 'Export: Current View Image',
    section: 'Board',
    keywords: 'png screenshot picture',
    run: () => void withExportStatus('Generating image', exportViewAsPng),
  });
  add({
    id: 'export-full-png',
    title: 'Export: Full Board Image',
    section: 'Board',
    keywords: 'png picture',
    run: () => void withExportStatus('Generating image', exportFullAsPng),
  });
  add({
    id: 'export-zip',
    title: 'Export: Plain Files (zip)',
    section: 'Board',
    keywords: 'download archive',
    run: () => void withExportStatus('Zipping files', exportBoardAsPlainZip),
  });

  return cmds;
}
