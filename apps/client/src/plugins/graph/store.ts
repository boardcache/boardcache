import { create } from 'zustand';

/**
 * UI state of the Graph View: how nodes are drawn (remembered on this
 * device), the filters, the search, the selection and the path being
 * picked (per visit).
 */

export type GraphNodes = 'previews' | 'dots';
type GraphSpace = '3d' | '2d';
export type GraphLabels = 'auto' | 'always' | 'off';
export type GraphColorBy = 'cluster' | 'type';

export interface GraphPrefs {
  nodes: GraphNodes;
  space: GraphSpace;
  labels: GraphLabels;
  colorBy: GraphColorBy;
  /** Node size as a factor of the default. */
  nodeScale: number;
  /** The sidebar is open. */
  side: boolean;
}

const PREFS_KEY = 'boardcache:graphPrefs';
export const NODE_SCALES = [0.6, 0.8, 1, 1.25, 1.6, 2];

const DEFAULTS: GraphPrefs = {
  nodes: 'previews',
  space: '3d',
  labels: 'auto',
  colorBy: 'cluster',
  nodeScale: 1,
  side: true,
};

function readPrefs(): GraphPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<GraphPrefs> | null;
    if (!raw) return DEFAULTS;
    return {
      nodes: raw.nodes === 'dots' ? 'dots' : 'previews',
      space: raw.space === '2d' ? '2d' : '3d',
      labels: raw.labels === 'always' || raw.labels === 'off' ? raw.labels : 'auto',
      colorBy: raw.colorBy === 'type' ? 'type' : 'cluster',
      nodeScale: NODE_SCALES.includes(raw.nodeScale ?? 1) ? raw.nodeScale! : 1,
      side: raw.side !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(p: GraphPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* the choice lasts the session */
  }
}

type PathInfo =
  | { kind: 'picking'; fromName: string }
  | { kind: 'done'; fromName: string; toName: string; hops: number }
  | { kind: 'none'; fromName: string; toName: string }
  | null;

interface GraphUi extends GraphPrefs {
  includeAll: boolean;
  unwired: boolean;
  hiddenRels: Set<string>;
  hiddenTypes: Set<string>;
  query: string;
  /** The node picked by a click (its details show in the sidebar). */
  selected: string | null;
  path: PathInfo;

  setPref: <K extends keyof GraphPrefs>(key: K, value: GraphPrefs[K]) => void;
  setIncludeAll: (v: boolean) => void;
  setUnwired: (v: boolean) => void;
  toggleRel: (rel: string) => void;
  toggleType: (type: string) => void;
  setQuery: (q: string) => void;
  setSelected: (id: string | null) => void;
  setPath: (p: PathInfo) => void;
  /** Back to a fresh visit (the board changed, the view closed). */
  reset: () => void;
}

export const useGraphUi = create<GraphUi>((set, get) => ({
  ...readPrefs(),
  includeAll: false,
  unwired: false,
  hiddenRels: new Set(),
  hiddenTypes: new Set(),
  query: '',
  selected: null,
  path: null,

  setPref: (key, value) => {
    set({ [key]: value } as Partial<GraphUi>);
    const s = get();
    writePrefs({
      nodes: s.nodes,
      space: s.space,
      labels: s.labels,
      colorBy: s.colorBy,
      nodeScale: s.nodeScale,
      side: s.side,
    });
  },
  setIncludeAll: (includeAll) => set({ includeAll }),
  setUnwired: (unwired) => set({ unwired, selected: null, path: null }),
  toggleRel: (rel) =>
    set((s) => {
      const next = new Set(s.hiddenRels);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return { hiddenRels: next };
    }),
  toggleType: (type) =>
    set((s) => {
      const next = new Set(s.hiddenTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { hiddenTypes: next };
    }),
  setQuery: (query) => set({ query }),
  setSelected: (selected) => set({ selected }),
  setPath: (path) => set({ path }),
  reset: () =>
    set({
      includeAll: false,
      unwired: false,
      hiddenRels: new Set(),
      hiddenTypes: new Set(),
      query: '',
      selected: null,
      path: null,
    }),
}));
