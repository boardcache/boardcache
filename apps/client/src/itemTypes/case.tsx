import type { CaseItem } from '@boardcache/schema';
import { defineItemType } from './registry';
import { CaseContent, CaseStage } from '../components/items/CaseContent';
import type { StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { mediaMeta } from '../lib/mediaItems';
import { conclusionScores, formatScore } from '../lib/structure/cases';
import { weightLabel } from '../lib/text/evidenceWeight';
import { useDocumentStore } from '../state/documentStore';

const FOR = '#2e9e5b';
const AGAINST = '#d64545';

/** Gallery card: the question and the top conclusions with their bars. */
function CaseCard({ item }: { item: CaseItem }) {
  const itemsById = useDocumentStore((s) => s.doc.items);
  const rows = conclusionScores(itemsById, item).slice(0, 3);
  const largest = Math.max(1, ...rows.map((r) => r.supports + r.contradicts));
  return (
    <span className="gallery-case" data-testid="gallery-case-thumb">
      <strong className="gallery-case-title">{item.title}</strong>
      {item.question && <span className="gallery-case-question">{item.question}</span>}
      {rows.map((row) => (
        <span className="gallery-case-row" key={row.conclusion.id}>
          <span className="gallery-case-label">{row.conclusion.label}</span>
          <span className={`gallery-case-score${row.net > 0 ? ' pos' : row.net < 0 ? ' neg' : ''}`}>
            {formatScore(row.net)}
          </span>
          <span className="case-bar" aria-hidden>
            <span
              className="case-bar-for"
              style={{ width: `${(row.supports / largest) * 100}%` }}
            />
            <span
              className="case-bar-against"
              style={{ width: `${(row.contradicts / largest) * 100}%` }}
            />
          </span>
        </span>
      ))}
    </span>
  );
}

function Stage({ item }: StageProps<CaseItem>) {
  return (
    <div className="lightbox-case" onClick={(e) => e.stopPropagation()}>
      <CaseStage item={item} />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: CaseItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  const rows = conclusionScores(p.itemsById ?? {}, item);
  const largest = Math.max(1, ...rows.map((r) => r.supports + r.contradicts));
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = p.card.text;
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.fillText(item.title, x + 14, y + 22, item.width - 28);
  let top = y + 44;
  if (item.question) {
    ctx.fillStyle = p.card.sub;
    ctx.font = '400 11.5px Inter, system-ui, sans-serif';
    ctx.fillText(item.question, x + 14, top, item.width - 28);
    top += 22;
  }
  const rowH = 34;
  for (const row of rows) {
    if (top + rowH > y + item.height - 8) break;
    ctx.fillStyle = p.card.text;
    ctx.font = '500 13px Inter, system-ui, sans-serif';
    ctx.fillText(row.conclusion.label, x + 14, top + 8, item.width - 90);
    const score = formatScore(row.net);
    ctx.font = '700 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = row.net > 0 ? FOR : row.net < 0 ? AGAINST : p.card.sub;
    ctx.fillText(score, x + item.width - 14 - ctx.measureText(score).width, top + 8);
    const barW = item.width - 28;
    ctx.fillStyle = 'rgba(127,127,127,0.18)';
    ctx.fillRect(x + 14, top + 20, barW, 5);
    const forW = (row.supports / largest) * barW;
    const againstW = (row.contradicts / largest) * barW;
    ctx.fillStyle = FOR;
    ctx.fillRect(x + 14, top + 20, forW, 5);
    ctx.fillStyle = AGAINST;
    ctx.fillRect(x + 14 + forW, top + 20, againstW, 5);
    top += rowH;
  }
}

/** What the board search index sees. */
function searchText(item: CaseItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.title,
    body: join(item.question, ...item.conclusions.map((c) => c.label), baseText(item)),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: CaseItem, p: PopoutContext): string {
  const { doc } = p;
  const rows = conclusionScores(doc.items, item)
    .map((row) => {
      const side = (stance: 'supports' | 'contradicts') =>
        item.evidence
          .filter((e) => e.conclusionId === row.conclusion.id && e.stance === stance)
          .map((e) => {
            const it = doc.items[e.itemId];
            if (!it) return '';
            const w = it.weight ? ` (${escapeHtml(weightLabel(it.weight))})` : ' (unrated)';
            return escapeHtml(mediaMeta(it).title) + w;
          })
          .filter(Boolean)
          .join(' · ');
      return (
        `<section><h2>${escapeHtml(row.conclusion.label)} <small>${formatScore(row.net)}</small></h2>` +
        `<p><b style="color:${FOR}">For</b> ${side('supports') || '<i>—</i>'}</p>` +
        `<p><b style="color:${AGAINST}">Against</b> ${side('contradicts') || '<i>—</i>'}</p></section>`
      );
    })
    .join('');
  return (
    `<div class="casepop"><h1>${escapeHtml(item.name ?? item.title)}</h1>` +
    (item.question ? `<p>${escapeHtml(item.question)}</p>` : '') +
    `<style>.casepop section{border-top:1px solid #ccc;padding:10px 0}.casepop h2{font-size:16px;margin:0 0 6px}.casepop small{font-weight:400;color:#777}</style>` +
    `${rows}</div>`
  );
}

export const caseType = defineItemType('case', {
  popout,
  // The lightbox stage is the editor: title, question, conclusions, links.
  edit: { kind: 'lightbox' },
  pdfCategory: 'image',
  meta: (item) => ({ title: item.name ?? item.title, detail: 'Case' }),
  label: 'Case',
  searchText,
  thumbnail: paint,
  render: CaseContent,
  card: CaseCard,
  stage: Stage,
  cardAspect: () => 0.9,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
