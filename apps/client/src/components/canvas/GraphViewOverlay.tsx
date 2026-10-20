import { revealItemPage } from '../../lib/board/pages';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CanvasDocument, Item } from '@boardcache/schema';
import { getCanvasContainer } from '../../lib/canvas/canvasDom';
import { renderItemCanvas } from '../../lib/media/thumbnail';
import {
  relColor,
  relDirectional,
  relName,
  CONNECTION_RELS,
} from '../../lib/canvas/connectionTypes';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { mediaMeta } from '../../lib/mediaItems';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { statusMeta } from '../../lib/text/evidenceStatus';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { CloseIcon } from '../icons';
import { groupMembers } from '../../lib/canvas/grouping';

/**
 * Graph View (View menu): the board's CONNECTED items as an Obsidian-style
 * 3D force graph — orbit to spin, scroll to zoom, drag nodes, hover for
 * names, click to fly back to the item on the canvas. Only items/groups
 * with at least one connection appear (a toggle adds the rest). The heavy
 * 3d-force-graph/three chunk loads lazily on first open and stays out of
 * the viewer bundle and the SW precache.
 */

const TYPE_COLORS: Record<string, string> = {
  image: '#5b8def',
  video: '#b06fe0',
  audio: '#e0b34a',
  text: '#69b47a',
  title: '#69b47a',
  pdf: '#e06c5b',
  link: '#4ab8c9',
  iframe: '#4ab8c9',
  map: '#5bc98e',
  group: '#9aa4b5',
};

interface GNode {
  id: string;
  name: string;
  kind: 'item' | 'group';
  type: string;
  /** Connected-component index (cluster colors); -1 = unconnected. */
  comp: number;
}

interface GLink {
  source: string;
  target: string;
  label: string;
  rel: string;
  /** Stable key for path membership (force-graph mutates source/target). */
  pk: number;
}

/** Distinct cluster hues (border tint when no evidence status claims it). */
const CLUSTER_COLORS = [
  '#4a7de0',
  '#2e9e5b',
  '#e08a2e',
  '#b06fe0',
  '#4ab8c9',
  '#d64545',
  '#8a9a2e',
  '#e0559a',
];

/** Does this item point somewhere outside the board (a research source)? */
const isSource = (item: Item): boolean =>
  !!item.source ||
  !!item.linkUrl ||
  (item.type === 'link' && !!item.url) ||
  (item.type === 'iframe' && !!item.url);

function buildGraph(
  doc: CanvasDocument,
  includeAll: boolean,
  unwired: boolean,
): { nodes: GNode[]; links: GLink[]; clusters: number } {
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
  if (unwired) {
    const nodes: GNode[] = [];
    for (const item of Object.values(doc.items) as Item[]) {
      if (connected.has(item.id) || !isSource(item)) continue;
      nodes.push({
        id: item.id,
        name: mediaMeta(item).title,
        kind: 'item',
        type: item.type,
        comp: -1,
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
    if (!includeAll && !connected.has(item.id)) continue;
    nodes.push({
      id: item.id,
      name: mediaMeta(item).title,
      kind: 'item',
      type: item.type,
      comp: compOf(item.id),
    });
  }
  for (const [gid, group] of Object.entries(doc.groups)) {
    if (!connected.has(gid)) continue;
    nodes.push({
      id: gid,
      name: (group as { name?: string }).name ?? 'Group',
      kind: 'group',
      type: 'group',
      comp: compOf(gid),
    });
  }
  return { nodes, links, clusters: compIndex.size };
}

/** Shortest undirected path over the visible links; null when unreachable. */
function shortestPath(
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

export function GraphViewOverlay() {
  const open = useSessionStore((s) => s.graphOpen);
  return open ? <GraphBody /> : null;
}

function GraphBody() {
  const close = () => useSessionStore.getState().setGraphOpen(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const [includeAll, setIncludeAll] = useState(false);
  // Typed-connection filter: hide whole relation kinds from the graph.
  const [hiddenRels, setHiddenRels] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<{ nodes: number; links: number } | null>(null);
  // "Unwired sources": only source-bearing items with no connections yet.
  const [unwired, setUnwired] = useState(false);
  // Path mode: shift-click two nodes -> shortest route between them.
  const [pathInfo, setPathInfo] = useState<
    | { kind: 'picking'; fromName: string }
    | { kind: 'done'; fromName: string; toName: string; hops: number }
    | { kind: 'none'; fromName: string; toName: string }
    | null
  >(null);
  const pathState = useRef<{ ends: { id: string; name: string }[]; links: Set<number> }>({
    ends: [],
    links: new Set(),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let graph: { _destructor?: () => void } | null = null;

    pathState.current = { ends: [], links: new Set() };
    setPathInfo(null);

    void (async () => {
      const [{ default: ForceGraph3D }, THREE] = await Promise.all([
        import('3d-force-graph'),
        import('three'),
      ]);
      if (disposed) return;
      const doc = useDocumentStore.getState().doc;
      const data = buildGraph(doc, includeAll, unwired);
      data.links = data.links.filter((l) => !hiddenRels.has(l.rel));
      setCounts({ nodes: data.nodes.length, links: data.links.length });
      (window as { __graphStats?: unknown }).__graphStats = {
        nodes: data.nodes.length,
        links: data.links.length,
        clusters: data.clusters,
      };
      if (data.nodes.length === 0) return;
      // force-graph swaps link source/target ids for node objects on load —
      // keep a plain-id snapshot for path finding.
      const plainLinks: GLink[] = data.links.map((l) => ({ ...l }));

      const styles = getComputedStyle(document.documentElement);
      const accent = styles.getPropertyValue('--accent').trim() || '#3b82f6';
      const g = new ForceGraph3D(host)
        .backgroundColor('rgba(0,0,0,0)')
        .graphData(data)
        .nodeLabel((n) => (n as GNode).name)
        .nodeColor((n) => {
          const node = n as GNode;
          if (node.comp >= 0) return CLUSTER_COLORS[node.comp % CLUSTER_COLORS.length]!;
          return TYPE_COLORS[node.type] ?? accent;
        })
        .nodeRelSize(5)
        .linkLabel((l) => {
          const link = l as GLink;
          return link.rel !== 'relates'
            ? `${relName(link.rel as never)}${link.label ? ` — ${link.label}` : ''}`
            : link.label;
        })
        .linkColor((l) => {
          const link = l as GLink;
          const path = pathState.current;
          if (path.links.size > 0) {
            return path.links.has(link.pk) ? accent : 'rgba(127, 127, 127, 0.18)';
          }
          return (
            relColor(link.rel as never) ??
            (styles.getPropertyValue('--text-secondary').trim() || '#8a93a5')
          );
        })
        .linkDirectionalArrowLength((l) => (relDirectional((l as GLink).rel as never) ? 3.4 : 0))
        .linkDirectionalArrowRelPos(0.55)
        .linkOpacity(0.45)
        .linkWidth((l) => {
          const link = l as GLink;
          const path = pathState.current;
          if (path.links.size > 0 && path.links.has(link.pk)) return 3.2;
          return link.label ? 1.4 : 0.7;
        })
        .onNodeClick((n, event) => {
          const node = n as GNode;
          // Shift-click: pick path endpoints instead of leaving the graph.
          if ((event as MouseEvent | undefined)?.shiftKey && !unwired) {
            const path = pathState.current;
            const next = [...path.ends, { id: node.id, name: node.name }].slice(-2);
            if (next.length === 2 && next[0]!.id === next[1]!.id) next.pop();
            path.ends = next;
            if (next.length === 1) {
              path.links = new Set();
              setPathInfo({ kind: 'picking', fromName: next[0]!.name });
            } else if (next.length === 2) {
              const found = shortestPath(plainLinks, next[0]!.id, next[1]!.id);
              path.links = found?.linkKeys ?? new Set();
              setPathInfo(
                found
                  ? {
                      kind: 'done',
                      fromName: next[0]!.name,
                      toName: next[1]!.name,
                      hops: found.hops,
                    }
                  : { kind: 'none', fromName: next[0]!.name, toName: next[1]!.name },
              );
              (window as { __graphStats?: { path?: unknown } }).__graphStats!.path = found
                ? { found: true, hops: found.hops }
                : { found: false };
            }
            restyle();
            return;
          }
          close();
          const session = useSessionStore.getState();
          const liveDoc = useDocumentStore.getState().doc;
          const ids = node.kind === 'group' ? groupMembers(liveDoc, node.id) : [node.id];
          const first = ids[0] && liveDoc.items[ids[0]];
          if (!first) return;
          if (session.view !== 'canvas') session.setView('canvas');
          session.setSelection(ids);
          revealItemPage(first.id);
          fitViewportTo(rotatedRectAABB(first), getCanvasContainer());
        });
      // Re-applying the accessors makes force-graph restyle existing links
      // (path highlight on/off) without rebuilding the scene.
      const restyle = () => {
        g.linkColor(g.linkColor());
        g.linkWidth(g.linkWidth());
      };
      (window as { __graphRestyle?: () => void }).__graphRestyle = restyle;
      // e2e hook: drive path picking without WebGL hit-testing.
      (window as { __graphPath?: (a: string, b: string) => void }).__graphPath = (a, b) => {
        const found = shortestPath(plainLinks, a, b);
        const nameOf = (id: string) => data.nodes.find((n) => n.id === id)?.name ?? id;
        pathState.current.ends = [
          { id: a, name: nameOf(a) },
          { id: b, name: nameOf(b) },
        ];
        pathState.current.links = found?.linkKeys ?? new Set();
        setPathInfo(
          found
            ? { kind: 'done', fromName: nameOf(a), toName: nameOf(b), hops: found.hops }
            : { kind: 'none', fromName: nameOf(a), toName: nameOf(b) },
        );
        (window as { __graphStats?: { path?: unknown } }).__graphStats!.path = found
          ? { found: true, hops: found.hops }
          : { found: false };
        restyle();
      };
      // EVERY item node renders its real preview as a billboard card — the
      // same rasterizer that draws board thumbnails and PDF pages, so any
      // type (text, PDFs, swatches, maps) looks like itself. Groups keep
      // the default sphere.
      const composeCard = (src: HTMLCanvasElement, border?: string): HTMLCanvasElement => {
        const MAX = 256;
        const PAD = 10;
        const ar = src.width / Math.max(1, src.height);
        const w = ar >= 1 ? MAX : Math.max(48, Math.round(MAX * ar));
        const h = ar >= 1 ? Math.max(48, Math.round(MAX / ar)) : MAX;
        const c = document.createElement('canvas');
        c.width = w + PAD * 2;
        c.height = h + PAD * 2;
        const x = c.getContext('2d')!;
        x.beginPath();
        x.roundRect(1, 1, c.width - 2, c.height - 2, 14);
        x.fillStyle = styles.getPropertyValue('--panel-solid').trim() || '#ffffff';
        x.fill();
        x.save();
        x.clip();
        x.drawImage(src, PAD, PAD, w, h);
        x.restore();
        x.strokeStyle = border ?? 'rgba(127, 127, 127, 0.45)';
        x.lineWidth = border ? 4 : 2;
        x.stroke();
        return c;
      };
      g.nodeThreeObject((n) => {
        const node = n as GNode;
        if (node.kind !== 'item') return false as unknown as never; // group sphere
        const item = useDocumentStore.getState().doc.items[node.id];
        if (!item) return false as unknown as never;
        const material = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(14, 14, 1);
        void (async () => {
          try {
            const raw = await renderItemCanvas(item, 1);
            if (disposed) return;
            const card = composeCard(
              raw,
              statusMeta(item.status)?.color ??
                (node.comp >= 0 ? CLUSTER_COLORS[node.comp % CLUSTER_COLORS.length] : undefined),
            );
            const tex = new THREE.CanvasTexture(card);
            tex.colorSpace = THREE.SRGBColorSpace;
            const ar = card.width / card.height;
            const base = 18;
            sprite.scale.set(base * Math.sqrt(ar), base / Math.sqrt(ar), 1);
            material.map = tex;
            material.needsUpdate = true;
          } catch {
            // Rasterization failed — fall back to a type-colored dot.
            material.color.set(TYPE_COLORS[node.type] ?? accent);
          }
        })();
        return sprite as unknown as never;
      });
      const size = () => g.width(host.clientWidth).height(host.clientHeight);
      size();
      const ro = new ResizeObserver(size);
      ro.observe(host);
      graph = {
        _destructor: () => {
          ro.disconnect();
          (g as unknown as { _destructor?: () => void })._destructor?.();
        },
      };
    })();

    return () => {
      disposed = true;
      graph?._destructor?.();
    };
  }, [includeAll, hiddenRels, unwired]);

  return createPortal(
    <div className="graph-veil" data-testid="graph-view">
      <div className="graph-host" ref={hostRef} />
      {counts !== null && counts.nodes === 0 && !unwired && (
        <div className="graph-empty" data-testid="graph-empty">
          <p>No connected items yet.</p>
          <p className="graph-empty-hint">
            Draw connections between items on the canvas (drag from an item’s link handle) and
            they’ll appear here as a graph.
          </p>
        </div>
      )}
      <div className="graph-chrome">
        <span className="graph-title">Graph View</span>
        {counts !== null && counts.nodes > 0 && (
          <span className="graph-counts" data-testid="graph-counts">
            {counts.nodes} item{counts.nodes === 1 ? '' : 's'} · {counts.links} connection
            {counts.links === 1 ? '' : 's'}
          </span>
        )}
        <span className="graph-rels" data-testid="graph-rels">
          {CONNECTION_RELS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`graph-rel${hiddenRels.has(r.id) ? ' off' : ''}`}
              data-testid={`graph-rel-${r.id}`}
              title={`${hiddenRels.has(r.id) ? 'Show' : 'Hide'} ${r.name} connections`}
              onClick={() =>
                setHiddenRels((prev) => {
                  const next = new Set(prev);
                  if (next.has(r.id)) next.delete(r.id);
                  else next.add(r.id);
                  return next;
                })
              }
            >
              <span
                className="conn-rel-dot"
                style={{ background: r.color ?? 'var(--text-secondary)' }}
              />
              {r.name}
            </button>
          ))}
        </span>
        <label className="graph-toggle">
          <input
            type="checkbox"
            checked={includeAll}
            data-testid="graph-include-all"
            onChange={(e) => setIncludeAll(e.target.checked)}
          />
          <span>Include unconnected</span>
        </label>
        <label
          className="graph-toggle"
          title="Only items that point at an outside source but have no connections yet"
        >
          <input
            type="checkbox"
            checked={unwired}
            data-testid="graph-unwired"
            onChange={(e) => setUnwired(e.target.checked)}
          />
          <span>Unwired sources</span>
        </label>
        <button
          type="button"
          className="graph-close"
          aria-label="Close graph view"
          data-testid="graph-close"
          onClick={close}
        >
          <CloseIcon size={16} />
        </button>
      </div>
      {pathInfo && (
        <div className="graph-path-chip" data-testid="graph-path-chip">
          {pathInfo.kind === 'picking'
            ? `Path from “${pathInfo.fromName}” — shift-click another node`
            : pathInfo.kind === 'done'
              ? `Path: ${pathInfo.fromName} ⇄ ${pathInfo.toName} · ${pathInfo.hops} hop${pathInfo.hops === 1 ? '' : 's'}`
              : `No path between ${pathInfo.fromName} and ${pathInfo.toName}`}
          <button
            type="button"
            aria-label="Clear path"
            data-testid="graph-path-clear"
            onClick={() => {
              pathState.current = { ends: [], links: new Set() };
              setPathInfo(null);
              (window as { __graphRestyle?: () => void }).__graphRestyle?.();
            }}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      )}
      {counts !== null && counts.nodes === 0 && unwired && (
        <div className="graph-empty" data-testid="graph-unwired-empty">
          <p>Every source is wired in.</p>
          <p className="graph-empty-hint">
            No source-bearing items are left unconnected — nice detective work.
          </p>
        </div>
      )}
    </div>,
    document.body,
  );
}
