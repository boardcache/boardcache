import { platform } from '../platform';
import { clientToCanvas } from '../canvas/canvasDom';
import type { Point } from '../canvas/coords';
import { importFontFiles } from '../import/importFonts';

/**
 * Google Fonts import: search the catalogue, fetch the font binary, and hand
 * it to the normal font importer (so the result is a plain font item/asset —
 * offline-safe, exportable, syncable; nothing references Google at runtime).
 *
 * The full family list comes from fonts.google.com/metadata (no API key).
 * If that endpoint is unreachable (offline, CORS changes), search falls back
 * to a curated list of popular families — and free-text import still works
 * for any exact family name via the CSS API.
 */

const CURATED_FAMILIES = [
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Oswald',
  'Raleway',
  'Poppins',
  'Inter',
  'Nunito',
  'Merriweather',
  'Playfair Display',
  'Rubik',
  'Work Sans',
  'Source Sans 3',
  'Source Serif 4',
  'Source Code Pro',
  'PT Sans',
  'PT Serif',
  'Noto Sans',
  'Noto Serif',
  'Ubuntu',
  'Mukta',
  'Quicksand',
  'Barlow',
  'Manrope',
  'Karla',
  'Josefin Sans',
  'Libre Baskerville',
  'Libre Franklin',
  'Space Grotesk',
  'Space Mono',
  'DM Sans',
  'DM Serif Display',
  'Bebas Neue',
  'Anton',
  'Archivo',
  'Cabin',
  'Crimson Text',
  'EB Garamond',
  'Cormorant',
  'Fira Sans',
  'Fira Code',
  'IBM Plex Sans',
  'IBM Plex Serif',
  'IBM Plex Mono',
  'Inconsolata',
  'JetBrains Mono',
  'Lora',
  'Bitter',
  'Zilla Slab',
  'Abril Fatface',
  'Righteous',
  'Pacifico',
  'Caveat',
  'Dancing Script',
  'Shadows Into Light',
  'Amatic SC',
  'Lobster',
  'Comfortaa',
  'Exo 2',
  'Orbitron',
  'Press Start 2P',
  'VT323',
  'Special Elite',
  'Alfa Slab One',
  'Bungee',
  'Fredoka',
  'Baloo 2',
  'Chivo',
  'Heebo',
  'Hind',
  'Kanit',
  'Mulish',
  'Outfit',
  'Plus Jakarta Sans',
  'Sora',
  'Urbanist',
  'Figtree',
];

let familiesPromise: Promise<string[]> | null = null;

/** Every Google Fonts family (cached); curated fallback when unreachable. */
function allFamilies(): Promise<string[]> {
  familiesPromise ??= (async () => {
    const res = await fetch('https://fonts.google.com/metadata/fonts');
    if (!res.ok) throw new Error(String(res.status));
    // The endpoint prefixes its JSON with an XSSI guard.
    const text = (await res.text()).replace(/^\)\]\}'/, '');
    const parsed = JSON.parse(text) as { familyMetadataList?: { family: string }[] };
    const names = (parsed.familyMetadataList ?? []).map((f) => f.family);
    if (names.length === 0) throw new Error('empty catalogue');
    return names;
  })().catch(() => CURATED_FAMILIES);
  return familiesPromise;
}

export async function searchFamilies(query: string, limit = 30): Promise<string[]> {
  const q = query.trim().toLowerCase();
  const names = await allFamilies();
  if (!q) return names.slice(0, limit);
  const starts = names.filter((n) => n.toLowerCase().startsWith(q));
  const contains = names.filter(
    (n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q),
  );
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Fetch a family's regular-weight binary via the CSS API and import it as a
 * font item at the view center. Throws with a readable message on failure.
 */
export async function importGoogleFont(family: string, at?: Point): Promise<string[]> {
  // Prefer the server's CSS lookup: it gets TRUETYPE urls (embeddable into
  // exported PDFs); the browser's own UA would get WOFF2. Falls back to the
  // direct CSS API when the sync server is unreachable.
  let css: string | null = null;
  try {
    const proxied = await platform.fontCss(family);
    if (proxied.ok) css = await proxied.text();
    else if (proxied.status === 404) throw new Error(`"${family}" wasn’t found on Google Fonts.`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('wasn’t found')) throw err;
  }
  if (!css) {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400&display=swap`;
    const cssRes = await fetch(cssUrl);
    if (!cssRes.ok) throw new Error(`"${family}" wasn’t found on Google Fonts.`);
    css = await cssRes.text();
  }
  // Prefer the latin subset block when present; otherwise the first URL.
  const latin = /\/\* latin \*\/[^}]*?url\((https:[^)]+)\)/.exec(css);
  const any = /url\((https:[^)]+)\)/.exec(css);
  const url = latin?.[1] ?? any?.[1];
  if (!url) throw new Error('No downloadable font file in the response.');
  const binRes = await fetch(url);
  if (!binRes.ok) throw new Error('Downloading the font file failed.');
  const blob = await binRes.blob();
  const ext = url.split('.').pop()?.split(/[?#]/)[0] ?? 'woff2';
  const file = new File([blob], `${family}.${ext}`, {
    type: blob.type || (ext === 'ttf' ? 'font/ttf' : ext === 'otf' ? 'font/otf' : `font/${ext}`),
  });
  const ids = await importFontFiles(
    [file],
    at ?? clientToCanvas(window.innerWidth / 2, window.innerHeight / 2),
  );
  if (ids.length === 0) throw new Error('Importing the font failed.');
  return ids;
}
