import type { Item } from '@boardcache/schema';
import { itemAssetIds, newId } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { unionRects } from '../canvas/geometry';
import { addItems, removeItems, topZIndex } from '../../state/commands';
import { remapClonedTimelines } from '../structure/timelineLayout';
import { adoptAssets } from '../board/assetStore';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Internal item clipboard: the item JSON and the board it was copied from.
 * Pasting onto another board gives that board its own copies of the media
 * the items show (media is kept per board). OS image paste (files) is
 * handled separately by the paste event listener.
 */
let clipboardItems: Item[] = [];
let clipboardBoard: string | null = null;
/** The text written to the OS clipboard with the last copy, or null when
 *  the OS clipboard could not be written (then a paste cannot tell whether
 *  something newer was copied elsewhere, and the items are assumed current). */
let clipboardStamp: string | null = null;

export function copySelection(): void {
  const { selection } = useSessionStore.getState();
  const { doc } = useDocumentStore.getState();
  clipboardItems = selection
    .map((id) => doc.items[id])
    .filter((item): item is Item => item !== undefined)
    .map((item) => ({ ...item }));
  clipboardBoard = doc.id;
  clipboardStamp = null;
  if (clipboardItems.length === 0) return;
  // The OS clipboard takes the copy's text, so other apps get something to
  // paste and, when the person next copies elsewhere, that copy is seen
  // to be newer than these items.
  const stamp = clipboardText(clipboardItems);
  clipboardStamp = stamp;
  navigator.clipboard?.writeText?.(stamp).catch(() => {
    if (clipboardStamp === stamp) clipboardStamp = null;
  });
}

/** One line per item: its text, link or name, else what it is. */
function clipboardText(items: Item[]): string {
  return items
    .map((item) => {
      const i = item as Item & { text?: string; url?: string; name?: string; title?: string };
      const line = (typeof i.text === 'string' && i.text) || i.url || i.title || i.name;
      return (line ?? '').trim() || `${item.type} item`;
    })
    .join('\n');
}

/**
 * Whether the copied items are still what the person last copied, going by
 * the text the OS clipboard holds now: text that is not the copy's own
 * means something newer was copied in another app (a file or image on the
 * clipboard is the caller's call, and always newer). Nothing there, or no
 * stamp to compare with, counts as current.
 */
export function internalClipboardCurrent(osText: string | null | undefined): boolean {
  if (clipboardItems.length === 0) return false;
  const text = (osText ?? '').trim();
  return clipboardStamp === null || text === '' || text === clipboardStamp.trim();
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
export async function pasteItems(target?: Point): Promise<string[]> {
  if (clipboardItems.length === 0) return [];
  const { doc } = useDocumentStore.getState();
  // Copied from another board: this one takes its own copies of the media
  // first, so the items show at once and the board's next push has them.
  if (clipboardBoard && clipboardBoard !== doc.id) {
    await adoptAssets(doc.id, itemsAssetIds(clipboardItems), clipboardBoard);
    if (useDocumentStore.getState().doc.id !== doc.id) return [];
  }
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

const itemsAssetIds = (items: Item[]): string[] => items.flatMap((item) => itemAssetIds(item));
