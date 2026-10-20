import type { Point } from '../canvas/coords';
import { isHeicFile } from '../media/heic';
import { importAudioFiles } from './importAudio';
import { importImageFiles } from './importImages';
import { importFontFiles, isFontFile } from './importFonts';
import { importPdfFiles, isPdfFile } from './importPdf';
import { importEpubFiles, isEpubFile } from './importEpub';
import { importVideoFiles } from './importVideos';
import { formatMb, syncAssetLimitBytes } from '../limits';
import { showNotice } from '../notices';
import { useSessionStore } from '../../state/sessionStore';

/**
 * The `accept` list for every media file input — the menu's "Add Media from
 * File" and the empty-canvas double-click picker share this so they stay
 * identical. Routed through importMediaFiles below.
 */
export const MEDIA_ACCEPT =
  'image/*,video/*,audio/*,.heic,.heif,application/pdf,.pdf,application/epub+zip,.epub,font/*,.ttf,.otf,.woff,.woff2';

/** Route dropped/pasted/picked files to the right importer (image, video, audio, PDF). */
export async function importMediaFiles(files: File[], point: Point): Promise<string[]> {
  // Boundary awareness up front: oversize files import fine LOCALLY, but a
  // board containing them can never finish syncing.
  const limit = syncAssetLimitBytes();
  for (const f of files) {
    if (f.size > limit) {
      showNotice(
        `“${f.name}” is ${formatMb(f.size)} — files over ${formatMb(limit)} work on this device but can’t sync to your account.`,
      );
    }
  }
  // HEIC frequently arrives with a blank MIME type, so match it explicitly.
  const images = files.filter((f) => f.type.startsWith('image/') || isHeicFile(f));
  const videos = files.filter((f) => f.type.startsWith('video/'));
  const audios = files.filter((f) => f.type.startsWith('audio/'));
  const pdfs = files.filter(isPdfFile);
  const epubs = files.filter(isEpubFile);
  const fonts = files.filter(isFontFile);
  const ids: string[] = [];
  // Images first (cheap), then videos (poster generation is async), then audio, then PDFs.
  if (images.length) ids.push(...(await importImageFiles(images, point)));
  if (videos.length) ids.push(...(await importVideoFiles(videos, point)));
  if (audios.length) ids.push(...(await importAudioFiles(audios, point)));
  if (pdfs.length) ids.push(...(await importPdfFiles(pdfs, point)));
  if (epubs.length) ids.push(...(await importEpubFiles(epubs, point)));
  if (fonts.length) ids.push(...(await importFontFiles(fonts, point)));
  if (ids.length) useSessionStore.getState().setSelection(ids);
  return ids;
}

export function hasMediaFiles(files: readonly File[]): boolean {
  return files.some(
    (f) =>
      f.type.startsWith('image/') ||
      f.type.startsWith('video/') ||
      f.type.startsWith('audio/') ||
      isHeicFile(f) ||
      isPdfFile(f) ||
      isEpubFile(f) ||
      isFontFile(f),
  );
}
