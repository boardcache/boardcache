import type { StoryboardItem } from '@boardcache/schema';
import { ContainerCard } from './containerCard';
import { defineItemType } from './registry';
import { StoryboardStage, StoryboardContent } from '../components/items/StoryboardContent';
import type { StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { mediaMeta } from '../lib/mediaItems';

function StoryboardCard({ item }: { item: StoryboardItem }) {
  return <ContainerCard item={item} testId="gallery-storyboard-thumb" label="Storyboard" />;
}

function Stage({ item }: StageProps<StoryboardItem>) {
  return (
    <div className="lightbox-storyboard" onClick={(e) => e.stopPropagation()}>
      <StoryboardStage item={item} />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: StoryboardItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  const HEADER = 40;
  const PAD = 14;
  const GAP = 12;
  const META = 52;
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  ctx.fillStyle = p.card.text;
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.title, x + 14, y + HEADER / 2, item.width - 28);
  const cols = Math.max(1, item.columns);
  const w = (item.width - PAD * 2 - GAP * (cols - 1)) / cols;
  const ar =
    item.aspect === '9:16'
      ? 9 / 16
      : item.aspect === '4:3'
        ? 4 / 3
        : item.aspect === '2.39:1'
          ? 2.39
          : 16 / 9;
  const frameH = w / ar;
  item.panels.forEach((panel, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const px = x + PAD + col * (w + GAP);
    const py = y + HEADER + PAD + row * (frameH + META + GAP);
    ctx.fillStyle = 'rgba(127,127,127,0.12)';
    ctx.fillRect(px, py, w, frameH);
    ctx.strokeStyle = 'rgba(127,127,127,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, w, frameH);
    ctx.fillStyle = p.card.text;
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.fillText(panel.label, px + 2, py + frameH + 14, w - 4);
    if (panel.scene) {
      ctx.fillStyle = p.card.sub;
      ctx.font = '400 10px Inter, system-ui, sans-serif';
      ctx.fillText(panel.scene, px + 2, py + frameH + 28, w - 4);
    }
  });
}

/** What the board search index sees. */
function searchText(item: StoryboardItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.title,
    body: join(...item.panels.flatMap((p) => [p.label, p.scene, p.action]), baseText(item)),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: StoryboardItem, p: PopoutContext): string {
  const { doc } = p;
  const rows = item.panels
    .map((p) => {
      const names = p.itemIds
        .map((id) => {
          const it = doc.items[id];
          return it ? escapeHtml(mediaMeta(it).title) : '';
        })
        .filter(Boolean);
      const meta = [p.move, p.lens, p.duration != null ? `${p.duration}s` : '']
        .filter(Boolean)
        .join(' · ');
      return (
        `<div class="sbrow"><b>${escapeHtml(p.label)}</b>` +
        `${p.scene ? `<span class="sbscene">${escapeHtml(p.scene)}</span>` : ''}` +
        `${p.action ? `<p>${escapeHtml(p.action)}</p>` : ''}` +
        `${meta ? `<i>${escapeHtml(meta)}</i>` : ''}` +
        `${names.length ? `<span class="sbframe">frame: ${names.join(' · ')}</span>` : ''}</div>`
      );
    })
    .join('');
  return (
    `<div class="sbpop"><h1>${escapeHtml(item.name ?? item.title)}</h1>` +
    `<style>.sbrow{padding:10px 0;border-bottom:1px solid #ccc}.sbscene{margin-left:8px;color:#667}.sbrow p{margin:4px 0}.sbrow i{color:#667}.sbframe{display:block;font-size:12px;color:#889}</style>` +
    `${rows || '<p>No shots yet.</p>'}</div>`
  );
}

export const storyboardType = defineItemType('storyboard', {
  popout,
  edit: { kind: 'event', event: 'boardcache:edit-storyboard' },
  pdfCategory: 'storyboard',
  meta: null,
  label: 'Storyboard',
  searchText,
  thumbnail: paint,
  render: StoryboardContent,
  card: StoryboardCard,
  stage: Stage,
  cardAspect: () => 1.15, // wide shot grid
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
