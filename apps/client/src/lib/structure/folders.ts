/**
 * Folder trees over board items (the Feeds view; the Notes view keeps the
 * same shape in its own model): an item names its folder by a path
 * ("Research/Ideas"), and folders with nothing in them yet live in a list
 * on the board settings. Pure path helpers and the tree, no store access.
 */

export interface FolderNode<T> {
  /** Full path ('' at the root). */
  path: string;
  name: string;
  children: FolderNode<T>[];
  items: T[];
}

const clean = (segment: string) => segment.replace(/[\\/]/g, '-').trim();

/** A folder path as the model stores it: trimmed segments, no empties. */
export function cleanFolderPath(path: string): string {
  return path.split('/').map(clean).filter(Boolean).join('/');
}

const folderName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
export const parentFolder = (path: string): string =>
  path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** Every folder path, each ancestor included, from the items' folders and
 *  the settings' list, sorted. */
export function allFolderPaths(itemFolders: Iterable<string>, extra: Iterable<string>): string[] {
  const out = new Set<string>();
  const add = (p: string) => {
    const segs = p.split('/');
    for (let i = 1; i <= segs.length; i++) out.add(segs.slice(0, i).join('/'));
  };
  for (const f of itemFolders) if (f) add(f);
  for (const f of extra) {
    const c = cleanFolderPath(f);
    if (c) add(c);
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** The tree a sidebar shows: folders (sorted by name) with their items. */
export function buildFolderTree<T>(
  items: T[],
  folderOf: (item: T) => string,
  extra: Iterable<string>,
  rootName: string,
  compare: (a: T, b: T) => number,
): FolderNode<T> {
  const root: FolderNode<T> = { path: '', name: rootName, children: [], items: [] };
  const nodes = new Map<string, FolderNode<T>>([['', root]]);
  const nodeFor = (path: string): FolderNode<T> => {
    const have = nodes.get(path);
    if (have) return have;
    const parent = nodeFor(parentFolder(path));
    const node: FolderNode<T> = { path, name: folderName(path), children: [], items: [] };
    parent.children.push(node);
    nodes.set(path, node);
    return node;
  };
  for (const f of allFolderPaths(items.map(folderOf), extra)) nodeFor(f);
  for (const it of items) nodeFor(folderOf(it)).items.push(it);
  const sortNode = (node: FolderNode<T>) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    node.items.sort(compare);
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

/** How many items a folder holds, subfolders included. */
export function countItems<T>(node: FolderNode<T>): number {
  return node.items.length + node.children.reduce((n, c) => n + countItems(c), 0);
}

/** Where a path goes when `path` is renamed to `next`: it and its subfolders follow. */
export function renamedPath(p: string, path: string, next: string): string {
  return p === path || p.startsWith(`${path}/`) ? next + p.slice(path.length) : p;
}

/** Where a path goes when `path` is deleted: its contents move up a level. */
export function liftedPath(p: string, path: string): string {
  const parent = parentFolder(path);
  if (p === path) return parent;
  if (p.startsWith(`${path}/`)) return cleanFolderPath(`${parent}/${p.slice(path.length + 1)}`);
  return p;
}
