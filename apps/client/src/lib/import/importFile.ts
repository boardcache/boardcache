import type { FileItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { putAsset } from '../board/assetStore';
import type { Point } from '../canvas/coords';
import { reserveNext } from '../canvas/placeSpot';
import type { ReservedBox } from '../canvas/placeSpot';
import { addItems, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

const FILE_CARD_WIDTH = 360;
const FILE_CARD_HEIGHT = 120;

/**
 * Keep files the board has no viewer for: each becomes a file card holding
 * the bytes as an asset, named as it arrived, to download from the board.
 * The last door in importFiles — anything a real importer takes never
 * reaches here.
 */
export async function importFileItems(files: File[], dropPoint: Point): Promise<string[]> {
  const { doc } = useDocumentStore.getState();
  let z = topZIndex(doc) + 1;
  const reserved: ReservedBox[] = [];
  const items: FileItem[] = [];
  for (const file of files) {
    try {
      const assetId = await putAsset(file);
      const spot = reserveNext(reserved, dropPoint, FILE_CARD_WIDTH, FILE_CARD_HEIGHT);
      items.push({
        id: newId(),
        type: 'file',
        x: spot.x - FILE_CARD_WIDTH / 2,
        y: spot.y - FILE_CARD_HEIGHT / 2,
        width: FILE_CARD_WIDTH,
        height: FILE_CARD_HEIGHT,
        rotation: 0,
        zIndex: z++,
        locked: false,
        opacity: 1,
        groupId: null,
        assetId,
        fileName: file.name || 'file',
        mime: file.type || 'application/octet-stream',
        size: file.size,
      });
    } catch (err) {
      console.error(`boardCache: could not keep file "${file.name}"`, err);
    }
  }
  if (items.length === 0) return [];
  addItems(items, items.length === 1 ? 'Add file' : `Add ${items.length} files`);
  return items.map((i) => i.id);
}
