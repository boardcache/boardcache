/** Open/closed state and one-shot payloads for every dialog and overlay. */
import type { StateCreator } from 'zustand';
import type { SessionState } from '../sessionStore';
import type { CaptureMode } from './types';

interface SignupPreset {
  plan: 'free' | 'personal' | 'team';
  period: 'month' | 'yearly';
}

export interface DialogsSlice {
  /** Webcam/microphone/screen capture dialog. */
  captureMode: CaptureMode | null;
  setCaptureMode: (mode: CaptureMode | null) => void;
  /** App settings dialog. */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** Command palette (Ctrl/Cmd+P). */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** "Find on Board" content-search dialog. */
  boardSearchOpen: boolean;
  setBoardSearchOpen: (open: boolean) => void;
  /** One-shot query the dialog consumes on open (library search bridge). */
  boardSearchPrefill: string | null;
  setBoardSearchPrefill: (q: string | null) => void;
  /** 3D graph of connected items (View menu overlay). */
  graphOpen: boolean;
  setGraphOpen: (open: boolean) => void;
  /** Active settings category — routed as /settings/:section. */
  settingsSection: string;
  setSettingsSection: (section: string) => void;
  /** Keyboard shortcut map overlay ("?"). */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  /** Google Fonts search dialog. */
  googleFontsOpen: boolean;
  setGoogleFontsOpen: (open: boolean) => void;
  /** Stock media search dialog. */
  stockOpen: boolean;
  setStockOpen: (open: boolean) => void;
  /** Item ids whose tags are being edited in the Tags dialog (null = closed). */
  tagEditorItems: string[] | null;
  setTagEditor: (ids: string[] | null) => void;
  /** Review queue for AI-suggested connections (research boards). */
  suggestConnectionsOpen: boolean;
  setSuggestConnectionsOpen: (open: boolean) => void;
  /** "More like this" similarity dialog for one item (null = closed). */
  moreLikeThisId: string | null;
  setMoreLikeThis: (id: string | null) => void;
  /** Board Insights dialog (duplicates + outliers). */
  insightsOpen: boolean;
  setInsightsOpen: (open: boolean) => void;
  /** "Move/Copy to Board" picker for the selected items. */
  sendToBoard: { ids: string[]; mode: 'move' | 'copy' } | null;
  setSendToBoard: (req: { ids: string[]; mode: 'move' | 'copy' } | null) => void;
  /** Item ids whose note is being edited in the Note dialog (null = closed). */
  noteEditorItems: string[] | null;
  setNoteEditor: (ids: string[] | null) => void;
  /** Video whose poster-frame picker is open; null when closed. */
  videoPosterPickerId: string | null;
  setVideoPosterPickerId: (id: string | null) => void;
  /** Settings → Sync sign-in dialog visibility; routed as /signin or /signup. */
  syncDialogOpen: boolean;
  syncDialogMode: 'login' | 'register';
  setSyncDialogOpen: (open: boolean, mode?: 'login' | 'register') => void;
  /** /signup?plan=…&type=… preselects a plan; read once by the form, then cleared. */
  signupPreset: SignupPreset | null;
  setSignupPreset: (preset: SignupPreset | null) => void;
  /** Settings → AI Providers dialog visibility. */
  aiProvidersOpen: boolean;
  setAiProvidersOpen: (open: boolean) => void;
  /** Add → Generate Text prompt dialog visibility. */
  generateTextOpen: boolean;
  setGenerateTextOpen: (open: boolean) => void;
  /** File → Export → Interactive Offline boardCache confirmation dialog. */
  viewerExportOpen: boolean;
  setViewerExportOpen: (open: boolean) => void;
  /** A label while an export is being built (null = idle); drives the overlay. */
  exportBusy: string | null;
  setExportBusy: (label: string | null) => void;
  /** Fraction (0..1) shown as a bar in the busy overlay (null = spinner only). */
  exportProgress: number | null;
  setExportProgress: (fraction: number | null) => void;
  /** Settings → Background color dialog. */
  canvasBgOpen: boolean;
  setCanvasBgOpen: (open: boolean) => void;
  /** File → Export → Asset PDF type-selection dialog. */
  assetPdfOpen: boolean;
  setAssetPdfOpen: (open: boolean) => void;
  /** In-flight AI generations by item id (drives the blinking status). */
  aiGenerations: Record<string, 'thinking' | 'streaming'>;
  setAiGeneration: (id: string, phase: 'thinking' | 'streaming' | null) => void;
  /** Open context menu (screen coords); null when closed. */
  contextMenu: { x: number; y: number; itemId: string | null } | null;
  setContextMenu: (menu: { x: number; y: number; itemId: string | null } | null) => void;
  /** Close everything that belongs to the open board (dialogs, panels,
   *  pickers, the context menu): called when a board closes or another
   *  takes its place, so nothing of it lingers over the library. */
  resetBoardUi: () => void;
}

export const createDialogsSlice: StateCreator<
  SessionState,
  [['zustand/subscribeWithSelector', never]],
  [],
  DialogsSlice
> = (set) => ({
  captureMode: null,
  setCaptureMode: (mode) => set({ captureMode: mode }),
  resetBoardUi: () =>
    set({
      captureMode: null,
      boardSearchOpen: false,
      boardSearchPrefill: null,
      graphOpen: false,
      tagEditorItems: null,
      suggestConnectionsOpen: false,
      moreLikeThisId: null,
      insightsOpen: false,
      sendToBoard: null,
      noteEditorItems: null,
      videoPosterPickerId: null,
      contextMenu: null,
      pagesOpen: false,
    }),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  boardSearchOpen: false,
  setBoardSearchOpen: (boardSearchOpen) => set({ boardSearchOpen }),
  boardSearchPrefill: null,
  setBoardSearchPrefill: (boardSearchPrefill) => set({ boardSearchPrefill }),
  graphOpen: false,
  setGraphOpen: (graphOpen) => set({ graphOpen }),
  settingsSection: 'general',
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  googleFontsOpen: false,
  setGoogleFontsOpen: (open) => set({ googleFontsOpen: open }),
  stockOpen: false,
  setStockOpen: (open) => set({ stockOpen: open }),
  tagEditorItems: null,
  setTagEditor: (tagEditorItems) => set({ tagEditorItems }),
  suggestConnectionsOpen: false,
  setSuggestConnectionsOpen: (suggestConnectionsOpen) => set({ suggestConnectionsOpen }),
  moreLikeThisId: null,
  setMoreLikeThis: (moreLikeThisId) => set({ moreLikeThisId }),
  insightsOpen: false,
  setInsightsOpen: (insightsOpen) => set({ insightsOpen }),
  sendToBoard: null,
  setSendToBoard: (sendToBoard) => set({ sendToBoard }),
  noteEditorItems: null,
  setNoteEditor: (noteEditorItems) => set({ noteEditorItems }),
  videoPosterPickerId: null,
  setVideoPosterPickerId: (videoPosterPickerId) => set({ videoPosterPickerId }),
  syncDialogOpen: false,
  syncDialogMode: 'login',
  signupPreset: null,
  setSignupPreset: (signupPreset) => set({ signupPreset }),
  // Opening without a mode means sign-in; the mode only persists while open
  // (it is the route), so a later plain open never lands on the sign-up form.
  setSyncDialogOpen: (syncDialogOpen, mode) =>
    set(
      mode
        ? { syncDialogOpen, syncDialogMode: mode }
        : syncDialogOpen
          ? { syncDialogOpen, syncDialogMode: 'login' }
          : { syncDialogOpen },
    ),
  aiProvidersOpen: false,
  setAiProvidersOpen: (aiProvidersOpen) => set({ aiProvidersOpen }),
  generateTextOpen: false,
  setGenerateTextOpen: (generateTextOpen) => set({ generateTextOpen }),
  viewerExportOpen: false,
  setViewerExportOpen: (viewerExportOpen) => set({ viewerExportOpen }),
  exportBusy: null,
  // Every busy transition resets the bar — a new task starts spinner-only.
  setExportBusy: (exportBusy) => set({ exportBusy, exportProgress: null }),
  exportProgress: null,
  setExportProgress: (exportProgress) => set({ exportProgress }),
  canvasBgOpen: false,
  setCanvasBgOpen: (canvasBgOpen) => set({ canvasBgOpen }),
  assetPdfOpen: false,
  setAssetPdfOpen: (assetPdfOpen) => set({ assetPdfOpen }),
  aiGenerations: {},
  setAiGeneration: (id, phase) =>
    set((s) => {
      const next = { ...s.aiGenerations };
      if (phase) next[id] = phase;
      else delete next[id];
      return { aiGenerations: next };
    }),
  contextMenu: null,
  setContextMenu: (contextMenu) => set({ contextMenu }),
});
