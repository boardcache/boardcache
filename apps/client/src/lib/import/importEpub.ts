import type { EpubItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { putAsset } from '../board/assetStore';
import type { Point } from '../canvas/coords';
import { addItems, topZIndex, updateItems } from '../../state/commands';
import { reserveNext } from '../canvas/placeSpot';
import type { ReservedBox } from '../canvas/placeSpot';
import { useDocumentStore } from '../../state/documentStore';

/** Default canvas size for a placed ePub (book-cover portrait, canvas units). */
const EPUB_PLACED = { width: 320, height: 460 };

/** An .epub file (MIME when the OS knows it, extension otherwise). */
export function isEpubFile(file: { name?: string; type?: string }): boolean {
  return file.type === 'application/epub+zip' || /\.epub$/i.test(file.name ?? '');
}

/**
 * Import ePub files: store the blob, place a card immediately, then extract
 * cover + title/author in the background (epubjs is a lazy chunk — the
 * canvas card renders from the stored cover, never from the library).
 */
export async function importEpubFiles(files: File[], dropPoint: Point): Promise<string[]> {
  const epubs = files.filter(isEpubFile);
  if (epubs.length === 0) return [];

  const { doc } = useDocumentStore.getState();
  let z = topZIndex(doc) + 1;
  const reserved: ReservedBox[] = [];
  const items: EpubItem[] = [];
  const blobs = new Map<string, File>();

  for (const file of epubs) {
    try {
      const assetId = await putAsset(file);
      const { width, height } = EPUB_PLACED;
      const spot = reserveNext(reserved, dropPoint, width, height);
      const item: EpubItem = {
        id: newId(),
        type: 'epub',
        x: spot.x - width / 2,
        y: spot.y - height / 2,
        width,
        height,
        rotation: 0,
        zIndex: z++,
        locked: false,
        opacity: 1,
        groupId: null,
        name: file.name || undefined,
        assetId,
        coverAssetId: null,
        location: null,
        bookmarks: [],
        highlights: [],
      };
      items.push(item);
      blobs.set(item.id, file);
    } catch (err) {
      console.error(`boardCache: could not import "${file.name}"`, err);
    }
  }

  addItems(items, items.length === 1 ? 'Add ePub' : `Add ${items.length} ePubs`);

  // Cover + metadata land as a follow-up edit; failures leave the plain card.
  for (const item of items) {
    void extractEpubMeta(item.id, blobs.get(item.id)!);
  }
  return items.map((i) => i.id);
}

async function extractEpubMeta(itemId: string, file: File): Promise<void> {
  try {
    const { default: ePub } = await import('epubjs');
    const book = ePub(await file.arrayBuffer());
    await book.ready;
    const meta = await book.loaded.metadata;
    let coverAssetId: string | null = null;
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      const blob = await (await fetch(coverUrl)).blob();
      coverAssetId = await putAsset(new File([blob], 'cover', { type: blob.type || 'image/jpeg' }));
    }
    book.destroy();
    updateItems([itemId], 'Add ePub', (it) => {
      if (it.type !== 'epub') return;
      it.coverAssetId = coverAssetId;
      if (meta?.title) it.bookTitle = meta.title;
      if (meta?.creator) it.author = meta.creator;
    });
  } catch (err) {
    console.error('boardCache: could not read ePub metadata', err);
  }
}
