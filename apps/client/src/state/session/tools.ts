/** The active tool, its defaults, and the live gesture drafts. */
import type { StateCreator } from 'zustand';
import type { SessionState } from '../sessionStore';
import type { Rect } from '../../lib/canvas/coords';
import type { ToolId, ShapeStyle, PenDraft, ShapeDraft, Gesture } from './types';

export interface ToolsSlice {
  tool: ToolId;
  setTool: (tool: ToolId) => void;
  /** What a plain wheel/trackpad scroll does on the canvas. */
  wheelMode: 'pan' | 'zoom';
  /** Wheel-zoom sensitivity multiplier (1 = default; shift stays ¼ of this). */
  zoomSpeed: number;
  /** Zoom fraction (≤) at which the canvas swaps to low-detail sprites. */
  lodThreshold: number;
  setLodThreshold: (t: number) => void;
  setZoomSpeed: (speed: number) => void;
  setWheelMode: (mode: 'pan' | 'zoom') => void;
  /** Path item whose anchors are being node-edited; null when not editing. */
  pathEditId: string | null;
  setPathEditId: (id: string | null) => void;
  /** Defaults applied to newly created text items (persisted). */
  textDefaults: { fontFamily: string; fontSize: number; align: 'left' | 'center' | 'right' };
  setTextDefaults: (
    patch: Partial<{ fontFamily: string; fontSize: number; align: 'left' | 'center' | 'right' }>,
  ) => void;
  /** Default style for new shapes; the shape panel reads/writes it. */
  shapeStyle: ShapeStyle;
  setShapeStyle: (patch: Partial<ShapeStyle>) => void;
  /** Live drawing preview; null when not drawing. */
  draft: ShapeDraft | null;
  setDraft: (draft: ShapeDraft | null) => void;
  /** In-progress pen path (canvas coords); null when the pen is idle. */
  penDraft: PenDraft | null;
  setPenDraft: (penDraft: PenDraft | null) => void;
  gesture: Gesture | null;
  setGesture: (gesture: Gesture | null) => void;
  /** Marquee rectangle in canvas coordinates while rubber-band selecting. */
  marquee: Rect | null;
  setMarquee: (marquee: Rect | null) => void;
  /** True while the spacebar is held — temporarily forces pan behavior. */
  spaceHeld: boolean;
  setSpaceHeld: (held: boolean) => void;
  /** True while the "c" key is held — dragging on an image crops it. */
  cropHeld: boolean;
  setCropHeld: (held: boolean) => void;
  /** Live crop rectangle in canvas coordinates while drawing a crop box. */
  cropBox: Rect | null;
  setCropBox: (box: Rect | null) => void;
  /** True during an active pan drag (drives the grabbing cursor). */
  panning: boolean;
  setPanning: (panning: boolean) => void;
}

export const createToolsSlice: StateCreator<
  SessionState,
  [['zustand/subscribeWithSelector', never]],
  [],
  ToolsSlice
> = (set) => ({
  tool: 'select',
  setTool: (tool) =>
    set((s) => {
      // Grabbing a non-select tool drops the selection (the handles would
      // fight the new tool). Switching BACK to select keeps it — draw
      // gestures select their new item and then return to the select tool.
      if (tool === s.tool || tool === 'select') return { tool };
      return { tool, selection: [], selectedConnectionId: null };
    }),
  wheelMode: (() => {
    try {
      return localStorage.getItem('boardcache:wheelMode') === 'zoom' ? 'zoom' : 'pan';
    } catch {
      return 'pan';
    }
  })(),
  zoomSpeed: (() => {
    try {
      const v = Number(localStorage.getItem('boardcache:zoomSpeed'));
      return Number.isFinite(v) && v >= 0.25 && v <= 3 ? v : 1;
    } catch {
      return 1;
    }
  })(),
  lodThreshold: (() => {
    try {
      const v = Number(localStorage.getItem('boardcache:lodThreshold'));
      return Number.isFinite(v) && v >= 0.05 && v <= 0.4 ? v : 0.15;
    } catch {
      return 0.15;
    }
  })(),
  setLodThreshold: (t) => {
    const v = Math.min(0.4, Math.max(0.05, t));
    try {
      localStorage.setItem('boardcache:lodThreshold', String(v));
    } catch {
      /* storage unavailable */
    }
    set({ lodThreshold: v });
  },
  setZoomSpeed: (speed) => {
    const v = Math.min(3, Math.max(0.25, speed));
    try {
      localStorage.setItem('boardcache:zoomSpeed', String(v));
    } catch {
      /* storage unavailable */
    }
    set({ zoomSpeed: v });
  },
  setWheelMode: (mode) => {
    try {
      localStorage.setItem('boardcache:wheelMode', mode);
    } catch {
      /* storage unavailable */
    }
    set({ wheelMode: mode });
  },
  pathEditId: null,
  setPathEditId: (id) => set({ pathEditId: id }),
  textDefaults: (() => {
    try {
      const raw = localStorage.getItem('boardcache:textDefaults');
      if (raw) {
        const parsed = JSON.parse(raw) as {
          fontFamily?: string;
          fontSize?: number;
          align?: 'left' | 'center' | 'right';
        };
        return {
          fontFamily:
            typeof parsed.fontFamily === 'string' && parsed.fontFamily.trim()
              ? parsed.fontFamily
              : 'Inter, system-ui, sans-serif',
          fontSize: typeof parsed.fontSize === 'number' ? parsed.fontSize : 18,
          align: parsed.align ?? 'left',
        };
      }
    } catch {
      /* storage unavailable */
    }
    return { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 18, align: 'left' as const };
  })(),
  setTextDefaults: (patch) =>
    set((state) => {
      const next = { ...state.textDefaults, ...patch };
      try {
        localStorage.setItem('boardcache:textDefaults', JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return { textDefaults: next };
    }),
  shapeStyle: {
    stroke: '#1971c2',
    fill: null,
    fillGradient: null,
    strokeWidth: 2,
    dashed: false,
  },
  setShapeStyle: (patch) => set((state) => ({ shapeStyle: { ...state.shapeStyle, ...patch } })),
  draft: null,
  setDraft: (draft) => set({ draft }),
  penDraft: null,
  setPenDraft: (penDraft) => set({ penDraft }),
  gesture: null,
  setGesture: (gesture) => set({ gesture }),
  marquee: null,
  setMarquee: (marquee) => set({ marquee }),
  spaceHeld: false,
  setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
  cropHeld: false,
  setCropHeld: (cropHeld) => set({ cropHeld }),
  cropBox: null,
  setCropBox: (cropBox) => set({ cropBox }),
  panning: false,
  setPanning: (panning) => set({ panning }),
});
