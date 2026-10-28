import './style.css';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { RecipeItem } from '@boardcache/schema';
import { z } from 'zod';
import { ChefHatIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { putAsset } from '../../lib/board/assetStore';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createRecipeItem } from '../../lib/import/createItems';
import { platform } from '../../lib/platform';
import { extractRecipeFromHtml } from '../../lib/structure/recipeSchema';
import type { ExtractedRecipe } from '../../lib/structure/recipeSchema';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { registerPlugin } from '../registry';

/**
 * Recipes plugin: paste a recipe URL, the schema.org data becomes an
 * elegant editable recipe card (canvas summary + full lightbox view + its
 * own PDF-export section). The item type is core (`recipe`); this plugin
 * is the import/edit UX.
 */

const PLUGIN_ID = 'recipes';

/** Editable working copy shared by the import preview and the edit flow. */
interface Draft {
  title: string;
  description: string;
  author: string;
  servings: string;
  prepMin: string;
  cookMin: string;
  totalMin: string;
  cuisine: string;
  ingredients: string;
  steps: string;
  sourceUrl: string | null;
  imageAssetId: string | null;
}

const emptyDraft = (): Draft => ({
  title: '',
  description: '',
  author: '',
  servings: '',
  prepMin: '',
  cookMin: '',
  totalMin: '',
  cuisine: '',
  ingredients: '',
  steps: '',
  sourceUrl: null,
  imageAssetId: null,
});

function draftFromExtracted(
  r: ExtractedRecipe,
  sourceUrl: string,
  imageAssetId: string | null,
): Draft {
  return {
    title: r.title,
    description: r.description ?? '',
    author: r.author ?? '',
    servings: r.servings ?? '',
    prepMin: r.prepMin ? String(r.prepMin) : '',
    cookMin: r.cookMin ? String(r.cookMin) : '',
    totalMin: r.totalMin ? String(r.totalMin) : '',
    cuisine: r.cuisine ?? r.category ?? '',
    ingredients: r.ingredients.join('\n'),
    steps: r.steps.join('\n'),
    sourceUrl,
    imageAssetId,
  };
}

function draftFromItem(item: RecipeItem): Draft {
  return {
    title: item.title,
    description: item.description ?? '',
    author: item.author ?? '',
    servings: item.servings ?? '',
    prepMin: item.prepMin ? String(item.prepMin) : '',
    cookMin: item.cookMin ? String(item.cookMin) : '',
    totalMin: item.totalMin ? String(item.totalMin) : '',
    cuisine: item.cuisine ?? item.category ?? '',
    ingredients: item.ingredients.join('\n'),
    steps: item.steps.join('\n'),
    sourceUrl: item.sourceUrl,
    imageAssetId: item.imageAssetId,
  };
}

const num = (s: string): number | null => {
  const n = Number(s.trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

function draftToFields(d: Draft) {
  return {
    title: d.title.trim() || 'Untitled recipe',
    description: d.description.trim() || null,
    author: d.author.trim() || null,
    servings: d.servings.trim() || null,
    prepMin: num(d.prepMin),
    cookMin: num(d.cookMin),
    totalMin: num(d.totalMin),
    cuisine: d.cuisine.trim() || null,
    ingredients: d.ingredients
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
    steps: d.steps
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
    sourceUrl: d.sourceUrl,
    imageAssetId: d.imageAssetId,
  };
}

/**
 * The item metadata every recipe carries beside its own fields: the name
 * the gallery and lightbox show, the page it came from as the item's link
 * and provenance, and the description as the note the Details panel shows.
 */
function recipeMeta(fields: ReturnType<typeof draftToFields>) {
  return {
    name: fields.title,
    ...(fields.sourceUrl
      ? {
          linkUrl: fields.sourceUrl,
          source: {
            url: fields.sourceUrl,
            title: fields.title,
            ...(fields.author ? { author: fields.author } : {}),
            capturedAt: new Date().toISOString(),
          },
        }
      : {}),
    ...(fields.description ? { notes: fields.description } : {}),
  };
}

interface DialogState {
  open: { editItemId: string | null } | null;
  openNew: () => void;
  openEdit: (itemId: string) => void;
  close: () => void;
}

const useRecipeDialog = create<DialogState>((set) => ({
  open: null,
  openNew: () => set({ open: { editItemId: null } }),
  openEdit: (editItemId) => set({ open: { editItemId } }),
  close: () => set({ open: null }),
}));

/** Fetch page text: browser first (CORS-friendly hosts), then the relay. */
async function fetchPageHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) return await res.text();
  } catch {
    /* CORS or network — fall through to the relay */
  }
  const res = await platform.urlFetch({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? 'Could not fetch that page.');
  }
  return res.text();
}

/** Fetch the hero image and store it as an asset (best effort). */
async function fetchHeroAsset(imageUrl: string): Promise<string | null> {
  try {
    let blob: Blob | null = null;
    try {
      const direct = await fetch(imageUrl, { mode: 'cors' });
      if (direct.ok) blob = await direct.blob();
    } catch {
      /* relay below */
    }
    if (!blob) {
      const res = await platform.urlFetch({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: imageUrl }),
      });
      if (!res.ok) return null;
      blob = await res.blob();
    }
    if (!blob.type.startsWith('image/')) return null;
    return await putAsset(blob);
  } catch {
    return null;
  }
}

function RecipeDialog() {
  const open = useRecipeDialog((s) => s.open);
  return open ? <RecipeDialogBody key={open.editItemId ?? 'new'} /> : null;
}

function RecipeDialogBody() {
  const { editItemId } = useRecipeDialog.getState().open!;
  const close = () => useRecipeDialog.getState().close();
  const editItem = editItemId
    ? (useDocumentStore.getState().doc.items[editItemId] as RecipeItem | undefined)
    : undefined;

  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(editItem ? draftFromItem(editItem) : emptyDraft());
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const importUrl = async () => {
    setBusy(true);
    setError(null);
    try {
      const target = url.trim();
      const html = await fetchPageHtml(target);
      const recipe = extractRecipeFromHtml(html);
      if (!recipe) {
        throw new Error('No recipe data found on that page (schema.org/Recipe markup missing).');
      }
      const imageAssetId = recipe.imageUrl ? await fetchHeroAsset(recipe.imageUrl) : null;
      setDraft(draftFromExtracted(recipe, target, imageAssetId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const fields = draftToFields(draft);
    if (editItemId) {
      updateItems([editItemId], 'Edit recipe', (d) => {
        if (d.type !== 'recipe') return;
        Object.assign(d, fields);
        // Keep the item's name and link in step; a note the user wrote stays.
        d.name = fields.title;
        if (fields.sourceUrl) {
          d.linkUrl = fields.sourceUrl;
          d.source = { ...(d.source ?? {}), url: fields.sourceUrl, title: fields.title };
        }
        if (!d.notes && fields.description) d.notes = fields.description;
      });
    } else {
      createRecipeItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2), {
        ...fields,
        ...recipeMeta(fields),
      });
    }
    close();
  };

  return (
    <UiDialog
      title={editItemId ? 'Edit Recipe' : 'Import Recipe'}
      onClose={close}
      className="rcp-sheet"
      size="large"
      testId="recipe-dialog"
    >
      <div className="rcp-body">
        {!editItemId && (
          <div className="rcp-url-row" data-testid="recipe-url-row">
            <input
              value={url}
              placeholder="https:// (any page with recipe markup)"
              data-testid="recipe-url"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url.trim()) void importUrl();
              }}
            />
            <button
              type="button"
              className="sync-primary"
              disabled={busy || !url.trim()}
              data-testid="recipe-fetch"
              onClick={() => void importUrl()}
            >
              {busy ? 'Fetching' : 'Fetch'}
            </button>
          </div>
        )}
        {!editItemId && (
          <p className="rcp-hint">
            Paste a recipe URL to import its data — or just fill in the fields below.
          </p>
        )}
        {error && <p className="rcp-error">{error}</p>}

        <div className="rcp-form" data-testid="recipe-form">
          <input
            className="rcp-title"
            value={draft.title}
            placeholder="Recipe title"
            data-testid="recipe-title"
            onChange={(e) => set({ title: e.target.value })}
          />
          <textarea
            className="rcp-desc"
            value={draft.description}
            placeholder="Description (optional)"
            data-testid="recipe-description"
            onChange={(e) => set({ description: e.target.value })}
          />
          <div className="rcp-meta-grid">
            <label>
              Author
              <input value={draft.author} onChange={(e) => set({ author: e.target.value })} />
            </label>
            <label>
              Servings
              <input
                value={draft.servings}
                data-testid="recipe-servings"
                onChange={(e) => set({ servings: e.target.value })}
              />
            </label>
            <label>
              Cuisine
              <input value={draft.cuisine} onChange={(e) => set({ cuisine: e.target.value })} />
            </label>
            <label>
              Prep (min)
              <input
                value={draft.prepMin}
                inputMode="numeric"
                onChange={(e) => set({ prepMin: e.target.value })}
              />
            </label>
            <label>
              Cook (min)
              <input
                value={draft.cookMin}
                inputMode="numeric"
                onChange={(e) => set({ cookMin: e.target.value })}
              />
            </label>
            <label>
              Total (min)
              <input
                value={draft.totalMin}
                inputMode="numeric"
                data-testid="recipe-total"
                onChange={(e) => set({ totalMin: e.target.value })}
              />
            </label>
          </div>
          <label className="rcp-block">
            Ingredients — one per line
            <textarea
              value={draft.ingredients}
              data-testid="recipe-ingredients"
              onChange={(e) => set({ ingredients: e.target.value })}
            />
          </label>
          <label className="rcp-block">
            Instructions — one step per line (end a line with “:” for a section header)
            <textarea
              value={draft.steps}
              data-testid="recipe-steps"
              onChange={(e) => set({ steps: e.target.value })}
            />
          </label>
          <div className="rcp-actions">
            <button
              type="button"
              className="sync-primary"
              disabled={busy || !draft.title.trim()}
              data-testid="recipe-save"
              onClick={save}
            >
              {editItemId ? 'Save Recipe' : 'Add to Board'}
            </button>
          </div>
        </div>
      </div>
    </UiDialog>
  );
}

/** Lightbox "Edit" button dispatches this (it closes the lightbox first). */
function RecipeEditBridge() {
  useEffect(() => {
    const onEdit = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) useRecipeDialog.getState().openEdit(id);
    };
    window.addEventListener('boardcache:edit-recipe', onEdit);
    return () => window.removeEventListener('boardcache:edit-recipe', onEdit);
  }, []);
  return <RecipeDialog />;
}

const recipeToolSchema = z.object({
  url: z.string().describe('Page URL with schema.org/Recipe markup'),
  x: z.number().optional(),
  y: z.number().optional(),
});

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 57,
    name: 'Recipes',
    description:
      'Turn any recipe URL into an elegant, editable recipe card — schema.org data with hero image, ingredients and steps, plus a print-quality PDF export section.',
  },
  addMenu: [
    {
      label: 'Add Recipe',
      category: 'structure',
      icon: <ChefHatIcon />,
      onSelect: () => {
        const selection = useSessionStore.getState().selection;
        const item =
          selection.length === 1 ? useDocumentStore.getState().doc.items[selection[0]!] : null;
        if (item?.type === 'recipe') useRecipeDialog.getState().openEdit(item.id);
        else useRecipeDialog.getState().openNew();
      },
    },
  ],
  Component: RecipeEditBridge,
  itemMenu: (item) =>
    item.type === 'recipe'
      ? [
          {
            kind: 'action',
            label: 'Edit Recipe',
            icon: <ChefHatIcon />,
            onSelect: () => useRecipeDialog.getState().openEdit(item.id),
          },
        ]
      : [],
  tools: [
    {
      name: 'import_recipe',
      description:
        'Import a recipe from a URL: reads the page’s schema.org/Recipe markup and places an editable recipe card (title, image, times, servings, ingredients, steps) on the board.',
      parameters: recipeToolSchema,
      access: 'write',
      execute: async (args, ctx) => {
        const html = await fetchPageHtml(args.url);
        const recipe = extractRecipeFromHtml(html);
        if (!recipe) throw new Error('No schema.org/Recipe markup found on that page.');
        const imageAssetId = recipe.imageUrl ? await fetchHeroAsset(recipe.imageUrl) : null;
        const center = ctx.viewCenter();
        const at = { x: args.x ?? center.x, y: args.y ?? center.y };
        const fields = draftToFields(draftFromExtracted(recipe, args.url, imageAssetId));
        const id = createRecipeItem(at, { ...fields, ...recipeMeta(fields) });
        return { id, title: fields.title };
      },
    },
  ],
});
