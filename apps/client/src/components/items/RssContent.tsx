import { safeHttpUrl } from '../../lib/text/safeUrl';
import { useState } from 'react';
import type { RssItem } from '@boardcache/schema';
import { hasSyncServer } from '../../lib/sync/apiBase';
import { usePlatformCaps } from '../../lib/platform';
import { refreshRssItem } from '../../lib/integrations/rss';
import { updateItems } from '../../state/commands';
import { useSessionStore } from '../../state/sessionStore';
import { LoopIcon, TextQuoteIcon } from '../icons';

/**
 * RSS reader box: cached feed entries in a scrollable list of headlines;
 * the quote button adds each entry's excerpt and thumbnail (kept on the
 * item). Clicking an entry opens the article in a new tab, ↻ refetches
 * through the server proxy, and a double-click on the title bar opens the
 * reader in the lightbox like any other card.
 */

/** Flip the card between headlines alone and headlines with excerpts. */
export function toggleRssExcerpts(id: string): void {
  updateItems([id], 'Feed excerpts', (draft) => {
    if (draft.type === 'rss') draft.showExcerpts = !draft.showExcerpts;
  });
}

/** The feed's entries as a list: headlines, with the excerpt and thumbnail
 *  when the item shows them. Shared by the card, the lightbox and the
 *  Feeds view. */
export function RssEntryList({ item }: { item: RssItem }) {
  const caps = usePlatformCaps();
  const excerpts = item.showExcerpts;
  return (
    <div
      className={`rss-list${excerpts ? '' : ' rss-list-compact'}`}
      data-testid="rss-list"
      data-excerpts={excerpts ? 'true' : 'false'}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {item.entries.map((entry) => (
        <button
          key={entry.link}
          type="button"
          className="rss-entry"
          onClick={(e) => {
            e.stopPropagation();
            const target = safeHttpUrl(entry.link);
            if (target) window.open(target, '_blank', 'noopener,noreferrer');
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={entry.link}
          data-testid="rss-entry"
        >
          {excerpts && entry.thumbnail && (
            <img
              className="rss-thumb"
              src={entry.thumbnail}
              alt=""
              loading="lazy"
              draggable={false}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <span className="rss-entry-text">
            <span className="rss-entry-title">{entry.title}</span>
            {excerpts && entry.excerpt && (
              <span className="rss-entry-excerpt">{entry.excerpt}</span>
            )}
          </span>
        </button>
      ))}
      {item.entries.length === 0 && !caps.rss && (
        <p className="rss-empty" data-testid="rss-gate">
          {hasSyncServer() ? (
            <>
              RSS feeds load through your sync server.{' '}
              <button
                type="button"
                className="rss-gate-link"
                onClick={() => useSessionStore.getState().setSyncDialogOpen(true)}
              >
                Sign in under Board sync
              </button>{' '}
              to fetch this feed.
            </>
          ) : (
            'This deployment has no sync server, so this feed can’t be fetched.'
          )}
        </p>
      )}
      {item.entries.length === 0 && caps.rss && (
        <p className="rss-empty">{item.fetchedAt ? 'No entries.' : 'Fetching'}</p>
      )}
    </div>
  );
}

export function RssContent({ item }: { item: RssItem }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reader typography follows the app's default text font (Settings → Text).
  const fontFamily = useSessionStore((s) => s.textDefaults.fontFamily);

  const bumpScale = (factor: number) => {
    updateItems([item.id], 'RSS text size', (draft) => {
      if (draft.type !== 'rss') return;
      draft.fontScale = Math.min(2.2, Math.max(0.6, draft.fontScale * factor));
    });
  };

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await refreshRssItem(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      setBusy(false);
    }
  };

  // The bar's buttons act on a click and swallow a double-click; the title
  // itself lets a double-click through to the card (the lightbox).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="rss-card"
      data-testid="rss-card"
      style={{ fontFamily, ['--rss-scale' as string]: item.fontScale }}
    >
      <header className="rss-head" data-testid="rss-head">
        <span className="rss-title" title={item.url}>
          {item.feedTitle ?? (item.fetchedAt ? item.url : 'Loading feed')}
        </span>
        <button
          type="button"
          className={`rss-refresh${item.showExcerpts ? ' active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleRssExcerpts(item.id);
          }}
          onPointerDown={stop}
          onDoubleClick={stop}
          title={item.showExcerpts ? 'Headlines only' : 'Show excerpts'}
          aria-label={item.showExcerpts ? 'Headlines only' : 'Show excerpts'}
          aria-pressed={item.showExcerpts}
          data-testid="rss-excerpts"
        >
          <TextQuoteIcon size={13} />
        </button>
        <button
          type="button"
          className="rss-refresh"
          onClick={(e) => {
            e.stopPropagation();
            bumpScale(1 / 1.15);
          }}
          onPointerDown={stop}
          onDoubleClick={stop}
          title="Smaller text"
          aria-label="Decrease text size"
          data-testid="rss-text-smaller"
        >
          A−
        </button>
        <button
          type="button"
          className="rss-refresh"
          onClick={(e) => {
            e.stopPropagation();
            bumpScale(1.15);
          }}
          onPointerDown={stop}
          onDoubleClick={stop}
          title="Larger text"
          aria-label="Increase text size"
          data-testid="rss-text-larger"
        >
          A+
        </button>
        <button
          type="button"
          className={`rss-refresh${busy ? ' busy' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            void refresh();
          }}
          onPointerDown={stop}
          onDoubleClick={stop}
          disabled={busy}
          title={
            item.fetchedAt
              ? `Refresh (last: ${new Date(item.fetchedAt).toLocaleString()})`
              : 'Refresh'
          }
          aria-label="Refresh feed"
          data-testid="rss-refresh"
        >
          <LoopIcon size={13} />
        </button>
      </header>

      {error && (
        <p className="rss-error" role="alert" data-testid="rss-error">
          {error}
        </p>
      )}

      <RssEntryList item={item} />
    </div>
  );
}
