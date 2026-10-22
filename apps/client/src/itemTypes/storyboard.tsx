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
import {
  SB_HEADER,
  SB_PAD,
  storyboardLayout,
  storyboardZoom,
} from '../lib/structure/storyboardAttach';

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
  // The card mirrored at its design size, scaled by its zoom.
  const k = storyboardZoom(item);
  const W = item.width / k;
  const H = item.height / k;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = p.card.text;
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.title, SB_PAD, SB_HEADER / 2, W - SB_PAD * 2);
  storyboardLayout(item, W, H).forEach((r, i) => {
    const panel = item.panels[i]!;
    ctx.fillStyle = 'rgba(127,127,127,0.12)';
    ctx.fillRect(r.x, r.y, r.w, r.frameH);
    ctx.strokeStyle = 'rgba(127,127,127,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x, r.y, r.w, r.frameH);
    ctx.fillStyle = p.card.text;
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.fillText(panel.label, r.x + 2, r.y + r.frameH + 14, r.w - 4);
    if (panel.scene) {
      ctx.fillStyle = p.card.sub;
      ctx.font = '400 10px Inter, system-ui, sans-serif';
      ctx.fillText(panel.scene, r.x + 2, r.y + r.frameH + 28, r.w - 4);
    }
  });
  ctx.restore();
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
