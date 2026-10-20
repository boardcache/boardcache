import type { PdfItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { putAsset } from '../board/assetStore';
import type { Point } from '../canvas/coords';
import { addItems, topZIndex } from '../../state/commands';
import { reserveNext } from '../canvas/placeSpot';
import type { ReservedBox } from '../canvas/placeSpot';
import { useDocumentStore } from '../../state/documentStore';

/** Default canvas size for a placed PDF (US Letter portrait, in canvas units). */
const PDF_PLACED = { width: 460, height: 595 };
/** Cascade offset when several files are dropped together. */

/** A PDF file (its MIME is reliable, but match the extension too, just in case). */
export function isPdfFile(file: { name?: string; type?: string }): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '');
}

/**
 * Import PDF files: store the blob in the content-addressed asset store and add
 * a pdf item that renders in the browser's native viewer. One undo step.
 */
export async function importPdfFiles(files: File[], dropPoint: Point): Promise<string[]> {
  const pdfs = files.filter(isPdfFile);
  if (pdfs.length === 0) return [];

  const { doc } = useDocumentStore.getState();
  let z = topZIndex(doc) + 1;
  const reserved: ReservedBox[] = [];
  const items: PdfItem[] = [];

  for (const file of pdfs) {
    try {
      const assetId = await putAsset(file);
      const { width, height } = PDF_PLACED;
      const spot = reserveNext(reserved, dropPoint, width, height);
      items.push({
        id: newId(),
        type: 'pdf',
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
        page: 1,
        pageCount: null,
        bookmarks: [],
        highlights: [],
      });
    } catch (err) {
      console.error(`boardCache: could not import "${file.name}"`, err);
    }
  }

  addItems(items, items.length === 1 ? 'Add PDF' : `Add ${items.length} PDFs`);
  return items.map((i) => i.id);
}
