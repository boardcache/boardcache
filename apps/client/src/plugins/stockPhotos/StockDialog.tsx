import { useEffect, useRef, useState } from 'react';
import {
  enabledStockSources,
  importStockResult,
  loadStockKeys,
  saveEnabledStockSources,
  searchStock,
  STOCK_SOURCES,
} from './stock';
import { usePluginSettings } from '../settingsStore';
import type { StockKind, StockResult, StockSourceId } from './stock';
import { useSessionStore } from '../../state/sessionStore';
import { UiDialog } from '../../components/ui/Dialog';
import { PlayIcon } from '../../components/icons';

const EMPTY_KEYS: Record<string, string> = {};

/** Stock photo/video search across providers, with a source sidebar. */
export function StockDialog() {
  const open = useSessionStore((s) => s.stockOpen);
  return open ? <StockBody /> : null;
}

function StockBody() {
  const close = () => useSessionStore.getState().setStockOpen(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<StockKind>('photo');
  const [enabled, setEnabled] = useState<StockSourceId[]>(enabledStockSources);
  // Keys live in the plugin's settings (Settings → Plugins → Stock Media).
  const stockSettings = usePluginSettings((s) => s.settings['stock-photos']) as
    | { keys?: Record<string, string> }
    | undefined;
  const keys = stockSettings?.keys ?? EMPTY_KEYS;
  const [results, setResults] = useState<StockResult[]>([]);
  const [errors, setErrors] = useState<Partial<Record<StockSourceId, string>>>({});
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState<string | null>(null);
  const seq = useRef(0);
  // Infinite scroll: the next page to fetch, and whether any source has more.
  const pageRef = useRef(1);
  const [exhausted, setExhausted] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const runSearch = async (q: string, k: StockKind, srcs: StockSourceId[]) => {
    if (!q.trim()) {
      setResults([]);
      setErrors({});
      setExhausted(true);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    pageRef.current = 1;
    const outcome = await searchStock(q.trim(), k, srcs, loadStockKeys());
    if (mine !== seq.current) return; // stale
    setResults(outcome.results);
    setErrors(outcome.errors);
    setExhausted(outcome.exhausted);
    setBusy(false);
    gridRef.current?.scrollTo({ top: 0 });
  };

  const MAX_PAGES = 25;

  const loadMore = async () => {
    if (busy || loadingMore || exhausted || !query.trim()) return;
    const mine = seq.current;
    setLoadingMore(true);
    const next = pageRef.current + 1;
    const outcome = await searchStock(query.trim(), kind, enabled, loadStockKeys(), next);
    if (mine !== seq.current) return; // a new search superseded this page
    pageRef.current = next;
    const seen = new Set(results.map((r) => r.id));
    const fresh = outcome.results.filter((r) => !seen.has(r.id));
    if (fresh.length) setResults((prev) => [...prev, ...fresh]);
    // Stop when the round says so, when a source repeats itself (a page that
    // adds nothing new would otherwise loop forever), or at a sanity cap.
    setExhausted(outcome.exhausted || fresh.length === 0 || next >= MAX_PAGES);
    setLoadingMore(false);
  };

  // Fetch the next page when the bottom sentinel scrolls into view.
  useEffect(() => {
    const grid = gridRef.current;
    const sentinel = sentinelRef.current;
    if (!grid || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: grid, rootMargin: '300px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm per state snapshot
  }, [results, exhausted, busy, loadingMore, query, kind, enabled]);

  // Debounced live search.
  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query, kind, enabled), 450);
    return () => clearTimeout(timer);
  }, [query, kind, enabled, keys]);

  const toggleSource = (id: StockSourceId) => {
    setEnabled((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      saveEnabledStockSources(next);
      return next;
    });
  };

  const add = async (result: StockResult) => {
    if (added.has(result.id) || importing) return;
    setImporting(result.id);
    try {
      await importStockResult(result);
      setAdded((prev) => new Set(prev).add(result.id));
    } catch {
      window.alert('Downloading this item failed.');
    } finally {
      setImporting(null);
    }
  };

  return (
    <UiDialog title="Add Stock Media" onClose={close} className="stock-sheet" testId="stock-dialog">
      <div className="stock-body">
        <aside className="stock-side">
          <div className="stock-side-head">Sources</div>
          {STOCK_SOURCES.map((s) => (
            <div key={s.id} className="stock-source">
              <label className="stock-source-row">
                <input
                  type="checkbox"
                  checked={enabled.includes(s.id)}
                  onChange={() => toggleSource(s.id)}
                  data-testid={`stock-source-${s.id}`}
                />
                <span>{s.label}</span>
              </label>
              {s.needsKey && enabled.includes(s.id) && !(keys[s.id] ?? '').trim() && (
                <p className="stock-source-error" data-testid={`stock-needs-key-${s.id}`}>
                  Needs an API key — add it in Settings → Plugins → Stock Media.
                </p>
              )}
              {errors[s.id] && <p className="stock-source-error">{errors[s.id]}</p>}
            </div>
          ))}
        </aside>

        <div className="stock-main">
          <div className="stock-search-row">
            <input
              className="stock-search"
              value={query}
              placeholder="Search stock media"
              autoFocus
              data-autofocus
              data-testid="stock-search"
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="seg">
              <button
                type="button"
                className={kind === 'photo' ? 'active' : ''}
                onClick={() => setKind('photo')}
                data-testid="stock-kind-photo"
              >
                Photos
              </button>
              <button
                type="button"
                className={kind === 'video' ? 'active' : ''}
                onClick={() => setKind('video')}
                data-testid="stock-kind-video"
              >
                Videos
              </button>
            </div>
          </div>

          <div className="stock-grid" data-testid="stock-grid" ref={gridRef}>
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`stock-item${added.has(r.id) ? ' added' : ''}`}
                onClick={() => void add(r)}
                disabled={importing !== null && importing !== r.id}
                title={`${r.author} — ${r.source}`}
                data-testid="stock-item"
              >
                <img src={r.thumbUrl} alt="" loading="lazy" draggable={false} />
                {r.kind === 'video' && (
                  <span className="stock-play">
                    <PlayIcon size={18} />
                  </span>
                )}
                {importing === r.id && <span className="stock-state">Adding</span>}
                {added.has(r.id) && <span className="stock-state">✓ Added</span>}
                <span className="stock-credit">
                  {r.author} · {r.source}
                </span>
              </button>
            ))}
            {!busy && results.length === 0 && query.trim() && (
              <p className="stock-empty">
                No results — check the enabled sources (key-based ones need an API key).
              </p>
            )}
            {!query.trim() && <p className="stock-empty">Type to search the enabled sources.</p>}
            {busy && <p className="stock-empty">Searching</p>}
            {loadingMore && (
              <p className="stock-empty" data-testid="stock-loading-more">
                Loading more
              </p>
            )}
            <div ref={sentinelRef} className="stock-sentinel" aria-hidden />
          </div>
        </div>
      </div>
    </UiDialog>
  );
}
