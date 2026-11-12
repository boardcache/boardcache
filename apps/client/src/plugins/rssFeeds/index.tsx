import './style.css';
import { z } from 'zod';
import { useEffect } from 'react';
import { EyeIcon, EyeOffIcon, PencilIcon, RssIcon, TextQuoteIcon } from '../../components/icons';
import { toggleRssExcerpts } from '../../components/items/RssContent';
import { requireType } from '../../lib/tools/shared';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { registerPlugin } from '../registry';
import { editFeedUrl, openAddFeed, openFeeds, VIEW_ID } from './actions';
import { AddFeedDialog } from './AddFeedDialog';
import {
  feedFolderOf,
  feedTitle,
  feedsOf,
  feedsOpml,
  importOpml,
  moveFeedToFolder,
  refreshFeeds,
  setFeedOnCanvas,
} from './feedsModel';
import { FeedsView } from './FeedsView';
import { useFeedsUi } from './store';

/** The dialog host; the lightbox's Open in Feeds button reaches the view through it. */
function FeedsHost() {
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { itemId } = (e as CustomEvent<{ itemId?: string }>).detail ?? {};
      openFeeds(itemId);
    };
    window.addEventListener('boardcache:open-feeds', onOpen);
    return () => window.removeEventListener('boardcache:open-feeds', onOpen);
  }, []);
  return <AddFeedDialog />;
}

/**
 * RSS feeds: reader cards on the canvas (feeds are fetched through the
 * sync server), and the Feeds view — every feed on the board in folders,
 * read at full width, refreshed by hand, shown on the canvas or kept to
 * the view.
 */
registerPlugin({
  manifest: {
    id: 'rss-feeds',
    order: 30,
    name: 'RSS Feeds',
    description:
      'Reader cards for RSS/Atom feeds, fetched through your sync server, and the Feeds view that files them in folders.',
  },
  addMenu: [
    {
      label: 'Add RSS Feed',
      category: 'links',
      icon: <RssIcon />,
      onSelect: () => openAddFeed(),
    },
  ],
  Component: FeedsHost,
  itemMenu: (item) => {
    if (item.type !== 'rss') return [];
    return [
      {
        kind: 'action',
        label: 'Edit Feed',
        icon: <PencilIcon />,
        onSelect: () => void editFeedUrl(item.id),
      },
      {
        kind: 'action',
        label: item.showExcerpts ? 'Headlines Only' : 'Show Excerpts',
        icon: <TextQuoteIcon />,
        onSelect: () => toggleRssExcerpts(item.id),
      },
      {
        kind: 'action',
        label: item.hidden ? 'Show on Canvas' : 'Hide from Canvas',
        icon: item.hidden ? <EyeIcon /> : <EyeOffIcon />,
        onSelect: () => setFeedOnCanvas(item.id, !!item.hidden),
      },
      {
        kind: 'action',
        label: 'Open Feeds',
        icon: <RssIcon />,
        onSelect: () => openFeeds(item.id),
      },
    ];
  },
  views: [
    {
      id: VIEW_ID,
      label: 'Feeds',
      icon: <RssIcon />,
      Component: FeedsView,
      // /b/:id/feeds[/:feedId]: the feed on the right.
      subPath: () => {
        const id = useFeedsUi.getState().selectedId;
        return id ? [id] : [];
      },
      applySubPath: (segments) => {
        const [id] = segments;
        if (id && useDocumentStore.getState().doc.items[id]?.type === 'rss')
          useFeedsUi.getState().setSelected(id);
      },
    },
  ],
  tools: [
    {
      name: 'list_feeds',
      description:
        'The RSS feeds on the board: each with its id, name, address, Feeds-view folder, whether its card is on the canvas, when it was last fetched, and its latest entries (title, link, date). Add one with add_rss_feed.',
      parameters: z.object({
        entries: z
          .number()
          .int()
          .min(0)
          .max(25)
          .optional()
          .describe('How many of the latest entries to include per feed (default 5)'),
      }),
      access: 'read',
      execute: (args, ctx) =>
        feedsOf(ctx.doc()).map((f) => ({
          id: f.id,
          title: feedTitle(f),
          url: f.url,
          folder: feedFolderOf(f),
          onCanvas: !f.hidden,
          fetchedAt: f.fetchedAt,
          entryCount: f.entries.length,
          entries: f.entries.slice(0, args.entries ?? 5).map((e) => ({
            title: e.title,
            link: e.link,
            published: e.published,
          })),
        })),
    },
    {
      name: 'export_opml',
      description:
        "The board's RSS feeds as an OPML subscription list (folders as nested outlines), the format feed readers exchange.",
      parameters: z.object({}),
      access: 'read',
      execute: (_args, ctx) => ({ opml: feedsOpml(ctx.doc()) }),
    },
    {
      name: 'import_opml',
      description:
        'Add the feeds an OPML subscription list names, in its folders, kept to the Feeds view (off the canvas); feeds already on the board are skipped. Returns the new feed ids.',
      parameters: z.object({ opml: z.string().describe('The OPML document') }),
      access: 'write',
      execute: (args) => importOpml(args.opml),
    },
    {
      name: 'refresh_feeds',
      description:
        'Fetch RSS feeds again now: the given feed ids, or every feed on the board when none are given. Returns the ids that could not be fetched.',
      parameters: z.object({
        ids: z.array(z.string()).optional().describe('Feed item ids; absent = every feed'),
      }),
      access: 'external',
      execute: async (args, ctx) => {
        const ids = args.ids ?? feedsOf(ctx.doc()).map((f) => f.id);
        for (const id of ids) requireType(ctx, id, 'rss');
        const failed = await refreshFeeds(ids);
        return { refreshed: ids.length - failed.length, failed };
      },
    },
    {
      name: 'file_feed',
      description:
        "Change how a feed is kept: its Feeds-view folder ('' for the root), its own name, whether its card shows on the canvas, and whether the card shows excerpts under the headlines.",
      parameters: z.object({
        id: z.string(),
        folder: z.string().optional(),
        name: z
          .string()
          .optional()
          .describe("The feed's own name; '' falls back to the feed's title"),
        onCanvas: z.boolean().optional(),
        showExcerpts: z.boolean().optional(),
      }),
      access: 'write',
      execute: (args, ctx) => {
        requireType(ctx, args.id, 'rss');
        if (args.folder !== undefined) moveFeedToFolder(args.id, args.folder);
        if (args.onCanvas !== undefined) setFeedOnCanvas(args.id, args.onCanvas);
        if (args.name !== undefined || args.showExcerpts !== undefined) {
          updateItems([args.id], 'Edit feed', (d) => {
            if (d.type !== 'rss') return;
            if (args.name !== undefined) {
              if (args.name.trim()) d.name = args.name.trim();
              else delete d.name;
            }
            if (args.showExcerpts !== undefined) d.showExcerpts = args.showExcerpts;
          });
        }
        const feed = ctx.doc().items[args.id];
        return feed?.type === 'rss'
          ? { id: feed.id, folder: feedFolderOf(feed), onCanvas: !feed.hidden }
          : { id: args.id };
      },
    },
  ],
});
