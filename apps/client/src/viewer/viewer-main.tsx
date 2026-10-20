import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseDocument } from '@boardcache/schema';
import { ShareGate } from './ShareGate';
import { ViewerApp } from './ViewerApp';
import { useDocumentStore } from '../state/documentStore';
import '../styles/index.css';

// Share pages (/s/<id>) fetch + decrypt the board instead of embedding it.
const share = window.__SHARE__;

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
