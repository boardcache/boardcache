/** The mobile edit mode and its sheets. */
import type { StateCreator } from 'zustand';
import type { SessionState } from '../sessionStore';

export interface MobileSlice {
  /** Mobile canvas editing (phase 1): off = the classic view-only canvas. */
  mobileEditMode: boolean;
  /** Mobile: the image adjustments sheet (filters/caption) is open. */
  mobileAdjustOpen: boolean;
  setMobileAdjustOpen: (open: boolean) => void;
  /** Mobile: a style panel (link/QR/shape) is showing as a bottom sheet. */
  mobileStyleSheetOpen: boolean;
  setMobileStyleSheetOpen: (open: boolean) => void;
  setMobileEditMode: (on: boolean) => void;
  /** Phase 2 dimension lock: the next touch gesture only moves/scales/rotates. */
  mobileTransformLock: 'move' | 'scale' | 'rotate';
  setMobileTransformLock: (lock: 'move' | 'scale' | 'rotate') => void;
}

export const createMobileSlice: StateCreator<
  SessionState,
  [['zustand/subscribeWithSelector', never]],
  [],
  MobileSlice
> = (set) => ({
  mobileEditMode: false,
  mobileAdjustOpen: false,
  setMobileAdjustOpen: (mobileAdjustOpen) => set({ mobileAdjustOpen }),
  mobileStyleSheetOpen: false,
  setMobileStyleSheetOpen: (mobileStyleSheetOpen) => set({ mobileStyleSheetOpen }),
  // Leaving edit mode leaves every editing state with it: the lock resets and
  // an isolated group is released (view mode has no group editing).
  setMobileEditMode: (mobileEditMode) =>
    set({
      mobileEditMode,
      mobileTransformLock: 'move',
      ...(mobileEditMode ? {} : { isolatedGroupId: null }),
    }),
  mobileTransformLock: 'move',
  setMobileTransformLock: (mobileTransformLock) => set({ mobileTransformLock }),
});
