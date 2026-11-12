import { unzip } from 'fflate';
import { cleanFolderPath, ensureFolders, noteItem } from './notesModel';
import { TEXT_DEFAULTS } from '../../lib/import/createItems';
import { importFileItems } from '../../lib/import/importFile';
import { hasMediaFiles, importMediaFiles } from '../../lib/import/importMedia';
import { isTextDocumentFile } from '../../lib/import/importText';
import { screenToCanvas } from '../../lib/canvas/coords';
import { findOpenSpot } from '../../lib/canvas/placeSpot';
import { parseFrontmatter } from '../../lib/text/frontmatter';
import { normalizeTag } from '../../lib/text/tags';
import { mimeForName } from '../../lib/vault/layout';
import { showNotice } from '../../lib/notices';
import { addItems, setItemsHidden, topZIndex } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useHistoryStore } from '../../state/history';
import { useSessionStore } from '../../state/sessionStore';

/**
 * An Obsidian vault into the Notes view: every Markdown file a note in the
 * folder it came from, every other file (a picture, a PDF, anything) an
 * item the notes can embed, all of it kept off the canvas. The vault's
 * own folder (`.obsidian`), its trash and dotfiles are left behind.
 *
 * Obsidian links carry paths and headings that this board's links do not:
 * `[[Folder/Note#Heading|words]]` becomes `[[Note|words]]`, and an embed
 * `![[Folder/pic.png|300]]` becomes `![[pic.png|300]]`, so they resolve by
 * title here as they did there. Frontmatter stays in the note; its `tags`
 * become the note's tags.
 */

export interface VaultFile {
  /** Path inside the vault, `/`-separated, the vault's root stripped. */
  path: string;
  file: File;
}

interface VaultImportResult {
  notes: number;
  attachments: number;
  skipped: number;
}

const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', '__MACOSX']);

/** Whether a path is one the import leaves behind. */
function skipped(path: string): boolean {
  const segs = path.split('/');
  return segs.some((s) => SKIP_DIRS.has(s) || (s.startsWith('.') && s !== '.')) || !segs.at(-1);
}

/** Take a root folder off every path when they all share one. */
export function stripCommonRoot(paths: string[]): string[] {
  if (paths.length === 0) return paths;
  const first = paths[0]!.split('/')[0];
  if (!first || !paths.every((p) => p.split('/').length > 1 && p.split('/')[0] === first)) {
    return paths;
  }
  return paths.map((p) => p.slice(first.length + 1));
}

/** The files of a picked folder (each carries the path it was picked under). */
export function vaultFromPickedFiles(files: File[]): VaultFile[] {
  const paths = files.map((f) => (f.webkitRelativePath || f.name).replace(/\\/g, '/'));
  const stripped = stripCommonRoot(paths);
  return files.map((file, i) => ({ path: stripped[i]!, file }));
}

/** The files of a zipped vault. */
export async function vaultFromZip(zip: File): Promise<VaultFile[]> {
  if (zip.size > MAX_ZIP_BYTES) throw new Error('the zip is larger than 1 GB');
  const bytes = new Uint8Array(await zip.arrayBuffer());
  // What an archive may unpack to: a vault, not a bomb.
  let entries = 0;
  let total = 0;
  const unpacked = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      bytes,
      {
        filter: (f) => {
          if (f.name.endsWith('/')) return false;
          entries += 1;
          total += f.originalSize;
          if (entries > MAX_ENTRIES || total > MAX_UNPACKED_BYTES) {
            reject(new Error('the archive unpacks to more than this import takes'));
            return false;
          }
          return true;
        },
      },
      (err, out) => (err ? reject(err) : resolve(out)),
    );
  });
  const names = Object.keys(unpacked).filter((n) => unpacked[n]!.length > 0 || n.endsWith('.md'));
  const stripped = stripCommonRoot(names);
  return names.map((name, i) => {
    const base = name.slice(name.lastIndexOf('/') + 1);
    const blob = unpacked[name]!;
    return {
      path: stripped[i]!,
      file: new File([blob as BlobPart], base, { type: mimeForName(base) ?? '' }),
    };
  });
}

const LINK = /(!?)\[\[([^\]|#^]+)([#^][^\]|]*)?(\|[^\]]*)?\]\]/g;

/** Obsidian's paths and headings out of the links; titles stay. */
export function rewriteObsidianLinks(text: string): string {
  return text.replace(
    LINK,
    (_m, bang: string, target: string, _frag, alias: string | undefined) => {
      const title = target.trim().split('/').filter(Boolean).at(-1) ?? target.trim();
      return `${bang}[[${title}${alias ?? ''}]]`;
    },
  );
}

/** The tags a frontmatter block names, as this board writes them. */
export function frontmatterTags(text: string): string[] {
  const raw = parseFrontmatter(text).props['tags'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
  return [...new Set(list.map((t) => normalizeTag(String(t))).filter(Boolean))];
}

const isNoteFile = (path: string) => /\.(md|markdown)$/i.test(path);

async function importObsidianVault(
  files: VaultFile[],
  vaultName: string,
): Promise<VaultImportResult> {
  const session = useSessionStore.getState();
  session.setExportBusy(`Importing ${vaultName}`);
  try {
    const kept = files.filter((f) => !skipped(f.path));
    const skippedCount = files.length - kept.length;
    const noteFiles = kept.filter((f) => isNoteFile(f.path));
    const others = kept.filter((f) => !isNoteFile(f.path));

    const { doc } = useDocumentStore.getState();
    const centre = screenToCanvas(
      { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      doc.viewport,
    );
    const origin = findOpenSpot(doc, centre, TEXT_DEFAULTS.width, TEXT_DEFAULTS.height);
    let z = topZIndex(doc) + 1;
    const cols = 8;
    const stepX = TEXT_DEFAULTS.width + 40;
    const stepY = TEXT_DEFAULTS.height + 40;
    ensureFolders(noteFiles.map((f) => f.path.slice(0, Math.max(0, f.path.lastIndexOf('/')))));
    const items = [];
    for (let i = 0; i < noteFiles.length; i++) {
      const f = noteFiles[i]!;
      const text = rewriteObsidianLinks(await f.file.text());
      const slash = f.path.lastIndexOf('/');
      const folder = slash >= 0 ? f.path.slice(0, slash) : '';
      const title = f.path.slice(slash + 1).replace(/\.(md|markdown)$/i, '');
      items.push(
        noteItem(doc, {
          folder: cleanFolderPath(folder),
          title,
          text,
          onCanvas: false,
          at: { x: origin.x + (i % cols) * stepX, y: origin.y + Math.floor(i / cols) * stepY },
          zIndex: z++,
          tags: frontmatterTags(text),
          createdAt: new Date(f.file.lastModified || Date.now()).toISOString(),
        }),
      );
    }
    // In slices a team room accepts (a batch is capped at a few thousand
    // patches), joined into one undo step.
    const mark = useHistoryStore.getState().index;
    for (let i = 0; i < items.length; i += 500) {
      addItems(items.slice(i, i + 500), `Import ${vaultName}`);
    }
    if (items.length > 500) useHistoryStore.getState().coalesceSince(mark, `Import ${vaultName}`);

    // Attachments: pictures, sound, documents through their importers, the
    // rest as file cards, all off the canvas, named as the vault names them
    // so the notes' embeds find them.
    const at = { x: origin.x, y: origin.y + Math.ceil(items.length / cols) * stepY + 200 };
    const media = others.filter((f) => hasMediaFiles([f.file]) || isTextDocumentFile(f.file));
    const rest = others.filter((f) => !media.includes(f));
    const ids: string[] = [];
    if (media.length)
      ids.push(
        ...(await importMediaFiles(
          media.map((f) => f.file),
          at,
        )),
      );
    if (rest.length)
      ids.push(
        ...(await importFileItems(
          rest.map((f) => f.file),
          at,
        )),
      );
    if (ids.length) setItemsHidden(ids, true);

    return { notes: items.length, attachments: ids.length, skipped: skippedCount };
  } finally {
    session.setExportBusy(null);
  }
}

/** Import and say what came of it. */
export async function importVaultFiles(files: VaultFile[], vaultName: string): Promise<void> {
  if (!files.length) {
    showNotice('Nothing to import: the vault is empty.', { kind: 'warn' });
    return;
  }
  try {
    const r = await importObsidianVault(files, vaultName);
    const parts = [
      `${r.notes} ${r.notes === 1 ? 'note' : 'notes'}`,
      ...(r.attachments
        ? [`${r.attachments} ${r.attachments === 1 ? 'attachment' : 'attachments'}`]
        : []),
    ];
    showNotice(`Imported ${parts.join(' and ')} from ${vaultName} to the Notes view.`, {
      kind: 'info',
    });
  } catch (err) {
    console.error('boardCache: vault import failed', err);
    showNotice(
      `Couldn’t import ${vaultName}: ${err instanceof Error ? err.message : 'unreadable'}.`,
    );
  }
}
