import type { Item } from '@boardcache/schema';
import type { GNode, GraphData } from './model';
import type { GraphLabels, GraphNodes } from './store';

/**
 * What a renderer (2D canvas or 3D WebGL) is given and gives back. The
 * view owns the state; the engine reads it through `state()` whenever it
 * restyles, so a selection, a search or a path never rebuilds the scene.
 * Engines are heavy and must only ever be `import()`ed.
 */

interface EngineLook {
  nodes: GraphNodes;
  labels: GraphLabels;
  nodeScale: number;
  /** The colour of a node (cluster or type, the view decides). */
  colorOf: (node: GNode) => string;
  /** The border tint of a preview card (evidence status wins over cluster). */
  borderOf: (node: GNode) => string | null;
  /** The colour a typed connection draws in (null for plain ones). */
  relColor: (rel: string) => string | null;
  accent: string;
  muted: string;
  panel: string;
  text: string;
}

export interface EngineState {
  selected: string | null;
  /** Nodes lit by the selection (the node and its neighbours) or the search. */
  lit: ReadonlySet<string> | null;
  pathLinks: ReadonlySet<number>;
}

export interface EngineOptions {
  host: HTMLElement;
  data: GraphData;
  look: EngineLook;
  state: () => EngineState;
  getItem: (id: string) => Item | undefined;
  /** A plain click. */
  onClick: (node: GNode) => void;
  /** A double click. */
  onOpen: (node: GNode) => void;
  /** A shift click (path endpoints). */
  onShiftClick: (node: GNode) => void;
  onBackgroundClick: () => void;
}

export interface Engine {
  destroy: () => void;
  /** Re-read the state and recolour without rebuilding. */
  restyle: () => void;
  fit: () => void;
  /** Bring the camera to a node. */
  focus: (id: string) => void;
  unpinAll: () => void;
  /** The picture as drawn, with the page's background behind it. */
  snapshot: () => Promise<Blob | null>;
}

/** The radius of a dot for a node: a floor plus its connections. */
export const dotSize = (node: GNode, scale: number): number =>
  (3 + Math.sqrt(node.degree) * 1.6) * scale;

/** Click bookkeeping: the second click inside DOUBLE_MS opens instead. */
const DOUBLE_MS = 320;
export function clickRouter(opts: Pick<EngineOptions, 'onClick' | 'onOpen' | 'onShiftClick'>) {
  let last: { id: string; at: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (node: GNode, shift: boolean) => {
    if (shift) {
      opts.onShiftClick(node);
      return;
    }
    const now = Date.now();
    if (last && last.id === node.id && now - last.at < DOUBLE_MS) {
      if (timer) clearTimeout(timer);
      timer = null;
      last = null;
      opts.onOpen(node);
      return;
    }
    last = { id: node.id, at: now };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      opts.onClick(node);
    }, DOUBLE_MS);
  };
}

/** A node's alpha under the current lighting. */
export function alphaFor(id: string, state: EngineState): number {
  if (!state.lit) return 1;
  return state.lit.has(id) ? 1 : 0.18;
}
