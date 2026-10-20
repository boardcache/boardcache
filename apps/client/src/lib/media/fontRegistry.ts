import type { CanvasDocument } from '@boardcache/schema';
import { getAssetBlob } from '../board/assetStore';
import { VIEWER, viewerAssetUrl } from '../viewerMode';

/**
 * Loads board font assets (TTF/OTF/WOFF/WOFF2) into `document.fonts` so
 * specimen cards AND text items can use them by family name. Each family
 * loads once per session; missing assets fail quietly (text falls back).
 */

const loaded = new Map<string, Promise<boolean>>();

export function ensureFont(family: string, assetId: string): Promise<boolean> {
  const key = `${family}::${assetId}`;
  let p = loaded.get(key);
  if (!p) {
    p = (async () => {
      // The viewer's assets are URLs (a url() source also works on file://).
      const source = VIEWER
        ? viewerAssetUrl(assetId)
        : await getAssetBlob(assetId).then((b) => b?.arrayBuffer() ?? null);
      if (!source) return false;
      const face = new FontFace(family, typeof source === 'string' ? `url("${source}")` : source);
      await face.load();
      document.fonts.add(face);
      return true;
    })().catch(() => false);
    loaded.set(key, p);
  }
  return p;
}

/** Load every font item's face — call when a document (re)loads. */
export function syncBoardFonts(doc: CanvasDocument): void {
  for (const item of Object.values(doc.items)) {
    if (item.type === 'font') void ensureFont(item.family, item.assetId);
  }
}

/** Font families available on this board, for the text editor's picker. */
export function boardFontFamilies(doc: CanvasDocument): string[] {
  const seen = new Set<string>();
  for (const item of Object.values(doc.items)) {
    if (item.type === 'font') seen.add(item.family);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
