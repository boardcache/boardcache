import type { Item } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { unionRects } from '../canvas/geometry';
import { addItems, removeItems, topZIndex } from '../../state/commands';
import { remapClonedTimelines } from '../structure/timelineLayout';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Internal item clipboard. Assets are content-addressed and shared, so a
 * copy is just the item JSON — pasting references the same blobs. OS image
 * paste (files) is handled separately by the paste event listener.
 */
let clipboardItems: Item[] = [];

export function copySelection(): void {
  const { selection } = useSessionStore.getState();
  const { doc } = useDocumentStore.getState();
  clipboardItems = selection
    .map((id) => doc.items[id])
    .filter((item): item is Item => item !== undefined)
    .map((item) => ({ ...item }));
}

/** Copy the selection to the internal clipboard, then delete it. */
export function cutSelection(): void {
  const { selection } = useSessionStore.getState();
  if (selection.length === 0) return;
  copySelection();
  removeItems(selection, 'Cut');
  useSessionStore.getState().clearSelection();
}

export function hasClipboardItems(): boolean {
  return clipboardItems.length > 0;
}

/** Paste centered on `target` (canvas coords); falls back to a +24 offset. */
export function pasteItems(target?: Point): string[] {
  if (clipboardItems.length === 0) return [];
  const { doc } = useDocumentStore.getState();
  let z = topZIndex(doc) + 1;

  const bounds = unionRects(clipboardItems);
  let dx = 24;
  let dy = 24;
  if (target && bounds) {
    dx = target.x - (bounds.x + bounds.width / 2);
    dy = target.y - (bounds.y + bounds.height / 2);
  }

  const idMap = new Map<string, string>();
  const clones = clipboardItems.map((item) => {
    const id = newId();
    idMap.set(item.id, id);
    return {
      ...item,
      id,
      x: item.x + dx,
      y: item.y + dy,
      zIndex: z++,
      groupId: null,
    };
  });
  remapClonedTimelines(clones, idMap);

  addItems(clones, 'Paste');
  useSessionStore.getState().setSelection(clones.map((c) => c.id));
  return clones.map((c) => c.id);
}
