import { createPaletteFromSwatches, groupItems, ungroupItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { selectionGroupState } from './grouping';

/**
 * Group the current selection — a set of swatches collapses into one palette
 * item (consistent with extracted palettes), everything else becomes a plain
 * group. Shared by the keyboard shortcut, the selection action bar, and the
 * context menu.
 */
export function groupSelection(): void {
  const { doc } = useDocumentStore.getState();
  const selection = useSessionStore.getState().selection;
  const state = selectionGroupState(doc, selection, useSessionStore.getState().isolatedGroupId);
  if (state.count < 2) return;
  if (state.allSwatches) createPaletteFromSwatches(selection);
  else groupItems(selection);
}

export function ungroupSelection(): void {
  ungroupItems(useSessionStore.getState().selection);
}
