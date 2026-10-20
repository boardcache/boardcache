import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { CanvasDocument, Viewport } from '@boardcache/schema';
import { createDocument } from '@boardcache/schema';

/**
 * The document store holds the one CanvasDocument (rule 3.5). It is the
 * persisted, undoable half of app state.
 *
 * Viewport updates are deliberately NOT commands: they are transient,
 * happen at 60fps during pan/zoom, and are excluded from undo history.
 * Item mutations go through the command system (arrives in Sprint 2) —
 * nothing else may write `doc.items`.
 */
interface DocumentState {
  doc: CanvasDocument;
  replaceDoc: (doc: CanvasDocument) => void;
  setViewport: (viewport: Viewport) => void;
  /** No-history write (page viewport memory) — same rail as setViewport. */
  setPages: (pages: CanvasDocument['pages']) => void;
}

export const useDocumentStore = create<DocumentState>()(
  subscribeWithSelector((set) => ({
    doc: createDocument({ name: 'My first board' }),

    replaceDoc: (doc) => set({ doc }),

    setViewport: (viewport) => set((state) => ({ doc: { ...state.doc, viewport } })),

    setPages: (pages) => set((state) => ({ doc: { ...state.doc, pages } })),
  })),
);
