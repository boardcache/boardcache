import type {
  Connection,
  ConnectionRel,
  ImageItem,
  Item,
  TextItem,
  TimelineItem,
  TitleItem,
} from '@boardcache/schema';
import { DEFAULT_FONT_FAMILY, newId } from '@boardcache/schema';
import { makePoint } from '../../lib/structure/timelineLayout';
import { measureMarkdownHeight } from '../../lib/text/markdown';
import type { AiEnrichment } from './ai';
import type { WikiArticle, WikiEvent } from './wiki';
import { extractEvents, sortEvents } from './wiki';

/**
 * Turns an article (plus whatever the model contributed) into a board:
 *
 *   ┌ Title ──────────────────────────────────────────┐
 *   │ Lead / summary            │ Hero image          │
 *   ├ Key facts │ Section  │ Section  (3-column flow) │
 *   │ Section   │ Image    │ Section                  │
 *   ├ Timeline of dated events ────────────────────────┤
 *   └ Sources and credits ─────────────────────────────┘
 *
 * with reading-order or model-suggested connections between cards. Pure:
 * items are laid out from (0, 0); the caller translates and commits them.
 */

export interface ImportOptions {
  images: boolean;
  timeline: boolean;
  facts: boolean;
  sources: boolean;
  useAI: boolean;
  /** Where the cards land: the page being viewed, a page by id, or a new
   *  page named after the article. */
  target: 'active' | 'new' | string;
  /** Group the cards so the article moves as one. */
  group: boolean;
}

/** An article image already stored as an asset. */
export interface StoredImage {
  assetId: string;
  width: number;
  height: number;
  file: string;
  caption: string;
  artist: string | null;
  license: string | null;
  pageUrl: string;
  /** Section the figure appeared in (-1 = lead). */
  section: number;
}

export interface Arranged {
  items: Item[];
  connections: Connection[];
  groupName: string;
  bounds: { x: number; y: number; width: number; height: number };
}

const COL_W = 360;
const GAP = 90;
const COLS = 3;
const FULL_W = COLS * COL_W + (COLS - 1) * GAP;
const FONT = 15;
const MAX_BOX_H = 560;
const EXCERPT_CHARS = 700;
const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

const base = (z: number) => ({
  id: newId(),
  rotation: 0,
  zIndex: z,
  locked: false,
  opacity: 1,
  groupId: null,
  createdAt: new Date().toISOString(),
});

function textBox(
  x: number,
  y: number,
  width: number,
  text: string,
  z: number,
  extra: { name?: string; linkUrl?: string; notes?: string } = {},
): TextItem {
  const measured = measureMarkdownHeight(text, width, FONT, DEFAULT_FONT_FAMILY) + 6;
  return {
    ...base(z),
    type: 'text',
    x,
    y,
    width,
    height: Math.min(measured, MAX_BOX_H),
    text,
    fontSize: FONT,
    fontFamily: DEFAULT_FONT_FAMILY,
    background: 'auto',
    color: 'default',
    align: 'left',
    verticalAlign: 'top',
    autoHeight: false,
    ...extra,
  };
}

/**
 * The first paragraphs of a section within `max` characters. Whole
 * paragraphs are kept while they fit; when the next one overflows and the
 * excerpt is still thin, that paragraph is cut at a sentence end instead.
 */
export function excerpt(text: string, max = EXCERPT_CHARS): string {
  if (text.length <= max) return text;
  let out = '';
  for (const p of text.split(/\n\n+/)) {
    const next = out ? `${out}\n\n${p}` : p;
    if (next.length <= max) {
      out = next;
      continue;
    }
    if (out.length < max / 2) {
      const room = max - (out ? out.length + 2 : 0);
      const cut = p.slice(0, room);
      const end = cut.lastIndexOf('. ');
      const piece = end > room * 0.4 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
      out = out ? `${out}\n\n${piece}` : piece;
    }
    break;
  }
  return out;
}

const attribution = (a: WikiArticle) => `From “${a.title}” on Wikipedia (${a.url}), CC BY-SA 4.0.`;

function imageItem(img: StoredImage, x: number, y: number, width: number, z: number): ImageItem {
  const ratio = img.height / Math.max(1, img.width);
  let w = width;
  let h = Math.round(width * ratio);
  if (h > 480) {
    h = 480;
    w = Math.round(480 / ratio);
  }
  const credit = [img.artist, img.license].filter(Boolean).join(' · ');
  return {
    ...base(z),
    type: 'image',
    x,
    y,
    width: w,
    height: h,
    name: img.file.replace(/^File:/, ''),
    assetId: img.assetId,
    naturalWidth: img.width,
    naturalHeight: img.height,
    crop: null,
    filters: null,
    flipH: false,
    flipV: false,
    ocrText: null,
    description: img.caption || null,
    caption: !!img.caption,
    captionCorner: 'bl',
    captionPlacement: 'inside',
    captionWrap: true,
    captionOpacity: 0.7,
    linkUrl: img.pageUrl,
    notes: credit ? `Credit: ${credit} — via Wikimedia Commons.` : 'Via Wikimedia Commons.',
  };
}

function sourcesMarkdown(article: WikiArticle, images: StoredImage[]): string {
  const lines = [
    '## Sources',
    '',
    `- Text adapted from [“${article.title}” on Wikipedia](${article.url}), licensed [CC BY-SA 4.0](${LICENSE_URL}).`,
  ];
  if (images.length) {
    lines.push('- Images via Wikimedia Commons:');
    for (const img of images) {
      const credit = [img.artist, img.license].filter(Boolean).join(', ');
      lines.push(
        `  - [${img.file.replace(/^File:/, '')}](${img.pageUrl})${credit ? ` — ${credit}` : ''}`,
      );
    }
  }
  const refs = article.references.slice(0, 12);
  if (refs.length) {
    lines.push('', `### References (${refs.length} of ${article.references.length})`, '');
    refs.forEach((r, i) => {
      const text = r.text.length > 180 ? `${r.text.slice(0, 177)}…` : r.text;
      lines.push(`${i + 1}. ${r.url ? `[${text}](${r.url})` : text}`);
    });
  }
  return lines.join('\n');
}

function timelineItem(
  events: WikiEvent[],
  x: number,
  y: number,
  z: number,
  title: string,
): TimelineItem {
  const points = events.map((e, i) => ({
    ...makePoint(i + 1),
    label: e.label,
    date: e.date,
    description: e.detail === e.label ? '' : e.detail,
  }));
  const width = Math.max(FULL_W, points.length * 210);
  return {
    ...base(z),
    type: 'timeline',
    x,
    y,
    width,
    height: 240,
    name: `${title} — timeline`,
    orientation: 'horizontal',
    scaleMode: 'even',
    points,
    style: { lineColor: '#98a2b3', lineWidth: 4, pointColor: '#608cff', pointSize: 12 },
  };
}

export function arrange(
  article: WikiArticle,
  images: StoredImage[],
  ai: AiEnrichment | null,
  opts: ImportOptions,
): Arranged {
  const items: Item[] = [];
  const connections: Connection[] = [];
  let z = 1;
  let y = 0;

  // Title row.
  const title: TitleItem = {
    ...base(z++),
    type: 'title',
    x: 0,
    y,
    width: FULL_W,
    height: 84,
    text: article.title,
    fontFamily: 'Inter, system-ui, sans-serif',
    color: null,
    background: null,
    bold: true,
    italic: false,
    alignH: 'left',
    alignV: 'middle',
    linkUrl: article.url,
    notes: attribution(article),
  };
  items.push(title);
  y += 84 + GAP;

  // Lead + hero.
  const hero = opts.images ? (images.find((i) => i.section === -1) ?? images[0]) : undefined;
  const others = images.filter((i) => i !== hero);
  const leadWidth = hero ? 2 * COL_W + GAP : FULL_W;
  const summary = ai?.summary ?? excerpt(article.lead, 1200);
  const lead = textBox(
    0,
    y,
    leadWidth,
    [
      article.description ? `**${article.description}**` : '',
      summary,
      `[Read on Wikipedia ↗](${article.url})`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    z++,
    { name: `${article.title} — summary`, linkUrl: article.url, notes: attribution(article) },
  );
  items.push(lead);
  let rowBottom = lead.y + lead.height;
  if (hero) {
    const img = imageItem(hero, leadWidth + GAP, y, COL_W, z++);
    items.push(img);
    rowBottom = Math.max(rowBottom, img.y + img.height);
  }
  y = rowBottom + GAP;

  // Three-column flow: facts, then sections with images interleaved.
  type Card = { kind: 'text'; item: TextItem } | { kind: 'image'; img: StoredImage };
  const cards: Card[] = [];
  const facts = ai?.facts?.length ? ai.facts : article.facts;
  if (opts.facts && facts.length) {
    cards.push({
      kind: 'text',
      item: textBox(
        0,
        0,
        COL_W,
        `## Key facts\n\n${facts.map((f) => `- **${f.key}:** ${f.value}`).join('\n')}`,
        0,
        { name: `${article.title} — key facts`, notes: attribution(article) },
      ),
    });
  }
  const sectionItems: TextItem[] = [];
  let imageCursor = 0;
  article.sections.forEach((s, i) => {
    const body = ai?.gists.get(i) ?? excerpt(s.text);
    const item = textBox(
      0,
      0,
      COL_W,
      `## ${s.heading}\n\n${body}\n\n[Read more ↗](${article.url}#${s.anchor})`,
      0,
      { name: s.heading, linkUrl: `${article.url}#${s.anchor}`, notes: attribution(article) },
    );
    sectionItems.push(item);
    cards.push({ kind: 'text', item });
    // An image after every second section keeps the flow visual.
    if (opts.images && i % 2 === 1 && imageCursor < others.length) {
      cards.push({ kind: 'image', img: others[imageCursor++]! });
    }
  });
  while (opts.images && imageCursor < others.length) {
    cards.push({ kind: 'image', img: others[imageCursor++]! });
  }
  const colY = Array.from({ length: COLS }, () => y);
  for (const card of cards) {
    const col = colY.indexOf(Math.min(...colY));
    const x = col * (COL_W + GAP);
    if (card.kind === 'text') {
      card.item.x = x;
      card.item.y = colY[col]!;
      card.item.zIndex = z++;
      items.push(card.item);
      colY[col]! += card.item.height + GAP;
    } else {
      const img = imageItem(card.img, x, colY[col]!, COL_W, z++);
      items.push(img);
      colY[col]! += img.height + GAP;
    }
  }
  y = Math.max(...colY);

  // Timeline.
  if (opts.timeline) {
    const events = ai?.events.length ? sortEvents(ai.events) : extractEvents(article);
    if (events.length >= 3) {
      const tl = timelineItem(events.slice(0, 12), 0, y, z++, article.title);
      items.push(tl);
      y += tl.height + GAP;
    }
  }

  // Sources and credits.
  if (opts.sources) {
    const src = textBox(0, y, 2 * COL_W + GAP, sourcesMarkdown(article, images), z, {
      name: `${article.title} — sources`,
      linkUrl: article.url,
    });
    items.push(src);
    y += src.height;
  }

  // Connections: the model's relations, or the reading order.
  if (sectionItems.length) {
    connections.push(connect(lead.id, sectionItems[0]!.id, 'follows'));
    if (ai?.relations.length) {
      for (const r of ai.relations) {
        const a = sectionItems[r.a];
        const b = sectionItems[r.b];
        if (a && b) connections.push(connect(a.id, b.id, r.rel, r.label));
      }
    } else {
      for (let i = 0; i + 1 < Math.min(sectionItems.length, 9); i++) {
        connections.push(connect(sectionItems[i]!.id, sectionItems[i + 1]!.id, 'follows'));
      }
    }
  }

  const width = Math.max(FULL_W, ...items.map((i) => i.x + i.width));
  return {
    items,
    connections,
    groupName: `Wikipedia · ${article.title}`,
    bounds: { x: 0, y: 0, width, height: y },
  };
}

function connect(from: string, to: string, rel: ConnectionRel, label?: string): Connection {
  return {
    id: newId(),
    from: { kind: 'item', id: from },
    to: { kind: 'item', id: to },
    rel,
    ...(label ? { label } : {}),
  };
}
