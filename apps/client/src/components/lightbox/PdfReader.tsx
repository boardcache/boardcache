import { useEffect, useRef, useState } from 'react';
import type { PdfItem, PdfHighlight } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { VIEWER } from '../../lib/viewerMode';
import { usePhoneViewport } from '../../hooks/useMobileViewport';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from '../ui/Popover';
import { createQuoteCard } from '../../lib/text/quoteExcerpt';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import {
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FitPageIcon,
  ListIcon,
  MatchWidthIcon,
  MinusIcon,
  MoreIcon,
  PlusIcon,
  PrinterIcon,
  RotateIcon,
  ScrollViewIcon,
} from '../icons';

/**
 * pdf.js reader for the lightbox: canvas pages with a real text layer, an
 * outline/bookmark/highlight drawer, Chrome-parity toolbar (zoom, fit modes,
 * rotate, find, download, print) and TWO view modes — single page and
 * continuous scroll. Scroll mode renders pages lazily (IntersectionObserver)
 * and tracks the most-visible page as "current". Annotations live ON the
 * item, so they sync and ride shares. The reading page persists on close.
 */

const HL_COLORS = ['#ffd43b', '#8ce99a', '#faa2c1'];
const VIEW_PREF = 'boardcache:pdfView';

interface OutlineRow {
  label: string;
  page: number | null;
}

type Zoom = 'fit-width' | 'fit-page' | number;

/** One rendered page: canvas + text layer + highlight overlay. */
function PdfPageView({
  docRef,
  holderRef,
  pageNo,
  zoom,
  rotation,
  query,
  highlights,
  lazy,
  onScaled,
  onSelection,
  registerWrap,
  onNavigate,
}: {
  docRef: React.RefObject<PDFDocumentProxy | null>;
  holderRef: React.RefObject<HTMLDivElement | null>;
  pageNo: number;
  zoom: Zoom;
  rotation: number;
  query: string;
  highlights: PdfHighlight[];
  /** Defer rendering until the page nears the viewport (scroll mode). */
  lazy: boolean;
  onScaled: (scale: number) => void;
  onSelection: (pageNo: number, textDiv: HTMLDivElement | null) => void;
  registerWrap: (pageNo: number, el: HTMLDivElement | null) => void;
  onNavigate: (pageNo: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);
  const renderSeq = useRef(0);
  const [ready, setReady] = useState(!lazy);

  useEffect(() => {
    registerWrap(pageNo, wrapRef.current);
    return () => registerWrap(pageNo, null);
  }, [pageNo, registerWrap]);

  useEffect(() => {
    if (!lazy || ready) return;
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setReady(true);
          io.disconnect();
        }
      },
      { root: holderRef.current, rootMargin: '900px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lazy, ready, holderRef]);

  useEffect(() => {
    if (!ready) return;
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const textDiv = textRef.current;
    const holder = holderRef.current;
    if (!doc || !canvas || !textDiv || !holder) return;
    const seq = ++renderSeq.current;
    void (async () => {
      try {
        const pdfPage = await doc.getPage(pageNo);
        if (seq !== renderSeq.current) return;
        const base = pdfPage.getViewport({ scale: 1, rotation });
        // Fall back to a sane size only while the holder has no layout yet —
        // a hard 280px floor made "fit width" overflow narrow phone holders.
        const availW = holder.clientWidth > 60 ? holder.clientWidth - 32 : 280;
        const availH = holder.clientHeight > 60 ? holder.clientHeight - 32 : 280;
        const scale =
          zoom === 'fit-width'
            ? Math.min(2.5, availW / base.width)
            : zoom === 'fit-page'
              ? Math.min(2.5, availW / base.width, availH / base.height)
              : zoom;
        onScaled(scale);
        const viewport = pdfPage.getViewport({ scale, rotation });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = `${Math.ceil(viewport.width)}px`;
        canvas.style.height = `${Math.ceil(viewport.height)}px`;
        const ctx = canvas.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (seq !== renderSeq.current) return;
        textDiv.replaceChildren();
        textDiv.style.width = `${Math.ceil(viewport.width)}px`;
        textDiv.style.height = `${Math.ceil(viewport.height)}px`;
        const { TextLayer } = await import('pdfjs-dist');
        const layer = new TextLayer({
          textContentSource: pdfPage.streamTextContent(),
          container: textDiv,
          viewport,
        });
        await layer.render();
        // Link annotations: external URLs open in a new tab; internal
        // destinations jump to their page. Without this layer, links in
        // imported PDFs are dead pixels.
        const linkDiv = linkRef.current;
        if (linkDiv) {
          linkDiv.replaceChildren();
          linkDiv.style.width = `${Math.ceil(viewport.width)}px`;
          linkDiv.style.height = `${Math.ceil(viewport.height)}px`;
          const annotations = (await pdfPage.getAnnotations()) as {
            subtype?: string;
            url?: string;
            dest?: unknown;
            rect?: number[];
          }[];
          for (const a of annotations) {
            if (a.subtype !== 'Link' || !a.rect || (!a.url && !a.dest)) continue;
            // pdf.js 6.3 dropped convertToViewportRectangle: map the two corners.
            const r = a.rect as [number, number, number, number];
            const [ax, ay] = viewport.convertToViewportPoint(r[0], r[1]) as [number, number];
            const [bx, by] = viewport.convertToViewportPoint(r[2], r[3]) as [number, number];
            const [x1, y1, x2, y2] = [ax, ay, bx, by];
            const el = document.createElement('a');
            el.className = 'pdf-link';
            el.style.left = `${Math.min(x1, x2)}px`;
            el.style.top = `${Math.min(y1, y2)}px`;
            el.style.width = `${Math.abs(x2 - x1)}px`;
            el.style.height = `${Math.abs(y2 - y1)}px`;
            if (a.url) {
              el.href = a.url;
              el.target = '_blank';
              el.rel = 'noreferrer noopener';
              el.title = a.url;
            } else {
              const dest = a.dest;
              el.href = '#';
              el.addEventListener('click', (ev) => {
                ev.preventDefault();
                void (async () => {
                  try {
                    const doc2 = docRef.current;
                    if (!doc2) return;
                    const resolved =
                      typeof dest === 'string'
                        ? await doc2.getDestination(dest)
                        : (dest as unknown[]);
                    const ref = Array.isArray(resolved) ? resolved[0] : null;
                    if (ref) {
                      const index = await doc2.getPageIndex(
                        ref as Parameters<typeof doc2.getPageIndex>[0],
                      );
                      onNavigateRef.current(index + 1);
                    }
                  } catch {
                    /* unresolvable destination */
                  }
                })();
              });
            }
            linkDiv.append(el);
          }
        }
        if (query) {
          const q = query.toLowerCase();
          for (const sp of textDiv.querySelectorAll('span')) {
            if (sp.textContent?.toLowerCase().includes(q)) sp.classList.add('pdf-find-hit');
          }
        }
      } catch (err) {
        if (seq === renderSeq.current) {
          console.error('boardCache: PDF page render failed', err);
        }
      }
    })();
  }, [ready, pageNo, zoom, rotation, query, docRef, holderRef, onScaled]);

  const pageHighlights = highlights.filter((h) => h.page === pageNo);

  return (
    <div
      className="pdf-page-wrap"
      data-page={pageNo}
      ref={wrapRef}
      onPointerUp={() => onSelection(pageNo, textRef.current)}
    >
      {!ready && <div className="pdf-page-pending" />}
      <canvas ref={canvasRef} />
      <div className="pdf-link-layer" ref={linkRef} />
      <div className="pdf-hl-layer" aria-hidden hidden={rotation !== 0}>
        {pageHighlights.map((h) =>
          h.rects.map((r, i) => (
            <i
              key={`${h.id}-${i}`}
              data-testid="pdf-highlight-rect"
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
                background: h.color,
              }}
            />
          )),
        )}
      </div>
      <div className="textLayer pdf-text-layer" ref={textRef} />
    </div>
  );
}

export function PdfReader({ item }: { item: PdfItem }) {
  const url = useAssetUrl(item.assetId);
  const holderRef = useRef<HTMLDivElement>(null);
  /** Touch swipe → page turn (single-page view). */
  const touchSwipeRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pageRef = useRef(item.page);
  const wrapEls = useRef(new Map<number, HTMLDivElement>());
  const [page, setPageState] = useState(item.page);
  const [pageCount, setPageCount] = useState(item.pageCount ?? 0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [outline, setOutline] = useState<OutlineRow[]>([]);
  const [pendingSel, setPendingSel] = useState<{
    page: number;
    rects: { x: number; y: number; w: number; h: number }[];
    text: string;
  } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit-width');
  // Phones: the header keeps contents + find; paging and tools move to a bottom bar.
  const phone = usePhoneViewport();
  const [moreOpen, setMoreOpen] = useState(false);
  const [effScale, setEffScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<number[]>([]);
  const [matchIdx, setMatchIdx] = useState(0);
  const [viewMode, setViewMode] = useState<'single' | 'scroll'>(() => {
    try {
      // Continuous scroll is the default; single-page is the opt-in.
      return localStorage.getItem(VIEW_PREF) === 'single' ? 'single' : 'scroll';
    } catch {
      return 'scroll';
    }
  });
  const textCache = useRef(new Map<number, string>());

  const bookmarks = useDocumentStore((s) => {
    const it = s.doc.items[item.id];
    return it?.type === 'pdf' ? it.bookmarks : [];
  });
  const highlights = useDocumentStore((s) => {
    const it = s.doc.items[item.id];
    return it?.type === 'pdf' ? it.highlights : [];
  });

  const note = (text: string) => {
    setFlash(text);
    window.setTimeout(() => setFlash(null), 2200);
  };

  const scrollToPage = (n: number) => {
    const holder = holderRef.current;
    const el = wrapEls.current.get(n);
    if (!holder || !el) return;
    // Scroll the holder itself — scrollIntoView picks whichever ancestor it
    // likes and left the holder untouched.
    holder.scrollTop += el.getBoundingClientRect().top - holder.getBoundingClientRect().top - 10;
  };

  const setPage = (n: number) => {
    const clamped = Math.max(1, Math.min(pageCount || n, n));
    pageRef.current = clamped;
    setPageState(clamped);
    setPendingSel(null);
    if (viewMode === 'scroll') scrollToPage(clamped);
  };

  const registerWrap = (pageNo: number, el: HTMLDivElement | null) => {
    if (el) wrapEls.current.set(pageNo, el);
    else wrapEls.current.delete(pageNo);
  };

  // Scroll mode: the page nearest the viewport middle becomes "current".
  useEffect(() => {
    if (viewMode !== 'scroll' || status !== 'ready') return;
    const holder = holderRef.current;
    if (!holder) return;
    const onScroll = () => {
      const mid = holder.getBoundingClientRect().top + holder.clientHeight / 2;
      let best: { page: number; dist: number } | null = null;
      for (const [n, el] of wrapEls.current) {
        const r = el.getBoundingClientRect();
        const center = r.top + r.height / 2;
        const dist = Math.abs(center - mid);
        if (!best || dist < best.dist) best = { page: n, dist };
      }
      if (best && best.page !== pageRef.current) {
        pageRef.current = best.page;
        setPageState(best.page);
      }
    };
    holder.addEventListener('scroll', onScroll, { passive: true });
    return () => holder.removeEventListener('scroll', onScroll);
  }, [viewMode, status]);

  // --- load the document ---------------------------------------------------
  useEffect(() => {
    if (!url) return;
    let dead = false;
    let cleanup = () => {};
    void (async () => {
      try {
        const { loadPdf } = await import('../../lib/media/pdfDoc');
        const { doc, destroy } = await loadPdf(url);
        if (dead) {
          destroy();
          return;
        }
        cleanup = destroy;
        docRef.current = doc;
        setPageCount(doc.numPages);
        setStatus('ready');
        try {
          const raw = (await doc.getOutline()) ?? [];
          const rows: OutlineRow[] = [];
          for (const entry of raw.slice(0, 100)) {
            let pageNo: number | null = null;
            try {
              const dest =
                typeof entry.dest === 'string' ? await doc.getDestination(entry.dest) : entry.dest;
              const ref = dest?.[0];
              if (ref) pageNo = (await doc.getPageIndex(ref)) + 1;
            } catch {
              /* unresolvable dest */
            }
            rows.push({ label: entry.title, page: pageNo });
          }
          if (!dead) setOutline(rows);
        } catch {
          /* no outline */
        }
      } catch (err) {
        console.error('boardCache: PDF failed to open', err);
        if (!dead) setStatus('error');
      }
    })();
    return () => {
      dead = true;
      cleanup();
      docRef.current = null;
    };
  }, [url]);

  // Persist the reading page ONCE on close.
  useEffect(() => {
    return () => {
      const current = pageRef.current;
      if (current !== item.page) {
        updateItems([item.id], 'Reading position', (it) => {
          if (it.type === 'pdf') it.page = current;
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // --- selection → pending highlight ---------------------------------------
  const onSelection = (pageNo: number, textDiv: HTMLDivElement | null) => {
    if (VIEWER) return; // a published board takes no highlights
    const sel = window.getSelection();
    if (!textDiv || !sel || sel.isCollapsed || sel.rangeCount === 0) return;
    if (rotation !== 0) return; // highlight rects live in unrotated page space
    const range = sel.getRangeAt(0);
    if (!textDiv.contains(range.commonAncestorContainer)) return;
    const pageBox = textDiv.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .slice(0, 40)
      .map((r) => ({
        x: (r.left - pageBox.left) / pageBox.width,
        y: (r.top - pageBox.top) / pageBox.height,
        w: r.width / pageBox.width,
        h: r.height / pageBox.height,
      }));
    if (rects.length === 0) return;
    setPendingSel({ page: pageNo, rects, text: sel.toString().slice(0, 300) });
  };

  const addHighlight = (color: string) => {
    const sel = pendingSel;
    if (!sel) return;
    updateItems([item.id], 'Add highlight', (it) => {
      if (it.type !== 'pdf') return;
      it.highlights.push({ id: newId(), page: sel.page, rects: sel.rects, color, text: sel.text });
    });
    setPendingSel(null);
    window.getSelection()?.removeAllRanges();
    note('Highlighted');
  };

  const removeHighlight = (id: string) => {
    updateItems([item.id], 'Remove highlight', (it) => {
      if (it.type !== 'pdf') return;
      it.highlights = it.highlights.filter((h) => h.id !== id);
    });
  };

  const toggleBookmark = () => {
    const current = pageRef.current;
    const existing = bookmarks.some((b) => b.page === current);
    updateItems([item.id], existing ? 'Remove bookmark' : 'Add bookmark', (it) => {
      if (it.type !== 'pdf') return;
      it.bookmarks = existing
        ? it.bookmarks.filter((b) => b.page !== current)
        : [...it.bookmarks, { page: current, label: `Page ${current}` }].sort(
            (a, b) => a.page - b.page,
          );
    });
    note(existing ? 'Bookmark removed' : 'Bookmarked');
  };

  // Arrow keys page the document (captured ahead of lightbox item nav).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      const next = pageRef.current + delta;
      if (next >= 1 && (pageCount === 0 || next <= pageCount)) setPage(next);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount, viewMode]);

  const zoomBy = (factor: number) => {
    setZoom(Math.min(5, Math.max(0.25, effScale * factor)));
  };

  const runSearch = async (q: string) => {
    const doc = docRef.current;
    setQuery(q);
    if (!doc || !q.trim()) {
      setMatches([]);
      setMatchIdx(0);
      return;
    }
    const needle = q.trim().toLowerCase();
    const found: number[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      let text = textCache.current.get(n);
      if (text === undefined) {
        try {
          const content = await doc.getPage(n).then((pg) => pg.getTextContent());
          text = content.items
            .map((it) => ('str' in it ? it.str : ''))
            .join(' ')
            .toLowerCase();
        } catch {
          text = '';
        }
        textCache.current.set(n, text);
      }
      if (text.includes(needle)) found.push(n);
    }
    setMatches(found);
    setMatchIdx(0);
    if (found.length) setPage(found[0]!);
    else note('No matches');
  };

  const stepMatch = (delta: number) => {
    if (!matches.length) return;
    const next = (matchIdx + delta + matches.length) % matches.length;
    setMatchIdx(next);
    setPage(matches[next]!);
  };

  const download = async () => {
    const { exportItem } = await import('../../lib/media/imageExport');
    await exportItem(item);
  };

  const print = async () => {
    const { getAssetBlob } = await import('../../lib/board/assetStore');
    const blob = await getAssetBlob(item.assetId);
    if (!blob) return;
    const blobUrl = URL.createObjectURL(blob);
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = blobUrl;
    frame.onload = () => {
      try {
        frame.contentWindow?.print();
      } catch {
        window.open(blobUrl, '_blank', 'noopener');
      }
      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        frame.remove();
      }, 60_000);
    };
    document.body.appendChild(frame);
  };

  const switchView = () => {
    const next = viewMode === 'single' ? 'scroll' : 'single';
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_PREF, next);
    } catch {
      /* storage unavailable */
    }
    // Land on the current page once the new mode's DOM exists.
    if (next === 'scroll') {
      window.setTimeout(() => scrollToPage(pageRef.current), 80);
    }
  };

  const pageMarked = bookmarks.some((b) => b.page === page);
  const pages =
    viewMode === 'scroll' && pageCount > 0
      ? Array.from({ length: pageCount }, (_, i) => i + 1)
      : [page];

  return (
    <div
      className={`lightbox-pdfreader${VIEWER ? ' pdf-readonly' : ''}`}
      onClick={(e) => e.stopPropagation()}
      data-testid="lightbox-pdfreader"
    >
      <header className="epub-bar">
        <button
          type="button"
          className={drawerOpen ? 'active' : ''}
          title="Contents, bookmarks & highlights"
          data-testid="pdf-toc-toggle"
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <ListIcon size={15} />
        </button>
        <span className="epub-bar-title">{item.name ?? 'PDF'}</span>
        {pendingSel && (
          <span className="epub-hl-picker" data-testid="pdf-hl-picker">
            <span className="epub-hl-label">Highlight:</span>
            {HL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="epub-hl-swatch"
                style={{ background: c }}
                aria-label={`Highlight ${c}`}
                data-testid="pdf-hl-color"
                onClick={() => addHighlight(c)}
              />
            ))}
            <button
              type="button"
              className="epub-hl-quote"
              data-testid="pdf-quote-btn"
              title="Add this passage to the canvas as a quote card, connected to this PDF"
              onClick={() => {
                const sel = pendingSel;
                if (!sel) return;
                createQuoteCard(item.id, sel.text, `${item.name ?? 'PDF'}, p. ${sel.page}`);
                setPendingSel(null);
                window.getSelection()?.removeAllRanges();
                note('Quote card added');
              }}
            >
              Quote to Board
            </button>
          </span>
        )}
        <span className="pdf-find">
          <input
            className="pdf-find-input"
            placeholder="Find"
            data-testid="pdf-find-input"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                if (e.currentTarget.value === query && matches.length) stepMatch(1);
                else void runSearch(e.currentTarget.value);
              }
            }}
            aria-label="Find in document"
          />
          {query && (
            <>
              <span className="pdf-find-count" data-testid="pdf-find-count">
                {matches.length ? `${matchIdx + 1}/${matches.length}` : '0'}
              </span>
              <button type="button" aria-label="Previous match" onClick={() => stepMatch(-1)}>
                ‹
              </button>
              <button
                type="button"
                aria-label="Next match"
                data-testid="pdf-find-next"
                onClick={() => stepMatch(1)}
              >
                ›
              </button>
            </>
          )}
        </span>
        {!phone && (
          <>
            <span className="pdf-zoom">
              <button
                type="button"
                aria-label="Zoom out"
                data-testid="pdf-zoom-out"
                onClick={() => zoomBy(1 / 1.2)}
              >
                <MinusIcon size={15} />
              </button>
              <span className="pdf-zoom-pct" data-testid="pdf-zoom-pct">
                {Math.round(effScale * 100)}%
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                data-testid="pdf-zoom-in"
                onClick={() => zoomBy(1.2)}
              >
                <PlusIcon size={15} />
              </button>
              <button
                type="button"
                className={zoom === 'fit-width' ? 'active' : ''}
                title="Fit width"
                data-testid="pdf-fit-width"
                onClick={() => setZoom('fit-width')}
              >
                <MatchWidthIcon size={15} />
              </button>
              <button
                type="button"
                className={zoom === 'fit-page' ? 'active' : ''}
                title="Fit page"
                data-testid="pdf-fit-page"
                onClick={() => setZoom('fit-page')}
              >
                <FitPageIcon size={15} />
              </button>
            </span>
            <button
              type="button"
              className={viewMode === 'scroll' ? 'active' : ''}
              title={viewMode === 'scroll' ? 'Single page view' : 'Continuous scroll view'}
              data-testid="pdf-view-toggle"
              onClick={switchView}
            >
              <ScrollViewIcon size={15} />
            </button>
            <button
              type="button"
              title="Rotate 90°"
              data-testid="pdf-rotate"
              onClick={() => setRotation((r) => (r + 90) % 360)}
            >
              <RotateIcon size={15} />
            </button>
            <button
              type="button"
              title="Download PDF"
              data-testid="pdf-download"
              onClick={() => void download()}
            >
              <DownloadIcon size={15} />
            </button>
            <button
              type="button"
              title="Print"
              data-testid="pdf-print"
              onClick={() => void print()}
            >
              <PrinterIcon size={15} />
            </button>
            <span className="pdf-page-nav">
              <input
                className="pdf-page-input"
                value={page}
                data-testid="pdf-page-input"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1) setPage(n);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Page"
              />
              <span className="pdf-page-count">/ {pageCount || '…'}</span>
            </span>
            <button
              type="button"
              className={pageMarked ? 'active' : ''}
              title={pageMarked ? 'Remove bookmark for this page' : 'Bookmark this page'}
              data-testid="pdf-bookmark"
              onClick={toggleBookmark}
            >
              <BookmarkIcon size={15} />
            </button>
          </>
        )}
      </header>
      <div className="epub-main">
        {drawerOpen && (
          <aside className="epub-toc" data-testid="pdf-drawer">
            {bookmarks.length > 0 && (
              <>
                <h4>Bookmarks</h4>
                {bookmarks.map((b) => (
                  <div className="epub-toc-row" key={b.page}>
                    <button
                      type="button"
                      className="epub-toc-link"
                      data-testid="pdf-bookmark-link"
                      onClick={() => setPage(b.page)}
                    >
                      {b.label}
                    </button>
                    <button
                      type="button"
                      className="epub-toc-x"
                      aria-label={`Remove ${b.label}`}
                      onClick={() =>
                        updateItems([item.id], 'Remove bookmark', (it) => {
                          if (it.type === 'pdf')
                            it.bookmarks = it.bookmarks.filter((x) => x.page !== b.page);
                        })
                      }
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
                  <div className="epub-toc-row" key={h.id}>
                    <button
                      type="button"
                      className="epub-toc-link epub-hl-link"
                      data-testid="pdf-highlight-link"
                      onClick={() => setPage(h.page)}
                    >
                      <i className="epub-hl-dot" style={{ background: h.color }} />
                      {h.text || `Page ${h.page}`}
                    </button>
                    <button
                      type="button"
                      className="epub-toc-x"
                      aria-label="Remove highlight"
                      onClick={() => removeHighlight(h.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            )}
            <h4>Contents</h4>
            {outline.map((o, i) => (
              <button
                key={i}
                type="button"
                className="epub-toc-link"
                data-testid="pdf-toc-link"
                disabled={o.page === null}
                onClick={() => o.page && setPage(o.page)}
              >
                {o.label}
              </button>
            ))}
            {outline.length === 0 && <p className="epub-toc-empty">No table of contents.</p>}
          </aside>
        )}
        <div className="epub-stage">
          {viewMode === 'single' && (
            <button
              type="button"
              className="epub-nav epub-prev"
              aria-label="Previous page"
              data-testid="pdf-prev"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeftIcon size={18} />
            </button>
          )}
          <div
            className={`pdf-holder${viewMode === 'scroll' ? ' pdf-holder-scroll' : ''}${typeof zoom !== 'number' ? ' pdf-holder-fit' : ''}`}
            ref={holderRef}
            onPointerDown={(e) => {
              if (e.pointerType !== 'touch') return;
              // The reader owns touch on its pages — a swipe here must never
              // double as the lightbox's next-item gesture.
              e.stopPropagation();
              touchSwipeRef.current =
                touchSwipeRef.current === null
                  ? { x: e.clientX, y: e.clientY, id: e.pointerId }
                  : null; // second finger = pinch/zoom, not a page turn
            }}
            onPointerUp={(e) => {
              const start = touchSwipeRef.current;
              touchSwipeRef.current = null;
              if (!start || e.pointerType !== 'touch' || e.pointerId !== start.id) return;
              e.stopPropagation();
              if (viewMode !== 'single') return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              if (!(Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy))) return;
              const holder = holderRef.current;
              if (holder && holder.scrollWidth > holder.clientWidth + 1) {
                // Zoomed wider than the holder: pan first — the page only
                // turns once the swipe pushes against that edge.
                const atEnd = holder.scrollLeft + holder.clientWidth >= holder.scrollWidth - 2;
                const atStart = holder.scrollLeft <= 2;
                if (dx < 0 ? !atEnd : !atStart) return;
              }
              setPage(page + (dx < 0 ? 1 : -1));
            }}
            onPointerCancel={() => {
              touchSwipeRef.current = null;
            }}
          >
            {status === 'loading' && <span className="item-placeholder">Opening PDF</span>}
            {status === 'error' && (
              <span className="item-placeholder">This PDF could not be opened.</span>
            )}
            {status === 'ready' &&
              pages.map((n) => (
                <PdfPageView
                  key={`${n}-${viewMode}`}
                  docRef={docRef}
                  holderRef={holderRef}
                  pageNo={n}
                  zoom={zoom}
                  rotation={rotation}
                  query={query}
                  highlights={highlights}
                  lazy={viewMode === 'scroll'}
                  onScaled={setEffScale}
                  onSelection={onSelection}
                  registerWrap={registerWrap}
                  onNavigate={setPage}
                />
              ))}
          </div>
          {viewMode === 'single' && (
            <button
              type="button"
              className="epub-nav epub-next"
              aria-label="Next page"
              data-testid="pdf-next"
              disabled={pageCount > 0 && page >= pageCount}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRightIcon size={18} />
            </button>
          )}
        </div>
      </div>
      {phone && (
        <footer className="pdf-bottom-bar" data-testid="pdf-bottom-bar">
          <button
            type="button"
            aria-label="Previous page"
            data-testid="pdf-bar-prev"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeftIcon size={18} />
          </button>
          <span className="pdf-page-nav">
            <input
              className="pdf-page-input"
              value={page}
              data-testid="pdf-page-input"
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1) setPage(n);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label="Page"
            />
            <span className="pdf-page-count">/ {pageCount || '…'}</span>
          </span>
          <button
            type="button"
            aria-label="Next page"
            data-testid="pdf-bar-next"
            disabled={pageCount > 0 && page >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRightIcon size={18} />
          </button>
          <span className="pdf-bar-spacer" />
          <button
            type="button"
            className={pageMarked ? 'active' : ''}
            title={pageMarked ? 'Remove bookmark for this page' : 'Bookmark this page'}
            data-testid="pdf-bookmark"
            onClick={toggleBookmark}
          >
            <BookmarkIcon size={17} />
          </button>
          <button
            type="button"
            title="Rotate 90°"
            data-testid="pdf-rotate"
            onClick={() => setRotation((r) => (r + 90) % 360)}
          >
            <RotateIcon size={17} />
          </button>
          <UiPopover open={moreOpen} onOpenChange={setMoreOpen}>
            <UiPopoverTrigger asChild>
              <button type="button" title="More" aria-label="More" data-testid="pdf-more">
                <MoreIcon size={18} />
              </button>
            </UiPopoverTrigger>
            <UiPopoverContent className="cw-pop pdf-more-pop" align="end" side="top">
              <div className="pdf-more-zoom">
                <button
                  type="button"
                  aria-label="Zoom out"
                  data-testid="pdf-zoom-out"
                  onClick={() => zoomBy(1 / 1.2)}
                >
                  <MinusIcon size={15} />
                </button>
                <span className="pdf-zoom-pct" data-testid="pdf-zoom-pct">
                  {Math.round(effScale * 100)}%
                </span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  data-testid="pdf-zoom-in"
                  onClick={() => zoomBy(1.2)}
                >
                  <PlusIcon size={15} />
                </button>
              </div>
              <div className="pj-pop-actions">
                <button
                  type="button"
                  className={`gallery-action-btn${zoom === 'fit-width' ? ' active' : ''}`}
                  data-testid="pdf-fit-width"
                  onClick={() => {
                    setZoom('fit-width');
                    setMoreOpen(false);
                  }}
                >
                  <MatchWidthIcon size={13} /> Fit width
                </button>
                <button
                  type="button"
                  className={`gallery-action-btn${zoom === 'fit-page' ? ' active' : ''}`}
                  data-testid="pdf-fit-page"
                  onClick={() => {
                    setZoom('fit-page');
                    setMoreOpen(false);
                  }}
                >
                  <FitPageIcon size={13} /> Fit page
                </button>
                <button
                  type="button"
                  className={`gallery-action-btn${viewMode === 'scroll' ? ' active' : ''}`}
                  data-testid="pdf-view-toggle"
                  onClick={() => {
                    switchView();
                    setMoreOpen(false);
                  }}
                >
                  <ScrollViewIcon size={13} />{' '}
                  {viewMode === 'scroll' ? 'Single page view' : 'Continuous scroll'}
                </button>
                <button
                  type="button"
                  className="gallery-action-btn"
                  data-testid="pdf-download"
                  onClick={() => {
                    setMoreOpen(false);
                    void download();
                  }}
                >
                  <DownloadIcon size={13} /> Download
                </button>
                <button
                  type="button"
                  className="gallery-action-btn"
                  data-testid="pdf-print"
                  onClick={() => {
                    setMoreOpen(false);
                    void print();
                  }}
                >
                  <PrinterIcon size={13} /> Print
                </button>
              </div>
            </UiPopoverContent>
          </UiPopover>
        </footer>
      )}
      {flash && <div className="epub-flash">{flash}</div>}
    </div>
  );
}
