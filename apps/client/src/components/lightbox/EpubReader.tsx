import { useEffect, useRef, useState } from 'react';
import type { EpubItem } from '@boardcache/schema';
import type { Book, Rendition, NavItem } from 'epubjs';
import { getAssetBlob } from '../../lib/board/assetStore';
import { VIEWER, viewerAssetUrl } from '../../lib/viewerMode';
import { importImageFiles } from '../../lib/import/importImages';
import { openSpotNear } from '../../lib/canvas/placeSpot';
import { createQuoteCard } from '../../lib/text/quoteExcerpt';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { BookmarkIcon, CameraIcon, ChevronLeftIcon, ChevronRightIcon, ListIcon } from '../icons';

/**
 * Full ePub reader for the lightbox stage: epub.js rendition with previous/
 * next paging, a TOC drawer, bookmarks (saved on the item, so they sync),
 * and page screenshots that land as image items beside the book on the
 * canvas. epub.js and html2canvas are lazy chunks — the viewer bundle and
 * plain canvas rendering never load them. The reading position persists to
 * the document ONCE, when the reader closes (a single history entry).
 * While the reader is open, ArrowLeft/ArrowRight flip pages instead of
 * switching lightbox items (captured before the lightbox handler; also
 * wired to the keys epub.js relays from inside its iframe).
 */

interface Toc {
  label: string;
  href: string;
}

const HL_COLORS = ['#ffd43b', '#8ce99a', '#faa2c1'];

/** epub.js paints highlights as SVG; keep them translucent under the text. */
const hlStyle = (color: string) => ({ fill: color, 'fill-opacity': '0.35' });

function flattenToc(items: NavItem[], depth = 0, out: Toc[] = []): Toc[] {
  for (const it of items) {
    out.push({ label: `${' '.repeat(depth)}${it.label.trim()}`, href: it.href });
    if (it.subitems?.length) flattenToc(it.subitems, depth + 1, out);
  }
  return out;
}

export function EpubReader({ item }: { item: EpubItem }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const locationRef = useRef<string | null>(item.location);
  const chapterRef = useRef<string>('');
  const [toc, setToc] = useState<Toc[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [shotBusy, setShotBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // Live copies so the panel updates without re-reading the doc.
  const bookmarks = useDocumentStore((s) => {
    const it = s.doc.items[item.id];
    return it?.type === 'epub' ? it.bookmarks : [];
  });
  const highlights = useDocumentStore((s) => {
    const it = s.doc.items[item.id];
    return it?.type === 'epub' ? it.highlights : [];
  });
  /** Pending text selection inside the book (cfi range + excerpt). */
  const [pendingSel, setPendingSel] = useState<{ cfi: string; text: string } | null>(null);

  useEffect(() => {
    let dead = false;
    const holder = holderRef.current;
    if (!holder) return;

    void (async () => {
      try {
        const blob = VIEWER
          ? await fetch(viewerAssetUrl(item.assetId) ?? '').then((r) => (r.ok ? r.blob() : null))
          : await getAssetBlob(item.assetId);
        if (!blob) throw new Error('asset missing');
        const { default: ePub } = await import('epubjs');
        if (dead) return;
        const book = ePub(await blob.arrayBuffer());
        bookRef.current = book;
        const rendition = book.renderTo(holder, {
          width: '100%',
          height: '100%',
          spread: 'none',
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        // Keys pressed while focus sits inside the book's iframe arrive via
        // epub.js's relay; the window listener below covers everything else.
        rendition.on('keydown', (ev: KeyboardEvent) => {
          if (ev.key === 'ArrowLeft') void rendition.prev();
          if (ev.key === 'ArrowRight') void rendition.next();
        });
        rendition.on('relocated', (loc: { start?: { cfi?: string; href?: string } }) => {
          if (loc.start?.cfi) locationRef.current = loc.start.cfi;
          if (loc.start?.href) {
            const nav = bookRef.current?.navigation;
            const hit = nav?.get(loc.start.href);
            chapterRef.current = hit?.label?.trim() ?? '';
          }
        });
        rendition.on('selected', (cfiRange: string, contents: { window: Window }) => {
          if (dead) return;
          // The live iframe selection is the reliable source for the excerpt
          // (getRange over the CFI can under-report on fast selections).
          const live = contents.window.getSelection()?.toString() ?? '';
          void book.getRange(cfiRange).then((range) => {
            if (dead) return;
            const text = (live || range?.toString() || '').slice(0, 300);
            setPendingSel({ cfi: cfiRange, text });
          });
        });
        await rendition.display(item.location ?? undefined);
        // Re-paint saved highlights (annotations persist across displays).
        for (const h of useDocumentStore.getState().doc.items[item.id]?.type === 'epub'
          ? (useDocumentStore.getState().doc.items[item.id] as EpubItem).highlights
          : []) {
          rendition.annotations.highlight(h.cfi, {}, undefined, 'epub-hl', hlStyle(h.color));
        }
        const nav = await book.loaded.navigation;
        if (dead) return;
        setToc(flattenToc(nav.toc));
        setStatus('ready');
      } catch (err) {
        console.error('boardCache: ePub failed to open', err);
        if (!dead) setStatus('error');
      }
    })();

    return () => {
      dead = true;
      // Persist the reading position as ONE labeled entry on close.
      const cfi = locationRef.current;
      if (cfi && cfi !== item.location) {
        updateItems([item.id], 'Reading position', (it) => {
          if (it.type === 'epub') it.location = cfi;
        });
      }
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.assetId]);

  // Arrow keys page the book while the reader is open — captured ahead of
  // the lightbox's item navigation. Text fields (e.g. the Assistant tab's
  // input) keep their own arrow behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowLeft') void renditionRef.current?.prev();
      else void renditionRef.current?.next();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const note = (text: string) => {
    setFlash(text);
    window.setTimeout(() => setFlash(null), 2200);
  };

  const addBookmark = () => {
    const cfi = locationRef.current;
    if (!cfi) return;
    const label = chapterRef.current || `Location ${bookmarks.length + 1}`;
    updateItems([item.id], 'Add bookmark', (it) => {
      if (it.type !== 'epub') return;
      if (it.bookmarks.some((b) => b.cfi === cfi)) return;
      it.bookmarks.push({ cfi, label });
    });
    note('Bookmarked');
  };

  const addHighlight = (color: string) => {
    const sel = pendingSel;
    if (!sel) return;
    updateItems([item.id], 'Add highlight', (it) => {
      if (it.type !== 'epub') return;
      if (it.highlights.some((h) => h.cfi === sel.cfi)) return;
      it.highlights.push({ cfi: sel.cfi, color, text: sel.text });
    });
    renditionRef.current?.annotations.highlight(sel.cfi, {}, undefined, 'epub-hl', hlStyle(color));
    setPendingSel(null);
    note('Highlighted');
  };

  const removeHighlight = (cfi: string) => {
    updateItems([item.id], 'Remove highlight', (it) => {
      if (it.type !== 'epub') return;
      it.highlights = it.highlights.filter((h) => h.cfi !== cfi);
    });
    try {
      renditionRef.current?.annotations.remove(cfi, 'highlight');
    } catch {
      /* not painted in this session */
    }
  };

  const removeBookmark = (cfi: string) => {
    updateItems([item.id], 'Remove bookmark', (it) => {
      if (it.type !== 'epub') return;
      it.bookmarks = it.bookmarks.filter((b) => b.cfi !== cfi);
    });
  };

  /** Capture the current page as an image item placed beside the book. */
  const screenshot = async () => {
    const holder = holderRef.current;
    if (!holder || shotBusy) return;
    setShotBusy(true);
    try {
      const iframe = holder.querySelector('iframe');
      const body = iframe?.contentDocument?.body;
      if (!body) throw new Error('page not rendered');
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(body, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        windowWidth: body.scrollWidth,
      });
      const pageBlob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!pageBlob) throw new Error('capture failed');
      const title = item.bookTitle ?? item.name ?? 'ePub';
      const chapter = chapterRef.current ? ` — ${chapterRef.current}` : '';
      const file = new File([pageBlob], `${title}${chapter}.png`, { type: 'image/png' });
      const { doc } = useDocumentStore.getState();
      const it = doc.items[item.id];
      const at = it
        ? openSpotNear({ x: it.x + it.width + 28 + 200, y: it.y + 150 }, 400, 300)
        : { x: 0, y: 0 };
      await importImageFiles([file], at);
      note('Page captured to the canvas');
    } catch (err) {
      console.error('boardCache: page capture failed', err);
      note('Could not capture this page');
    } finally {
      setShotBusy(false);
    }
  };

  return (
    <div className="lightbox-epub" onClick={(e) => e.stopPropagation()} data-testid="lightbox-epub">
      <header className="epub-bar">
        <button
          type="button"
          className={tocOpen ? 'active' : ''}
          title="Contents & bookmarks"
          data-testid="epub-toc-toggle"
          onClick={() => setTocOpen((o) => !o)}
        >
          <ListIcon size={15} />
        </button>
        <span className="epub-bar-title">{item.bookTitle ?? item.name ?? 'ePub'}</span>
        {pendingSel && (
          <span className="epub-hl-picker" data-testid="epub-hl-picker">
            <span className="epub-hl-label">Highlight:</span>
            {HL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="epub-hl-swatch"
                style={{ background: c }}
                aria-label={`Highlight ${c}`}
                data-testid="epub-hl-color"
                onClick={() => addHighlight(c)}
              />
            ))}
            <button
              type="button"
              className="epub-hl-quote"
              data-testid="epub-quote-btn"
              title="Add this passage to the canvas as a quote card, connected to this book"
              onClick={() => {
                const sel = pendingSel;
                if (!sel) return;
                createQuoteCard(item.id, sel.text, item.bookTitle ?? item.name ?? 'ePub');
                setPendingSel(null);
                note('Quote card added');
              }}
            >
              Quote to Board
            </button>
          </span>
        )}
        <button
          type="button"
          title="Bookmark this location"
          data-testid="epub-bookmark"
          onClick={addBookmark}
        >
          <BookmarkIcon size={15} />
        </button>
        <button
          type="button"
          title="Capture this page to the canvas"
          data-testid="epub-screenshot"
          disabled={shotBusy}
          onClick={() => void screenshot()}
        >
          <CameraIcon size={15} />
        </button>
      </header>
      <div className="epub-main">
        {tocOpen && (
          <aside className="epub-toc" data-testid="epub-toc">
            {bookmarks.length > 0 && (
              <>
                <h4>Bookmarks</h4>
                {bookmarks.map((b) => (
                  <div className="epub-toc-row" key={b.cfi}>
                    <button
                      type="button"
                      className="epub-toc-link"
                      data-testid="epub-bookmark-link"
                      onClick={() => void renditionRef.current?.display(b.cfi)}
                    >
                      {b.label}
                    </button>
                    <button
                      type="button"
                      className="epub-toc-x"
                      aria-label={`Remove bookmark ${b.label}`}
                      onClick={() => removeBookmark(b.cfi)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            )}
            {highlights.length > 0 && (
              <>
                <h4>Highlights</h4>
                {highlights.map((h) => (
                  <div className="epub-toc-row" key={h.cfi}>
                    <button
                      type="button"
                      className="epub-toc-link epub-hl-link"
                      data-testid="epub-highlight-link"
                      onClick={() => void renditionRef.current?.display(h.cfi)}
                    >
                      <i className="epub-hl-dot" style={{ background: h.color }} />
                      {h.text || 'Highlight'}
                    </button>
                    <button
                      type="button"
                      className="epub-toc-x"
                      aria-label="Remove highlight"
                      onClick={() => removeHighlight(h.cfi)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            )}
            <h4>Contents</h4>
            {toc.map((t, i) => (
              <button
                key={i}
                type="button"
                className="epub-toc-link"
                data-testid="epub-toc-link"
                onClick={() => void renditionRef.current?.display(t.href)}
              >
                {t.label}
              </button>
            ))}
            {toc.length === 0 && <p className="epub-toc-empty">No table of contents.</p>}
          </aside>
        )}
        <div className="epub-stage">
          <button
            type="button"
            className="epub-nav epub-prev"
            aria-label="Previous page"
            data-testid="epub-prev"
            onClick={() => void renditionRef.current?.prev()}
          >
            <ChevronLeftIcon size={18} />
          </button>
          <div className="epub-holder" ref={holderRef}>
            {status === 'loading' && <span className="item-placeholder">Opening ePub</span>}
            {status === 'error' && (
              <span className="item-placeholder">This ePub could not be opened.</span>
            )}
          </div>
          <button
            type="button"
            className="epub-nav epub-next"
            aria-label="Next page"
            data-testid="epub-next"
            onClick={() => void renditionRef.current?.next()}
          >
            <ChevronRightIcon size={18} />
          </button>
        </div>
      </div>
      {flash && <div className="epub-flash">{flash}</div>}
    </div>
  );
}
