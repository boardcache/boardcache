import type { Point } from '../canvas/coords';
import { importBoardFromFile } from '../board/transfer';
import { showNotice } from '../notices';
import { pluginFileImporter } from '../../plugins/registry';
import { useSessionStore } from '../../state/sessionStore';
import { importAseFile, isAseFile } from './importAse';
import { hasMediaFiles, importMediaFiles } from './importMedia';
import { importTextFile, isTextDocumentFile } from './importText';
import { importFileItems } from './importFile';

/**
 * One door for files, however they arrive: a drop on the canvas, the Add
 * menu's pickers, a share from the OS. Every file a menu entry can import
 * imports here too, in this order:
 *
 *   1. a board file opens as a board;
 *   2. media (images, video, audio, PDF, ePub, fonts, calendars) through
 *      the media importers;
 *   3. a file type an enabled plugin claims (Office documents) through
 *      that plugin, which has the richer form;
 *   4. a text document (.txt, .md, .html, .rtf, .docx without the Office
 *      plugin) as a text box;
 *   5. a swatch file (.ase) as a palette;
 *   6. anything else as a file card: the bytes kept whole, to download.
 *
 * Conversions that take a while (an Office document can take seconds) run
 * behind the app-wide progress overlay, named after the file, so nothing
 * seems to have happened until it does. What nothing can read stays on the
 * board all the same, as a file to download, and a notice says so.
 *
 * `asText` is the Add menu's text picker: the person chose to import a
 * document as text, so a .docx becomes a text box there even with the
 * Office plugin on.
 */
export async function importFiles(
  files: File[],
  at: Point,
  { asText = false }: { asText?: boolean } = {},
): Promise<void> {
  const rest: File[] = [];
  for (const file of files) {
    if (!(await importBoardFromFile(file))) rest.push(file);
  }
  const media = rest.filter((f) => hasMediaFiles([f]) && !(asText && isTextDocumentFile(f)));
  if (media.length) await importMediaFiles(media, at);

  const slow = rest.filter((f) => !media.includes(f));
  const unknown: File[] = [];
  const session = useSessionStore.getState();
  let done = 0;
  const label = (file: File) =>
    slow.length > 1
      ? `Importing ${file.name} (${done + 1} of ${slow.length})`
      : `Importing ${file.name}`;
  try {
    for (const file of slow) {
      const plugin = asText && isTextDocumentFile(file) ? null : pluginFileImporter(file);
      const step = plugin
        ? () => plugin.importFiles([file], at)
        : isTextDocumentFile(file)
          ? () => importTextFile(file, at).then(() => undefined)
          : isAseFile(file)
            ? () => importAseFile(file, at)
            : null;
      if (!step) {
        unknown.push(file);
        done += 1;
        continue;
      }
      session.setExportBusy(label(file));
      session.setExportProgress(slow.length > 1 ? done / slow.length : null);
      try {
        await step();
      } catch (err) {
        showNotice(err instanceof Error ? err.message : `Couldn’t import ${file.name}.`);
      }
      done += 1;
    }
  } finally {
    if (slow.length) session.setExportBusy(null);
  }
  if (unknown.length) {
    const kept = await importFileItems(unknown, at);
    if (kept.length) {
      showNotice(
        kept.length === 1
          ? `“${unknown[0]!.name}” has no viewer here, so it is kept on the board as a file to download.`
          : `${kept.length} files have no viewer here, so they are kept on the board as files to download.`,
        { kind: 'info' },
      );
    }
    if (kept.length < unknown.length) {
      showNotice(
        `Couldn’t keep ${unknown.length - kept.length === 1 ? 'one file' : `${unknown.length - kept.length} files`}.`,
      );
    }
  }
}
