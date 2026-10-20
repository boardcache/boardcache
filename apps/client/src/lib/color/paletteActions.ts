import { encodeAse } from './ase';
import { downloadBlob } from '../export/download';

export interface PaletteColor {
  color: string;
  name?: string | undefined;
}

/** Copy a palette's colors to the clipboard, one hex per line. */
export function copyPaletteColors(colors: PaletteColor[]): void {
  void navigator.clipboard?.writeText(colors.map((c) => c.color).join('\n'));
}

/** Download a palette as an Adobe `.ase` swatch file named after the palette. */
export function exportPaletteAse(colors: PaletteColor[], paletteName: string): void {
  const ase = encodeAse(colors.map((c, i) => ({ name: c.name ?? `Color ${i + 1}`, hex: c.color })));
  const safe = (paletteName.trim() || 'palette').replace(/[^\w.-]+/g, '_');
  downloadBlob(new Blob([ase], { type: 'application/octet-stream' }), `${safe}.ase`);
}
