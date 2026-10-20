/**
 * schema.org/Recipe extraction from web pages. Recipe sites embed their
 * data as JSON-LD (script[type="application/ld+json"]) — plain top-level
 * nodes, arrays, or @graph collections. This normalizes the many shapes
 * (HowToStep/HowToSection instructions, ImageObject images, ISO-8601
 * durations, Person authors) into one flat structure.
 */

export interface ExtractedRecipe {
  title: string;
  description: string | null;
  imageUrl: string | null;
  author: string | null;
  prepMin: number | null;
  cookMin: number | null;
  totalMin: number | null;
  servings: string | null;
  cuisine: string | null;
  category: string | null;
  ingredients: string[];
  steps: string[];
}

type Json = Record<string, unknown>;

/** "PT1H30M" / "PT45M" / "P0DT2H" → minutes (null when unparseable). */
export function isoDurationToMin(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m =
    /^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      raw.trim(),
    );
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
  const minutes =
    Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 60;
  return Math.round(minutes) || null;
}

/** Minimal HTML entity decode for the strings sites embed in JSON-LD. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

const clean = (v: unknown): string | null => {
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return null;
  const s = decodeEntities(v.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
};

function isRecipeNode(node: unknown): node is Json {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const t = (node as Json)['@type'];
  if (typeof t === 'string') return t.toLowerCase() === 'recipe';
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.toLowerCase() === 'recipe');
  return false;
}

/** Depth-first hunt for a Recipe node in whatever the site nested it in. */
function findRecipeNode(root: unknown, depth = 0): Json | null {
  if (depth > 4 || !root || typeof root !== 'object') return null;
  if (isRecipeNode(root)) return root;
  if (Array.isArray(root)) {
    for (const entry of root) {
      const hit = findRecipeNode(entry, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const graph = (root as Json)['@graph'];
  if (graph) return findRecipeNode(graph, depth + 1);
  const main = (root as Json)['mainEntity'];
  if (main) return findRecipeNode(main, depth + 1);
  return null;
}

function imageUrlOf(image: unknown): string | null {
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) {
    for (const entry of image) {
      const url = imageUrlOf(entry);
      if (url) return url;
    }
    return null;
  }
  if (image && typeof image === 'object') {
    const url = (image as Json)['url'] ?? (image as Json)['contentUrl'];
    return typeof url === 'string' ? url : null;
  }
  return null;
}

function authorOf(author: unknown): string | null {
  if (typeof author === 'string') return clean(author);
  if (Array.isArray(author)) return authorOf(author[0]);
  if (author && typeof author === 'object') return clean((author as Json)['name']);
  return null;
}

function yieldOf(y: unknown): string | null {
  if (Array.isArray(y)) {
    // Sites often give ["4", "4 servings"] — prefer the descriptive one.
    const strings = y.map(clean).filter(Boolean) as string[];
    return strings.sort((a, b) => b.length - a.length)[0] ?? null;
  }
  const s = clean(y);
  return s ? (/^\d+$/.test(s) ? `${s} servings` : s) : null;
}

const firstString = (v: unknown): string | null =>
  Array.isArray(v) ? clean(v.filter((x) => typeof x === 'string')[0]) : clean(v);

/** Flatten recipeInstructions: strings, HowToStep[], HowToSection[]. */
function stepsOf(instructions: unknown, depth = 0): string[] {
  if (depth > 3 || !instructions) return [];
  if (typeof instructions === 'string') {
    // A single blob: split on newlines or numbered markers.
    return instructions
      .split(/\n+|(?=\d+\.\s)/)
      .map((s) => clean(s))
      .filter((s): s is string => Boolean(s));
  }
  if (Array.isArray(instructions)) {
    return instructions.flatMap((entry) => stepsOf(entry, depth + 1));
  }
  if (typeof instructions === 'object') {
    const node = instructions as Json;
    const t = typeof node['@type'] === 'string' ? (node['@type'] as string).toLowerCase() : '';
    if (t === 'howtosection' || node['itemListElement']) {
      const section = clean(node['name']);
      const inner = stepsOf(node['itemListElement'], depth + 1);
      // Keep section headers as their own "step" line when informative.
      return section && inner.length ? [`${section}:`, ...inner] : inner;
    }
    const text = clean(node['text']) ?? clean(node['name']);
    return text ? [text] : [];
  }
  return [];
}

/** Normalize one JSON-LD Recipe node. */
export function normalizeRecipeNode(node: Json): ExtractedRecipe | null {
  const title = clean(node['name']);
  if (!title) return null;
  const ingredients = (
    Array.isArray(node['recipeIngredient'])
      ? node['recipeIngredient']
      : Array.isArray(node['ingredients'])
        ? node['ingredients']
        : []
  )
    .map((entry: unknown) => clean(entry))
    .filter((entry): entry is string => Boolean(entry));
  return {
    title,
    description: clean(node['description']),
    imageUrl: imageUrlOf(node['image']),
    author: authorOf(node['author']),
    prepMin: isoDurationToMin(node['prepTime']),
    cookMin: isoDurationToMin(node['cookTime']),
    totalMin: isoDurationToMin(node['totalTime']),
    servings: yieldOf(node['recipeYield'] ?? node['yield']),
    cuisine: firstString(node['recipeCuisine']),
    category: firstString(node['recipeCategory']),
    ingredients,
    steps: stepsOf(node['recipeInstructions']),
  };
}

/** Extract the first schema.org Recipe from a page's HTML. */
export function extractRecipeFromHtml(html: string): ExtractedRecipe | null {
  const scripts = html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]!.trim());
    } catch {
      continue; // some sites ship broken JSON in one block and valid in another
    }
    const node = findRecipeNode(parsed);
    if (node) {
      const recipe = normalizeRecipeNode(node);
      if (recipe) return recipe;
    }
  }
  return null;
}
