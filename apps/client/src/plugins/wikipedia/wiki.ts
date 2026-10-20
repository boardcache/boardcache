import { platform } from '../../lib/platform';

/**
 * Wikipedia data layer: search, the article's rendered HTML (via the
 * MediaWiki API, which permits browser calls with `origin=*`), and image
 * metadata. The HTML is parsed into a compact article model — sections,
 * infobox facts, figures with captions, references — that the arranger
 * turns into a board. Pure parsing lives in `parseArticleHtml` so it can be
 * unit-tested on a fixture.
 */

export interface WikiSearchHit {
  title: string;
  description: string;
  thumbnail: string | null;
}

interface WikiSection {
  heading: string;
  /** URL fragment for the section (the heading's id). */
  anchor: string;
  /** Markdown-ish body: paragraphs, "- " lists, "### " subheadings. */
  text: string;
}

interface WikiFigure {
  /** "File:Foo.jpg" */
  file: string;
  caption: string;
  /** Index of the section the figure appeared in (-1 = lead / infobox). */
  section: number;
}

interface WikiReference {
  text: string;
  url: string | null;
}

export interface WikiArticle {
  title: string;
  lang: string;
  url: string;
  description: string;
  /** The lead paragraphs (plain text). */
  lead: string;
  sections: WikiSection[];
  facts: { key: string; value: string }[];
  figures: WikiFigure[];
  references: WikiReference[];
}

export interface WikiImageInfo {
  file: string;
  url: string;
  width: number;
  height: number;
  artist: string | null;
  license: string | null;
  descriptionUrl: string;
}

/** Sections that are apparatus, not content. */
const SKIP_SECTIONS =
  /^(references|external links|see also|notes|further reading|bibliography|sources|citations|footnotes|gallery|works cited|explanatory notes|references and notes)$/i;

const api = (lang: string) => `https://${lang}.wikipedia.org/w/api.php`;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}.`);
  return res.json();
}

export async function searchWikipedia(query: string, lang = 'en'): Promise<WikiSearchHit[]> {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '8',
    gsrnamespace: '0',
    prop: 'pageimages|description',
    piprop: 'thumbnail',
    pithumbsize: '120',
  });
  const data = (await getJson(`${api(lang)}?${q}`)) as {
    query?: {
      pages?: {
        title: string;
        index: number;
        description?: string;
        thumbnail?: { source: string };
      }[];
    };
  };
  const pages = data.query?.pages ?? [];
  return pages
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((p) => ({
      title: p.title,
      description: p.description ?? '',
      thumbnail: p.thumbnail?.source ?? null,
    }));
}

/** The rendered article HTML plus its canonical title. */
async function fetchParsed(title: string, lang: string): Promise<{ title: string; html: string }> {
  const q = new URLSearchParams({
    action: 'parse',
    format: 'json',
    formatversion: '2',
    origin: '*',
    page: title,
    prop: 'text|displaytitle',
    redirects: '1',
    disableeditsection: '1',
    disabletoc: '1',
  });
  const data = (await getJson(`${api(lang)}?${q}`)) as {
    error?: { info?: string };
    parse?: { title: string; text: string };
  };
  if (!data.parse) throw new Error(data.error?.info ?? 'No such article.');
  return { title: data.parse.title, html: data.parse.text };
}

async function fetchDescription(title: string, lang: string): Promise<string> {
  try {
    const q = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      titles: title,
      prop: 'description',
    });
    const data = (await getJson(`${api(lang)}?${q}`)) as {
      query?: { pages?: { description?: string }[] };
    };
    return data.query?.pages?.[0]?.description ?? '';
  } catch {
    return '';
  }
}

function articleUrl(title: string, lang: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export async function fetchArticle(title: string, lang = 'en'): Promise<WikiArticle> {
  const [{ title: canonical, html }, description] = await Promise.all([
    fetchParsed(title, lang),
    fetchDescription(title, lang),
  ]);
  const parsed = parseArticleHtml(html);
  return {
    title: canonical,
    lang,
    url: articleUrl(canonical, lang),
    description,
    ...parsed,
  };
}

// --- HTML → article model ---------------------------------------------------

const clean = (s: string) =>
  s
    .replace(/\[\d+\]|\[[a-z]\]|\[note \d+\]|\[citation needed\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

function listMarkdown(list: Element, depth = 0): string[] {
  const out: string[] = [];
  const ordered = list.tagName === 'OL';
  let n = 1;
  for (const li of Array.from(list.children)) {
    if (li.tagName !== 'LI') continue;
    const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
    for (const l of nested) l.remove();
    const text = clean(li.textContent ?? '');
    if (text) out.push(`${'  '.repeat(depth)}${ordered ? `${n++}.` : '-'} ${text}`);
    for (const l of nested) out.push(...listMarkdown(l, depth + 1));
  }
  return out;
}

/** Text of one section's block elements as markdown-ish paragraphs. */
function blocksToText(blocks: Element[]): string {
  const parts: string[] = [];
  for (const el of blocks) {
    const tag = el.tagName;
    if (tag === 'P') {
      const t = clean(el.textContent ?? '');
      if (t) parts.push(t);
    } else if (tag === 'UL' || tag === 'OL') {
      const lines = listMarkdown(el);
      if (lines.length) parts.push(lines.join('\n'));
    } else if (tag === 'H3' || tag === 'H4') {
      const t = clean(el.textContent ?? '');
      if (t) parts.push(`### ${t}`);
    } else if (tag === 'BLOCKQUOTE') {
      const t = clean(el.textContent ?? '');
      if (t) parts.push(`> ${t}`);
    } else if (tag === 'DL') {
      for (const dd of Array.from(el.querySelectorAll('dt, dd'))) {
        const t = clean(dd.textContent ?? '');
        if (t) parts.push(dd.tagName === 'DT' ? `**${t}**` : t);
      }
    }
  }
  return parts.join('\n\n');
}

/**
 * Parse MediaWiki parser output into sections, infobox facts, figures and
 * references. Apparatus (hatnotes, navboxes, edit links, citation markers,
 * the reference list itself) is stripped before the walk.
 */
export function parseArticleHtml(
  html: string,
): Pick<WikiArticle, 'lead' | 'sections' | 'facts' | 'figures' | 'references'> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.mw-parser-output') ?? doc.body;

  // Figures and the infobox are read BEFORE the strip (the infobox image is
  // a figure too), then removed so their captions don't leak into text.
  const figures: WikiFigure[] = [];
  const seenFiles = new Set<string>();
  const fileOf = (a: Element | null): string | null => {
    const href = a?.getAttribute('href') ?? '';
    const m = /\/wiki\/(File:[^#?]+)/.exec(href) ?? /title=(File:[^&#]+)/.exec(href);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]!).replace(/_/g, ' ');
    } catch {
      return m[1]!.replace(/_/g, ' ');
    }
  };
  const addFigure = (file: string | null, caption: string, section: number) => {
    if (!file || seenFiles.has(file)) return;
    if (/\.(svg|ogg|ogv|webm|mid|oga|mp3)$/i.test(file)) return; // icons, audio, video
    seenFiles.add(file);
    figures.push({ file, caption: clean(caption), section });
  };

  // Infobox: key/value rows and its lead image.
  const facts: { key: string; value: string }[] = [];
  const infobox = root.querySelector('table.infobox');
  if (infobox) {
    const img = infobox.querySelector('a[href*="File:"], a[href*="title=File:"]');
    addFigure(fileOf(img), infobox.querySelector('.infobox-caption')?.textContent ?? '', -1);
    for (const tr of Array.from(infobox.querySelectorAll('tr'))) {
      const th = tr.querySelector('th');
      const td = tr.querySelector('td');
      if (!th || !td || th.getAttribute('colspan')) continue;
      for (const br of Array.from(td.querySelectorAll('br'))) br.replaceWith(', ');
      for (const li of Array.from(td.querySelectorAll('li'))) li.append(', ');
      const key = clean(th.textContent ?? '');
      const value = clean(td.textContent ?? '').replace(/(,\s*)+$/, '');
      if (key && value && value.length <= 160 && facts.length < 14) facts.push({ key, value });
    }
    infobox.remove();
  }

  // References (before the strip removes them).
  const references: WikiReference[] = [];
  for (const li of Array.from(root.querySelectorAll('ol.references > li'))) {
    // The first citation on a page carries the cite templates' <style>
    // block inline; without this it became the reference's "text".
    for (const junk of Array.from(li.querySelectorAll('.mw-cite-backlink, style, script')))
      junk.remove();
    const link = li.querySelector('a.external') as HTMLAnchorElement | null;
    const text = clean((li.querySelector('.reference-text') ?? li).textContent ?? '');
    if (text) references.push({ text, url: link?.getAttribute('href') ?? null });
  }

  for (const sel of [
    '.hatnote',
    '.navbox',
    '.vertical-navbox',
    '.sidebar',
    '.metadata',
    '.ambox',
    '.mw-editsection',
    '.reference',
    '.reflist',
    'ol.references',
    '.mw-empty-elt',
    '.noprint',
    '.mw-authority-control',
    '.portal',
    '.side-box',
    'style',
    'script',
    'table.wikitable',
    '.thumbcaption .magnify',
    '.toc',
  ]) {
    for (const el of Array.from(root.querySelectorAll(sel))) el.remove();
  }

  // Walk the top-level flow: h2 opens a section; figures are noted (with
  // the section they sit in) then removed from the flow.
  const sections: WikiSection[] = [];
  let leadBlocks: Element[] = [];
  let current: { heading: string; anchor: string; blocks: Element[]; skip: boolean } | null = null;
  const flush = () => {
    if (!current) return;
    if (!current.skip) {
      const text = blocksToText(current.blocks);
      if (text) sections.push({ heading: current.heading, anchor: current.anchor, text });
    }
    current = null;
  };
  const sectionIndex = () => (current && !current.skip ? sections.length : -1);
  const FIG_SEL = 'figure, .thumb, .gallerybox, .infobox-image';
  const noteFigures = (scope: Element) => {
    const figs = scope.matches(FIG_SEL) ? [scope] : Array.from(scope.querySelectorAll(FIG_SEL));
    for (const f of figs) {
      const a = f.querySelector('a[href*="File:"], a[href*="title=File:"]');
      const cap = f.querySelector('figcaption, .thumbcaption, .gallerytext');
      addFigure(fileOf(a), cap?.textContent ?? '', sectionIndex());
    }
    for (const f of figs) f.remove();
  };

  const children = Array.from(root.children);
  for (const el of children) {
    const tag = el.tagName;
    // Modern parser output wraps headings: <div class="mw-heading mw-heading2"><h2 id>…</h2></div>
    const h2 =
      tag === 'H2' ? el : el.classList.contains('mw-heading2') ? el.querySelector('h2') : null;
    if (h2) {
      flush();
      const heading = clean(h2.textContent ?? '');
      current = {
        heading,
        anchor: h2.id || heading.replace(/ /g, '_'),
        blocks: [],
        skip: SKIP_SECTIONS.test(heading),
      };
      continue;
    }
    if (el.matches(FIG_SEL) || el.classList.contains('gallery')) {
      noteFigures(el);
      continue;
    }
    if (el.classList.contains('mw-heading3') || el.classList.contains('mw-heading4')) {
      const h = el.querySelector('h3, h4');
      if (h) (current ? current.blocks : leadBlocks).push(h);
      continue;
    }
    if (el.querySelector(FIG_SEL)) noteFigures(el);
    if (['P', 'UL', 'OL', 'H3', 'H4', 'BLOCKQUOTE', 'DL'].includes(tag)) {
      (current ? current.blocks : leadBlocks).push(el);
    } else if (tag === 'DIV' || tag === 'SECTION') {
      // Wrapped content (e.g. the lead in a <section>): take its blocks.
      for (const inner of Array.from(el.children)) {
        if (['P', 'UL', 'OL', 'H3', 'H4', 'BLOCKQUOTE', 'DL'].includes(inner.tagName)) {
          (current ? current.blocks : leadBlocks).push(inner);
        }
      }
    }
  }
  flush();
  leadBlocks = leadBlocks.filter((b) => b.tagName === 'P');
  const lead = blocksToText(leadBlocks);

  return { lead, sections, facts, figures, references };
}

// --- image metadata + bytes -------------------------------------------------

export async function fetchImageInfo(files: string[], lang = 'en'): Promise<WikiImageInfo[]> {
  const out: WikiImageInfo[] = [];
  for (let i = 0; i < files.length; i += 20) {
    const batch = files.slice(i, i + 20);
    const q = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      titles: batch.join('|'),
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata',
      iiurlwidth: '1200',
      iiextmetadatafilter: 'Artist|LicenseShortName|Credit',
    });
    const data = (await getJson(`${api(lang)}?${q}`)) as {
      query?: {
        pages?: {
          title: string;
          imageinfo?: {
            url: string;
            thumburl?: string;
            width: number;
            height: number;
            thumbwidth?: number;
            thumbheight?: number;
            descriptionurl: string;
            extmetadata?: Record<string, { value: string }>;
          }[];
        }[];
      };
    };
    for (const p of data.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const meta = ii.extmetadata ?? {};
      // Credits arrive as HTML, sometimes with the name repeated or a URL
      // tacked on; keep one clean name, short enough for a caption line.
      const strip = (v: string | undefined) => {
        if (!v) return null;
        let t = clean(v.replace(/<[^>]+>/g, ' ')).replace(/\(?\s*https?:\/\/\S+\)?/g, '');
        const half = t.slice(0, Math.floor(t.length / 2)).trim();
        if (half && t.trim() === `${half} ${half}`) t = half;
        t = t.replace(/\s+/g, ' ').trim();
        return t ? (t.length > 80 ? `${t.slice(0, 77).trimEnd()}…` : t) : null;
      };
      out.push({
        file: p.title,
        url: ii.thumburl ?? ii.url,
        width: ii.thumbwidth ?? ii.width,
        height: ii.thumbheight ?? ii.height,
        artist: strip(meta.Artist?.value),
        license: strip(meta.LicenseShortName?.value),
        descriptionUrl: ii.descriptionurl,
      });
    }
  }
  // Keep the caller's order.
  const order = new Map(files.map((f, i) => [f, i]));
  return out.sort((a, b) => (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0));
}

/** Image bytes: the browser first (Wikimedia allows it), then the relay. */
export async function fetchImageBlob(url: string): Promise<Blob | null> {
  try {
    const direct = await fetch(url, { mode: 'cors' });
    if (direct.ok) {
      const blob = await direct.blob();
      if (blob.type.startsWith('image/')) return blob;
    }
  } catch {
    /* relay below */
  }
  try {
    const res = await platform.urlFetch({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.type.startsWith('image/') ? blob : null;
  } catch {
    return null;
  }
}

// --- dated events without a model ------------------------------------------

export interface WikiEvent {
  /** "1969" or "1969-07-20" — display text, sortable by its leading year. */
  date: string;
  label: string;
  detail: string;
}

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_RE = new RegExp(
  `\\b(?:(?:(${MONTHS}) (\\d{1,2}), )?((?:1[0-9]|20)\\d{2}))\\b|\\b(\\d{1,2}) (${MONTHS}) ((?:1[0-9]|20)\\d{2})\\b`,
);

/**
 * Sentences that carry a date, one per year, in reading order — a
 * serviceable timeline when no model is available to pick the real events.
 */
/** Sentences, without breaking after an initial ("John F. Kennedy"). */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"'(])/)) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /\b[A-Z]\.$/.test(prev)) out[out.length - 1] = `${prev} ${piece}`;
    else out.push(piece);
  }
  return out;
}

/** A short label: the sentence up to its first clause break, on a word edge. */
function eventLabel(sentence: string): string {
  const clause = sentence.split(/[,;:—–(]/)[0]!.trim();
  const s = clause.length >= 24 ? clause : sentence;
  if (s.length <= 60) return s.replace(/[.]$/, '');
  const cut = s.slice(0, 58);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 30)).trimEnd()}…`;
}

export function extractEvents(article: Pick<WikiArticle, 'lead' | 'sections'>): WikiEvent[] {
  const texts = [article.lead, ...article.sections.map((s) => s.text)];
  // Narrative sentences date themselves up front ("In 1961, …", "On July 20,
  // 1969, …"); a year buried mid-sentence is usually an aside. Prefer the
  // former, fall back to the latter, one event per year, in reading order.
  // One event per year; a fuller date ("July 16, 1969") replaces a bare one.
  const byYear = new Map<string, WikiEvent>();
  const pick = (maxIndex: number) => {
    for (const text of texts) {
      for (const sentence of sentences(text)) {
        const s = sentence.trim();
        if (s.length < 30 || s.length > 400 || /^[-#>*]/.test(s)) continue;
        const m = DATE_RE.exec(s);
        if (!m || m.index > maxIndex) continue;
        const year = m[3] ?? m[6]!;
        const month = m[1] ?? m[5];
        const day = m[2] ?? m[4];
        const date = month
          ? `${year}-${String(MONTHS.split('|').indexOf(month) + 1).padStart(2, '0')}${day ? `-${day.padStart(2, '0')}` : ''}`
          : year;
        const prev = byYear.get(year);
        if (prev && prev.date.length >= date.length) continue;
        byYear.set(year, { date, label: eventLabel(s), detail: s });
      }
    }
  };
  pick(24);
  if (byYear.size < 3) pick(Infinity);
  return sortEvents([...byYear.values()].slice(0, 10));
}

export function sortEvents<T extends { date: string }>(events: T[]): T[] {
  return events.slice().sort((a, b) => a.date.localeCompare(b.date));
}
