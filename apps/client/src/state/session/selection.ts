/** Selection, drag targets, inline editing and the no-history live previews. */
import type { StateCreator } from 'zustand';
import type { SessionState } from '../sessionStore';
import type { ImageFilters } from '@boardcache/schema';
import { isMobileViewport } from '../../lib/mobile';
import type { PendingImport } from './types';

export interface SelectionSlice {
  /** Group isolation (Illustrator-style): members act as individuals. */
  isolatedGroupId: string | null;
  setIsolatedGroup: (id: string | null) => void;
  /** Group armed to receive dragged items (hover-hold while moving). */
  groupDropArmed: string | null;
  setGroupDropArmed: (id: string | null) => void;
  /** Group the drag is currently over (pre-arm hint shows immediately). */
  groupDropHover: string | null;
  setGroupDropHover: (id: string | null) => void;
  /** Timeline point the drag is currently over (drop-to-attach highlight). */
  timelineDropHover: { itemId: string; pointId: string } | null;
  setTimelineDropHover: (target: { itemId: string; pointId: string } | null) => void;
  /** Tier-list row under a drag (drop-target highlight). */
  tierDropHover: { itemId: string; rowId: string } | null;
  setTierDropHover: (t: { itemId: string; rowId: string } | null) => void;
  sbDropHover: { itemId: string; panelId: string } | null;
  setSbDropHover: (t: { itemId: string; panelId: string } | null) => void;
  /** Tree node under a drag (drop-target highlight). */
  treeDropHover: { itemId: string; nodeId: string } | null;
  setTreeDropHover: (t: { itemId: string; nodeId: string } | null) => void;
  /** Selected connector line (Delete removes it). */
  selectedConnectionId: string | null;
  setSelectedConnection: (id: string | null) => void;
  /** Live connect gesture: source endpoint + cursor + snapped target. */
  connectDraft: {
    from: { kind: 'item' | 'group'; id: string };
    x: number;
    y: number;
    target: { kind: 'item' | 'group'; id: string } | null;
  } | null;
  setConnectDraft: (draft: SessionState['connectDraft']) => void;
  /** Selected item ids, in selection order. */
  selection: string[];
  /**
   * What chromeClearSelection just deselected. Chrome (menus) clears the
   * visible selection on open, but selection-aware menu entries ("Insert
   * Chart" editing the selected chart) still need to know what the user had
   * selected. Reset by any real selection change.
   */
  chromeClearedSelection: string[];
  setSelection: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  /** Menu-open deselect: clears like clearSelection but keeps the snapshot. */
  chromeClearSelection: () => void;
  /** Placeholder boxes for media still being prepared (e.g. HEIC → JPEG). */
  pendingImports: PendingImport[];
  addPendingImport: (pending: PendingImport) => void;
  updatePendingImport: (id: string, patch: Partial<PendingImport>) => void;
  removePendingImport: (id: string) => void;
  /** Live image-filter preview while dragging an adjustment slider (no history). */
  filterPreview: { id: string; filters: ImageFilters } | null;
  setFilterPreview: (preview: { id: string; filters: ImageFilters } | null) => void;
  /** Live opacity preview for the selected items while dragging (no history). */
  opacityPreview: { ids: string[]; value: number } | null;
  setOpacityPreview: (preview: { ids: string[]; value: number } | null) => void;
  /** Live group-background preview while dragging its color/opacity (no history). */
  groupBgPreview: { id: string; background?: string; backgroundOpacity?: number } | null;
  setGroupBgPreview: (
    preview: { id: string; background?: string; backgroundOpacity?: number } | null,
  ) => void;
  /** Item currently in inline text-edit mode (contenteditable active). */
  editingItemId: string | null;
  setEditingItemId: (id: string | null) => void;
}

export const createSelectionSlice: StateCreator<
  SessionState,
  [['zustand/subscribeWithSelector', never]],
  [],
  SelectionSlice
> = (set, get) => ({
  isolatedGroupId: null,
  setIsolatedGroup: (id) => set({ isolatedGroupId: id }),
  groupDropArmed: null,
  setGroupDropArmed: (id) => set({ groupDropArmed: id }),
  groupDropHover: null,
  setGroupDropHover: (id) => set({ groupDropHover: id }),
  timelineDropHover: null,
  setTimelineDropHover: (timelineDropHover) => set({ timelineDropHover }),
  tierDropHover: null,
  setTierDropHover: (tierDropHover) => set({ tierDropHover }),
  sbDropHover: null,
  setSbDropHover: (sbDropHover) => set({ sbDropHover }),
  treeDropHover: null,
  setTreeDropHover: (treeDropHover) => set({ treeDropHover }),
  selectedConnectionId: null,
  setSelectedConnection: (id) => set({ selectedConnectionId: id }),
  connectDraft: null,
  setConnectDraft: (connectDraft) => set({ connectDraft }),
  selection: [],
  // Mobile has no selection chrome (panels/action bar hidden, touch can't
  // select) — programmatic selects after adds would strand a dead select
  // box, so only clears go through on small screens.
  chromeClearedSelection: [],
  setSelection: (selection) =>
    set(
      // Mobile stays select-proof only while view-only; the edit-mode FAB
      // (mobileEditMode) lifts the guard.
      selection.length > 0 && isMobileViewport() && !get().mobileEditMode
        ? {}
        : // Selecting items dismisses any selected connector line.
          (state) => ({
            selection,
            chromeClearedSelection: [],
            ...(state.selectedConnectionId && selection.length > 0
              ? { selectedConnectionId: null }
              : {}),
            // Picking an item always brings faded chrome back.
            ...(state.chromeHidden && selection.length > 0 ? { chromeHidden: false } : {}),
          }),
    ),
  toggleSelected: (id) =>
    set((state) => ({
      selection: state.selection.includes(id)
        ? state.selection.filter((s) => s !== id)
        : [...state.selection, id],
      chromeClearedSelection: [],
    })),
  clearSelection: () => set({ selection: [], chromeClearedSelection: [] }),
  chromeClearSelection: () =>
    set((state) => ({
      selection: [],
      chromeClearedSelection: state.selection.length
        ? state.selection
        : state.chromeClearedSelection,
    })),
  pendingImports: [],
  addPendingImport: (pending) =>
    set((state) => ({ pendingImports: [...state.pendingImports, pending] })),
  updatePendingImport: (id, patch) =>
    set((state) => ({
      pendingImports: state.pendingImports.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  removePendingImport: (id) =>
    set((state) => ({ pendingImports: state.pendingImports.filter((p) => p.id !== id) })),
  filterPreview: null,
  setFilterPreview: (filterPreview) => set({ filterPreview }),
  opacityPreview: null,
  setOpacityPreview: (opacityPreview) => set({ opacityPreview }),
  groupBgPreview: null,
  setGroupBgPreview: (groupBgPreview) => set({ groupBgPreview }),
  editingItemId: null,
  setEditingItemId: (editingItemId) => set({ editingItemId }),
});
