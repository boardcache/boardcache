import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { VIEWER, VIEWER_BASE } from '../viewerMode';

// This module is imported dynamically, so pdf.js (and its worker) are
// code-split into their own chunk — only fetched when a PDF is opened.
// The viewer bundle is one file whose asset paths resolve against the HOST
// page, so it loads the worker copied beside itself instead.
GlobalWorkerOptions.workerSrc =
  VIEWER && VIEWER_BASE ? `${VIEWER_BASE}pdf.worker.min.mjs` : workerUrl;

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  /** Aborts the worker + frees the document (v6 destroys via the load task). */
  destroy: () => void;
}

export async function loadPdf(url: string): Promise<LoadedPdf> {
  const task = getDocument({ url });
  const doc = await task.promise;
  return { doc, destroy: () => void task.destroy() };
}
