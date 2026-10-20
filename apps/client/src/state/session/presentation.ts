/** Presentation Mode playback and its panel. */
import type { StateCreator } from 'zustand';
import type { SessionState } from '../sessionStore';

export interface PresentationSlice {
  /** Presentation panel (the step order; numbered badges show while open). */
  presentPanelOpen: boolean;
  setPresentPanelOpen: (open: boolean) => void;
  /** Presentation Mode: playing, the current step, and the ids it frames. */
  presenting: boolean;
  presentStep: number;
  presentIds: string[];
  setPresentation: (p: {
    presenting: boolean;
    presentStep?: number;
    presentIds?: string[];
  }) => void;
}

export const createPresentationSlice: StateCreator<
  SessionState,
  [['zustand/subscribeWithSelector', never]],
  [],
  PresentationSlice
> = (set) => ({
  presentPanelOpen: false,
  setPresentPanelOpen: (presentPanelOpen) => set({ presentPanelOpen }),
  presenting: false,
  presentStep: 0,
  presentIds: [],
  setPresentation: (p) =>
    set((s) => ({
      presenting: p.presenting,
      presentStep: p.presentStep ?? s.presentStep,
      presentIds: p.presentIds ?? s.presentIds,
    })),
});
