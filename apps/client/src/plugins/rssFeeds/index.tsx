import { RssIcon } from '../../components/icons';
import { hasSyncServer } from '../../lib/sync/apiBase';
import { getPlatformCaps } from '../../lib/platform';
import { createRssItem } from '../../lib/integrations/rss';
import { useSessionStore } from '../../state/sessionStore';
import { registerPlugin } from '../registry';

/** RSS reader boxes (feeds are fetched through the sync server). */
registerPlugin({
  manifest: {
    id: 'rss-feeds',
    order: 30,
    name: 'RSS Feeds',
    description: 'Reader boxes for RSS/Atom feeds, fetched through your sync server.',
  },
  addMenu: [
    {
      label: 'Add RSS Feed',
      category: 'links',
      icon: <RssIcon />,
      onSelect: () => {
        if (!getPlatformCaps().rss) {
          if (!hasSyncServer()) {
            window.alert('This deployment has no sync server, so RSS feeds can’t be fetched.');
            return;
          }
          window.alert(
            'RSS feeds are fetched through your sync server. Sign in under Board sync to use them.',
          );
          useSessionStore.getState().setSyncDialogOpen(true);
          return;
        }
        const url = window.prompt('RSS or Atom feed URL:', 'https://');
        if (url && url.trim() && url !== 'https://') void createRssItem(url.trim());
      },
    },
  ],
});
