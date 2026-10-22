import { getPluginSettings, usePluginSettings } from '../settingsStore';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import type { Point } from '../../lib/canvas/coords';
import { updateItems } from '../../state/commands';
import { importImageFiles } from '../../lib/import/importImages';
import { importVideoFiles } from '../../lib/import/importVideos';

/**
 * Stock media search across multiple providers. Each source is queried
 * independently; results interleave round-robin (each source's own relevance
 * order is preserved) so no provider dominates the grid. Imports download
 * the full asset and route through the normal file importers.
 *
 * Keys: Unsplash / Pexels / Pixabay need a (free) API key, entered in the
 * dialog and kept in localStorage. Wikimedia Commons and Openverse need
 * nothing — so search always works, keys just widen it.
 */

export type StockKind = 'photo' | 'video';

export interface StockResult {
  id: string;
  source: StockSourceId;
  kind: StockKind;
  thumbUrl: string;
  fullUrl: string;
  /** Poster for video results (thumb fallback). */
  posterUrl?: string;
  author: string;
  pageUrl: string;
  /** License text when the source reports one (e.g. "CC BY 2.0"). */
  license?: string;
}

export type StockSourceId = 'unsplash' | 'pexels' | 'pixabay' | 'wikimedia' | 'openverse';

export interface StockSourceMeta {
  id: StockSourceId;
  label: string;
  needsKey: boolean;
  keyHint?: string;
  video: boolean;
  /** Unchecked until the user ticks it in the dialog (slow or unreliable sources). */
  offByDefault?: boolean;
}

export const STOCK_SOURCES: StockSourceMeta[] = [
  {
    id: 'unsplash',
    label: 'Unsplash',
    needsKey: true,
    keyHint: 'unsplash.com/developers',
    video: false,
  },
  { id: 'pexels', label: 'Pexels', needsKey: true, keyHint: 'pexels.com/api', video: true },
  { id: 'pixabay', label: 'Pixabay', needsKey: true, keyHint: 'pixabay.com/api/docs', video: true },
  { id: 'wikimedia', label: 'Wikimedia Commons', needsKey: false, video: false },
  { id: 'openverse', label: 'Openverse', needsKey: false, video: false, offByDefault: true },
];

const SOURCES_PREF = 'boardcache:stockSources';

/** The sources ticked in the dialog: the user's saved choice, else every source not off by default. */
export function enabledStockSources(): StockSourceId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SOURCES_PREF) ?? 'null') as string[] | null;
    if (raw) return STOCK_SOURCES.filter((s) => raw.includes(s.id)).map((s) => s.id);
  } catch {
    /* storage unavailable */
  }
  return STOCK_SOURCES.filter((s) => !s.offByDefault).map((s) => s.id);
}

export function saveEnabledStockSources(ids: StockSourceId[]): void {
  try {
    localStorage.setItem(SOURCES_PREF, JSON.stringify(ids));
  } catch {
    /* storage unavailable */
  }
}

interface StockSettings {
  keys?: Record<string, string>;
}

export function loadStockKeys(): Record<string, string> {
  return getPluginSettings<StockSettings>('stock-photos')?.keys ?? {};
}
export function saveStockKey(source: string, key: string): void {
  usePluginSettings.getState().set('stock-photos', { keys: { ...loadStockKeys(), [source]: key } });
}

const PER_SOURCE = 16;

async function searchUnsplash(q: string, key: string, page: number): Promise<StockResult[]> {
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${PER_SOURCE}&page=${page}`,
    { headers: { Authorization: `Client-ID ${key}` } },
  );
  if (!res.ok) throw new Error(`Unsplash: ${res.status === 401 ? 'invalid API key' : res.status}`);
  const data = (await res.json()) as {
    results: {
      id: string;
      urls: { small: string; regular: string; full?: string };
      user: { name: string };
      links: { html: string; download_location?: string };
    }[];
  };
  return data.results.map((r) => ({
    id: `unsplash-${r.id}`,
    source: 'unsplash' as const,
    kind: 'photo' as const,
    thumbUrl: r.urls.small,
    fullUrl: r.urls.full ?? r.urls.regular,
    author: r.user.name,
    pageUrl: r.links.html,
  }));
}

async function searchPexels(
  q: string,
  key: string,
  kind: StockKind,
  page: number,
): Promise<StockResult[]> {
  const base =
    kind === 'video'
      ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${PER_SOURCE}&page=${page}`
      : `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${PER_SOURCE}&page=${page}`;
  const res = await fetch(base, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels: ${res.status === 401 ? 'invalid API key' : res.status}`);
  if (kind === 'video') {
    const data = (await res.json()) as {
      videos: {
        id: number;
        image: string;
        url: string;
        user: { name: string };
        video_files: { quality: string; file_type: string; link: string; width: number }[];
      }[];
    };
    return data.videos.map((v) => {
      const mp4s = v.video_files
        .filter((f) => f.file_type === 'video/mp4')
        .sort((a, b) => b.width - a.width); // largest first
      const mid = mp4s.find((f) => f.width <= 1920) ?? mp4s[mp4s.length - 1];
      return {
        id: `pexels-v-${v.id}`,
        source: 'pexels' as const,
        kind: 'video' as const,
        thumbUrl: v.image,
        posterUrl: v.image,
        fullUrl: mid?.link ?? '',
        author: v.user.name,
        pageUrl: v.url,
      };
    });
  }
  const data = (await res.json()) as {
    photos: {
      id: number;
      src: { medium: string; large2x: string; original?: string };
      photographer: string;
      url: string;
    }[];
  };
  return data.photos.map((p) => ({
    id: `pexels-${p.id}`,
    source: 'pexels' as const,
    kind: 'photo' as const,
    thumbUrl: p.src.medium,
    fullUrl: p.src.original ?? p.src.large2x,
    author: p.photographer,
    pageUrl: p.url,
  }));
}

async function searchPixabay(
  q: string,
  key: string,
  kind: StockKind,
  page: number,
): Promise<StockResult[]> {
  const base =
    kind === 'video'
      ? `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=${PER_SOURCE}&page=${page}`
      : `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=${PER_SOURCE}&page=${page}`;
  const res = await fetch(base);
  if (!res.ok) throw new Error(`Pixabay: ${res.status === 400 ? 'invalid API key' : res.status}`);
  if (kind === 'video') {
    const data = (await res.json()) as {
      hits: {
        id: number;
        pageURL: string;
        user: string;
        videos: Record<string, { url: string; thumbnail?: string }>;
      }[];
    };
    return data.hits.map((h) => {
      const variant = h.videos.large ?? h.videos.medium ?? h.videos.small ?? h.videos.tiny;
      const thumb = h.videos.tiny?.thumbnail ?? h.videos.small?.thumbnail ?? '';
      return {
        id: `pixabay-v-${h.id}`,
        source: 'pixabay' as const,
        kind: 'video' as const,
        thumbUrl: thumb,
        posterUrl: thumb,
        fullUrl: variant?.url ?? '',
        author: h.user,
        pageUrl: h.pageURL,
      };
    });
  }
  const data = (await res.json()) as {
    hits: {
      id: number;
      previewURL: string;
      webformatURL: string;
      largeImageURL: string;
      fullHDURL?: string;
      imageURL?: string;
      /** Original vector file (SVG/AI) for vector results, key access allowing. */
      vectorURL?: string;
      user: string;
      pageURL: string;
    }[];
  };
  return data.hits.map((h) => ({
    id: `pixabay-${h.id}`,
    source: 'pixabay' as const,
    kind: 'photo' as const,
    thumbUrl: h.webformatURL,
    // Vector originals beat any raster rendition (skip .ai — we can't place it).
    fullUrl:
      (h.vectorURL && !/\.ai($|\?)/i.test(h.vectorURL) ? h.vectorURL : undefined) ??
      h.imageURL ??
      h.fullHDURL ??
      h.largeImageURL,
    author: h.user,
    pageUrl: h.pageURL,
  }));
}

async function searchWikimedia(q: string, page: number): Promise<StockResult[]> {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
    `&generator=search&gsrsearch=filetype:bitmap|drawing ${encodeURIComponent(q)}` +
    `&gsrnamespace=6&gsrlimit=${PER_SOURCE}&gsroffset=${(page - 1) * PER_SOURCE}` +
    '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=480';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikimedia: ${res.status}`);
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          pageid: number;
          title: string;
          index?: number;
          imageinfo?: {
            thumburl?: string;
            url?: string;
            descriptionurl?: string;
            extmetadata?: { Artist?: { value?: string } };
          }[];
        }
      >;
    };
  };
  const pages = Object.values(data.query?.pages ?? {});
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages
    .filter((p) => p.imageinfo?.[0]?.thumburl && p.imageinfo[0].url)
    .map((p) => {
      const info = p.imageinfo![0]!;
      const artist = (info.extmetadata?.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim();
      return {
        id: `wikimedia-${p.pageid}`,
        source: 'wikimedia' as const,
        kind: 'photo' as const,
        thumbUrl: info.thumburl!,
        fullUrl: info.url!,
        author: artist || 'Wikimedia Commons',
        pageUrl: info.descriptionurl ?? info.url!,
      };
    });
}

async function searchOpenverse(q: string, page: number): Promise<StockResult[]> {
  const u = new URL('https://api.openverse.org/v1/images/');
  u.searchParams.set('q', q);
  u.searchParams.set('page_size', String(PER_SOURCE));
  u.searchParams.set('page', String(page));
  u.searchParams.set('category', 'photograph');
  u.searchParams.set('mature', 'false');
  const res = await fetch(u);
  if (!res.ok)
    throw new Error(
      `Openverse: ${res.status === 429 ? 'rate-limited, retry shortly' : res.status}`,
    );
  const data = (await res.json()) as {
    results: {
      id: string;
      url?: string;
      thumbnail?: string;
      creator?: string;
      license?: string;
      license_version?: string;
      foreign_landing_url?: string;
    }[];
  };
  return data.results
    .filter((r) => typeof r.url === 'string' && /^https:/.test(r.url))
    .map((r) => ({
      id: `openverse-${r.id}`,
      source: 'openverse' as const,
      kind: 'photo' as const,
      thumbUrl: r.thumbnail ?? r.url!,
      fullUrl: r.url!,
      author: r.creator || 'Openverse',
      pageUrl: r.foreign_landing_url ?? r.url!,
      ...(r.license
        ? {
            license: `CC ${r.license.toUpperCase()}${r.license_version ? ` ${r.license_version}` : ''}`,
          }
        : {}),
    }));
}

export interface StockSearchOutcome {
  results: StockResult[];
  /** Per-source error messages (bad key, network) shown in the sidebar. */
  errors: Partial<Record<StockSourceId, string>>;
  /** No source has more pages — infinite scroll can stop. */
  exhausted: boolean;
}

/** Interleave source lists round-robin so no provider dominates the grid. */
function interleave(lists: StockResult[][]): StockResult[] {
  const out: StockResult[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) if (list[i]) out.push(list[i]!);
  }
  return out;
}

export async function searchStock(
  query: string,
  kind: StockKind,
  sources: StockSourceId[],
  keys: Record<string, string>,
  page = 1,
): Promise<StockSearchOutcome> {
  const jobs: { id: StockSourceId; run: () => Promise<StockResult[]> }[] = [];
  for (const id of sources) {
    const meta = STOCK_SOURCES.find((s) => s.id === id);
    if (!meta) continue;
    if (kind === 'video' && !meta.video) continue;
    const key = (keys[id] ?? '').trim();
    if (meta.needsKey && !key) continue;
    if (id === 'unsplash') jobs.push({ id, run: () => searchUnsplash(query, key, page) });
    else if (id === 'pexels') jobs.push({ id, run: () => searchPexels(query, key, kind, page) });
    else if (id === 'pixabay') jobs.push({ id, run: () => searchPixabay(query, key, kind, page) });
    else if (id === 'wikimedia') jobs.push({ id, run: () => searchWikimedia(query, page) });
    else if (id === 'openverse') jobs.push({ id, run: () => searchOpenverse(query, page) });
  }
  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  const lists: StockResult[][] = [];
  const errors: StockSearchOutcome['errors'] = {};
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') lists.push(s.value);
    else errors[jobs[i]!.id] = s.reason instanceof Error ? s.reason.message : 'Search failed';
  });
  // A full page from any source suggests it has more; all-short means done.
  const exhausted = lists.every((l) => l.length < PER_SOURCE);
  return { results: interleave(lists), errors, exhausted };
}

/** The sources usable right now: keyless ones plus any with a key entered. */
/**
 * Sources the assistant searches: every keyless source plus keyed ones with a
 * key, minus those off by default unless the user ticked them in the dialog.
 */
export function availablePhotoSources(): StockSourceId[] {
  const keys = loadStockKeys();
  const ticked = enabledStockSources();
  return STOCK_SOURCES.filter(
    (s) => (!s.needsKey || (keys[s.id] ?? '').trim()) && (!s.offByDefault || ticked.includes(s.id)),
  ).map((s) => s.id);
}

/** Download the full asset and add it to the canvas as a normal item. */
export async function importStockResult(result: StockResult, at?: Point): Promise<string[]> {
  const res = await fetch(result.fullUrl);
  if (!res.ok) throw new Error('Download failed.');
  const blob = await res.blob();
  at ??= clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const label = `${result.author} — ${result.source}`;
  let ids: string[];
  if (result.kind === 'video') {
    const file = new File([blob], `${label}.mp4`, { type: blob.type || 'video/mp4' });
    ids = await importVideoFiles([file], at);
  } else {
    const ext = blob.type.includes('svg')
      ? 'svg'
      : blob.type.includes('png')
        ? 'png'
        : blob.type.includes('webp')
          ? 'webp'
          : blob.type.includes('gif')
            ? 'gif'
            : 'jpg';
    const file = new File([blob], `${label}.${ext}`, { type: blob.type || 'image/jpeg' });
    ids = await importImageFiles([file], at);
  }
  // Attribution: the item's link points back at the source's media page,
  // and the notes carry the credit line.
  if (ids.length) {
    updateItems(ids, 'Stock source link', (d) => {
      if (result.pageUrl) d.linkUrl = result.pageUrl;
      d.notes = [`Photo: ${result.author}`, result.license, result.pageUrl]
        .filter(Boolean)
        .join(' · ');
    });
  }
  return ids;
}
