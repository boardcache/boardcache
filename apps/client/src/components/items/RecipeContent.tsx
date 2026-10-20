import { safeHttpUrl } from '../../lib/text/safeUrl';
import type { RecipeItem } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';

/**
 * Recipe cards. The canvas card is a designed summary (hero, title, meta
 * chips, ingredient preview); the lightbox stage renders the full recipe
 * responsively (two columns collapsing to one).
 */

function formatMinutes(min: number | null): string | null {
  if (!min) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function MetaChips({ item }: { item: RecipeItem }) {
  const chips: string[] = [];
  const total = formatMinutes(item.totalMin);
  const prep = formatMinutes(item.prepMin);
  const cook = formatMinutes(item.cookMin);
  if (total) chips.push(`⏱ ${total}`);
  else if (prep || cook) chips.push(`⏱ ${[prep, cook].filter(Boolean).join(' + ')}`);
  if (item.servings) chips.push(`🍽 ${item.servings}`);
  if (item.cuisine) chips.push(item.cuisine);
  else if (item.category) chips.push(item.category);
  return chips.length ? (
    <div className="recipe-chips">
      {chips.map((chip, i) => (
        <span key={i} className="recipe-chip">
          {chip}
        </span>
      ))}
    </div>
  ) : null;
}

/** Canvas card: summary layout that scales with the item box. */
export function RecipeContent({ item }: { item: RecipeItem }) {
  const imageUrl = useAssetUrl(item.imageAssetId);
  return (
    <div className="recipe-card" data-testid="recipe-card">
      {imageUrl && (
        <div className="recipe-hero">
          <img src={imageUrl} alt="" draggable={false} />
        </div>
      )}
      <div className="recipe-card-body">
        <h3 className="recipe-title">{item.title}</h3>
        <MetaChips item={item} />
        {item.ingredients.length > 0 && (
          <ul className="recipe-ingredients-preview">
            {item.ingredients.slice(0, 6).map((ing, i) => (
              <li key={i}>{ing}</li>
            ))}
            {item.ingredients.length > 6 && (
              <li className="recipe-more">+ {item.ingredients.length - 6} more</li>
            )}
          </ul>
        )}
        {item.steps.length > 0 && (
          <span className="recipe-steps-count">{item.steps.length} steps</span>
        )}
      </div>
    </div>
  );
}

/** Lightbox stage: the full recipe, responsive, with an edit affordance. */
export function RecipeStage({ item, onEdit }: { item: RecipeItem; onEdit?: () => void }) {
  const imageUrl = useAssetUrl(item.imageAssetId);
  return (
    <article className="recipe-stage" data-testid="recipe-stage">
      {imageUrl && (
        <div className="recipe-stage-hero">
          <img src={imageUrl} alt="" draggable={false} />
        </div>
      )}
      <header className="recipe-stage-head">
        <div>
          <h1>{item.title}</h1>
          {item.author && <p className="recipe-byline">by {item.author}</p>}
          {item.description && <p className="recipe-desc">{item.description}</p>}
          <MetaChips item={item} />
        </div>
        {onEdit && (
          <button type="button" className="recipe-edit" data-testid="recipe-edit" onClick={onEdit}>
            Edit
          </button>
        )}
      </header>
      <div className="recipe-columns">
        {item.ingredients.length > 0 && (
          <section className="recipe-section">
            <h2>Ingredients</h2>
            <ul className="recipe-ingredients">
              {item.ingredients.map((ing, i) => (
                <li key={i}>{ing}</li>
              ))}
            </ul>
          </section>
        )}
        {item.steps.length > 0 && (
          <section className="recipe-section">
            <h2>Instructions</h2>
            <ol className="recipe-steps">
              {item.steps.map((step, i) =>
                step.endsWith(':') ? (
                  <li key={i} className="recipe-step-header">
                    {step.slice(0, -1)}
                  </li>
                ) : (
                  <li key={i}>{step}</li>
                ),
              )}
            </ol>
          </section>
        )}
      </div>
      {item.sourceUrl && (
        <footer className="recipe-source">
          <a
            href={safeHttpUrl(item.sourceUrl) ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
          >
            {(() => {
              try {
                return new URL(item.sourceUrl).hostname.replace(/^www\./, '');
              } catch {
                return item.sourceUrl;
              }
            })()}
          </a>
        </footer>
      )}
    </article>
  );
}
