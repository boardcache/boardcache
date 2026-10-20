import { textFromHtml } from '../text/safeUrl';
import { hasSyncServer } from '../sync/apiBase';
import { getPlatformCaps, platform } from '../platform';
import type { RssEntry, RssItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { clientToCanvas } from '../canvas/canvasDom';
import type { Point } from '../canvas/coords';
import { addItems, topZIndex, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * RSS/Atom reader boxes. Feeds are fetched through the sync server's /api/rss
 * proxy (feeds rarely send CORS headers) and parsed client-side; entries are
 * cached on the item so boxes render offline and in the viewer.
 */

const MAX_ENTRIES = 25;

function text(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? '';
}

/** Strip markup and collapse whitespace into a short excerpt. */
function toExcerpt(html: string, max = 220): string {
  const t = textFromHtml(html).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function firstImgSrc(html: string): string | null {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m?.[1] ?? null;
}

function entryThumbnail(node: Element, contentHtml: string): string | null {
  // media:thumbnail / media:content (RSS media extension)
  for (const tag of ['media:thumbnail', 'media:content', 'thumbnail', 'content']) {
    for (const el of [...node.getElementsByTagName(tag)]) {
      const url = el.getAttribute('url');
      const medium = el.getAttribute('medium') ?? el.getAttribute('type') ?? '';
      if (url && (medium.includes('image') || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url))) {
        return url;
      }
    }
  }
  const enclosure = node.querySelector('enclosure[type^="image"]');
  if (enclosure?.getAttribute('url')) return enclosure.getAttribute('url');
  return firstImgSrc(contentHtml);
}

interface ParsedFeed {
  feedTitle: string | null;
  entries: RssEntry[];
}

/** Parse RSS 2.0 or Atom XML into reader entries. */
function parseFeed(xml: string): ParsedFeed {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Not a valid RSS/Atom feed.');

  const entries: RssEntry[] = [];
  const rssItems = [...doc.querySelectorAll('channel > item')];
  const atomEntries = rssItems.length ? [] : [...doc.getElementsByTagName('entry')];

  for (const node of rssItems.slice(0, MAX_ENTRIES)) {
    const contentHtml =
      text(node.getElementsByTagName('content:encoded')[0]) ||
      text(node.querySelector('description'));
    const link =
      text(node.querySelector('link')) || node.querySelector('guid')?.textContent?.trim() || '';
    if (!link) continue;
    entries.push({
      title: text(node.querySelector('title')) || link,
      link,
      excerpt: toExcerpt(text(node.querySelector('description')) || contentHtml),
      thumbnail: entryThumbnail(node, contentHtml),
      published: text(node.querySelector('pubDate')) || null,
    });
  }

  for (const node of atomEntries.slice(0, MAX_ENTRIES)) {
    const linkEl =
      node.querySelector('link[rel="alternate"]') ??
      node.querySelector('link:not([rel])') ??
      node.querySelector('link');
    const link = linkEl?.getAttribute('href') ?? '';
    if (!link) continue;
    const contentHtml = text(node.querySelector('content')) || text(node.querySelector('summary'));
    entries.push({
      title: text(node.querySelector('title')) || link,
      link,
      excerpt: toExcerpt(contentHtml),
      thumbnail: entryThumbnail(node, contentHtml),
      published:
        text(node.querySelector('updated')) || text(node.querySelector('published')) || null,
    });
  }

  const feedTitle =
    text(doc.querySelector('channel > title')) || text(doc.querySelector('feed > title')) || null;
  if (entries.length === 0) throw new Error('The feed has no readable entries.');
  return { feedTitle, entries };
}

/** Fetch + parse a feed through the server proxy. */
async function fetchFeed(url: string): Promise<ParsedFeed> {
  if (!getPlatformCaps().rss) {
    throw new Error(
      hasSyncServer()
        ? 'Sign in to a sync server (Board sync) to load RSS feeds.'
        : 'This deployment has no sync server, so RSS feeds can’t be fetched.',
    );
  }
  const res = await platform.rssFetch(url);
  if (res.status === 401) throw new Error('Sign in to sync to fetch RSS feeds.');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Could not fetch the feed.');
  }
  return parseFeed(await res.text());
}

/** Refresh an existing box in place. Throws on failure (box keeps old data). */
export async function refreshRssItem(id: string): Promise<void> {
  const item = useDocumentStore.getState().doc.items[id];
  if (!item || item.type !== 'rss') return;
  const feed = await fetchFeed(item.url);
  updateItems([id], 'Refresh RSS feed', (draft) => {
    if (draft.type !== 'rss') return;
    draft.feedTitle = feed.feedTitle;
    draft.entries = feed.entries;
    draft.fetchedAt = new Date().toISOString();
  });
}

/** Create a reader box for a feed URL; content fills in when the fetch lands. */
export async function createRssItem(url: string, at?: Point): Promise<string> {
  const { doc } = useDocumentStore.getState();
  const point = at ?? clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const item: RssItem = {
    id: newId(),
    type: 'rss',
    x: point.x - 180,
    y: point.y - 210,
    width: 360,
    height: 420,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    url,
    feedTitle: null,
    fetchedAt: null,
    entries: [],
    fontScale: 1,
  };
  addItems([item], 'Add RSS feed');
  void refreshRssItem(item.id).catch((err) => {
    console.error('boardCache: RSS fetch failed', err);
  });
  return item.id;
}
