import { useEffect, useState } from 'react';
import type { PdfItem } from '@boardcache/schema';
import { ExternalLinkIcon } from '../components/icons';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { defineItemType } from './registry';
import { OFFLINE_VIEWER } from '../lib/viewerMode';
import { PdfReader } from '../components/lightbox/PdfReader';
import { PdfContent } from '../components/items/PdfContent';
import { memo, renderPdfPage } from '../lib/media/paint';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { baseText } from '../lib/search/extract';
import type { MetaOverride } from './registry';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { getAssetBlob } from '../lib/board/assetStore';

// Rendered first-page thumbnails, keyed by content-addressed asset id.
const pdfThumbCache = new Map<string, string>();

/** PDF thumbnail: a rendered first page in the app, a generic icon offline. */
function PdfCard({ item }: { item: PdfItem }) {
  // The viewer build has no pdf.js — show a simple label instead.
  if (import.meta.env.VIEWER) return <span className="gallery-generic">PDF</span>;
  return <PdfCardCanvas item={item} />;
}

function PdfCardCanvas({ item }: { item: PdfItem }) {
  const url = useAssetUrl(item.assetId);
  const [src, setSrc] = useState<string | null>(() => pdfThumbCache.get(item.assetId) ?? null);

  useEffect(() => {
    if (!url || src) return;
    let cancelled = false;
    void (async () => {
      try {
        const { loadPdf } = await import('../lib/media/pdfDoc');
        const { doc, destroy } = await loadPdf(url);
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 420 / base.width) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/png');
        destroy();
        if (!cancelled) {
          pdfThumbCache.set(item.assetId, dataUrl);
          setSrc(dataUrl);
        }
      } catch (err) {
        if (!cancelled) console.error('boardCache: PDF thumbnail failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, src, item.assetId]);

  return src ? (
    <img src={src} alt="" draggable={false} className="gallery-pdf-thumb" />
  ) : (
    <span className="gallery-generic">PDF</span>
  );
}

function PdfStage({ item }: { item: PdfItem }) {
  // The offline export can't run pdf.js (file:// blocks worker fetches) —
  // it keeps the browser's native embed. A published board served over
  // http(s) gets the same reader as the app (read-only there).
  if (OFFLINE_VIEWER) return <PdfNativeStage item={item} />;
  return <PdfReader item={item} />;
}

function PdfNativeStage({ item }: { item: PdfItem }) {
  const url = useAssetUrl(item.assetId);
  if (!url) return <div className="lightbox-generic">Loading PDF</div>;
  // A framed PDF on iPad shows only its first page; the same URL in its own
  // tab is the full document, so the stage offers that too.
  return (
    <div className="lightbox-pdf-wrap">
      <iframe
        className="lightbox-pdf"
        src={`${url}#view=FitH`}
        title={item.name ?? 'PDF'}
        data-testid="lightbox-pdf"
      />
      <a
        className="lightbox-pdf-open"
        href={url}
        target="_blank"
        rel="noopener"
        data-testid="lightbox-pdf-open"
      >
        <ExternalLinkIcon size={14} /> Open PDF
      </a>
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
async function paint(item: PdfItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  const page = await memo(
    p.cache,
    `pdf:${item.assetId}:${item.page ?? 1}@${Math.round(Math.max(item.width, item.height))}`,
    () => renderPdfPage(item.assetId, item.page ?? 1, item.width, item.height),
  );
  if (page) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, item.width, item.height);
    const fit = Math.min(item.width / page.width, item.height / page.height);
    const dw = page.width * fit;
    const dh = page.height * fit;
    ctx.drawImage(page, x + (item.width - dw) / 2, y + (item.height - dh) / 2, dw, dh);
  } else {
    // Fall back to a labelled card (the filename, sans extension).
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(x, y, item.width, item.height);
    ctx.strokeStyle = 'rgba(127,127,127,0.5)';
    ctx.strokeRect(x, y, item.width, item.height);
    ctx.fillStyle = '#c0392b';
    ctx.font = `bold ${Math.max(14, Math.min(item.width, item.height) * 0.16)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = (item.name ?? 'PDF').replace(/\.pdf$/i, '');
    ctx.fillText(label, x + item.width / 2, y + item.height / 2, item.width - 16);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

/** What the board search index sees. */
function searchText(item: PdfItem): Extracted {
  const title = item.name?.trim() ?? '';
  // Visual types index their base metadata; PDF and htmlembed get deep
  // text through the async extractors below.
  return {
    title: title || ('title' in item ? ((item as { title?: string }).title ?? '') : ''),
    body: baseText(item),
  };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: PdfItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.detail = item.pageCount ? `${item.pageCount} pages` : 'PDF';
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
async function popout(item: PdfItem, p: PopoutContext): Promise<string> {
  const { mintUrl } = p;
  const blob = await getAssetBlob(item.assetId);
  if (!blob) return `<div class="msg">PDF unavailable</div>`;
  return `<iframe class="pdf" src="${mintUrl(blob)}#view=FitH"></iframe>`;
}

export const pdfType = defineItemType('pdf', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: 'pdf',
  meta,
  label: 'PDF',
  searchText,
  thumbnail: paint,
  render: PdfContent,
  card: PdfCard,
  stage: PdfStage,
  cardAspect: null,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
