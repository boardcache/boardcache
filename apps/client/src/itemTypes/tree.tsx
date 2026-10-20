import type { TreeItem } from '@boardcache/schema';
import { ContainerCard } from './containerCard';
import { defineItemType } from './registry';
import { TreeStage, TreeContent } from '../components/items/TreeContent';
import type { StageProps } from './registry';
import { useSessionStore } from '../state/sessionStore';
import type { PaintContext } from '../lib/media/paint';
import { readableTextColor } from '../lib/color/color';
import { computeTreeLayout } from '../lib/structure/treeLayout';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { mediaMeta } from '../lib/mediaItems';

function TreeCard({ item }: { item: TreeItem }) {
  return <ContainerCard item={item} testId="gallery-tree-thumb" label="Tree" />;
}

function Stage({ item }: StageProps<TreeItem>) {
  return (
    <div className="lightbox-tree" onClick={(e) => e.stopPropagation()}>
      <TreeStage item={item} />
    </div>
  );
}

/** Clicking the card's background selects the tree itself (not a node). */
function TreeRender({ item }: { item: TreeItem }) {
  return (
    <TreeContent
      item={item}
      onBackgroundClick={() => useSessionStore.getState().setSelection([item.id])}
    />
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: TreeItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const layout = computeTreeLayout(item, p.itemsById);
  const sx = item.width / Math.max(1, layout.width);
  const sy = item.height / Math.max(1, layout.height);
  const k = Math.min(sx, sy, 1);
  ctx.strokeStyle = 'rgba(127,127,127,0.5)';
  ctx.lineWidth = 1.5;
  for (const box of layout.boxes.values()) {
    const parent = box.node.parentId ? layout.boxes.get(box.node.parentId) : undefined;
    if (parent) {
      ctx.beginPath();
      ctx.moveTo(x + (parent.x + parent.w / 2) * k, y + (parent.y + parent.h) * k);
      ctx.lineTo(x + (box.x + box.w / 2) * k, y + box.y * k);
      ctx.stroke();
    }
  }
  for (const box of layout.boxes.values()) {
    ctx.fillStyle = box.node.color ?? 'rgba(127,127,127,0.18)';
    ctx.beginPath();
    ctx.roundRect(x + box.x * k, y + box.y * k, box.w * k, box.h * k, 6 * k);
    ctx.fill();
    ctx.fillStyle = box.node.color ? readableTextColor(box.node.color) : p.card.text;
    ctx.font = `600 ${box.fontSize * k}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    // The layout's own lines, centred in the label row (the whole card
    // when nothing is shelved; the shelf items draw below it otherwise).
    const lineH = box.fontSize * 1.25;
    const top = box.y + (box.labelRow - box.lines.length * lineH) / 2;
    box.lines.forEach((line, i) => {
      ctx.fillText(
        line,
        x + (box.x + box.w / 2) * k,
        y + (top + lineH * (i + 0.5)) * k,
        (box.w - 16) * k,
      );
    });
    ctx.textAlign = 'start';
  }
}

/** What the board search index sees. */
function searchText(item: TreeItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.title,
    body: join(...item.nodes.map((n) => n.label), baseText(item)),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: TreeItem, p: PopoutContext): string {
  const { doc } = p;
  const rows: string[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const n of item.nodes.filter((x) => (x.parentId ?? null) === parentId)) {
      const names = n.itemIds
        .map((id) => {
          const it = doc.items[id];
          return it ? escapeHtml(mediaMeta(it).title) : '';
        })
        .filter(Boolean);
      rows.push(
        `<div class="treerow" style="margin-left:${depth * 22}px">` +
          `<span class="treenode"${n.color ? ` style="background:${escapeHtml(n.color)};color:${readableTextColor(n.color)}"` : ''}>${escapeHtml(n.label)}</span>` +
          (names.length ? `<span class="treeitems">${names.join(' · ')}</span>` : '') +
          `</div>`,
      );
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return (
    `<div class="treepop"><h1>${escapeHtml(item.name ?? item.title)}</h1>` +
    `<style>.treerow{display:flex;align-items:center;gap:10px;margin:6px 0}.treenode{padding:4px 12px;border-radius:8px;background:#eceef2;font-weight:600}.treeitems{color:#667}</style>` +
    `${rows.join('') || '<p>No nodes yet.</p>'}</div>`
  );
}

export const treeType = defineItemType('tree', {
  popout,
  edit: { kind: 'event', event: 'boardcache:edit-tree' },
  pdfCategory: 'image',
  meta: null,
  label: 'Tree',
  searchText,
  thumbnail: paint,
  render: TreeRender,
  card: TreeCard,
  stage: Stage,
  cardAspect: () => 0.7, // hierarchy card
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
