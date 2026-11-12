import type { CanvasDocument, Item } from '@boardcache/schema';
import { useDocumentStore } from '../../state/documentStore';
import { mediaMeta } from '../mediaItems';
import { noteTitle, notesOf } from './wikilinks';

/**
 * What `[[` and `![[` complete to, and how an embed's title finds its item.
 * `[[Title]]` names a note (a text item); `![[Title]]` embeds any other
 * item on the board: a picture, a video, a swatch, a document, by the name
 * it was given, else the title the lightbox shows for it.
 */

export type LinkKind = 'note' | 'media';

const isMedia = (item: Item): boolean => item.type !== 'text';

/** The title an embed names an item by. */
export function mediaTitle(item: Item): string {
  return item.name?.trim() || mediaMeta(item).title;
}

const fold = (s: string) => s.trim().toLowerCase();
/** A file's title without its extension: `![[Harbour]]` finds Harbour.png. */
const stem = (s: string) => fold(s).replace(/\.[a-z0-9]{2,5}$/, '');

/** The item an embed's title names: by name first, then by shown title,
 *  then by either without a file extension. */
export function findMediaByTitle(doc: CanvasDocument, title: string): Item | null {
  const want = fold(title);
  if (!want) return null;
  const items = Object.values(doc.items).filter(isMedia);
  return (
    items.find((it) => fold(it.name ?? '') === want) ??
    items.find((it) => fold(mediaTitle(it)) === want) ??
    items.find((it) => stem(it.name ?? '') === stem(want)) ??
    items.find((it) => stem(mediaTitle(it)) === stem(want)) ??
    null
  );
}

/** The titles `![[` offers: every item that has one of its own (a name,
 *  or a title richer than its kind), deduplicated. */
function embedTitles(doc: CanvasDocument): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of Object.values(doc.items)) {
    if (!isMedia(it)) continue;
    const title = mediaTitle(it);
    if (!title || title === mediaMeta(it).typeLabel) continue;
    const key = fold(title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

/** The completion source for an editor on item `selfId`: notes for `[[`
 *  (this one left out), media for `![[`. */
export const linkTitlesFor =
  (selfId: string) =>
  (kind: LinkKind): string[] => {
    const doc = useDocumentStore.getState().doc;
    if (kind === 'media') return embedTitles(doc);
    return notesOf(doc)
      .filter((n) => n.id !== selfId)
      .map(noteTitle);
  };
