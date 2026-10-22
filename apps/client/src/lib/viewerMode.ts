import type { CanvasDocument } from '@boardcache/schema';

/** Metadata for one asset in an offline-viewer export. */
export interface ViewerAssetMeta {
  /** Relative path inside the export, e.g. `assets/images/<id>.png`. */
  url: string;
  mime: string;
}

declare global {
  interface Window {
    /** Present only when running inside an exported offline viewer. */
    __BOARD__?: CanvasDocument;
    __BOARD_ASSETS__?: Record<string, ViewerAssetMeta>;
    /** Present only on the public share page (/s/<id> → share.html). */
    __SHARE__?: { id: string };
  }
}

/**
 * Runtime flag: are we rendering a read-only board (an exported offline
 * viewer, or a public share page) rather than the live app? Set by the
 * hosting page before the viewer bundle loads.
 */
export const VIEWER: boolean =
  typeof window !== 'undefined' &&
  !!(
    window.__BOARD__ ||
    window.__SHARE__ ||
    document.getElementById('boardcache-board') ||
    /^\/s\/[A-Za-z0-9_-]+/.test(location.pathname) ||
    /[?&]id=[A-Za-z0-9_-]+/.test(location.search)
  );

/**
 * The viewer sits in a frame whose host already names the board (the
 * community lightbox in the app, a public page's preview), so its own
 * chrome shows no title.
 */
export const FRAMED_VIEWER: boolean =
  VIEWER &&
  (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

/**
 * The exported offline viewer runs from file://, where workers and fetch()
 * are blocked — pdf.js can't run there, so PDFs fall back to the browser's
 * native frame. A published board served over http(s) gets the full reader.
 */
export const OFFLINE_VIEWER: boolean =
  VIEWER && typeof location !== 'undefined' && location.protocol === 'file:';

/** The folder the viewer bundle loaded from (its own script URL) — for the
 *  files that ship beside it, like the pdf.js worker. Null in the app. */
const viewerScript =
  typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
export const VIEWER_BASE: string | null = viewerScript?.src
  ? new URL('.', viewerScript.src).href
  : null;

/** Resolve an assetId to its relative file path in the export (or null). */
export function viewerAssetUrl(assetId: string | null): string | null {
  if (!assetId) return null;
  return window.__BOARD_ASSETS__?.[assetId]?.url ?? null;
}
