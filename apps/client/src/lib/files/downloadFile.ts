import type { FileItem } from '@boardcache/schema';
import { getAssetBlob, requestAsset } from '../board/assetStore';
import { downloadBlob } from '../export/download';
import { showNotice } from '../notices';
import { confirmDialog } from '../../components/ui/Prompt';
import { isRunnableFile } from './fileKind';

/**
 * Hand a file card's bytes to the person, under the file's own name. A
 * program (an installer, a script) asks first: a board can come from
 * someone else, and a download is the moment to think about that.
 */
export async function downloadFileItem(item: FileItem): Promise<void> {
  if (isRunnableFile(item.fileName)) {
    const go = await confirmDialog({
      title: 'Download a program?',
      body: `“${item.fileName}” runs as a program when opened. Only download it if you trust where this board came from.`,
      confirmLabel: 'Download',
    });
    if (!go) return;
  }
  // The bytes may still be on the account's server or in the team room:
  // ask for them the way a picture that is not here yet asks.
  await requestAsset(item.assetId);
  const blob = await getAssetBlob(item.assetId);
  if (!blob) {
    showNotice('The file could not be fetched; try again when you are online.', { kind: 'warn' });
    return;
  }
  downloadBlob(blob, item.fileName);
}
