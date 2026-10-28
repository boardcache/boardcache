import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseDocument } from '@boardcache/schema';
import { ShareGate } from './ShareGate';
import { ViewerApp } from './ViewerApp';
import { useDocumentStore } from '../state/documentStore';
import '../styles/index.css';

// Theme before first paint. The host pages carry no inline script (the view
// host's policy allows none), so it runs here, first.
(() => {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('boardcache:theme') ?? localStorage.getItem('refboard:theme');
  } catch {
    /* storage unavailable: follow the system */
  }
  const dark =
    stored === 'dark' ||
    ((stored === null || stored === 'system') &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();

// Share pages (/s/<id>, or share.html?id=<id>) fetch the board from the API
// instead of embedding it; the id comes from the URL.
const shareId =
  window.__SHARE__?.id ??
  /^\/s\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1] ??
  /[?&]id=([A-Za-z0-9_-]+)/.exec(location.search)?.[1] ??
  null;
const share = shareId !== null ? { id: shareId } : undefined;
if (share) window.__SHARE__ = share;

// A published preview carries its board in JSON data blocks (no inline
// script); an offline export carries it on window.__BOARD__.
const dataBlock = <T,>(id: string): T | undefined => {
  const el = document.getElementById(id);
  if (!el?.textContent) return undefined;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return undefined;
  }
};
if (!window.__BOARD__) {
  const fromPage = dataBlock<NonNullable<typeof window.__BOARD__>>('boardcache-board');
  if (fromPage) {
    window.__BOARD__ = fromPage;
    const assets = dataBlock<NonNullable<typeof window.__BOARD_ASSETS__>>('boardcache-assets');
    if (assets) window.__BOARD_ASSETS__ = assets;
  }
}

// The board is embedded in the export's index.html (window.__BOARD__). Validate
// + normalize it through the schema (applies defaults / migrations) before it
// reaches the store; fall back to the raw object if parsing somehow fails.
const board = share ? undefined : window.__BOARD__;
if (board) {
  try {
    useDocumentStore.getState().replaceDoc(parseDocument(JSON.stringify(board)));
  } catch (err) {
    console.error('boardCache viewer: could not parse embedded board', err);
    useDocumentStore.getState().replaceDoc(board);
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>{share ? <ShareGate id={share.id} /> : <ViewerApp />}</StrictMode>,
  );
}
