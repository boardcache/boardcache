/**
 * Diagrams as text, for add_diagram: a Mermaid flowchart, a Graphviz DOT
 * graph or plain "A -> B: label" lines become nodes, edges and groups
 * (subgraphs / clusters), then a layered layout places them. Pure: no DOM,
 * no board. The subsets are the ones people actually write: node shapes,
 * edge labels and styles, chains, fan-in with `&`, subgraphs, clusters,
 * rankdir. Anything else on a line is ignored rather than refused.
 */

type NodeShape =
  | 'box'
  | 'round'
  | 'stadium'
  | 'diamond'
  | 'circle'
  | 'hexagon'
  | 'cylinder'
  | 'parallelogram';

export interface DiagramNode {
  id: string;
  label: string;
  shape: NodeShape;
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  directed: boolean;
}

interface DiagramGroup {
  id: string;
  title: string;
  nodeIds: string[];
}

export interface Diagram {
  format: 'mermaid' | 'dot' | 'plain';
  direction: 'TB' | 'LR';
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: DiagramGroup[];
}

export type DiagramFormat = Diagram['format'];

class Builder {
  nodes = new Map<string, DiagramNode>();
  edges: DiagramEdge[] = [];
  groups: DiagramGroup[] = [];
  direction: 'TB' | 'LR' = 'TB';
  /** The subgraph stack: a node first seen inside one belongs to it. */
  private stack: DiagramGroup[] = [];

  node(id: string, label?: string, shape?: NodeShape, defaultShape?: NodeShape): DiagramNode {
    let n = this.nodes.get(id);
    if (!n) {
      n = { id, label: label ?? id, shape: shape ?? defaultShape ?? 'box' };
      this.nodes.set(id, n);
      const g = this.stack[this.stack.length - 1];
      if (g && !g.nodeIds.includes(id)) g.nodeIds.push(id);
    } else {
      if (label !== undefined) n.label = label;
      if (shape !== undefined) n.shape = shape;
    }
    return n;
  }
  edge(e: DiagramEdge) {
    this.node(e.from);
    this.node(e.to);
    if (!this.edges.some((x) => x.from === e.from && x.to === e.to)) this.edges.push(e);
  }
  openGroup(id: string, title: string) {
    const g: DiagramGroup = { id, title, nodeIds: [] };
    this.groups.push(g);
    this.stack.push(g);
  }
  closeGroup() {
    this.stack.pop();
  }
  /** A node mentioned inside a subgraph after it was defined outside joins it. */
  claim(id: string) {
    const g = this.stack[this.stack.length - 1];
    if (g && !g.nodeIds.includes(id) && !this.groups.some((x) => x.nodeIds.includes(id)))
      g.nodeIds.push(id);
  }
  build(format: Diagram['format']): Diagram {
    return {
      format,
      direction: this.direction,
      nodes: [...this.nodes.values()],
      edges: this.edges,
      groups: this.groups.filter((g) => g.nodeIds.length > 0),
    };
  }
}

const unquote = (s: string): string => {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
    ? t.slice(1, -1)
    : t;
};
const breaks = (s: string): string =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .trim();

/** Which language a text is written in. */
export function detectFormat(text: string): DiagramFormat {
  const first =
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('%%') && !l.startsWith('//') && !l.startsWith('#')) ?? '';
  if (/^(graph|flowchart)\s+(TB|TD|BT|LR|RL)\b/i.test(first)) return 'mermaid';
  if (/^(strict\s+)?(di)?graph\b/i.test(first) || first.startsWith('{')) return 'dot';
  if (/^(graph|flowchart)\b/i.test(first)) return 'mermaid';
  return 'plain';
}

// --- mermaid ---------------------------------------------------------------

const MERMAID_SHAPES: [RegExp, NodeShape][] = [
  [/^\(\[(.*?)\]\)/, 'stadium'],
  [/^\[\[(.*?)\]\]/, 'box'],
  [/^\[\((.*?)\)\]/, 'cylinder'],
  [/^\(\((.*?)\)\)/, 'circle'],
  [/^\{\{(.*?)\}\}/, 'hexagon'],
  [/^\[\/(.*?)\/\]/, 'parallelogram'],
  [/^\[\\(.*?)\\\]/, 'parallelogram'],
  [/^>(.*?)\]/, 'box'],
  [/^\[(.*?)\]/, 'box'],
  [/^\((.*?)\)/, 'round'],
  [/^\{(.*?)\}/, 'diamond'],
];
const MERMAID_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]*/;
// An arrow with its label in the middle (`-- yes -->`, `-. no .->`, `== x ==>`).
const MID_LABEL = /^(--|-\.|==)\s+(.+?)\s+(-->|---|\.->|\.-|==>|===)/;
const ARROW = /^(-\.+->|-\.+-|-->|---|==>|===|--o|--x)/;

function parseMermaid(text: string, b: Builder): Diagram {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/%%.*$/, '').trim())
    .filter(Boolean);
  const header = lines.shift() ?? '';
  const dir = /^(?:graph|flowchart)\s+(TB|TD|BT|LR|RL)/i.exec(header)?.[1]?.toUpperCase();
  b.direction = dir === 'LR' || dir === 'RL' ? 'LR' : 'TB';
  const statements = lines.flatMap((l) => l.split(';').map((s) => s.trim())).filter(Boolean);
  for (const st of statements) {
    if (/^end$/i.test(st)) {
      b.closeGroup();
      continue;
    }
    const sub = /^subgraph\s+(.+)$/i.exec(st);
    if (sub) {
      const body = sub[1]!.trim();
      const titled = /^([A-Za-z0-9_.-]+)\s*\[(.*)\]$/.exec(body);
      if (titled) b.openGroup(titled[1]!, unquote(titled[2]!));
      else b.openGroup(body.replace(/\s+/g, '_'), unquote(body));
      continue;
    }
    if (/^(style|classDef|class|click|linkStyle|direction)\b/i.test(st)) continue;
    parseMermaidChain(st, b);
  }
  return b.build('mermaid');
}

function parseMermaidChain(st: string, b: Builder): void {
  let rest = st;
  let prev: string[] | null = null;
  let pending: { label?: string; dashed?: boolean; directed: boolean } | null = null;
  const takeNodes = (): string[] | null => {
    const ids: string[] = [];
    for (;;) {
      const m = MERMAID_ID.exec(rest);
      if (!m) break;
      const id = m[0];
      rest = rest.slice(id.length);
      let label: string | undefined;
      let shape: NodeShape | undefined;
      for (const [re, sh] of MERMAID_SHAPES) {
        const s = re.exec(rest);
        if (s) {
          label = breaks(unquote(s[1]!));
          shape = sh;
          rest = rest.slice(s[0].length);
          break;
        }
      }
      b.node(id, label, shape);
      b.claim(id);
      ids.push(id);
      const amp = /^\s*&\s*/.exec(rest);
      if (!amp) break;
      rest = rest.slice(amp[0].length);
    }
    return ids.length ? ids : null;
  };
  for (let guard = 0; guard < 200; guard++) {
    rest = rest.trim();
    if (!rest) break;
    const ids = takeNodes();
    if (!ids) break;
    if (prev && pending) {
      for (const f of prev) for (const t of ids) b.edge({ from: f, to: t, ...pending });
    }
    prev = ids;
    rest = rest.trim();
    const mid = MID_LABEL.exec(rest);
    if (mid) {
      pending = {
        label: unquote(mid[2]!),
        dashed: mid[1] === '-.',
        directed: mid[3]!.endsWith('>'),
      };
      rest = rest.slice(mid[0].length);
    } else {
      const ar = ARROW.exec(rest);
      if (!ar) break;
      pending = { dashed: ar[1]!.includes('.'), directed: ar[1]!.endsWith('>') };
      rest = rest.slice(ar[0].length);
      const lab = /^\s*\|([^|]*)\|/.exec(rest);
      if (lab) {
        pending.label = unquote(lab[1]!);
        rest = rest.slice(lab[0].length);
      }
    }
  }
}

// --- dot -------------------------------------------------------------------

const DOT_SHAPES: Record<string, NodeShape> = {
  box: 'box',
  rect: 'box',
  rectangle: 'box',
  square: 'box',
  plaintext: 'box',
  plain: 'box',
  none: 'box',
  note: 'box',
  ellipse: 'circle',
  oval: 'circle',
  circle: 'circle',
  doublecircle: 'circle',
  point: 'circle',
  diamond: 'diamond',
  hexagon: 'hexagon',
  cylinder: 'cylinder',
  parallelogram: 'parallelogram',
};

function dotAttrs(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  const re = /([A-Za-z_]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^,;\s\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]!.toLowerCase()] = unquote(m[2]!).replace(/\\"/g, '"');
  return out;
}

const DOT_ID = /^("(?:[^"\\]|\\.)*"|[A-Za-z0-9_.\u0080-￿-]+)(?::[A-Za-z0-9_]+)?/;

function stripDotComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/^\s*#.*$/, ''))
    .join('\n');
}

/** Split a brace body into statements at `;` and newlines, keeping nested
 *  braces and quoted strings whole. */
function dotStatements(body: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quote) {
      cur += c;
      if (c === '\\' && i + 1 < body.length) cur += body[++i];
      else if (c === '"') quote = false;
      continue;
    }
    if (c === '"') {
      quote = true;
      cur += c;
    } else if (c === '{') {
      depth++;
      cur += c;
    } else if (c === '}') {
      depth--;
      cur += c;
      if (depth === 0) {
        out.push(cur.trim());
        cur = '';
      }
    } else if ((c === ';' || c === '\n') && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

function parseDotBody(
  body: string,
  b: Builder,
  directed: boolean,
  defaults: { shape?: NodeShape },
) {
  const local = { ...defaults };
  for (const st of dotStatements(body)) {
    const sub = /^subgraph\s*([^{\s]*)\s*\{([\s\S]*)\}$/.exec(st) ?? /^\{([\s\S]*)\}$/.exec(st);
    if (sub) {
      const inner = sub.length === 3 ? sub[2]! : sub[1]!;
      const name = sub.length === 3 ? unquote(sub[1]!) : '';
      const title = dotAttrs(/label\s*=\s*("(?:[^"\\]|\\.)*"|[^;\n]+)/.exec(inner)?.[0])['label'];
      const cluster = name.startsWith('cluster') || title !== undefined;
      if (cluster) b.openGroup(name || `cluster_${b.groups.length + 1}`, breaks(title ?? name));
      parseDotBody(inner, b, directed, local);
      if (cluster) b.closeGroup();
      continue;
    }
    const rank = /^rankdir\s*=\s*"?(LR|RL|TB|BT)"?/i.exec(st);
    if (rank) {
      b.direction = /^(LR|RL)$/i.test(rank[1]!) ? 'LR' : 'TB';
      continue;
    }
    const nodeDefault = /^node\s*\[([\s\S]*)\]$/.exec(st);
    if (nodeDefault) {
      const sh = DOT_SHAPES[(dotAttrs(nodeDefault[1])['shape'] ?? '').toLowerCase()];
      if (sh) local.shape = sh;
      continue;
    }
    if (/^(graph|edge)\s*\[/.test(st) || /^[A-Za-z_]+\s*=/.test(st)) continue;
    // A node, or a chain of edges, with trailing [attrs].
    const attrsAt = st.lastIndexOf('[');
    const attrs = attrsAt > 0 && st.endsWith(']') ? dotAttrs(st.slice(attrsAt + 1, -1)) : {};
    let rest = attrsAt > 0 && st.endsWith(']') ? st.slice(0, attrsAt).trim() : st;
    const ids: string[] = [];
    for (let guard = 0; guard < 200 && rest; guard++) {
      const m = DOT_ID.exec(rest);
      if (!m) break;
      ids.push(unquote(m[1]!));
      rest = rest.slice(m[0].length).trim();
      const op = /^(->|--)/.exec(rest);
      if (!op) break;
      rest = rest.slice(op[0].length).trim();
    }
    if (!ids.length) continue;
    if (ids.length === 1) {
      const sh = attrs['shape'] ? DOT_SHAPES[attrs['shape'].toLowerCase()] : undefined;
      b.node(
        ids[0]!,
        attrs['label'] !== undefined ? breaks(attrs['label']) : undefined,
        sh,
        local.shape,
      );
      b.claim(ids[0]!);
      continue;
    }
    for (const id of ids) {
      b.node(id, undefined, undefined, local.shape);
      b.claim(id);
    }
    for (let i = 0; i + 1 < ids.length; i++) {
      b.edge({
        from: ids[i]!,
        to: ids[i + 1]!,
        ...(attrs['label'] !== undefined ? { label: breaks(attrs['label']) } : {}),
        ...(attrs['style'] === 'dashed' || attrs['style'] === 'dotted' ? { dashed: true } : {}),
        directed,
      });
    }
  }
}

function parseDot(text: string, b: Builder): Diagram {
  const clean = stripDotComments(text);
  const directed = /^\s*(strict\s+)?digraph\b/i.test(clean);
  const open = clean.indexOf('{');
  const close = clean.lastIndexOf('}');
  const body = open >= 0 && close > open ? clean.slice(open + 1, close) : clean;
  parseDotBody(body, b, directed, {});
  return b.build('dot');
}

// --- plain -----------------------------------------------------------------

function parsePlain(text: string, b: Builder): Diagram {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*[-*]\s+/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('%%')) continue;
    const m = /^(.+?)\s*(-->|->|=>|—>|--|→)\s*(.+?)(?:\s*(?::|\[)\s*(.+?)\]?)?$/.exec(line);
    if (!m) {
      b.node(line, line);
      continue;
    }
    const from = m[1]!.trim();
    const to = m[3]!.trim();
    b.node(from, from);
    b.node(to, to);
    b.edge({
      from,
      to,
      ...(m[4] ? { label: m[4].trim() } : {}),
      directed: m[2] !== '--',
    });
  }
  return b.build('plain');
}

/** Nodes, edges and groups from any of the three languages. */
export function parseDiagram(text: string, format: DiagramFormat | 'auto' = 'auto'): Diagram {
  const fmt = format === 'auto' ? detectFormat(text) : format;
  const b = new Builder();
  const d =
    fmt === 'mermaid'
      ? parseMermaid(text, b)
      : fmt === 'dot'
        ? parseDot(text, b)
        : parsePlain(text, b);
  if (!d.nodes.length) throw new Error('No nodes found in the diagram text.');
  return d;
}

// --- layout ----------------------------------------------------------------

export interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A layered drawing: sources on top (or left), every edge going down (or
 * right) as far as the graph allows, nodes in a layer ordered by where
 * their neighbours sit so the lines cross little, nodes of one group kept
 * together. Cycles are broken on the way in. Top-left positions, centred
 * on (0, 0).
 */
export function layoutDiagram(
  d: Diagram,
  size: (node: DiagramNode) => { width: number; height: number },
  gap: { x: number; y: number } = { x: 80, y: 110 },
): Map<string, Placed> {
  const ids = d.nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  // Break cycles: an edge back to a node on the DFS stack is dropped for layering.
  const state = new Map<string, 0 | 1 | 2>();
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of d.edges) if (e.from !== e.to) adj.get(e.from)!.push(e.to);
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of adj.get(u)!) {
      const s = state.get(v) ?? 0;
      if (s === 1) continue;
      out.get(u)!.push(v);
      indeg.set(v, indeg.get(v)! + 1);
      if (s === 0) visit(v);
    }
    state.set(u, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);
  // Longest path from the sources.
  const layer = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const left = new Map(indeg);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of out.get(u)!) {
      layer.set(v, Math.max(layer.get(v)!, layer.get(u)! + 1));
      left.set(v, left.get(v)! - 1);
      if (left.get(v) === 0) queue.push(v);
    }
  }
  const depth = Math.max(0, ...layer.values()) + 1;
  const layers: string[][] = Array.from({ length: depth }, () => []);
  for (const id of ids) layers[layer.get(id)!]!.push(id);
  const groupOf = new Map<string, number>();
  d.groups.forEach((g, k) => g.nodeIds.forEach((id) => groupOf.set(id, k)));
  const pos = new Map<string, number>();
  const settle = (ls: string[]) => ls.forEach((id, i) => pos.set(id, i));
  layers.forEach(settle);
  const neighbours = (id: string, up: boolean) =>
    d.edges
      .filter((e) => (up ? e.to === id : e.from === id))
      .map((e) => (up ? e.from : e.to))
      .filter((n) => layer.get(n)! === layer.get(id)! + (up ? -1 : 1));
  const bary = (id: string, up: boolean) => {
    const ns = neighbours(id, up);
    return ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const up = sweep % 2 === 0;
    const order = up ? layers.keys() : [...layers.keys()].reverse();
    for (const li of order) {
      const ls = layers[li]!;
      const key = new Map(ls.map((id) => [id, bary(id, up)]));
      ls.sort(
        (a, b) =>
          (groupOf.get(a) ?? -1) - (groupOf.get(b) ?? -1) ||
          key.get(a)! - key.get(b)! ||
          index.get(a)! - index.get(b)!,
      );
      settle(ls);
    }
  }
  // Coordinates.
  const sizes = new Map(d.nodes.map((n) => [n.id, size(n)]));
  const placed = new Map<string, Placed>();
  const lr = d.direction === 'LR';
  let along = 0; // the layer axis
  for (const ls of layers) {
    const thick = Math.max(...ls.map((id) => (lr ? sizes.get(id)!.width : sizes.get(id)!.height)));
    const span =
      ls.reduce((s, id) => s + (lr ? sizes.get(id)!.height : sizes.get(id)!.width), 0) +
      (ls.length - 1) * (lr ? gap.y : gap.x);
    let across = -span / 2;
    for (const id of ls) {
      const s = sizes.get(id)!;
      if (lr) {
        placed.set(id, { x: along, y: across, width: s.width, height: s.height });
        across += s.height + gap.y;
      } else {
        placed.set(id, { x: across, y: along, width: s.width, height: s.height });
        across += s.width + gap.x;
      }
    }
    along += thick + (lr ? gap.x : gap.y);
  }
  // Centre the whole drawing on the origin.
  const all = [...placed.values()];
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x + p.width));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y + p.height));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const p of placed.values()) {
    p.x -= cx;
    p.y -= cy;
  }
  return placed;
}
