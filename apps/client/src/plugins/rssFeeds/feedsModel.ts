import type { CanvasDocument, RssItem } from '@boardcache/schema';
import { createRssItem, refreshRssItem } from '../../lib/integrations/rss';
import {
  allFolderPaths,
  buildFolderTree,
  cleanFolderPath,
  liftedPath,
  parentFolder,
  renamedPath,
  type FolderNode,
} from '../../lib/structure/folders';
import { buildOpml, parseOpml } from '../../lib/structure/opml';
import {
  removeItems,
  setItemsHidden,
  updateBoardSettings,
  updateItems,
} from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * The Feeds view's model over the board: the feeds are the RSS items, filed
 * under folders by their `folder` path; folders with nothing in them yet are
 * listed in the board settings. A feed hidden from the canvas is an item
 * the canvas does not draw (`hidden`, the layers panel's eye) that the view
 * still lists. Everything here is a command on the document, so it undoes
 * and syncs like any other edit.
 */

export type FeedNode = FolderNode<RssItem>;

export const feedsOf = (doc: CanvasDocument): RssItem[] =>
  Object.values(doc.items).filter((i): i is RssItem => i.type === 'rss');

export const feedFolderOf = (feed: RssItem): string => cleanFolderPath(feed.folder ?? '');

/** The name a feed goes by: its own name, the feed's title, else its host. */
export function feedTitle(feed: RssItem): string {
  const own = feed.name?.trim();
  if (own) return own;
  if (feed.feedTitle) return feed.feedTitle;
  try {
    return new URL(feed.url).host;
  } catch {
    return feed.url;
  }
}

const byTitle = (a: RssItem, b: RssItem) =>
  feedTitle(a).localeCompare(feedTitle(b), undefined, { sensitivity: 'base', numeric: true });

/** Every folder path on the board, from the feeds and the settings. */
export function allFeedFolders(doc: CanvasDocument): string[] {
  return allFolderPaths(feedsOf(doc).map(feedFolderOf), doc.settings.feedFolders);
}

/** The folder tree the sidebar shows. */
export function feedTree(doc: CanvasDocument): FeedNode {
  return buildFolderTree(feedsOf(doc), feedFolderOf, doc.settings.feedFolders, 'Feeds', byTitle);
}

/** Feeds whose title, feed title or address match every word of a search. */
export function searchFeeds(doc: CanvasDocument, query: string): RssItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return feedsOf(doc)
    .filter((f) => {
      const hay = `${feedTitle(f)} ${f.feedTitle ?? ''} ${f.url} ${feedFolderOf(f)}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .sort(byTitle);
}

export function moveFeedToFolder(id: string, folder: string): void {
  const path = cleanFolderPath(folder);
  updateItems([id], 'Move feed', (d) => {
    if (d.type !== 'rss') return;
    if (path) d.folder = path;
    else delete d.folder;
  });
}

/** A folder with nothing in it yet; returns its path. */
export function createFeedFolder(parent: string, name: string): string | null {
  const path = cleanFolderPath(`${parent}/${name}`);
  if (!path) return null;
  const { doc } = useDocumentStore.getState();
  if (allFeedFolders(doc).includes(path)) return path;
  updateBoardSettings({ feedFolders: [...doc.settings.feedFolders, path] });
  return path;
}

/** Rename a folder: its feeds and subfolders follow. */
export function renameFeedFolder(path: string, name: string): string | null {
  const next = cleanFolderPath(`${parentFolder(path)}/${name}`);
  if (!next || next === path) return path;
  const { doc } = useDocumentStore.getState();
  const moved = (p: string) => renamedPath(p, path, next);
  const ids = feedsOf(doc)
    .filter((f) => moved(feedFolderOf(f)) !== feedFolderOf(f))
    .map((f) => f.id);
  if (ids.length) {
    updateItems(ids, 'Rename folder', (d) => {
      if (d.type === 'rss') d.folder = moved(cleanFolderPath(d.folder ?? ''));
    });
  }
  const folders = new Set(doc.settings.feedFolders.map(cleanFolderPath).map(moved));
  folders.add(next);
  updateBoardSettings({ feedFolders: [...folders].filter(Boolean) });
  return next;
}

/** Remove a folder: its feeds move up to the parent, subfolders with them. */
export function deleteFeedFolder(path: string): void {
  const { doc } = useDocumentStore.getState();
  const lifted = (p: string) => liftedPath(p, path);
  const ids = feedsOf(doc)
    .filter((f) => lifted(feedFolderOf(f)) !== feedFolderOf(f))
    .map((f) => f.id);
  if (ids.length) {
    updateItems(ids, 'Delete folder', (d) => {
      if (d.type !== 'rss') return;
      const to = lifted(cleanFolderPath(d.folder ?? ''));
      if (to) d.folder = to;
      else delete d.folder;
    });
  }
  updateBoardSettings({
    feedFolders: [
      ...new Set(
        doc.settings.feedFolders
          .map(cleanFolderPath)
          .filter((p) => p !== path)
          .map(lifted)
          .filter(Boolean),
      ),
    ],
  });
}

/** Show the feed's card on the canvas, or keep it to the Feeds view. */
export function setFeedOnCanvas(id: string, on: boolean): void {
  setItemsHidden([id], !on);
}

export function deleteFeed(id: string): void {
  removeItems([id], 'Delete feed');
}

/** Refetch feeds one after another; the ones that failed, by id. */
export async function refreshFeeds(ids: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await refreshRssItem(id);
    } catch (err) {
      console.error('boardCache: RSS refresh failed', err);
      failed.push(id);
    }
  }
  return failed;
}

/** The board's feeds as an OPML document, folders as nested outlines. */
export function feedsOpml(doc: CanvasDocument): string {
  return buildOpml(
    feedsOf(doc).map((f) => ({ url: f.url, title: feedTitle(f), folder: feedFolderOf(f) })),
    doc.name || 'Feeds',
  );
}

/** Add the feeds an OPML document lists that are not on the board yet, kept
 *  to the view (a long list would bury the canvas); each is fetched. */
export async function importOpml(text: string): Promise<{ added: string[]; skipped: number }> {
  const feeds = parseOpml(text);
  const have = new Set(feedsOf(useDocumentStore.getState().doc).map((f) => f.url.trim()));
  const added: string[] = [];
  let skipped = 0;
  for (const f of feeds) {
    if (have.has(f.url)) {
      skipped += 1;
      continue;
    }
    have.add(f.url);
    added.push(
      await createRssItem(f.url, undefined, {
        folder: f.folder,
        onCanvas: false,
        ...(f.title ? { title: f.title } : {}),
      }),
    );
  }
  return { added, skipped };
}
