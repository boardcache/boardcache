import { platform } from '../../lib/platform';
import { getPluginSettings, usePluginSettings } from '../settingsStore';

/**
 * Research providers: one adapter per source, each a URL builder and a pure
 * parser over the provider's JSON (or Atom), normalised to ResearchResult.
 * Keys live in this plugin's settings (device-local, in encrypted settings
 * sync). Requests go through platform.httpFetch: the desktop shell on the
 * desktop (no CORS), the browser's fetch on the web — where providers that
 * refuse cross-origin calls are reported as desktop-only.
 */

export type ProviderKind = 'web' | 'news' | 'papers' | 'collections' | 'books' | 'social';

export interface ResearchResult {
  title: string;
  url: string;
  snippet?: string;
  date?: string;
  author?: string;
  /** Publisher, repository, museum, instance. */
  site?: string;
  image?: string;
  license?: string;
  /** Provider-specific extras worth keeping (DOI, citations, identifiers). */
  extra?: Record<string, string | number>;
}

export interface SearchOutcome {
  source: ProviderId;
  results: ResearchResult[];
  note?: string;
}

export interface SearchOptions {
  count: number;
  /** YYYY-MM-DD bounds where the provider supports them. */
  from?: string;
  to?: string;
  /** Only results with an image (collections). */
  imagesOnly?: boolean;
}

export interface ProviderSpec {
  id: ProviderId;
  kind: ProviderKind;
  label: string;
  needsKey: boolean;
  keyHint?: string;
  keyUrl?: string;
  /** The API accepts browser cross-origin calls; otherwise desktop only. */
  corsSafe: boolean;
  blurb: string;
}

export type ProviderId =
  | 'brave'
  | 'tavily'
  | 'perplexity'
  | 'guardian'
  | 'nyt'
  | 'gdelt'
  | 'openalex'
  | 'semanticscholar'
  | 'crossref'
  | 'arxiv'
  | 'pubmed'
  | 'smithsonian'
  | 'europeana'
  | 'met'
  | 'loc'
  | 'trove'
  | 'googlebooks'
  | 'archive'
  | 'openlibrary'
  | 'x'
  | 'bluesky'
  | 'reddit';

export const PROVIDERS: ProviderSpec[] = [
  {
    id: 'perplexity',
    kind: 'web',
    label: 'Perplexity Search',
    needsKey: true,
    keyHint: 'API key',
    keyUrl: 'https://www.perplexity.ai/settings/api',
    corsSafe: false,
    blurb: 'Web search with snippets and dates; domain filters.',
  },
  {
    id: 'brave',
    kind: 'web',
    label: 'Brave Search',
    needsKey: true,
    keyHint: 'subscription token',
    keyUrl: 'https://brave.com/search/api/',
    corsSafe: false,
    blurb: 'Independent web index; free tier.',
  },
  {
    id: 'tavily',
    kind: 'web',
    label: 'Tavily',
    needsKey: true,
    keyHint: 'API key',
    keyUrl: 'https://tavily.com',
    corsSafe: false,
    blurb: 'Search tuned for agents; page content in results.',
  },
  {
    id: 'guardian',
    kind: 'news',
    label: 'The Guardian',
    needsKey: true,
    keyHint: 'developer key (free)',
    keyUrl: 'https://open-platform.theguardian.com/access/',
    corsSafe: true,
    blurb: 'Full article text since 1999.',
  },
  {
    id: 'nyt',
    kind: 'news',
    label: 'The New York Times',
    needsKey: true,
    keyHint: 'API key (free)',
    keyUrl: 'https://developer.nytimes.com/',
    corsSafe: true,
    blurb: 'Article search with abstracts back to 1851.',
  },
  {
    id: 'gdelt',
    kind: 'news',
    label: 'GDELT',
    needsKey: false,
    corsSafe: true,
    blurb: 'World news monitoring, last few months; no key.',
  },
  {
    id: 'openalex',
    kind: 'papers',
    label: 'OpenAlex',
    needsKey: false,
    corsSafe: true,
    blurb: 'Scholarly works with abstracts and citations; no key.',
  },
  {
    id: 'semanticscholar',
    kind: 'papers',
    label: 'Semantic Scholar',
    needsKey: false,
    keyHint: 'API key (optional, raises limits)',
    keyUrl: 'https://www.semanticscholar.org/product/api',
    corsSafe: true,
    blurb: 'Papers with abstracts and open-access PDFs.',
  },
  {
    id: 'crossref',
    kind: 'papers',
    label: 'CrossRef',
    needsKey: false,
    corsSafe: true,
    blurb: 'DOI metadata for journal articles; no key.',
  },
  {
    id: 'arxiv',
    kind: 'papers',
    label: 'arXiv',
    needsKey: false,
    corsSafe: false,
    blurb: 'Preprints in physics, maths, CS and more; no key.',
  },
  {
    id: 'pubmed',
    kind: 'papers',
    label: 'PubMed',
    needsKey: false,
    keyHint: 'NCBI key (optional)',
    keyUrl: 'https://www.ncbi.nlm.nih.gov/account/settings/',
    corsSafe: true,
    blurb: 'Biomedical literature.',
  },
  {
    id: 'smithsonian',
    kind: 'collections',
    label: 'Smithsonian Open Access',
    needsKey: true,
    keyHint: 'api.data.gov key (free)',
    keyUrl: 'https://api.data.gov/signup/',
    corsSafe: true,
    blurb: 'Millions of CC0 images and records.',
  },
  {
    id: 'europeana',
    kind: 'collections',
    label: 'Europeana',
    needsKey: true,
    keyHint: 'API key (free)',
    keyUrl: 'https://pro.europeana.eu/page/get-api',
    corsSafe: true,
    blurb: 'European museums, libraries and archives.',
  },
  {
    id: 'met',
    kind: 'collections',
    label: 'The Met',
    needsKey: false,
    corsSafe: true,
    blurb: 'The Metropolitan Museum of Art, public-domain images; no key.',
  },
  {
    id: 'loc',
    kind: 'collections',
    label: 'Library of Congress',
    needsKey: false,
    corsSafe: false,
    blurb: 'Digitised newspapers, photographs, maps; no key.',
  },
  {
    id: 'trove',
    kind: 'collections',
    label: 'Trove',
    needsKey: true,
    keyHint: 'API key (free)',
    keyUrl: 'https://trove.nla.gov.au/about/create-something/using-api',
    corsSafe: false,
    blurb: 'Australian newspapers and collections.',
  },
  {
    id: 'googlebooks',
    kind: 'books',
    label: 'Google Books',
    needsKey: true,
    keyHint: 'API key',
    keyUrl: 'https://console.cloud.google.com/apis/library/books.googleapis.com',
    corsSafe: true,
    blurb: 'Book metadata and snippets.',
  },
  {
    id: 'archive',
    kind: 'books',
    label: 'Internet Archive',
    needsKey: false,
    corsSafe: true,
    blurb: 'Scanned books and documents; no key.',
  },
  {
    id: 'openlibrary',
    kind: 'books',
    label: 'Open Library',
    needsKey: false,
    corsSafe: true,
    blurb: 'Book records and editions; no key.',
  },
  {
    id: 'x',
    kind: 'social',
    label: 'X',
    needsKey: true,
    keyHint: 'bearer token (paid tier for search)',
    keyUrl: 'https://developer.x.com/',
    corsSafe: false,
    blurb: 'Recent posts, last 7 days.',
  },
  {
    id: 'bluesky',
    kind: 'social',
    label: 'Bluesky',
    needsKey: false,
    corsSafe: true,
    blurb: 'Public posts; no key.',
  },
  {
    id: 'reddit',
    kind: 'social',
    label: 'Reddit',
    needsKey: false,
    corsSafe: false,
    blurb: 'Posts and threads, public search; best effort.',
  },
];

const byId = new Map(PROVIDERS.map((p) => [p.id, p]));
export const providerSpec = (id: ProviderId): ProviderSpec => byId.get(id)!;

// ---- settings ----------------------------------------------------------------------

export const PLUGIN_ID = 'research';
interface ResearchSettings {
  keys?: Partial<Record<ProviderId, string>>;
  /** Contact for "polite pool" APIs (OpenAlex, CrossRef); optional. */
  mailto?: string;
}
export function loadKeys(): Partial<Record<ProviderId, string>> {
  return getPluginSettings<ResearchSettings>(PLUGIN_ID)?.keys ?? {};
}
export function loadMailto(): string {
  return getPluginSettings<ResearchSettings>(PLUGIN_ID)?.mailto ?? '';
}
export function saveKey(id: ProviderId, key: string): void {
  const cur = getPluginSettings<ResearchSettings>(PLUGIN_ID) ?? {};
  usePluginSettings
    .getState()
    .set(PLUGIN_ID, { ...cur, keys: { ...loadKeys(), [id]: key.trim() } });
}
export function saveMailto(mailto: string): void {
  const cur = getPluginSettings<ResearchSettings>(PLUGIN_ID) ?? {};
  usePluginSettings.getState().set(PLUGIN_ID, { ...cur, mailto: mailto.trim() });
}

/** Whether a provider can run here: key present when needed, CORS-safe or on the desktop. */
export function providerStatus(id: ProviderId): { available: boolean; reason?: string } {
  const spec = providerSpec(id);
  const key = loadKeys()[id];
  if (spec.needsKey && !key)
    return { available: false, reason: 'needs an API key (Settings → Plugins → Research)' };
  if (!spec.corsSafe && !platform.hasHttpBridge)
    return {
      available: false,
      reason: 'desktop app only (the API refuses browser cross-origin calls)',
    };
  return { available: true };
}

export function availableProviders(kind: ProviderKind): ProviderId[] {
  return PROVIDERS.filter((p) => p.kind === kind && providerStatus(p.id).available).map(
    (p) => p.id,
  );
}

// ---- transport ----------------------------------------------------------------------

async function http(
  label: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<string> {
  const res = await platform.httpFetch(url, init);
  if (res.status === 401 || res.status === 403)
    throw new Error(`${label}: the API key was rejected (${res.status}).`);
  if (res.status === 429) throw new Error(`${label}: rate limited (429); try again in a moment.`);
  if (res.status < 200 || res.status >= 300) throw new Error(`${label}: HTTP ${res.status}.`);
  return res.body;
}
async function json<T>(
  label: string,
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<T> {
  const text = await http(label, url, init);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label}: the response was not JSON.`);
  }
}
const q = (s: string) => encodeURIComponent(s);
const clip = (s: string | undefined | null, n = 400) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const stripTags = (s: string | undefined | null) => (s ?? '').replace(/<[^>]+>/g, ' ');
const ymd = (s: string | undefined) => (s ? s.replace(/-/g, '') : undefined);

// ---- parsers (pure; unit-tested) -------------------------------------------------------

type J = Record<string, unknown>;
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const obj = (v: unknown): J => (v && typeof v === 'object' ? (v as J) : {});

export const parse = {
  perplexity(data: J): ResearchResult[] {
    return arr(data.results).map((r) => ({
      title: str(r.title) || str(r.url),
      url: str(r.url),
      snippet: clip(str(r.snippet)),
      ...(str(r.date) ? { date: str(r.date) } : {}),
    }));
  },
  brave(data: J): ResearchResult[] {
    return arr(obj(data.web).results).map((r) => ({
      title: str(r.title),
      url: str(r.url),
      snippet: clip(stripTags(str(r.description))),
      ...(str(r.page_age) ? { date: str(r.page_age).slice(0, 10) } : {}),
      ...(str(obj(r.profile).name) ? { site: str(obj(r.profile).name) } : {}),
    }));
  },
  tavily(data: J): ResearchResult[] {
    return arr(data.results).map((r) => ({
      title: str(r.title),
      url: str(r.url),
      snippet: clip(str(r.content), 500),
      ...(str(r.published_date) ? { date: str(r.published_date).slice(0, 10) } : {}),
    }));
  },
  guardian(data: J): ResearchResult[] {
    return arr(obj(data.response).results).map((r) => {
      const f = obj(r.fields);
      return {
        title: str(r.webTitle),
        url: str(r.webUrl),
        snippet: clip(stripTags(str(f.trailText)) || clip(str(f.bodyText), 600), 600),
        date: str(r.webPublicationDate).slice(0, 10),
        ...(str(f.byline) ? { author: str(f.byline) } : {}),
        site: `The Guardian · ${str(r.sectionName)}`,
      };
    });
  },
  nyt(data: J): ResearchResult[] {
    return arr(obj(data.response).docs).map((d) => ({
      title: str(obj(d.headline).main),
      url: str(d.web_url),
      snippet: clip(str(d.abstract) || str(d.snippet) || str(d.lead_paragraph), 600),
      date: str(d.pub_date).slice(0, 10),
      ...(str(obj(d.byline).original)
        ? { author: str(obj(d.byline).original).replace(/^By /, '') }
        : {}),
      site: `The New York Times · ${str(d.section_name)}`,
    }));
  },
  gdelt(data: J): ResearchResult[] {
    return arr(data.articles).map((a) => {
      const seen = str(a.seendate); // 20240101T120000Z
      return {
        title: str(a.title),
        url: str(a.url),
        ...(seen ? { date: `${seen.slice(0, 4)}-${seen.slice(4, 6)}-${seen.slice(6, 8)}` } : {}),
        site: str(a.domain),
        ...(str(a.socialimage) ? { image: str(a.socialimage) } : {}),
        extra: { language: str(a.language), country: str(a.sourcecountry) },
      };
    });
  },
  /** OpenAlex stores abstracts as word → positions; rebuild the text. */
  openalexAbstract(inverted: unknown): string {
    const idx = obj(inverted);
    const words: string[] = [];
    for (const [word, positions] of Object.entries(idx)) {
      for (const pos of Array.isArray(positions) ? (positions as number[]) : []) words[pos] = word;
    }
    return words.filter(Boolean).join(' ');
  },
  openalex(data: J): ResearchResult[] {
    return arr(data.results).map((w) => {
      const loc = obj(w.primary_location);
      const oa = obj(w.open_access);
      return {
        title: str(w.display_name) || str(w.title),
        url: str(oa.oa_url) || str(loc.landing_page_url) || str(w.doi) || str(w.id),
        snippet: clip(parse.openalexAbstract(w.abstract_inverted_index), 600),
        ...(w.publication_year ? { date: String(w.publication_year) } : {}),
        author: arr(w.authorships)
          .slice(0, 4)
          .map((a) => str(obj(a.author).display_name))
          .filter(Boolean)
          .join(', '),
        ...(str(obj(loc.source).display_name) ? { site: str(obj(loc.source).display_name) } : {}),
        extra: { doi: str(w.doi), citations: Number(w.cited_by_count ?? 0) },
      };
    });
  },
  semanticscholar(data: J): ResearchResult[] {
    return arr(data.data).map((p) => ({
      title: str(p.title),
      url: str(obj(p.openAccessPdf).url) || str(p.url),
      snippet: clip(str(p.abstract), 600),
      ...(p.year ? { date: String(p.year) } : {}),
      author: arr(p.authors)
        .slice(0, 4)
        .map((a) => str(a.name))
        .join(', '),
      ...(str(p.venue) ? { site: str(p.venue) } : {}),
      extra: { doi: str(obj(p.externalIds).DOI), citations: Number(p.citationCount ?? 0) },
    }));
  },
  crossref(data: J): ResearchResult[] {
    return arr(obj(data.message).items).map((it) => {
      const parts = arr(obj(obj(it.issued)['date-parts'])[0] as unknown) as unknown as number[];
      const year = Array.isArray(obj(it.issued)['date-parts'])
        ? (obj(it.issued)['date-parts'] as number[][])[0]?.[0]
        : undefined;
      void parts;
      return {
        title: arr(it.title).length ? str((it.title as unknown[])[0]) : str(it.title),
        url: str(it.URL),
        ...(str(it.abstract) ? { snippet: clip(stripTags(str(it.abstract)), 600) } : {}),
        ...(year ? { date: String(year) } : {}),
        author: arr(it.author)
          .slice(0, 4)
          .map((a) => `${str(a.given)} ${str(a.family)}`.trim())
          .join(', '),
        ...(arr(it['container-title']).length
          ? { site: str((it['container-title'] as unknown[])[0]) }
          : {}),
        extra: { doi: str(it.DOI) },
      };
    });
  },
  /** arXiv answers in Atom; a small tag scan keeps this free of the DOM. */
  arxiv(xml: string): ResearchResult[] {
    const tag = (src: string, name: string): string =>
      (src.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
    return Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)).map((m) => {
      const e = m[1]!;
      const authors = Array.from(e.matchAll(/<author>([\s\S]*?)<\/author>/g)).map((a) =>
        tag(a[1]!, 'name'),
      );
      return {
        title: tag(e, 'title').replace(/\s+/g, ' '),
        url: tag(e, 'id'),
        snippet: clip(tag(e, 'summary'), 600),
        date: tag(e, 'published').slice(0, 10),
        author: authors.slice(0, 4).join(', '),
        site: 'arXiv',
      };
    });
  },
  pubmed(summary: J, ids: string[]): ResearchResult[] {
    const result = obj(summary.result);
    return ids
      .map((id) => obj(result[id]))
      .filter((r) => str(r.title))
      .map((r) => ({
        title: str(r.title),
        url: `https://pubmed.ncbi.nlm.nih.gov/${str(r.uid)}/`,
        date: str(r.pubdate),
        author: arr(r.authors)
          .slice(0, 4)
          .map((a) => str(a.name))
          .join(', '),
        site: str(r.source),
        extra: { pmid: str(r.uid) },
      }));
  },
  smithsonian(data: J): ResearchResult[] {
    return arr(obj(data.response).rows).map((row) => {
      const content = obj(row.content);
      const dnr = obj(content.descriptiveNonRepeating);
      const media = arr(obj(dnr.online_media).media)[0];
      const free = obj(content.freetext);
      const first = (k: string) => str(obj(arr(free[k])[0]).content);
      const usage = media ? str(obj(media.usage).access) : '';
      return {
        title: str(row.title),
        url: str(dnr.record_link) || `https://collections.si.edu/search/detail/${str(row.id)}`,
        ...(first('notes') ? { snippet: clip(first('notes'), 400) } : {}),
        ...(first('date') ? { date: first('date') } : {}),
        ...(first('name') ? { author: first('name') } : {}),
        site: str(dnr.data_source) || 'Smithsonian',
        ...(media && str(media.content) ? { image: str(media.content) } : {}),
        ...(usage ? { license: usage } : {}),
        extra: { id: str(row.id) },
      };
    });
  },
  europeana(data: J): ResearchResult[] {
    return arr(data.items).map((it) => ({
      title:
        str(arr(it.title as unknown)[0] as unknown) || str((it.title as string[] | undefined)?.[0]),
      url: str(it.guid),
      ...(arr(it.dcDescription as unknown).length
        ? { snippet: clip(str((it.dcDescription as string[])[0]), 400) }
        : {}),
      ...(Array.isArray(it.year) && (it.year as string[])[0]
        ? { date: String((it.year as string[])[0]) }
        : {}),
      ...(Array.isArray(it.dcCreator) && (it.dcCreator as string[])[0]
        ? { author: String((it.dcCreator as string[])[0]) }
        : {}),
      site: Array.isArray(it.dataProvider) ? String((it.dataProvider as string[])[0]) : 'Europeana',
      ...(Array.isArray(it.edmIsShownBy) && (it.edmIsShownBy as string[])[0]
        ? { image: String((it.edmIsShownBy as string[])[0]) }
        : Array.isArray(it.edmPreview) && (it.edmPreview as string[])[0]
          ? { image: String((it.edmPreview as string[])[0]) }
          : {}),
      ...(Array.isArray(it.rights) && (it.rights as string[])[0]
        ? { license: String((it.rights as string[])[0]) }
        : {}),
    }));
  },
  metObject(o: J): ResearchResult {
    return {
      title: str(o.title),
      url: str(o.objectURL),
      ...(str(o.objectDate) ? { date: str(o.objectDate) } : {}),
      ...(str(o.artistDisplayName) ? { author: str(o.artistDisplayName) } : {}),
      site: `The Met · ${str(o.department)}`,
      ...(str(o.primaryImageSmall) ? { image: str(o.primaryImageSmall) } : {}),
      license: o.isPublicDomain ? 'Public domain (CC0)' : 'Rights reserved',
      extra: { id: Number(o.objectID ?? 0), medium: str(o.medium) },
    };
  },
  loc(data: J): ResearchResult[] {
    return arr(data.results).map((r) => {
      const partof = Array.isArray(r.partof_title) ? String((r.partof_title as string[])[0]) : '';
      const images = Array.isArray(r.image_url) ? (r.image_url as string[]) : [];
      const desc = Array.isArray(r.description)
        ? String((r.description as string[])[0])
        : str(r.description);
      return {
        title: str(r.title) || partof,
        url: str(r.id) || str(r.url),
        ...(desc ? { snippet: clip(desc, 400) } : {}),
        ...(str(r.date) ? { date: str(r.date) } : {}),
        site: partof || 'Library of Congress',
        ...(images.length ? { image: images[images.length - 1]! } : {}),
        license: 'See rights on the item page (most pre-1929 material is public domain)',
      };
    });
  },
  trove(data: J): ResearchResult[] {
    const out: ResearchResult[] = [];
    for (const cat of arr(data.category)) {
      for (const a of arr(obj(cat.records).article)) {
        out.push({
          title: str(a.heading),
          url: str(a.troveUrl) || str(a.url),
          ...(str(a.snippet) ? { snippet: clip(stripTags(str(a.snippet)), 400) } : {}),
          ...(str(a.date) ? { date: str(a.date) } : {}),
          site: str(obj(a.title).title) || 'Trove',
          license: 'Australian newspapers; most pre-1955 pages are public domain',
        });
      }
    }
    return out;
  },
  googlebooks(data: J): ResearchResult[] {
    return arr(data.items).map((it) => {
      const v = obj(it.volumeInfo);
      const si = obj(it.searchInfo);
      return {
        title: str(v.title) + (str(v.subtitle) ? `: ${str(v.subtitle)}` : ''),
        url: str(v.infoLink) || str(v.canonicalVolumeLink),
        snippet: clip(stripTags(str(si.textSnippet)) || str(v.description), 500),
        ...(str(v.publishedDate) ? { date: str(v.publishedDate) } : {}),
        author: arr(v.authors as unknown).length
          ? (v.authors as string[]).slice(0, 3).join(', ')
          : '',
        ...(str(v.publisher) ? { site: str(v.publisher) } : {}),
        ...(str(obj(v.imageLinks).thumbnail) ? { image: str(obj(v.imageLinks).thumbnail) } : {}),
      };
    });
  },
  archive(data: J): ResearchResult[] {
    return arr(obj(data.response).docs).map((d) => ({
      title: str(d.title),
      url: `https://archive.org/details/${str(d.identifier)}`,
      ...(str(d.description)
        ? {
            snippet: clip(
              Array.isArray(d.description)
                ? String((d.description as string[])[0])
                : str(d.description),
              400,
            ),
          }
        : {}),
      ...(d.year ? { date: String(d.year) } : {}),
      ...(d.creator
        ? {
            author: Array.isArray(d.creator)
              ? (d.creator as string[]).slice(0, 3).join(', ')
              : str(d.creator),
          }
        : {}),
      site: 'Internet Archive',
      image: `https://archive.org/services/img/${str(d.identifier)}`,
      extra: { identifier: str(d.identifier), mediatype: str(d.mediatype) },
    }));
  },
  openlibrary(data: J): ResearchResult[] {
    return arr(data.docs).map((d) => ({
      title: str(d.title),
      url: `https://openlibrary.org${str(d.key)}`,
      ...(d.first_publish_year ? { date: String(d.first_publish_year) } : {}),
      ...(Array.isArray(d.author_name)
        ? { author: (d.author_name as string[]).slice(0, 3).join(', ') }
        : {}),
      site: 'Open Library',
      ...(d.cover_i
        ? { image: `https://covers.openlibrary.org/b/id/${String(d.cover_i)}-M.jpg` }
        : {}),
      extra: { editions: Number(d.edition_count ?? 0) },
    }));
  },
  x(data: J): ResearchResult[] {
    const users = new Map(arr(obj(data.includes).users).map((u) => [str(u.id), u]));
    return arr(data.data).map((t) => {
      const u = users.get(str(t.author_id));
      const handle = u ? str(u.username) : str(t.author_id);
      const m = obj(t.public_metrics);
      return {
        title: clip(str(t.text), 120),
        url: `https://x.com/${handle}/status/${str(t.id)}`,
        snippet: clip(str(t.text), 600),
        date: str(t.created_at).slice(0, 10),
        author: u ? `${str(u.name)} (@${handle})` : `@${handle}`,
        site: 'X',
        extra: { likes: Number(m.like_count ?? 0), reposts: Number(m.retweet_count ?? 0) },
      };
    });
  },
  bluesky(data: J): ResearchResult[] {
    return arr(data.posts).map((p) => {
      const a = obj(p.author);
      const rec = obj(p.record);
      const rkey = str(p.uri).split('/').pop() ?? '';
      return {
        title: clip(str(rec.text), 120),
        url: `https://bsky.app/profile/${str(a.handle)}/post/${rkey}`,
        snippet: clip(str(rec.text), 600),
        date: str(rec.createdAt).slice(0, 10),
        author: `${str(a.displayName)} (@${str(a.handle)})`.trim(),
        site: 'Bluesky',
        extra: { likes: Number(p.likeCount ?? 0), reposts: Number(p.repostCount ?? 0) },
      };
    });
  },
  reddit(data: J): ResearchResult[] {
    return arr(obj(data.data).children).map((c) => {
      const d = obj(c.data);
      const created = Number(d.created_utc ?? 0);
      return {
        title: str(d.title),
        url: `https://www.reddit.com${str(d.permalink)}`,
        ...(str(d.selftext) ? { snippet: clip(str(d.selftext), 500) } : {}),
        ...(created ? { date: new Date(created * 1000).toISOString().slice(0, 10) } : {}),
        author: `u/${str(d.author)}`,
        site: `r/${str(d.subreddit)}`,
        extra: { score: Number(d.score ?? 0), comments: Number(d.num_comments ?? 0) },
      };
    });
  },
};

// ---- adapters ----------------------------------------------------------------------------

type Adapter = (query: string, o: SearchOptions, key: string) => Promise<SearchOutcome>;

const ADAPTERS: Record<ProviderId, Adapter> = {
  async perplexity(query, o, key) {
    const data = await json<J>('Perplexity', 'https://api.perplexity.ai/search', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, max_results: Math.min(20, o.count) }),
    });
    return { source: 'perplexity', results: parse.perplexity(data) };
  },
  async brave(query, o, key) {
    const data = await json<J>(
      'Brave',
      `https://api.search.brave.com/res/v1/web/search?q=${q(query)}&count=${Math.min(20, o.count)}`,
      {
        headers: { 'X-Subscription-Token': key, accept: 'application/json' },
      },
    );
    return { source: 'brave', results: parse.brave(data) };
  },
  async tavily(query, o, key) {
    const data = await json<J>('Tavily', 'https://api.tavily.com/search', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, max_results: Math.min(20, o.count), include_answer: false }),
    });
    return { source: 'tavily', results: parse.tavily(data) };
  },
  async guardian(query, o, key) {
    const params = [
      `q=${q(query)}`,
      `api-key=${q(key)}`,
      'show-fields=trailText,byline,bodyText',
      `page-size=${Math.min(50, o.count)}`,
      'order-by=relevance',
    ];
    if (o.from) params.push(`from-date=${o.from}`);
    if (o.to) params.push(`to-date=${o.to}`);
    const data = await json<J>(
      'The Guardian',
      `https://content.guardianapis.com/search?${params.join('&')}`,
    );
    return { source: 'guardian', results: parse.guardian(data) };
  },
  async nyt(query, o, key) {
    const params = [`q=${q(query)}`, `api-key=${q(key)}`, 'sort=relevance'];
    if (o.from) params.push(`begin_date=${ymd(o.from)}`);
    if (o.to) params.push(`end_date=${ymd(o.to)}`);
    const data = await json<J>(
      'The New York Times',
      `https://api.nytimes.com/svc/search/v2/articlesearch.json?${params.join('&')}`,
    );
    return {
      source: 'nyt',
      results: parse.nyt(data).slice(0, o.count),
      note: 'The NYT API returns 10 per page.',
    };
  },
  async gdelt(query, o) {
    const params = [
      `query=${q(query)}`,
      'mode=artlist',
      'format=json',
      `maxrecords=${Math.min(75, o.count)}`,
      'sort=hybridrel',
    ];
    if (o.from) params.push(`startdatetime=${ymd(o.from)}000000`);
    if (o.to) params.push(`enddatetime=${ymd(o.to)}235959`);
    const data = await json<J>(
      'GDELT',
      `https://api.gdeltproject.org/api/v2/doc/doc?${params.join('&')}`,
    );
    return {
      source: 'gdelt',
      results: parse.gdelt(data),
      note: 'GDELT indexes world news from the last few months; titles and links only.',
    };
  },
  async openalex(query, o) {
    const mailto = loadMailto();
    const filter =
      o.from || o.to
        ? `&filter=${[o.from ? `from_publication_date:${o.from}` : '', o.to ? `to_publication_date:${o.to}` : ''].filter(Boolean).join(',')}`
        : '';
    const data = await json<J>(
      'OpenAlex',
      `https://api.openalex.org/works?search=${q(query)}&per-page=${Math.min(50, o.count)}${filter}${mailto ? `&mailto=${q(mailto)}` : ''}`,
    );
    return { source: 'openalex', results: parse.openalex(data) };
  },
  async semanticscholar(query, o, key) {
    const data = await json<J>(
      'Semantic Scholar',
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${q(query)}&limit=${Math.min(100, o.count)}&fields=title,abstract,year,authors,url,venue,citationCount,externalIds,openAccessPdf`,
      key ? { headers: { 'x-api-key': key } } : {},
    );
    return { source: 'semanticscholar', results: parse.semanticscholar(data) };
  },
  async crossref(query, o) {
    const mailto = loadMailto();
    const data = await json<J>(
      'CrossRef',
      `https://api.crossref.org/works?query=${q(query)}&rows=${Math.min(50, o.count)}${mailto ? `&mailto=${q(mailto)}` : ''}`,
    );
    return { source: 'crossref', results: parse.crossref(data) };
  },
  async arxiv(query, o) {
    const xml = await http(
      'arXiv',
      `https://export.arxiv.org/api/query?search_query=all:${q(query)}&max_results=${Math.min(50, o.count)}`,
    );
    return { source: 'arxiv', results: parse.arxiv(xml) };
  },
  async pubmed(query, o, key) {
    const k = key ? `&api_key=${q(key)}` : '';
    const search = await json<J>(
      'PubMed',
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${q(query)}&retmax=${Math.min(50, o.count)}&retmode=json${k}`,
    );
    const ids = (obj(search.esearchresult).idlist as string[] | undefined) ?? [];
    if (!ids.length) return { source: 'pubmed', results: [] };
    const summary = await json<J>(
      'PubMed',
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json${k}`,
    );
    return { source: 'pubmed', results: parse.pubmed(summary, ids) };
  },
  async smithsonian(query, o, key) {
    const fq = o.imagesOnly ? '&fq=online_media_type:Images&fq=media_usage:CC0' : '';
    const data = await json<J>(
      'Smithsonian',
      `https://api.si.edu/openaccess/api/v1.0/search?q=${q(query)}&rows=${Math.min(100, o.count)}${fq}&api_key=${q(key)}`,
    );
    return { source: 'smithsonian', results: parse.smithsonian(data) };
  },
  async europeana(query, o, key) {
    const media = o.imagesOnly ? '&media=true&reusability=open&qf=TYPE:IMAGE' : '';
    const data = await json<J>(
      'Europeana',
      `https://api.europeana.eu/record/v2/search.json?wskey=${q(key)}&query=${q(query)}&rows=${Math.min(100, o.count)}&profile=rich${media}`,
    );
    return { source: 'europeana', results: parse.europeana(data) };
  },
  async met(query, o) {
    const ids = await json<J>(
      'The Met',
      `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${q(query)}${o.imagesOnly ? '&hasImages=true' : ''}`,
    );
    const list = ((ids.objectIDs as number[] | null) ?? []).slice(0, Math.min(8, o.count));
    const objects = await Promise.all(
      list.map((id) =>
        json<J>(
          'The Met',
          `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
        ).catch(() => null),
      ),
    );
    return {
      source: 'met',
      results: objects.filter((x): x is J => !!x).map(parse.metObject),
      note: `${Number(ids.total ?? 0)} objects match; showing up to ${list.length}.`,
    };
  },
  async loc(query, o) {
    const data = await json<J>(
      'Library of Congress',
      `https://www.loc.gov/search/?q=${q(query)}&fo=json&c=${Math.min(50, o.count)}${o.imagesOnly ? '&fa=online-format:image' : ''}`,
    );
    return { source: 'loc', results: parse.loc(data) };
  },
  async trove(query, o, key) {
    const data = await json<J>(
      'Trove',
      `https://api.trove.nla.gov.au/v3/result?category=newspaper&q=${q(query)}&n=${Math.min(100, o.count)}&encoding=json&include=articletext`,
      { headers: { 'X-API-KEY': key, accept: 'application/json' } },
    );
    return { source: 'trove', results: parse.trove(data) };
  },
  async googlebooks(query, o, key) {
    const data = await json<J>(
      'Google Books',
      `https://www.googleapis.com/books/v1/volumes?q=${q(query)}&maxResults=${Math.min(40, o.count)}&printType=books&key=${q(key)}`,
    );
    return { source: 'googlebooks', results: parse.googlebooks(data) };
  },
  async archive(query, o) {
    const data = await json<J>(
      'Internet Archive',
      `https://archive.org/advancedsearch.php?q=${q(query)}+AND+mediatype%3Atexts&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&fl%5B%5D=description&fl%5B%5D=mediatype&rows=${Math.min(50, o.count)}&output=json`,
    );
    return { source: 'archive', results: parse.archive(data) };
  },
  async openlibrary(query, o) {
    const data = await json<J>(
      'Open Library',
      `https://openlibrary.org/search.json?q=${q(query)}&limit=${Math.min(50, o.count)}&fields=key,title,author_name,first_publish_year,cover_i,edition_count`,
    );
    return { source: 'openlibrary', results: parse.openlibrary(data) };
  },
  async x(query, o, key) {
    const data = await json<J>(
      'X',
      `https://api.x.com/2/tweets/search/recent?query=${q(query)}&max_results=${Math.max(10, Math.min(100, o.count))}&tweet.fields=created_at,author_id,public_metrics&expansions=author_id&user.fields=username,name`,
      { headers: { authorization: `Bearer ${key}` } },
    );
    return {
      source: 'x',
      results: parse.x(data).slice(0, o.count),
      note: 'Recent search covers the last seven days.',
    };
  },
  async bluesky(query, o) {
    const data = await json<J>(
      'Bluesky',
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${q(query)}&limit=${Math.min(100, o.count)}`,
    );
    return { source: 'bluesky', results: parse.bluesky(data) };
  },
  async reddit(query, o) {
    const data = await json<J>(
      'Reddit',
      `https://www.reddit.com/search.json?q=${q(query)}&limit=${Math.min(100, o.count)}&sort=relevance`,
    );
    return { source: 'reddit', results: parse.reddit(data) };
  },
};

/** Run one provider. Throws with a readable reason when it cannot run. */
export async function searchProvider(
  id: ProviderId,
  query: string,
  o: SearchOptions,
): Promise<SearchOutcome> {
  const status = providerStatus(id);
  if (!status.available) throw new Error(`${providerSpec(id).label} ${status.reason}.`);
  return ADAPTERS[id](query, o, loadKeys()[id] ?? '');
}
