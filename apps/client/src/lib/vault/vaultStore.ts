import { create } from 'zustand';
import { desktopVault, type VaultScanBoard } from '../platform';

/**
 * The board folder as the index sees it ("Files" in the sidebar): the root
 * the person chose, the organisational folders under it and the boards,
 * each a folder of its own. Read by scanning the disk through the shell;
 * re-read when the shell reports a change made outside the app, and after
 * every change the app makes itself.
 *
 * Desktop only: without the shell's bridge the store stays empty and the
 * section never appears.
 */

export interface VaultBoard extends VaultScanBoard {
  /** The organisational folder holding the board ('' at the root). */
  dir: string;
}

export interface VaultDir {
  path: string;
  name: string;
  /** The parent folder ('' at the root). */
  dir: string;
}

interface VaultState {
  /** The chosen root (absolute path), null while no folder is chosen. */
  root: string | null;
  /** Whether a scan has completed since the root was set. */
  loaded: boolean;
  dirs: VaultDir[];
  boards: VaultBoard[];
}

export const useVaultStore = create<VaultState>(() => ({
  root: null,
  loaded: false,
  dirs: [],
  boards: [],
}));

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
export const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Whether the desktop shell offers a board folder at all. */
export const vaultAvailable = (): boolean => desktopVault() !== null;

export function vaultBoard(id: string): VaultBoard | null {
  return useVaultStore.getState().boards.find((b) => b.id === id) ?? null;
}

/** The root and every folder as "A / B" labels, for the move pickers. */
export function vaultDirOptions(): { path: string; label: string }[] {
  const dirs = [...useVaultStore.getState().dirs].sort((a, b) => a.path.localeCompare(b.path));
  return [
    { path: '', label: 'Files' },
    ...dirs.map((d) => ({ path: d.path, label: d.path.split('/').join(' / ') })),
  ];
}

/** Root → … → `dir`, as folder records (empty at the root). */
export function dirPath(dir: string): VaultDir[] {
  if (!dir) return [];
  const out: VaultDir[] = [];
  let cur = '';
  for (const seg of dir.split('/')) {
    cur = cur ? `${cur}/${seg}` : seg;
    out.push({ path: cur, name: seg, dir: parentOf(cur) });
  }
  return out;
}

let scanning: Promise<void> | null = null;
let scanAgain = false;

/**
 * Read the folder tree from the disk. Runs one scan at a time; a request
 * made during a scan queues one more, so the last change is always seen.
 */
export function rescanVault(): Promise<void> {
  const bridge = desktopVault();
  if (!bridge) return Promise.resolve();
  if (scanning) {
    scanAgain = true;
    return scanning;
  }
  scanning = (async () => {
    try {
      do {
        scanAgain = false;
        const scan = await bridge.scan();
        const { reconcileVaultIds } = await import('./vaultBoards');
        const boards = await reconcileVaultIds(scan.boards);
        useVaultStore.setState({
          root: scan.root,
          loaded: true,
          dirs: scan.dirs.map((path) => ({ path, name: nameOf(path), dir: parentOf(path) })),
          boards: boards.map((b) => ({ ...b, dir: parentOf(b.path) })),
        });
        pruneVaultThumbs();
      } while (scanAgain);
    } finally {
      scanning = null;
    }
  })();
  return scanning;
}

// --- thumbnails --------------------------------------------------------------
// Object URLs for the folder thumbnails, keyed by path and stamp so a board
// re-rendered on disk shows its new preview and an unchanged one costs no read.

const thumbUrls = new Map<string, string>();
const thumbPending = new Map<string, Promise<string | null>>();

export function vaultThumbUrl(board: VaultBoard, dark: boolean): Promise<string | null> {
  const bridge = desktopVault();
  const stamp = dark ? board.thumbDark : board.thumb;
  if (!bridge || stamp === null) return Promise.resolve(null);
  const key = `${board.path}\u0000${dark ? 'dark' : 'light'}\u0000${stamp}`;
  const cached = thumbUrls.get(key);
  if (cached) return Promise.resolve(cached);
  let p = thumbPending.get(key);
  if (!p) {
    p = bridge
      .read(board.path, dark ? 'thumbnail-dark.png' : 'thumbnail.png')
      .then((res) => {
        if (res.error !== undefined) return null;
        // Older stamps of the same file go: a board has one current preview.
        for (const [k, url] of thumbUrls) {
          if (k.startsWith(`${board.path}\u0000${dark ? 'dark' : 'light'}\u0000`)) {
            URL.revokeObjectURL(url);
            thumbUrls.delete(k);
          }
        }
        const url = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: 'image/png' }));
        thumbUrls.set(key, url);
        return url;
      })
      .finally(() => thumbPending.delete(key));
    thumbPending.set(key, p);
  }
  return p;
}

/** Drop the previews of boards no longer listed. */
function pruneVaultThumbs(): void {
  const live = new Set(useVaultStore.getState().boards.map((b) => b.path));
  for (const [k, url] of thumbUrls) {
    if (!live.has(k.split('\u0000')[0]!)) {
      URL.revokeObjectURL(url);
      thumbUrls.delete(k);
    }
  }
}
