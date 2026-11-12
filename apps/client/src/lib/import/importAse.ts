import type { Point } from '../canvas/coords';
import { decodeAse } from '../color/ase';
import { createPaletteItem } from './createItems';

/** An Adobe Swatch Exchange file (.ase): a palette item. */
export const isAseFile = (file: File): boolean => /\.ase$/i.test(file.name);

export async function importAseFile(file: File, at: Point): Promise<void> {
  const entries = decodeAse(await file.arrayBuffer());
  if (entries.length === 0) throw new Error(`No colors found in “${file.name}”.`);
  createPaletteItem(
    at,
    entries.map((entry) => ({ color: entry.hex, name: entry.name })),
    { name: file.name.replace(/\.ase$/i, '') },
  );
}
