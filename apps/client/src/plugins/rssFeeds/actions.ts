import { promptText } from '../../components/ui/Prompt';
import { showNotice } from '../../lib/notices';
import { getPlatformCaps } from '../../lib/platform';
import { hasSyncServer } from '../../lib/sync/apiBase';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { openPluginView } from '../registry';
import { downloadBlob, exportFileName } from '../../lib/export/download';
import { feedsOpml, importOpml, refreshFeeds } from './feedsModel';
import { useFeedsUi } from './store';

/** What the menus, the view and the card share: the gate on fetching,
 *  adding a feed by its address, refreshing with the rows marked busy,
 *  and opening the Feeds view on a feed. */

export const VIEW_ID = 'feeds';

/** Feeds fetch through the sync server: say so (and open sign-in) when it
 *  is missing; true when a fetch can run. */
function requireRss(): boolean {
  if (getPlatformCaps().rss) return true;
  if (!hasSyncServer()) {
    showNotice('This deployment has no sync server, so RSS feeds cannot be fetched.', {
      id: 'rss-signin',
      kind: 'info',
    });
    return false;
  }
  showNotice(
    'RSS feeds are fetched through your sync server. Sign in under Board sync to use them.',
    { id: 'rss-signin', kind: 'info' },
  );
  useSessionStore.getState().setSyncDialogOpen(true);
  return false;
}

/** Open the Add RSS Feed dialog (address and folder), on `folder`. */
export function openAddFeed(folder = ''): void {
  if (!requireRss()) return;
  useFeedsUi.getState().openAdd(folder);
}

/** Change a feed's address and fetch it again. */
export async function editFeedUrl(id: string): Promise<void> {
  const item = useDocumentStore.getState().doc.items[id];
  if (item?.type !== 'rss') return;
  const url = await promptText({
    title: 'Edit feed',
    label: 'Feed URL',
    initial: item.url,
    type: 'url',
    confirmLabel: 'Save',
  });
  if (!url || !url.trim() || url.trim() === item.url) return;
  updateItems([id], 'Edit feed', (d) => {
    if (d.type === 'rss') d.url = url.trim();
  });
  await refreshFeedsNow([id]);
}

/** Refetch feeds with their rows marked busy; the failures, by id. */
export async function refreshFeedsNow(ids: string[]): Promise<string[]> {
  if (ids.length === 0 || !requireRss()) return ids;
  const ui = useFeedsUi.getState();
  ui.setBusy(ids, true);
  try {
    return await refreshFeeds(ids);
  } finally {
    useFeedsUi.getState().setBusy(ids, false);
  }
}

/** Switch to the Feeds view, on a feed when given. */
export function openFeeds(itemId?: string): void {
  if (itemId) useFeedsUi.getState().setSelected(itemId);
  // The full view replaces whatever was showing — including the lightbox.
  useSessionStore.getState().setLightbox(null);
  openPluginView(VIEW_ID);
}

/** Read OPML files and add the feeds they list; a notice says how many. */
export async function importOpmlFiles(files: File[]): Promise<void> {
  let added = 0;
  let skipped = 0;
  for (const file of files) {
    try {
      const out = await importOpml(await file.text());
      added += out.added.length;
      skipped += out.skipped;
    } catch (err) {
      showNotice(err instanceof Error ? err.message : `${file.name} could not be read.`, {
        kind: 'warn',
      });
      return;
    }
  }
  const dup = skipped ? ` (${skipped} already on the board)` : '';
  showNotice(
    added === 0
      ? `No new feeds${dup}.`
      : `${added} ${added === 1 ? 'feed' : 'feeds'} imported to the Feeds view${dup}.`,
  );
}

/** Download the board's feeds as an OPML file. */
export function exportFeedsOpml(): void {
  const doc = useDocumentStore.getState().doc;
  downloadBlob(
    new Blob([feedsOpml(doc)], { type: 'text/x-opml;charset=utf-8' }),
    exportFileName(undefined, doc.name || 'feeds', 'opml'),
  );
}
