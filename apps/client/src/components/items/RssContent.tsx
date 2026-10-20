import { safeHttpUrl } from '../../lib/text/safeUrl';
import { useState } from 'react';
import type { RssItem } from '@boardcache/schema';
import { hasSyncServer } from '../../lib/sync/apiBase';
import { usePlatformCaps } from '../../lib/platform';
import { refreshRssItem } from '../../lib/integrations/rss';
import { updateItems } from '../../state/commands';
import { useSessionStore } from '../../state/sessionStore';
import { LoopIcon } from '../icons';

/**
 * RSS reader box: cached feed entries in a scrollable list. Thumbnails sit
 * left of the headline + excerpt; clicking an entry opens the article in a
 * new tab. ↻ refetches through the server proxy.
 */
export function RssContent({ item }: { item: RssItem }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reader typography follows the app's default text font (Settings → Text).
  const fontFamily = useSessionStore((s) => s.textDefaults.fontFamily);
  const caps = usePlatformCaps();

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

  return (
    <div
      className="rss-card"
      data-testid="rss-card"
      style={{ fontFamily, ['--rss-scale' as string]: item.fontScale }}
    >
      <header className="rss-head" onDoubleClick={(e) => e.stopPropagation()}>
        <span className="rss-title" title={item.url}>
          {item.feedTitle ?? (item.fetchedAt ? item.url : 'Loading feed')}
        </span>
        <button
          type="button"
          className="rss-refresh"
          onClick={(e) => {
            e.stopPropagation();
            bumpScale(1 / 1.15);
          }}
          onPointerDown={(e) => e.stopPropagation()}
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
          onPointerDown={(e) => e.stopPropagation()}
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
          onPointerDown={(e) => e.stopPropagation()}
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

      <div className="rss-list" data-testid="rss-list" onPointerDown={(e) => e.stopPropagation()}>
        {item.entries.map((entry) => (
          <button
            key={entry.link}
            type="button"
            className="rss-entry"
            onClick={(e) => {
              e.stopPropagation();
              {
                const target = safeHttpUrl(entry.link);
                if (target) window.open(target, '_blank', 'noopener,noreferrer');
              }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={entry.link}
            data-testid="rss-entry"
          >
            {entry.thumbnail && (
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
              {entry.excerpt && <span className="rss-entry-excerpt">{entry.excerpt}</span>}
            </span>
          </button>
        ))}
        {item.entries.length === 0 && !error && !caps.rss && (
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
        {item.entries.length === 0 && !error && caps.rss && (
          <p className="rss-empty">{item.fetchedAt ? 'No entries.' : 'Fetching'}</p>
        )}
      </div>
    </div>
  );
}
