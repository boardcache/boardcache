import type { FontItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { groupItems } from '../../state/commands';
import { reserveNext } from '../canvas/placeSpot';
import type { ReservedBox } from '../canvas/placeSpot';
import { putAsset } from '../board/assetStore';
import { ensureFont } from '../media/fontRegistry';
import type { Point } from '../canvas/coords';
import { addItems, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'];

export function isFontFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return FONT_EXTENSIONS.some((ext) => lower.endsWith(ext)) || file.type.startsWith('font/');
}

/** Shared leading words of the member family names ("Inter Bold", "Inter
 *  Light" → "Inter") for naming the group/zip. */
function commonFamilyPrefix(names: string[]): string {
  const words = names.map((n) => n.split(' '));
  const first = words[0] ?? [];
  const out: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const w = first[i]!;
    if (words.every((ws) => ws[i] === w)) out.push(w);
    else break;
  }
  return out.join(' ');
}

/** "Inter-Bold.ttf" → "Inter Bold" — a readable CSS family name. */
function familyFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'Untitled font';
}

/** Import font files as specimen cards; the faces register immediately. */
export async function importFontFiles(files: File[], dropPoint: Point): Promise<string[]> {
  const { doc } = useDocumentStore.getState();
  let z = topZIndex(doc) + 1;
  const reserved: ReservedBox[] = [];
  const items: FontItem[] = [];
  for (const file of files) {
    try {
      const assetId = await putAsset(file);
      const family = familyFromFileName(file.name);
      await ensureFont(family, assetId);
      const spot = reserveNext(reserved, dropPoint, 320, 180);
      items.push({
        id: newId(),
        type: 'font',
        x: spot.x - 160,
        y: spot.y - 90,
        width: 320,
        height: 180,
        rotation: 0,
        zIndex: z++,
        locked: false,
        opacity: 1,
        groupId: null,
        assetId,
        family,
        previewText: 'Aa Bb Cc',
      });
    } catch (err) {
      console.error(`boardCache: could not import font "${file.name}"`, err);
    }
  }
  if (items.length === 0) return [];
  // Several files in one drop are treated as a family (multiple weights):
  // grouped on the canvas, downloadable together as a .zip.
  if (items.length > 1) {
    addItems(items, `Add ${items.length} fonts`);
    const prefix = commonFamilyPrefix(items.map((i) => i.family));
    groupItems(
      items.map((i) => i.id),
      prefix || 'Font family',
    );
  } else {
    addItems(items, 'Add font');
  }
  return items.map((i) => i.id);
}
