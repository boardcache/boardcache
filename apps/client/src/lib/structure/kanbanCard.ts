import { DEFAULT_FONT_FAMILY } from '@boardcache/schema';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useHistoryStore } from '../../state/history';
import { createTextBox, TEXT_DEFAULTS } from '../import/createItems';
import { measureMarkdownHeight } from '../text/markdown';
import {
  attachItemsToKanbanColumn,
  KANBAN_COL_PAD,
  kanbanColumnWidth,
  kanbanZoom,
} from './kanbanAttach';

/**
 * Writing a text card straight into a kanban column. Kept apart from the
 * attach module (which the read-only viewer bundles) because it pulls in
 * the text creator and the markdown measurer; the card loads it on demand.
 */

/** A new text card filed at the end of a column: one undo step. */
export function addKanbanCard(kanbanId: string, columnId: string, text: string): string | null {
  const doc = useDocumentStore.getState().doc;
  const kb = doc.items[kanbanId];
  if (kb?.type !== 'kanban' || !kb.columns.some((c) => c.id === columnId)) return null;
  const before = useHistoryStore.getState().index;
  const k = kanbanZoom(kb);
  const width = Math.max(120, kanbanColumnWidth(kb, k) * k - KANBAN_COL_PAD * 2 * k);
  const id = createTextBox({ x: kb.x, y: kb.y + kb.height }, width, text, 'Add kanban card');
  // The card is written at the board's zoom, so its text keeps step with
  // the chrome of a board that was scaled up or down.
  if (k !== 1) {
    const fontSize = TEXT_DEFAULTS.fontSize * k;
    updateItems([id], 'Add kanban card', (d) => {
      if (d.type !== 'text') return;
      d.fontSize = fontSize;
      d.height = measureMarkdownHeight(text, width, fontSize, DEFAULT_FONT_FAMILY);
    });
  }
  attachItemsToKanbanColumn([id], { itemId: kanbanId, columnId });
  useHistoryStore.getState().coalesceSince(before, 'Add kanban card');
  return id;
}
