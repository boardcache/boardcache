import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { createNavigationSlice, type NavigationSlice } from './session/navigation';
import { createToolsSlice, type ToolsSlice } from './session/tools';
import { createDialogsSlice, type DialogsSlice } from './session/dialogs';
import { createSelectionSlice, type SelectionSlice } from './session/selection';
import { createGallerySlice, type GallerySlice } from './session/gallery';
import { createPresentationSlice, type PresentationSlice } from './session/presentation';
import { createChromeSlice, type ChromeSlice } from './session/chrome';
import { createMobileSlice, type MobileSlice } from './session/mobile';
import type { ThemePreference } from './session/types';

/**
 * Session store (rule 3.5): ephemeral interaction state. Never serialized,
 * never in undo history.
 *
 * Tools are a state machine (rule 3.6): exactly one tool is active at a time;
 * activating a tool exits the previous one by construction.
 */
export type {
  AppView,
  CaptureMode,
  DrawToolId,
  GallerySortMode,
  PenDraftNode,
  ShapeStyle,
  SortDir,
  ThemePreference,
  ToolId,
} from './session/types';
export { DRAW_TOOL_SHAPE, isDrawTool } from './session/types';
export { GALLERY_SCALE } from './session/persist';

/** Ephemeral interaction state: one store, assembled from the slices in ./session. */
export type SessionState = NavigationSlice &
  ToolsSlice &
  DialogsSlice &
  SelectionSlice &
  GallerySlice &
  PresentationSlice &
  ChromeSlice &
  MobileSlice;

export const useSessionStore = create<SessionState>()(
  subscribeWithSelector((...a) => ({
    ...createNavigationSlice(...a),
    ...createToolsSlice(...a),
    ...createDialogsSlice(...a),
    ...createSelectionSlice(...a),
    ...createGallerySlice(...a),
    ...createPresentationSlice(...a),
    ...createChromeSlice(...a),
    ...createMobileSlice(...a),
  })),
);

/** Resolve a preference to the concrete theme to render. */
export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}
