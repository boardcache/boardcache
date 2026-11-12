import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { relDirectional } from '../../lib/canvas/connectionTypes';
import { renderNodeCard } from './cards';
import { alphaFor, clickRouter, type Engine, type EngineOptions } from './engine';
import type { GLink, GNode } from './model';

/**
 * The 3D renderer: a WebGL force graph (3d-force-graph on three). Preview
 * nodes are billboard sprites textured with the item's card at up to 1024
 * pixels, mipmapped and anisotropic so they stay sharp up close; dot nodes
 * are spheres sized by their connections. Lazy: `import()` only.
 */

const SPRITE_BASE = 18;

export function createEngine3d(opts: EngineOptions): Engine {
  const { host, data, look } = opts;
  const route = clickRouter(opts);
  let disposed = false;
  const materials = new Map<string, THREE.Material & { opacity: number }>();

  const g = new ForceGraph3D(host, {
    rendererConfig: { preserveDrawingBuffer: true, alpha: true, antialias: true },
  })
    .backgroundColor('rgba(0,0,0,0)')
    .graphData(data)
    .nodeLabel((n) => (n as GNode).name)
    .nodeColor((n) => look.colorOf(n as GNode))
    .linkLabel((l) => {
      const link = l as GLink;
      return link.label || '';
    })
    .linkColor((l) => {
      const link = l as GLink;
      const state = opts.state();
      if (state.pathLinks.size > 0) {
        return state.pathLinks.has(link.pk) ? look.accent : 'rgba(127, 127, 127, 0.18)';
      }
      const rel = look.relColor(link.rel);
      if (state.lit) {
        const s = typeof link.source === 'string' ? link.source : (link.source as GNode).id;
        const t = typeof link.target === 'string' ? link.target : (link.target as GNode).id;
        if (!state.lit.has(s) || !state.lit.has(t)) return 'rgba(127, 127, 127, 0.12)';
      }
      return rel ?? look.muted;
    })
    .linkDirectionalArrowLength((l) => (relDirectional((l as GLink).rel as never) ? 3.4 : 0))
    .linkDirectionalArrowRelPos(0.55)
    .linkOpacity(0.5)
    .linkWidth((l) => {
      const link = l as GLink;
      const state = opts.state();
      if (state.pathLinks.size > 0 && state.pathLinks.has(link.pk)) return 3.2;
      return link.label ? 1.4 : 0.7;
    })
    .onNodeClick((n, event) => route(n as GNode, !!(event as MouseEvent | undefined)?.shiftKey))
    .onBackgroundClick(() => opts.onBackgroundClick())
    .onNodeDragEnd((n) => {
      // A dragged node stays where it was put.
      const node = n as GNode;
      node.fx = node.x ?? 0;
      node.fy = node.y ?? 0;
      node.fz = node.z ?? 0;
    });

  const anisotropy = g.renderer().capabilities.getMaxAnisotropy();

  g.nodeThreeObject((n) => {
    const node = n as GNode;
    const color = look.colorOf(node);
    if (look.nodes === 'dots' || node.kind !== 'item') {
      const r = (2.2 + Math.sqrt(node.degree) * 1.3) * look.nodeScale;
      const material = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 });
      materials.set(node.id, material);
      return new THREE.Mesh(new THREE.SphereGeometry(r, 20, 20), material) as unknown as never;
    }
    const item = opts.getItem(node.id);
    if (!item) return false as unknown as never;
    const material = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true });
    materials.set(node.id, material);
    const sprite = new THREE.Sprite(material);
    const base = SPRITE_BASE * look.nodeScale;
    sprite.scale.set(base, base, 1);
    void (async () => {
      try {
        const card = await renderNodeCard(item, {
          panel: look.panel,
          border: look.borderOf(node),
        });
        if (disposed) return;
        const tex = new THREE.CanvasTexture(card);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = anisotropy;
        const ar = card.width / card.height;
        sprite.scale.set(base * Math.sqrt(ar), base / Math.sqrt(ar), 1);
        material.map = tex;
        material.needsUpdate = true;
      } catch {
        material.color.set(color);
      }
    })();
    return sprite as unknown as never;
  });

  const size = () => g.width(host.clientWidth).height(host.clientHeight);
  size();
  const ro = new ResizeObserver(size);
  ro.observe(host);

  const restyle = () => {
    const state = opts.state();
    for (const [id, m] of materials) m.opacity = alphaFor(id, state);
    g.linkColor(g.linkColor());
    g.linkWidth(g.linkWidth());
  };

  return {
    destroy: () => {
      disposed = true;
      ro.disconnect();
      (g as unknown as { _destructor?: () => void })._destructor?.();
    },
    restyle,
    fit: () => g.zoomToFit(600, 40),
    focus: (id) => {
      const node = (g.graphData().nodes as GNode[]).find((n) => n.id === id);
      if (!node || node.x === undefined) return;
      const dist = 90;
      const len = Math.hypot(node.x, node.y ?? 0, node.z ?? 0) || 1;
      const k = 1 + dist / len;
      g.cameraPosition(
        { x: node.x * k, y: (node.y ?? 0) * k, z: (node.z ?? 0) * k },
        { x: node.x, y: node.y ?? 0, z: node.z ?? 0 },
        800,
      );
    },
    unpinAll: () => {
      for (const n of g.graphData().nodes as GNode[]) {
        delete n.fx;
        delete n.fy;
        delete n.fz;
      }
      g.d3ReheatSimulation();
    },
    snapshot: () =>
      new Promise((resolve) => {
        const src = g.renderer().domElement;
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
