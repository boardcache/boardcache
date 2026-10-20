import type { RecipeItem } from '@boardcache/schema';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { defineItemType } from './registry';
import { RecipeStage, RecipeContent } from '../components/items/RecipeContent';
import type { StageProps } from './registry';
import { memo, blobToCanvas } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import { getAssetBlob } from '../lib/board/assetStore';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

/** Recipe card thumb: hero cover + title + meta line. */
function RecipeCard({ item }: { item: RecipeItem }) {
  const url = useAssetUrl(item.imageAssetId);
  const meta = [
    item.totalMin ? `${item.totalMin} min` : null,
    item.servings,
    item.cuisine ?? item.category,
  ]
    .filter(Boolean)
    .join(' \u00b7 ');
  return (
    <span className="gallery-recipe" data-testid="gallery-recipe-thumb">
      {url && (
        <span className="gallery-recipe-hero">
          <img src={url} alt="" draggable={false} />
        </span>
      )}
      <strong className="gallery-recipe-title">{item.title}</strong>
      {meta && <span className="gallery-recipe-meta">{meta}</span>}
      {item.ingredients.length > 0 && (
        <span className="gallery-recipe-meta">
          {item.ingredients.length} ingredients · {item.steps.length} steps
        </span>
      )}
    </span>
  );
}

function Stage({ item, ctx }: StageProps<RecipeItem>) {
  return (
    <div className="lightbox-recipe" onClick={(e) => e.stopPropagation()}>
      <RecipeStage
        item={item}
        onEdit={() => {
          ctx.close();
          window.dispatchEvent(new CustomEvent('boardcache:edit-recipe', { detail: item.id }));
        }}
      />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
async function paint(item: RecipeItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  const heroH = item.height * 0.45;
  if (item.imageAssetId) {
    const bm = await memo(p.cache, `blob:${item.imageAssetId}`, async () => {
      const blob = await getAssetBlob(item.imageAssetId!);
      return blob ? blobToCanvas(blob) : null;
    });
    if (bm) {
      const fit = Math.max(item.width / bm.width, heroH / bm.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, item.width, heroH);
      ctx.clip();
      ctx.drawImage(bm, x + (item.width - bm.width * fit) / 2, y, bm.width * fit, bm.height * fit);
      ctx.restore();
    }
  }
  const pad = Math.max(8, item.width * 0.05);
  const titleSize = Math.max(11, item.width * 0.06);
  ctx.fillStyle = p.card.text;
  ctx.font = `700 ${titleSize}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(item.title, x + pad, y + heroH + pad, item.width - pad * 2);
  ctx.font = `${Math.max(9, titleSize * 0.72)}px sans-serif`;
  ctx.fillStyle = p.card.sub;
  const meta = [
    item.totalMin ? `${item.totalMin} min` : null,
    item.servings,
    `${item.ingredients.length} ingredients`,
  ]
    .filter(Boolean)
    .join(' · ');
  ctx.fillText(meta, x + pad, y + heroH + pad + titleSize * 1.5, item.width - pad * 2);
  const lineH = titleSize * 1.3;
  let ty = y + heroH + pad + titleSize * 3;
  for (const ing of item.ingredients.slice(0, 5)) {
    if (ty + lineH > y + item.height - pad) break;
    ctx.fillText(`• ${ing}`, x + pad, ty, item.width - pad * 2);
    ty += lineH;
  }
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: RecipeItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.title,
    body: join(
      item.description,
      item.author,
      item.sourceUrl,
      ...item.ingredients,
      ...item.steps,
      baseText(item),
    ),
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
async function popout(item: RecipeItem, p: PopoutContext): Promise<string> {
  const { mintUrl } = p;
  const heroBlob = item.imageAssetId ? await getAssetBlob(item.imageAssetId) : null;
  const hero = heroBlob ? `<img class="rchero" src="${mintUrl(heroBlob)}" alt="">` : '';
  const chips = [
    item.totalMin ? `\u23f1 ${item.totalMin} min` : null,
    item.servings,
    item.cuisine ?? item.category,
  ]
    .filter(Boolean)
    .map((c) => `<span class="rchip">${escapeHtml(String(c))}</span>`)
    .join('');
  const ings = item.ingredients.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  const steps = item.steps
    .map((st) =>
      st.endsWith(':')
        ? `<li class="rchead">${escapeHtml(st.slice(0, -1))}</li>`
        : `<li>${escapeHtml(st)}</li>`,
    )
    .join('');
  return (
    `<div class="rcp">${hero}<h1>${escapeHtml(item.title)}</h1>` +
    (item.author ? `<p class="rcby">by ${escapeHtml(item.author)}</p>` : '') +
    (item.description ? `<p class="rcdesc">${escapeHtml(item.description)}</p>` : '') +
    `<div class="rchips">${chips}</div>` +
    `<div class="rccols">` +
    (ings ? `<section><h2>Ingredients</h2><ul>${ings}</ul></section>` : '') +
    (steps ? `<section><h2>Instructions</h2><ol>${steps}</ol></section>` : '') +
    `</div></div>`
  );
}

export const recipeType = defineItemType('recipe', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: 'recipe',
  meta: null,
  label: 'Recipe',
  searchText,
  thumbnail: paint,
  render: RecipeContent,
  card: RecipeCard,
  stage: Stage,
  cardAspect: () => 0.85, // hero + title/meta card
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
