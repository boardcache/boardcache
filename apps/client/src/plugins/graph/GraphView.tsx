import { useEffect, useMemo, useRef, useState } from 'react';
import type { Item } from '@boardcache/schema';
import { ViewBarButton } from '../../components/chrome/ViewBarButton';
import { ThemeToggle } from '../../components/chrome/ThemeToggle';
import { PopOutViewButton } from '../../components/chrome/PopOutViewButton';
import {
  BoardsIcon,
  CameraIcon,
  CloseIcon,
  FitIcon,
  MinusIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
} from '../../components/icons';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { usePhoneViewport } from '../../hooks/useMobileViewport';
import { revealItemPage } from '../../lib/board/pages';
import { clientToCanvas, getCanvasContainer } from '../../lib/canvas/canvasDom';
import { CONNECTION_RELS, relColor, relName } from '../../lib/canvas/connectionTypes';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { groupMembers } from '../../lib/canvas/grouping';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { importMediaFiles } from '../../lib/import/importMedia';
import { mediaMeta } from '../../lib/mediaItems';
import { showNotice } from '../../lib/notices';
import { statusMeta } from '../../lib/text/evidenceStatus';
import { itemType } from '../../itemTypes';
import { useDocumentStore } from '../../state/documentStore';
import { resolveTheme, useSessionStore } from '../../state/sessionStore';
import type { Engine, EngineState } from './engine';
import {
  buildGraph,
  CLUSTER_COLORS,
  matchesQuery,
  neighboursOf,
  shortestPath,
  TYPE_COLORS,
  type GLink,
  type GNode,
  type GraphData,
} from './model';
import { NODE_SCALES, useGraphUi, type GraphColorBy, type GraphLabels } from './store';

/**
 * Graph View: the board's connected items as a force graph, 3D or 2D, as
 * preview cards or Obsidian-style dots. A sidebar holds the search, the
 * display choices, the filters, the colour legend and the picked node's
 * details; the bar has Fit, Save as picture and the theme. Click a node to
 * inspect it, double-click to fly to it on the canvas, shift-click two for
 * the shortest path between them. A full-screen plugin view at /b/:id/graph.
 */

const typeLabel = (type: string): string =>
  type === 'group' ? 'Group' : type.charAt(0).toUpperCase() + type.slice(1);

export function GraphView() {
  const ui = useGraphUi();
  const doc = useDocumentStore((s) => s.doc);
  const theme = useSessionStore((s) => resolveTheme(s.theme));
  const phone = usePhoneViewport();
  const hostRef = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [counts, setCounts] = useState<{ nodes: number; links: number } | null>(null);
  const pathState = useRef<{ ends: { id: string; name: string }[]; links: Set<number> }>({
    ends: [],
    links: new Set(),
  });

  // A fresh visit each time the view opens.
  useEffect(() => () => useGraphUi.getState().reset(), []);

  const data: GraphData = useMemo(
    () =>
      buildGraph(doc, {
        includeAll: ui.includeAll,
        unwired: ui.unwired,
        hiddenRels: ui.hiddenRels,
        hiddenTypes: ui.hiddenTypes,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      doc.items,
      doc.groups,
      doc.connections,
      ui.includeAll,
      ui.unwired,
      ui.hiddenRels,
      ui.hiddenTypes,
    ],
  );
  // The scene is rebuilt only when its shape changes, not on every edit.
  const signature = useMemo(
    () =>
      `${data.nodes.map((n) => `${n.id}:${n.type}:${n.comp}`).join(',')}|${data.links
        .map((l) => `${l.source}>${l.target}:${l.rel}:${l.label ? 1 : 0}`)
        .join(',')}`,
    [data],
  );
  const plainLinks = useMemo<GLink[]>(() => data.links.map((l) => ({ ...l })), [data]);
  const types = useMemo(() => {
    const seen = new Set<string>();
    for (const it of Object.values(doc.items)) seen.add(it.type);
    if (Object.keys(doc.groups).length) seen.add('group');
    return [...seen].sort();
  }, [doc.items, doc.groups]);

  // What the engine reads on every restyle.
  const state = useRef<EngineState>({ selected: null, lit: null, pathLinks: new Set() });
  const lit = useMemo<ReadonlySet<string> | null>(() => {
    if (ui.query.trim()) {
      return new Set(data.nodes.filter((n) => matchesQuery(n, ui.query)).map((n) => n.id));
    }
    if (ui.selected) {
      const set = neighboursOf(data.links, ui.selected);
      set.add(ui.selected);
      return set;
    }
    return null;
  }, [ui.query, ui.selected, data]);
  useEffect(() => {
    state.current = { ...state.current, selected: ui.selected, lit };
    engine.current?.restyle();
  }, [lit, ui.selected]);

  // The theme's accent, read once per theme (the legend and plain nodes use it).
  const accent = useMemo(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme],
  );
  const colorBy = ui.colorBy;
  const colorOf = (node: GNode): string => {
    if (colorBy === 'type') return TYPE_COLORS[node.type] ?? accent;
    if (node.comp >= 0) return CLUSTER_COLORS[node.comp % CLUSTER_COLORS.length]!;
    return TYPE_COLORS[node.type] ?? accent;
  };

  /** Fly to the item on the canvas. */
  const openOnCanvas = (id: string) => {
    const session = useSessionStore.getState();
    const liveDoc = useDocumentStore.getState().doc;
    const ids = liveDoc.groups[id] ? groupMembers(liveDoc, id) : [id];
    const first = ids[0] && liveDoc.items[ids[0]];
    if (!first) return;
    session.setView('canvas');
    session.setSelection(ids);
    revealItemPage(first.id);
    fitViewportTo(rotatedRectAABB(first), getCanvasContainer());
  };

  const pickPathEnd = (node: { id: string; name: string }) => {
    const path = pathState.current;
    const next = [...path.ends, { id: node.id, name: node.name }].slice(-2);
    if (next.length === 2 && next[0]!.id === next[1]!.id) next.pop();
    path.ends = next;
    const store = useGraphUi.getState();
    if (next.length === 1) {
      path.links = new Set();
      store.setPath({ kind: 'picking', fromName: next[0]!.name });
    } else if (next.length === 2) {
      const found = shortestPath(plainLinks, next[0]!.id, next[1]!.id);
      path.links = found?.linkKeys ?? new Set();
      store.setPath(
        found
          ? { kind: 'done', fromName: next[0]!.name, toName: next[1]!.name, hops: found.hops }
          : { kind: 'none', fromName: next[0]!.name, toName: next[1]!.name },
      );
      (window as { __graphStats?: { path?: unknown } }).__graphStats!.path = found
        ? { found: true, hops: found.hops }
        : { found: false };
    }
    state.current = { ...state.current, pathLinks: path.links };
    engine.current?.restyle();
  };
  const clearPath = () => {
    pathState.current = { ends: [], links: new Set() };
    useGraphUi.getState().setPath(null);
    state.current = { ...state.current, pathLinks: new Set() };
    engine.current?.restyle();
  };

  // Build (and rebuild) the scene.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    setCounts({ nodes: data.nodes.length, links: data.links.length });
    (window as { __graphStats?: unknown }).__graphStats = {
      nodes: data.nodes.length,
      links: data.links.length,
      clusters: data.clusters,
    };
    pathState.current = { ends: [], links: new Set() };
    state.current = { ...state.current, pathLinks: new Set() };
    useGraphUi.getState().setPath(null);
    // e2e hook: path picking without WebGL hit-testing (ready before the
    // renderer is, so a test can call it as soon as the counts are).
    (window as { __graphPath?: (a: string, b: string) => void }).__graphPath = (a, b) => {
      const nameOf = (id: string) => data.nodes.find((n) => n.id === id)?.name ?? id;
      pathState.current = { ends: [], links: new Set() };
      pickPathEnd({ id: a, name: nameOf(a) });
      pickPathEnd({ id: b, name: nameOf(b) });
    };
    if (data.nodes.length === 0) return;
    const styles = getComputedStyle(document.documentElement);
    const look = {
      nodes: ui.nodes,
      labels: ui.labels,
      nodeScale: ui.nodeScale,
      colorOf,
      borderOf: (n: GNode) => {
        const item = useDocumentStore.getState().doc.items[n.id];
        return (
          (item && statusMeta(item.status)?.color) ??
          (n.comp >= 0 ? CLUSTER_COLORS[n.comp % CLUSTER_COLORS.length]! : null)
        );
      },
      relColor: (rel: string) => relColor(rel as never) ?? null,
      accent,
      muted: styles.getPropertyValue('--text-secondary').trim() || '#8a93a5',
      panel: styles.getPropertyValue('--panel-solid').trim() || '#ffffff',
      text: styles.getPropertyValue('--text-primary').trim() || '#222222',
    };
    void (async () => {
      const mod = ui.space === '2d' ? await import('./engine2d') : await import('./engine3d');
      if (disposed) return;
      const make = 'createEngine2d' in mod ? mod.createEngine2d : mod.createEngine3d;
      const eng = make({
        host,
        data: {
          nodes: data.nodes.map((n) => ({ ...n })),
          links: data.links.map((l) => ({ ...l })),
          clusters: data.clusters,
        },
        look,
        state: () => state.current,
        getItem: (id) => useDocumentStore.getState().doc.items[id],
        onClick: (node) => useGraphUi.getState().setSelected(node.id),
        onOpen: (node) => openOnCanvas(node.id),
        onShiftClick: (node) => {
          if (!useGraphUi.getState().unwired) pickPathEnd(node);
        },
        onBackgroundClick: () => useGraphUi.getState().setSelected(null),
      });
      engine.current = eng;
      (window as { __graphRestyle?: () => void }).__graphRestyle = () => eng.restyle();
    })();
    return () => {
      disposed = true;
      engine.current?.destroy();
      engine.current = null;
      // A renderer leaves its canvas behind; the next one starts clean.
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, ui.space, ui.nodes, ui.labels, ui.nodeScale, ui.colorBy, theme]);

  // Escape: clear the search or the selection, else back to the canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useGraphUi.getState();
      e.stopPropagation();
      if (s.query) s.setQuery('');
      else if (s.selected) s.setSelected(null);
      else useSessionStore.getState().setView('canvas');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const back = () => useSessionStore.getState().setView('canvas');
  const snapshot = async () => {
    const blob = await engine.current?.snapshot();
    if (!blob) {
      showNotice('Nothing to picture yet', { kind: 'warn' });
      return;
    }
    const file = new File([blob], 'Graph view.png', { type: 'image/png' });
    await importMediaFiles([file], clientToCanvas(window.innerWidth / 2, window.innerHeight / 2));
    showNotice('The graph is on the board as a picture', { kind: 'info' });
  };
  const selectedNode = ui.selected ? data.nodes.find((n) => n.id === ui.selected) : undefined;
  const scaleAt = NODE_SCALES.findIndex((v) => Math.abs(v - ui.nodeScale) < 1e-6);
  const showSide = ui.side;

  return (
    <div className="gallery-screen graph-screen" data-testid="graph-view">
      <header className="gallery-header view-bar graph-bar">
        <div className="gallery-header-left">
          <ViewBarButton
            label="Back to canvas"
            icon={<BoardsIcon size={16} />}
            testId="graph-back"
            onClick={back}
          />
          <ViewBarButton
            label={showSide ? 'Hide the panel' : 'Show the panel'}
            icon={<PanelLeftIcon size={16} />}
            active={showSide}
            testId="graph-toggle-side"
            onClick={() => ui.setPref('side', !showSide)}
          />
          <h1>Graph View</h1>
          {counts !== null && counts.nodes > 0 && (
            <span className="view-bar-count" data-testid="graph-counts">
              {counts.nodes} item{counts.nodes === 1 ? '' : 's'} · {counts.links} connection
              {counts.links === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="gallery-actions">
          <ViewBarButton
            label="Fit the graph"
            icon={<FitIcon size={16} />}
            testId="graph-fit"
            disabled={!counts?.nodes}
            onClick={() => engine.current?.fit()}
          />
          <ViewBarButton
            label="Save as a picture on the board"
            icon={<CameraIcon size={16} />}
            testId="graph-snapshot"
            disabled={!counts?.nodes}
            onClick={() => void snapshot()}
          />
          <PopOutViewButton testId="graph-popout" />
          <ThemeToggle className="view-icon-btn" testId="graph-theme-toggle" />
        </div>
      </header>
      <div className={`graph-body${phone ? ' graph-phone' : ''}`}>
        {showSide && (
          <aside className="graph-side" data-testid="graph-side">
            <div className="graph-search">
              <SearchIcon size={14} />
              <input
                className="input"
                type="search"
                value={ui.query}
                placeholder="Find a node"
                aria-label="Find a node"
                data-testid="graph-search"
                onChange={(e) => ui.setQuery(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key !== 'Enter') return;
                  const first = data.nodes.find((n) => matchesQuery(n, ui.query));
                  if (first) {
                    ui.setSelected(first.id);
                    engine.current?.focus(first.id);
                  }
                }}
              />
            </div>
            <div className="graph-side-scroll">
              {selectedNode && (
                <NodePanel
                  node={selectedNode}
                  links={plainLinks}
                  nodes={data.nodes}
                  onPick={(id) => {
                    ui.setSelected(id);
                    engine.current?.focus(id);
                  }}
                  onOpen={() => openOnCanvas(selectedNode.id)}
                  onPath={() => {
                    pathState.current = { ends: [], links: new Set() };
                    pickPathEnd(selectedNode);
                  }}
                  onClose={() => ui.setSelected(null)}
                />
              )}
              <section className="lsp-section graph-section">
                <h3 className="graph-section-title">Display</h3>
                <div className="lsp-field">
                  <span className="lsp-field-label">Nodes</span>
                  <div className="seg seg-fill" role="radiogroup" aria-label="Nodes">
                    {(['previews', 'dots'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={ui.nodes === v}
                        className={ui.nodes === v ? 'active' : ''}
                        data-testid={`graph-nodes-${v}`}
                        onClick={() => ui.setPref('nodes', v)}
                      >
                        {v === 'previews' ? 'Previews' : 'Dots'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="lsp-field">
                  <span className="lsp-field-label">Space</span>
                  <div className="seg seg-fill" role="radiogroup" aria-label="Space">
                    {(['2d', '3d'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={ui.space === v}
                        className={ui.space === v ? 'active' : ''}
                        data-testid={`graph-space-${v}`}
                        onClick={() => ui.setPref('space', v)}
                      >
                        {v.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="lsp-field">
                  <span className="lsp-field-label">Labels</span>
                  <div className="seg seg-fill" role="radiogroup" aria-label="Labels">
                    {(
                      [
                        ['auto', 'As you zoom'],
                        ['always', 'Always'],
                        ['off', 'Off'],
                      ] as [GraphLabels, string][]
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={ui.labels === v}
                        className={ui.labels === v ? 'active' : ''}
                        data-testid={`graph-labels-${v}`}
                        title={ui.space === '3d' ? 'In 3D, names show on hover' : undefined}
                        onClick={() => ui.setPref('labels', v)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="lsp-field">
                  <span className="lsp-field-label">Size</span>
                  <div className="graph-size" role="group" aria-label="Node size">
                    <button
                      type="button"
                      className="view-icon-btn small"
                      aria-label="Smaller nodes"
                      title="Smaller nodes"
                      disabled={scaleAt <= 0}
                      data-testid="graph-size-smaller"
                      onClick={() => ui.setPref('nodeScale', NODE_SCALES[scaleAt - 1]!)}
                    >
                      <MinusIcon size={13} />
                    </button>
                    <span className="graph-size-value">{Math.round(ui.nodeScale * 100)}%</span>
                    <button
                      type="button"
                      className="view-icon-btn small"
                      aria-label="Larger nodes"
                      title="Larger nodes"
                      disabled={scaleAt >= NODE_SCALES.length - 1}
                      data-testid="graph-size-larger"
                      onClick={() => ui.setPref('nodeScale', NODE_SCALES[scaleAt + 1]!)}
                    >
                      <PlusIcon size={13} />
                    </button>
                  </div>
                </div>
              </section>
              <section className="lsp-section graph-section">
                <h3 className="graph-section-title">Filters</h3>
                <div className="lsp-field">
                  <span className="lsp-field-label">Connections</span>
                  <div className="graph-rels" data-testid="graph-rels">
                    {CONNECTION_RELS.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`graph-rel${ui.hiddenRels.has(r.id) ? ' off' : ''}`}
                        aria-pressed={!ui.hiddenRels.has(r.id)}
                        data-testid={`graph-rel-${r.id}`}
                        title={`${ui.hiddenRels.has(r.id) ? 'Show' : 'Hide'} ${r.name} connections`}
                        onClick={() => ui.toggleRel(r.id)}
                      >
                        <span
                          className="conn-rel-dot"
                          style={{ background: r.color ?? 'var(--text-secondary)' }}
                        />
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="graph-check">
                  <input
                    type="checkbox"
                    checked={ui.includeAll}
                    data-testid="graph-include-all"
                    onChange={(e) => ui.setIncludeAll(e.target.checked)}
                  />
                  <span>Include unconnected items</span>
                </label>
                <label
                  className="graph-check"
                  title="Only items that point at an outside source but have no connections yet"
                >
                  <input
                    type="checkbox"
                    checked={ui.unwired}
                    data-testid="graph-unwired"
                    onChange={(e) => ui.setUnwired(e.target.checked)}
                  />
                  <span>Unwired sources only</span>
                </label>
                {types.length > 1 && (
                  <div className="lsp-field">
                    <span className="lsp-field-label">Kinds</span>
                    <div className="graph-types">
                      {types.map((t) => (
                        <label key={t} className="graph-check">
                          <input
                            type="checkbox"
                            checked={!ui.hiddenTypes.has(t)}
                            data-testid={`graph-type-${t}`}
                            onChange={() => ui.toggleType(t)}
                          />
                          <span>{typeLabel(t)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </section>
              <section className="lsp-section graph-section">
                <h3 className="graph-section-title">Color</h3>
                <div className="seg seg-fill" role="radiogroup" aria-label="Color by">
                  {(
                    [
                      ['cluster', 'By cluster'],
                      ['type', 'By kind'],
                    ] as [GraphColorBy, string][]
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={ui.colorBy === v}
                      className={ui.colorBy === v ? 'active' : ''}
                      data-testid={`graph-color-${v}`}
                      onClick={() => ui.setPref('colorBy', v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <ul className="graph-legend" data-testid="graph-legend">
                  {ui.colorBy === 'cluster'
                    ? Array.from(
                        { length: Math.min(data.clusters, CLUSTER_COLORS.length) },
                        (_, i) => (
                          <li key={i}>
                            <i style={{ background: CLUSTER_COLORS[i] }} />
                            Cluster {i + 1}
                            <span>{data.nodes.filter((n) => n.comp === i).length}</span>
                          </li>
                        ),
                      )
                    : types
                        .filter((t) => data.nodes.some((n) => n.type === t))
                        .map((t) => (
                          <li key={t}>
                            <i style={{ background: TYPE_COLORS[t] ?? accent }} />
                            {typeLabel(t)}
                            <span>{data.nodes.filter((n) => n.type === t).length}</span>
                          </li>
                        ))}
                  {ui.colorBy === 'cluster' && data.clusters > CLUSTER_COLORS.length && (
                    <li className="graph-legend-more">
                      and {data.clusters - CLUSTER_COLORS.length} more, the colors repeating
                    </li>
                  )}
                </ul>
              </section>
              <section className="lsp-section graph-section">
                <h3 className="graph-section-title">Layout</h3>
                <p className="graph-hint">
                  Drag a node to pin it where you put it. The layout settles on its own and stays
                  still until something changes.
                </p>
                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="graph-unpin"
                  onClick={() => engine.current?.unpinAll()}
                >
                  Unpin every node
                </button>
              </section>
            </div>
          </aside>
        )}
        <div className={`graph-stage space-${ui.space}`}>
          <div className="graph-host" ref={hostRef} />
          {counts !== null && counts.nodes === 0 && !ui.unwired && (
            <div className="graph-empty" data-testid="graph-empty">
              <p>No connected items yet.</p>
              <p className="graph-empty-hint">
                Draw connections between items on the canvas (drag from an item’s link handle) and
                they’ll appear here as a graph.
              </p>
            </div>
          )}
          {counts !== null && counts.nodes === 0 && ui.unwired && (
            <div className="graph-empty" data-testid="graph-unwired-empty">
              <p>Every source is wired in.</p>
              <p className="graph-empty-hint">
                No source-bearing items are left unconnected — nice detective work.
              </p>
            </div>
          )}
          {ui.path && (
            <div className="graph-path-chip" data-testid="graph-path-chip">
              {ui.path.kind === 'picking'
                ? `Path from “${ui.path.fromName}” — shift-click another node`
                : ui.path.kind === 'done'
                  ? `Path: ${ui.path.fromName} ⇄ ${ui.path.toName} · ${ui.path.hops} hop${ui.path.hops === 1 ? '' : 's'}`
                  : `No path between ${ui.path.fromName} and ${ui.path.toName}`}
              <button
                type="button"
                className="graph-path-clear"
                aria-label="Clear path"
                data-testid="graph-path-clear"
                onClick={clearPath}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The picked node: its preview, what it is, and its connections. */
function NodePanel({
  node,
  links,
  nodes,
  onPick,
  onOpen,
  onPath,
  onClose,
}: {
  node: GNode;
  links: GLink[];
  nodes: GNode[];
  onPick: (id: string) => void;
  onOpen: () => void;
  onPath: () => void;
  onClose: () => void;
}) {
  const item = useDocumentStore((s) => s.doc.items[node.id]);
  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.name ?? 'Elsewhere';
  const rows = links
    .filter((l) => l.source === node.id || l.target === node.id)
    .map((l) => {
      const out = l.source === node.id;
      return { pk: l.pk, other: out ? l.target : l.source, rel: l.rel, out, label: l.label };
    });
  return (
    <section className="lsp-section graph-section graph-selected" data-testid="graph-selected">
      <div className="graph-selected-head">
        {item ? <NodePreview item={item} /> : <span className="graph-sel-chip">Group</span>}
        <div className="graph-selected-text">
          <strong data-testid="graph-selected-name">{node.name}</strong>
          <span>{item ? mediaMeta(item).typeLabel : 'Group'}</span>
        </div>
        <button
          type="button"
          className="view-icon-btn small"
          aria-label="Close"
          title="Close"
          data-testid="graph-selected-close"
          onClick={onClose}
        >
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="btns">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          data-testid="graph-selected-open"
          onClick={onOpen}
        >
          Open on canvas
        </button>
        <button
          type="button"
          className="btn btn-sm"
          data-testid="graph-selected-path"
          onClick={onPath}
        >
          Path from here
        </button>
      </div>
      <div className="lsp-field">
        <span className="lsp-field-label">
          {rows.length === 1 ? '1 connection' : `${rows.length} connections`}
        </span>
        <ul className="graph-sel-links">
          {rows.map((r) => (
            <li key={r.pk}>
              <button
                type="button"
                className="graph-sel-link"
                data-testid="graph-selected-link"
                onClick={() => onPick(r.other)}
              >
                <span
                  className="conn-rel-dot"
                  style={{ background: relColor(r.rel as never) ?? 'var(--text-secondary)' }}
                />
                <span className="graph-sel-rel">
                  {r.rel !== 'relates' ? relName(r.rel as never) : r.out ? 'to' : 'from'}
                </span>
                <span className="graph-sel-other">{nameOf(r.other)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function NodePreview({ item }: { item: Item }) {
  const def = itemType(item);
  const assetId =
    item.type === 'image' ? (item.previewAssetId ?? item.assetId) : (def.cardAsset?.(item) ?? null);
  const url = useAssetUrl(assetId);
  const color = def.cardColor?.(item);
  if (url) return <img className="graph-sel-thumb" src={url} alt="" draggable={false} />;
  if (color) return <i className="graph-sel-thumb" style={{ background: color }} />;
  return <span className="graph-sel-chip">{mediaMeta(item).typeLabel}</span>;
}
