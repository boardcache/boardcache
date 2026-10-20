import type { CanvasDocument, FontItem } from '@boardcache/schema';
import { zipSync } from 'fflate';
import { getAssetBlob } from '../board/assetStore';
import { downloadBlob } from '../export/download';

const EXT_BY_MIME: Record<string, string> = {
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'application/font-sfnt': 'ttf',
};

function fileNameFor(item: FontItem, blob: Blob): string {
  const ext = EXT_BY_MIME[blob.type] ?? 'ttf';
  return `${item.family.replace(/[^\w ()-]+/g, '').trim() || 'font'}.${ext}`;
}

/** Font items sharing this item's canvas group (a multi-weight family). */
export function fontFamilyMembers(doc: CanvasDocument, item: FontItem): FontItem[] {
  if (!item.groupId) return [item];
  const members = Object.values(doc.items).filter(
    (i): i is FontItem => i.type === 'font' && i.groupId === item.groupId,
  );
  return members.length > 1 ? members : [item];
}

/** Download one font file — or the whole grouped family as a .zip. */
export async function downloadFont(doc: CanvasDocument, item: FontItem): Promise<void> {
  const members = fontFamilyMembers(doc, item);
  if (members.length === 1) {
    const blob = await getAssetBlob(item.assetId);
    if (!blob) throw new Error('Font file missing.');
    downloadBlob(blob, fileNameFor(item, blob));
    return;
  }
  const files: Record<string, Uint8Array> = {};
  for (const member of members) {
    const blob = await getAssetBlob(member.assetId);
    if (!blob) continue;
    files[fileNameFor(member, blob)] = new Uint8Array(await blob.arrayBuffer());
  }
  if (Object.keys(files).length === 0) throw new Error('Font files missing.');
  const zipName =
    (item.groupId ? doc.groups[item.groupId]?.name : null) ??
    `${item.family.split(' ')[0] ?? 'fonts'} family`;
  const zipped = zipSync(files, { level: 0 }); // fonts are already compressed
  downloadBlob(new Blob([zipped as BlobPart], { type: 'application/zip' }), `${zipName}.zip`);
}
