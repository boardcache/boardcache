import ForceGraph from 'force-graph';
import { relDirectional } from '../../lib/canvas/connectionTypes';
import { renderNodeCard } from './cards';
import { alphaFor, clickRouter, dotSize, type Engine, type EngineOptions } from './engine';
import type { GLink, GNode } from './model';

/**
 * The 2D renderer: a canvas force graph (force-graph), the Obsidian look.
 * Dots are circles sized by their connections with labels that come in as
 * you zoom; previews draw the item's card. Lazy: `import()` only.
 */

const CARD_BASE = 26;

export function createEngine2d(opts: EngineOptions): Engine {
  const { host, data, look } = opts;
  const route = clickRouter(opts);
  let disposed = false;
  const cards = new Map<string, HTMLCanvasElement>();
  const pending = new Set<string>();

  const g = new ForceGraph(host)
    .backgroundColor('rgba(0,0,0,0)')
    .graphData(data)
    .nodeLabel((n) => (n as GNode).name)
    .linkColor((l) => {
      const link = l as GLink;
      const state = opts.state();
      if (state.pathLinks.size > 0) {
        return state.pathLinks.has(link.pk) ? look.accent : 'rgba(127, 127, 127, 0.18)';
      }
      if (state.lit) {
        const s = typeof link.source === 'string' ? link.source : (link.source as GNode).id;
        const t = typeof link.target === 'string' ? link.target : (link.target as GNode).id;
        if (!state.lit.has(s) || !state.lit.has(t)) return 'rgba(127, 127, 127, 0.12)';
      }
      return look.relColor(link.rel) ?? look.muted;
    })
    .linkWidth((l) => {
      const link = l as GLink;
      const state = opts.state();
      if (state.pathLinks.size > 0 && state.pathLinks.has(link.pk)) return 3;
      return link.label ? 1.4 : 0.8;
    })
    .linkDirectionalArrowLength((l) => (relDirectional((l as GLink).rel as never) ? 5 : 0))
    .linkDirectionalArrowRelPos(0.55)
    .onNodeClick((n, event) => route(n as GNode, !!(event as MouseEvent | undefined)?.shiftKey))
    .onBackgroundClick(() => opts.onBackgroundClick())
    .onNodeDragEnd((n) => {
      const node = n as GNode;
      node.fx = node.x ?? 0;
      node.fy = node.y ?? 0;
    });

  const cardFor = (node: GNode): HTMLCanvasElement | null => {
    const have = cards.get(node.id);
    if (have) return have;
    if (pending.has(node.id)) return null;
    const item = opts.getItem(node.id);
    if (!item) return null;
    pending.add(node.id);
    void renderNodeCard(item, { panel: look.panel, border: look.borderOf(node) })
      .then((c) => {
        if (disposed) return;
        cards.set(node.id, c);
      })
      .catch(() => {
        /* the dot stays */
      });
    return null;
  };

  const showLabel = (globalScale: number): boolean =>
    look.labels === 'always' || (look.labels === 'auto' && globalScale > 1.6);

  g.nodeCanvasObject((n, ctx, globalScale) => {
    const node = n as GNode;
    const state = opts.state();
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const alpha = alphaFor(node.id, state);
    ctx.globalAlpha = alpha;
    let labelY: number;
    const card = look.nodes === 'previews' && node.kind === 'item' ? cardFor(node) : null;
    if (card) {
      const ar = card.width / card.height;
      const w = CARD_BASE * look.nodeScale * Math.sqrt(ar);
      const h = (CARD_BASE * look.nodeScale) / Math.sqrt(ar);
      ctx.drawImage(card, x - w / 2, y - h / 2, w, h);
      if (state.selected === node.id) {
        ctx.strokeStyle = look.accent;
        ctx.lineWidth = 2 / globalScale;
        ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      }
      labelY = y + h / 2;
    } else {
      const r = dotSize(node, look.nodeScale);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = look.colorOf(node);
      ctx.fill();
      if (state.selected === node.id) {
        ctx.strokeStyle = look.accent;
        ctx.lineWidth = 2.5 / globalScale;
        ctx.stroke();
      }
      labelY = y + r;
    }
    if (showLabel(globalScale) || state.selected === node.id) {
      const size = Math.max(10 / globalScale, 2.2);
      ctx.font = `${size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = look.text;
      ctx.fillText(node.name, x, labelY + 2 / globalScale);
    }
    ctx.globalAlpha = 1;
  });
  g.nodePointerAreaPaint((n, color, ctx) => {
    const node = n as GNode;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const card = look.nodes === 'previews' && node.kind === 'item' ? cards.get(node.id) : null;
    ctx.fillStyle = color;
    if (card) {
      const ar = card.width / card.height;
      const w = CARD_BASE * look.nodeScale * Math.sqrt(ar);
      const h = (CARD_BASE * look.nodeScale) / Math.sqrt(ar);
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, dotSize(node, look.nodeScale) + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const size = () => g.width(host.clientWidth).height(host.clientHeight);
  size();
  const ro = new ResizeObserver(size);
  ro.observe(host);

  return {
    destroy: () => {
      disposed = true;
      ro.disconnect();
      (g as unknown as { _destructor?: () => void })._destructor?.();
    },
    // The canvas redraws every frame from the state it reads, so a restyle
    // only has to refresh the link accessors.
    restyle: () => {
      g.linkColor(g.linkColor());
      g.linkWidth(g.linkWidth());
    },
    fit: () => g.zoomToFit(600, 40),
    focus: (id) => {
      const node = (g.graphData().nodes as GNode[]).find((n) => n.id === id);
      if (!node || node.x === undefined) return;
      g.centerAt(node.x, node.y ?? 0, 600);
      g.zoom(Math.max(g.zoom(), 3), 600);
    },
    unpinAll: () => {
      for (const n of g.graphData().nodes as GNode[]) {
        delete n.fx;
        delete n.fy;
      }
      g.d3ReheatSimulation();
    },
    snapshot: () =>
      new Promise((resolve) => {
        const src = host.querySelector('canvas');
        if (!src) return resolve(null);
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const x = c.getContext('2d')!;
        x.fillStyle = look.panel;
        x.fillRect(0, 0, c.width, c.height);
        x.drawImage(src, 0, 0);
        c.toBlob((b) => resolve(b), 'image/png');
      }),
  };
}
