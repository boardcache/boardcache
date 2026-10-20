import { useEffect, useRef, useState } from 'react';
import { OFFLINE_VIEWER } from '../../lib/viewerMode';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import type { PdfItem } from '@boardcache/schema';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { importImageFiles } from '../../lib/import/importImages';
import { runSilent, updateItems } from '../../state/commands';
import { useSessionStore } from '../../state/sessionStore';

const PAGE_BG = '#525659'; // native PDF viewer backdrop

/**
 * The offline viewer can't run pdf.js (it fetches bytes, blocked on file://),
 * so it shows the PDF via the browser's native viewer from the local file.
 * Non-interactive on the canvas; double-click opens the lightbox.
 */
function PdfEmbed({ item }: { item: PdfItem }) {
  const url = useAssetUrl(item.assetId);
  return (
    <div className="pdf-embed" data-testid="pdf-embed">
      {url ? (
        <embed className="pdf-native" type="application/pdf" src={`${url}#toolbar=0&view=FitH`} />
      ) : (
        <span className="item-placeholder pdf-loading-text">Loading PDF</span>
      )}
    </div>
  );
}

/** PDF item renderer: pdf.js everywhere it can run; the native embed only in
 *  the offline (file://) export, where workers are blocked. */
export function PdfContent({ item }: { item: PdfItem }) {
  if (OFFLINE_VIEWER) return <PdfEmbed item={item} />;
  return <PdfCanvas item={item} />;
}

/**
 * PDF rendered page-by-page with pdf.js (loaded lazily / code-split). We own
 * the viewer, so we know the current page — "Snap" rasterizes it to an image
 * on the canvas. Fullscreen opens the larger native viewer (TOC, bookmarks).
 */
function PdfCanvas({ item }: { item: PdfItem }) {
  const url = useAssetUrl(item.assetId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const destroyRef = useRef<(() => void) | null>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const renderToken = useRef(0);
  const fittedRef = useRef(false);

  const [numPages, setNumPages] = useState(item.pageCount ?? 0);
  const [page, setPageState] = useState(Math.max(1, item.page ?? 1));
  // Page flips persist to the item (silently — no undo entries) so they
  // survive reloads AND stream to team-board peers like any doc change.
  const setPage = (next: number | ((p: number) => number)) => {
    setPageState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (value !== prev) {
        runSilent((draft) => {
          const it = draft.items[item.id];
          if (it?.type === 'pdf') it.page = value;
        });
      }
      return value;
    });
  };
  // Adopt remote flips (team boards) — render-phase adjust, no effect.
  const [seenDocPage, setSeenDocPage] = useState(item.page ?? 1);
  if ((item.page ?? 1) !== seenDocPage) {
    setSeenDocPage(item.page ?? 1);
    setPageState(Math.max(1, item.page ?? 1));
  }
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const selected = useSessionStore((s) => s.selection.length === 1 && s.selection[0] === item.id);

  // Load the document.
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void (async () => {
      try {
        const { loadPdf } = await import('../../lib/media/pdfDoc');
        if (!cancelled) setStatus('loading');
        const { doc, destroy } = await loadPdf(url);
        if (cancelled) {
          destroy();
          return;
        }
        docRef.current = doc;
        destroyRef.current = destroy;
        setNumPages(doc.numPages);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          console.error('boardCache: could not open PDF', err);
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      destroyRef.current?.();
      destroyRef.current = null;
      docRef.current = null;
      fittedRef.current = false;
    };
  }, [url]);

  // Render the current page, letterboxed into the item box.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (status !== 'ready' || !doc || !canvas) return;
    const token = ++renderToken.current;

    void (async () => {
      const p = await doc.getPage(Math.min(page, doc.numPages));
      if (token !== renderToken.current) return;

      // Once, match the box to the first page's aspect ratio.
      if (!fittedRef.current && page === 1) {
        fittedRef.current = true;
        const v = p.getViewport({ scale: 1 });
        const targetH = Math.round(item.width * (v.height / v.width));
        if (Math.abs(targetH - item.height) > 2) {
          updateItems([item.id], 'Fit PDF', (it) => {
            if (it.type === 'pdf') it.height = targetH;
          });
          return; // re-renders at the new height
        }
      }

      const rs = Math.min(2, window.devicePixelRatio || 1) * 1.5;
      canvas.width = Math.round(item.width * rs);
      canvas.height = Math.round(item.height * rs);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = PAGE_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const base = p.getViewport({ scale: 1 });
      const fit = Math.min(canvas.width / base.width, canvas.height / base.height);
      const viewport = p.getViewport({ scale: fit });
      const dx = (canvas.width - viewport.width) / 2;
      const dy = (canvas.height - viewport.height) / 2;

      taskRef.current?.cancel();
      const task = p.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform: [1, 0, 0, 1, dx, dy],
      });
      taskRef.current = task;
      await task.promise.catch((err: unknown) => {
        if (err && (err as { name?: string }).name !== 'RenderingCancelledException') {
          console.error('boardCache: PDF render failed', err);
        }
      });
    })();

    return () => {
      taskRef.current?.cancel();
    };
  }, [status, page, item.id, item.width, item.height]);

  const snap = async () => {
    const doc = docRef.current;
    if (!doc) return;
    const p = await doc.getPage(page);
    const viewport = p.getViewport({ scale: 2 });
    const off = document.createElement('canvas');
    off.width = Math.ceil(viewport.width);
    off.height = Math.ceil(viewport.height);
    await p.render({ canvas: off, canvasContext: off.getContext('2d')!, viewport }).promise;
    const blob = await new Promise<Blob>((r) => off.toBlob((b) => r(b!), 'image/png'));
    const base = (item.name ?? 'page').replace(/\.pdf$/i, '');
    const file = new File([blob], `${base}-p${page}.png`, { type: 'image/png' });
    // Place the snapshot just to the right of the PDF.
    await importImageFiles([file], {
      x: item.x + item.width + 60 + item.width / 2,
      y: item.y + item.height / 2,
    });
  };

  if (status === 'error') {
    return (
      <div className="pdf-embed pdf-loading">
        <span className="item-placeholder">Couldn’t open PDF</span>
      </div>
    );
  }

  return (
    <div className="pdf-embed" data-testid="pdf-embed">
      {selected && status === 'ready' && (
        <div className="pdf-bar" onPointerDown={(e) => e.stopPropagation()}>
          <div className="pdf-bar-left">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              title="Previous page"
              data-testid="pdf-prev"
            >
              <ChevronLeftIcon size={14} />
            </button>
            <span className="pdf-page" data-testid="pdf-page">
              {page} / {numPages || '…'}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(numPages, p + 1))}
              disabled={page >= numPages}
              title="Next page"
              data-testid="pdf-next"
            >
              <ChevronRightIcon size={14} />
            </button>
          </div>
          <div className="pdf-bar-right">
            <button
              type="button"
              data-edit=""
              onClick={() => void snap()}
              title="Snap the current page to an image"
              data-testid="pdf-snap"
            >
              📷 Snap
            </button>
            <button
              type="button"
              onClick={() => useSessionStore.getState().setLightbox(item.id)}
              title="Open in lightbox"
              data-testid="pdf-lightbox"
            >
              ⤢ Fullscreen
            </button>
          </div>
        </div>
      )}

      {status === 'loading' && (
        <span className="item-placeholder pdf-loading-text">Loading PDF</span>
      )}
      <canvas ref={canvasRef} className="pdf-canvas" data-testid="pdf-canvas" />
    </div>
  );
}
