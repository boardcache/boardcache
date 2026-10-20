import { createTextFromString } from '../import/createItems';
import { addConnection } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Excerpt highlighting (research arc 6/10): a selected passage in the PDF or
 * ePub reader becomes a quote card on the canvas, auto-connected to its
 * parent document with a 'cites' line — the passage keeps its provenance
 * visible on the wall.
 */
export function createQuoteCard(
  parentId: string,
  passage: string,
  attribution: string | null,
): string | null {
  const doc = useDocumentStore.getState().doc;
  const parent = doc.items[parentId];
  if (!parent || !passage.trim()) return null;
  const quote = passage
    .trim()
    .replace(/\s*\n\s*/g, ' ')
    .slice(0, 600);
  const text = `> ${quote}${attribution ? `\n\n— *${attribution}*` : ''}`;
  // Beside the parent, stacking downward when quoting repeatedly.
  const existing = Object.values(doc.connections).filter(
    (c) => c.to.kind === 'item' && c.to.id === parentId && c.rel === 'cites',
  ).length;
  const at = {
    x: parent.x + parent.width + 80,
    y: parent.y + existing * 150,
  };
  const id = createTextFromString(at, text, 'Quote to board');
  addConnection({ kind: 'item', id }, { kind: 'item', id: parentId }, 'cites');
  return id;
}
