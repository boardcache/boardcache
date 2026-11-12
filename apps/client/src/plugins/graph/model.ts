import type { CanvasDocument, Item } from '@boardcache/schema';
import { mediaMeta } from '../../lib/mediaItems';

/**
 * The graph's data: the board's connected items and groups as nodes, its
 * connections as links, clusters by connected component. Pure functions,
 * shared by both renderers and the sidebar.
 */

export const TYPE_COLORS: Record<string, string> = {
  image: '#5b8def',
  video: '#b06fe0',
  audio: '#e0b34a',
  text: '#69b47a',
  title: '#69b47a',
  pdf: '#e06c5b',
  link: '#4ab8c9',
  iframe: '#4ab8c9',
  map: '#5bc98e',
  swatch: '#e0559a',
  group: '#9aa4b5',
};

/** Distinct cluster hues (border tint when no evidence status claims it). */
export const CLUSTER_COLORS = [
  '#4a7de0',
  '#2e9e5b',
  '#e08a2e',
  '#b06fe0',
  '#4ab8c9',
  '#d64545',
  '#8a9a2e',
  '#e0559a',
];

export interface GNode {
  id: string;
  name: string;
  kind: 'item' | 'group';
  type: string;
  /** Connected-component index (cluster colors); -1 = unconnected. */
  comp: number;
  /** How many links touch the node (dots are sized by it). */
  degree: number;
  // Set by the force layout (a pinned node keeps fx/fy/fz).
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface GLink {
  source: string;
  target: string;
  label: string;
  rel: string;
  /** Stable key for path membership (force-graph mutates source/target). */
  pk: number;
}

export interface GraphData {
  nodes: GNode[];
  links: GLink[];
  clusters: number;
}

export interface GraphFilter {
  includeAll: boolean;
  unwired: boolean;
  hiddenRels: ReadonlySet<string>;
  hiddenTypes: ReadonlySet<string>;
}

/** Does this item point somewhere outside the board (a research source)? */
const isSource = (item: Item): boolean =>
  !!item.source ||
  !!item.linkUrl ||
  (item.type === 'link' && !!item.url) ||
  (item.type === 'iframe' && !!item.url);

export function buildGraph(doc: CanvasDocument, filter: GraphFilter): GraphData {
  const connected = new Set<string>();
  const links: GLink[] = [];
  for (const c of Object.values(doc.connections)) {
    const okFrom = c.from.kind === 'group' ? doc.groups[c.from.id] : doc.items[c.from.id];
    const okTo = c.to.kind === 'group' ? doc.groups[c.to.id] : doc.items[c.to.id];
    if (!okFrom || !okTo) continue;
    connected.add(c.from.id);
    connected.add(c.to.id);
    links.push({
      source: c.from.id,
      target: c.to.id,
      label: c.label ?? '',
      rel: c.rel ?? 'relates',
      pk: links.length,
    });
  }
  // "Unwired sources": ONLY the source-bearing items nothing points at yet —
  // the pile still waiting to be worked into the investigation.
  if (filter.unwired) {
    const nodes: GNode[] = [];
    for (const item of Object.values(doc.items) as Item[]) {
      if (connected.has(item.id) || !isSource(item) || filter.hiddenTypes.has(item.type)) continue;
      nodes.push({
        id: item.id,
        name: mediaMeta(item).title,
        kind: 'item',
        type: item.type,
        comp: -1,
        degree: 0,
      });
    }
    return { nodes, links: [], clusters: 0 };
  }
  // Connected components (union-find) → cluster color per node.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const id of connected) parent.set(id, id);
  for (const l of links) parent.set(find(l.source), find(l.target));
  const compIndex = new Map<string, number>();
  const compOf = (id: string): number => {
    if (!connected.has(id)) return -1;
    const root = find(id);
    if (!compIndex.has(root)) compIndex.set(root, compIndex.size);
    return compIndex.get(root)!;
  };
  const nodes: GNode[] = [];
  for (const item of Object.values(doc.items) as Item[]) {
    if (!filter.includeAll && !connected.has(item.id)) continue;
    if (filter.hiddenTypes.has(item.type)) continue;
    nodes.push({
      id: item.id,
      name: mediaMeta(item).title,
      kind: 'item',
      type: item.type,
      comp: compOf(item.id),
      degree: 0,
    });
  }
  for (const [gid, group] of Object.entries(doc.groups)) {
    if (!connected.has(gid) || filter.hiddenTypes.has('group')) continue;
    nodes.push({
      id: gid,
      name: (group as { name?: string }).name ?? 'Group',
      kind: 'group',
      type: 'group',
      comp: compOf(gid),
      degree: 0,
    });
  }
  const present = new Set(nodes.map((n) => n.id));
  const kept = links.filter(
    (l) => !filter.hiddenRels.has(l.rel) && present.has(l.source) && present.has(l.target),
  );
  const degree = new Map<string, number>();
  for (const l of kept) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  for (const n of nodes) n.degree = degree.get(n.id) ?? 0;
  return { nodes, links: kept, clusters: compIndex.size };
}

/** Shortest undirected path over the visible links; null when unreachable. */
export function shortestPath(
  links: GLink[],
  a: string,
  b: string,
): { linkKeys: Set<number>; hops: number } | null {
  const adj = new Map<string, { other: string; pk: number }[]>();
  for (const l of links) {
    if (!adj.has(l.source)) adj.set(l.source, []);
    if (!adj.has(l.target)) adj.set(l.target, []);
    adj.get(l.source)!.push({ other: l.target, pk: l.pk });
    adj.get(l.target)!.push({ other: l.source, pk: l.pk });
  }
  if (!adj.has(a) || !adj.has(b)) return null;
  const prev = new Map<string, { node: string; pk: number }>();
  const queue = [a];
  const seen = new Set([a]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === b) break;
    for (const e of adj.get(cur) ?? []) {
      if (seen.has(e.other)) continue;
      seen.add(e.other);
      prev.set(e.other, { node: cur, pk: e.pk });
      queue.push(e.other);
    }
  }
  if (!seen.has(b)) return null;
  const linkKeys = new Set<number>();
  let cur = b;
  let hops = 0;
  while (cur !== a) {
    const p = prev.get(cur)!;
    linkKeys.add(p.pk);
    cur = p.node;
    hops++;
  }
  return { linkKeys, hops };
}

/** The ids one hop from `id` over the links. */
export function neighboursOf(links: GLink[], id: string): Set<string> {
  const out = new Set<string>();
  for (const l of links) {
    if (l.source === id) out.add(l.target);
    if (l.target === id) out.add(l.source);
  }
  return out;
}

/** Case-insensitive name match for the search box. */
export function matchesQuery(node: GNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !!q && node.name.toLowerCase().includes(q);
}
