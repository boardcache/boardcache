import { z } from 'zod';
import type { ShapeItem } from '@boardcache/schema';
import { DEFAULT_FONT_FAMILY, newId } from '@boardcache/schema';
import { registerBoardTool, runBoardTool } from './registry';
import { positionSchema, placeAt } from './shared';
import { createTextBoxes, TEXT_DEFAULTS } from '../import/createItems';
import { layoutDiagram, parseDiagram } from '../structure/diagramText';
import type { DiagramNode } from '../structure/diagramText';
import { measureMarkdownHeight } from '../text/markdown';
import {
  addConnection,
  addItems,
  groupItems,
  setConnectionLabel,
  topZIndex,
  updateItems,
} from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * add_diagram: a flowchart, graph or process written as text becomes board
 * items. Each node is a text card (centred, fixed size); a decision, a
 * circle or a hexagon gets a shape drawn behind it; edges are connections
 * with their labels; subgraphs and clusters become groups, and the whole
 * drawing is one group so it moves together. The layout is layered
 * (sources first), so the agent writes the graph and never a coordinate.
 */

const PAD_X = 28;
const PAD_Y = 20;
const MIN_H = 64;

const shapeBehind = (n: DiagramNode): ShapeItem['shape'] | null =>
  n.shape === 'diamond'
    ? 'diamond'
    : n.shape === 'circle'
      ? 'ellipse'
      : n.shape === 'hexagon'
        ? 'polygon'
        : null;

registerBoardTool({
  name: 'add_diagram',
  description:
    'Draw a diagram from text: a Mermaid flowchart (`graph TD` / `flowchart LR`, node shapes like A[box] B{decision} C((circle)) D([stadium]), edges `-->`, `-- label -->`, `-->|label|`, `-.->`, chains, `A & B --> C`, subgraphs), a Graphviz DOT graph (`digraph { a -> b [label="x"]; subgraph cluster_1 { label="Title"; c } }`, rankdir, node shapes) or plain lines (`Idea -> Draft: label`). Nodes become text cards laid out in layers from the sources, decisions and circles get a shape behind them, edges become labelled connections, subgraphs and clusters become groups, and the whole drawing is grouped and brought into view. Returns the item id of every node by its name in the text, so later steps can connect or edit them. Prefer this over placing shapes and lines by hand.',
  parameters: z.object({
    source: z.string().min(1).max(20000),
    format: z.enum(['auto', 'mermaid', 'dot', 'plain']).optional(),
    direction: z.enum(['TB', 'LR']).optional().describe('Overrides the text'),
    nodeWidth: z.number().min(100).max(600).optional().describe('Card width, default 220'),
    title: z.string().max(120).optional().describe('Name of the group holding the drawing'),
    group: z.boolean().optional().describe('false leaves the items ungrouped'),
    ...positionSchema,
  }),
  access: 'write',
  execute: async (args, ctx) => {
    const d = parseDiagram(args.source, args.format ?? 'auto');
    if (args.direction) d.direction = args.direction;
    if (d.nodes.length > 200) throw new Error('A diagram of up to 200 nodes, please.');
    const width = args.nodeWidth ?? 220;
    const fontSize = TEXT_DEFAULTS.fontSize;
    const heights = new Map<string, number>();
    for (const n of d.nodes) {
      const text = measureMarkdownHeight(n.label, width - PAD_X * 2, fontSize, DEFAULT_FONT_FAMILY);
      // A shape behind wants room around the words.
      const extra = shapeBehind(n) ? 1.45 : 1;
      heights.set(n.id, Math.max(MIN_H, Math.round((text + PAD_Y * 2) * extra)));
    }
    const placed = layoutDiagram(d, (n) => ({
      width: shapeBehind(n) ? Math.round(width * 1.3) : width,
      height: heights.get(n.id)!,
    }));
    const at = placeAt(ctx, args.x, args.y);

    // Shapes first, so they sit under the cards.
    const { doc } = useDocumentStore.getState();
    let z = topZIndex(doc) + 1;
    const shapes: ShapeItem[] = [];
    const shapeFor = new Map<string, string>();
    for (const n of d.nodes) {
      const kind = shapeBehind(n);
      if (!kind) continue;
      const p = placed.get(n.id)!;
      const item: ShapeItem = {
        id: newId(),
        type: 'shape',
        x: at.x + p.x,
        y: at.y + p.y,
        width: p.width,
        height: p.height,
        rotation: 0,
        zIndex: z++,
        locked: false,
        opacity: 1,
        groupId: null,
        shape: kind,
        fill: null,
        stroke: '#4f8ef7',
        strokeWidth: 2,
        dashed: false,
        cornerRadius: 0,
        sides: 6,
        innerRadiusRatio: 0.5,
        flipDiagonal: false,
        points: null,
        pathNodes: null,
        pathClosed: false,
      };
      shapes.push(item);
      shapeFor.set(n.id, item.id);
    }
    if (shapes.length) addItems(shapes, 'Add diagram');

    const ids = createTextBoxes(
      d.nodes.map((n) => {
        const p = placed.get(n.id)!;
        const w = shapeBehind(n) ? width : p.width;
        return {
          topLeft: { x: at.x + p.x + (p.width - w) / 2, y: at.y + p.y },
          width: w,
          text: n.label,
        };
      }),
      'Add diagram',
    );
    const itemFor = new Map(d.nodes.map((n, i) => [n.id, ids[i]!]));
    updateItems(ids, 'Add diagram', (item) => {
      if (item.type !== 'text') return;
      const node = d.nodes.find((n) => itemFor.get(n.id) === item.id)!;
      item.align = 'center';
      item.verticalAlign = 'middle';
      item.autoHeight = false;
      item.height = heights.get(node.id)!;
      if (shapeBehind(node)) item.background = null;
    });

    let connections = 0;
    for (const e of d.edges) {
      const id = addConnection(
        { kind: 'item', id: itemFor.get(e.from)! },
        { kind: 'item', id: itemFor.get(e.to)! },
        'relates',
      );
      if (!id) continue;
      connections++;
      if (e.label) setConnectionLabel(id, e.label);
    }

    const members = (nodeIds: string[]) =>
      nodeIds.flatMap((n) => [itemFor.get(n)!, ...(shapeFor.has(n) ? [shapeFor.get(n)!] : [])]);
    const groups: { title: string; id: string }[] = [];
    for (const g of d.groups) {
      const gid = groupItems(members(g.nodeIds), g.title);
      if (gid) groups.push({ title: g.title, id: gid });
    }
    const all = members(d.nodes.map((n) => n.id));
    let groupId: string | null = null;
    if (args.group !== false && all.length >= 2) groupId = groupItems(all, args.title);
    useSessionStore.getState().setSelection(all);
    await runBoardTool('focus_viewport', { ids: all });
    return {
      format: d.format,
      nodes: d.nodes.map((n) => ({ name: n.id, label: n.label, itemId: itemFor.get(n.id)! })),
      connections,
      groups,
      ...(groupId ? { groupId } : {}),
    };
  },
});
