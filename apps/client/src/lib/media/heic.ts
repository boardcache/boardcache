import type * as Heic from 'heic2any';
/**
 * HEIC/HEIF support. Browsers other than Safari can't decode HEIC, so we
 * convert to JPEG in the browser via libheif (heic2any), loaded lazily the
 * first time one is imported so the ~1.5 MB WASM never touches normal startup.
 */

const HEIC_MIME = /^image\/(heic|heif)(-sequence)?$/i;

/** A HEIC/HEIF file. MIME is often blank for these, so fall back to extension. */
export function isHeicFile(file: { name?: string; type?: string }): boolean {
  if (HEIC_MIME.test(file.type ?? '')) return true;
  return /\.(heic|heif)$/i.test(file.name ?? '');
}

export type HeicStage = 'downloading' | 'converting';

let heicModule: Promise<typeof Heic> | null = null;

/** True once the converter chunk has started loading (i.e. won't "download" again). */
export function heicLibLoaded(): boolean {
  return heicModule !== null;
}

/**
 * Convert a HEIC/HEIF file to a JPEG File. `onStage` reports 'downloading'
 * (first-ever load of the converter) then 'converting'.
 */
export async function heicFileToJpeg(
  file: File,
  onStage: (stage: HeicStage) => void,
  quality = 0.92,
): Promise<File> {
  onStage(heicModule === null ? 'downloading' : 'converting');
  if (!heicModule) heicModule = import('heic2any');
  const { default: heic2any } = await heicModule;

  onStage('converting');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality });
  const blob = Array.isArray(out) ? out[0]! : out;

  const base = (file.name || 'image').replace(/\.(heic|heif)$/i, '');
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}
