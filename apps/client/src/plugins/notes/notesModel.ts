import type { CanvasDocument, NoteColor, TextItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { screenToCanvas } from '../../lib/canvas/coords';
import { notePath } from '../../lib/router';
import { findOpenSpot } from '../../lib/canvas/placeSpot';
import { TEXT_DEFAULTS } from '../../lib/import/createItems';
import { hasTag } from '../../lib/text/tags';
import { noteTitle, notesOf, wikiLinks } from '../../lib/text/wikilinks';
import type { NotesSort } from './store';
import {
  addItems,
  removeItems,
  setItemsHidden,
  topZIndex,
  updateBoardSettings,
  updateItems,
} from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * The Notes view's model over the board: notes are the text items, filed
 * under folders by their `noteFolder` path ("Research/Ideas"); folders with
 * nothing in them yet are listed in the board settings. Everything here is
 * a command on the document, so it undoes and syncs like any other edit.
 */

export interface FolderNode {
  /** Full path ('' at the root). */
  path: string;
  name: string;
  children: FolderNode[];
  notes: TextItem[];
}

const clean = (segment: string) => segment.replace(/[\\/]/g, '-').trim();

/** A folder path as the model stores it: trimmed segments, no empties. */
export function cleanFolderPath(path: string): string {
  return path.split('/').map(clean).filter(Boolean).join('/');
}

export const noteFolderOf = (note: TextItem): string => cleanFolderPath(note.noteFolder ?? '');

const folderName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const parentFolder = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** Every folder path on the board: from the notes and the settings. */
export function allFolders(doc: CanvasDocument): string[] {
  const out = new Set<string>();
  const add = (p: string) => {
    const segs = p.split('/');
    for (let i = 1; i <= segs.length; i++) out.add(segs.slice(0, i).join('/'));
  };
  for (const n of notesOf(doc)) {
    const f = noteFolderOf(n);
    if (f) add(f);
  }
  for (const f of doc.settings.noteFolders) {
    const c = cleanFolderPath(f);
    if (c) add(c);
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

const byTitle = (a: TextItem, b: TextItem) =>
  noteTitle(a).localeCompare(noteTitle(b), undefined, { sensitivity: 'base', numeric: true });
const byCreated = (a: TextItem, b: TextItem) =>
  (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || byTitle(a, b);

/** The order the sidebar lists notes in. */
function noteComparator(sort: NotesSort): (a: TextItem, b: TextItem) => number {
  switch (sort) {
    case 'title-desc':
      return (a, b) => byTitle(b, a);
    case 'newest':
      return (a, b) => byCreated(b, a);
    case 'oldest':
      return byCreated;
    default:
      return byTitle;
  }
}

/** The folder tree the sidebar shows. */
export function folderTree(doc: CanvasDocument, sort: NotesSort = 'title'): FolderNode {
  const root: FolderNode = { path: '', name: 'Notes', children: [], notes: [] };
  const nodes = new Map<string, FolderNode>([['', root]]);
  const nodeFor = (path: string): FolderNode => {
    const have = nodes.get(path);
    if (have) return have;
    const parent = nodeFor(parentFolder(path));
    const node: FolderNode = { path, name: folderName(path), children: [], notes: [] };
    parent.children.push(node);
    nodes.set(path, node);
    return node;
  };
  for (const f of allFolders(doc)) nodeFor(f);
  for (const n of notesOf(doc)) nodeFor(noteFolderOf(n)).notes.push(n);
  const cmp = noteComparator(sort);
  const sortNode = (node: FolderNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    node.notes.sort(cmp);
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

export interface NoteHit {
  note: TextItem;
  /** A line of the note around the first match, when the body matched. */
  snippet: string | null;
}

/** Notes matching a search (title, text, tags, folder) and a tag filter. */
export function searchNotes(
  doc: CanvasDocument,
  query: string,
  tag: string | null,
  sort: NotesSort = 'title',
): NoteHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: NoteHit[] = [];
  for (const note of notesOf(doc).sort(noteComparator(sort))) {
    if (tag && !hasTag(note, tag)) continue;
    if (!terms.length) {
      out.push({ note, snippet: null });
      continue;
    }
    const title = noteTitle(note).toLowerCase();
    const body = note.text.toLowerCase();
    const meta = [...(note.tags ?? []), noteFolderOf(note)].join(' ').toLowerCase();
    if (!terms.every((t) => title.includes(t) || body.includes(t) || meta.includes(t))) continue;
    let snippet: string | null = null;
    const at = body.indexOf(terms[0]!);
    if (at >= 0 && !title.includes(terms[0]!)) {
      const from = Math.max(0, body.lastIndexOf('\n', at) + 1);
      const to = body.indexOf('\n', at);
      snippet = note.text
        .slice(from, to < 0 ? undefined : to)
        .trim()
        .slice(0, 140);
    }
    out.push({ note, snippet });
  }
  return out;
}

/** Tags carried by notes, with how many notes carry each. */
export function noteTags(doc: CanvasDocument): { tag: string; count: number }[] {
  const seen = new Map<string, { tag: string; count: number }>();
  for (const n of notesOf(doc)) {
    for (const t of n.tags ?? []) {
      const key = t.toLowerCase();
      const have = seen.get(key);
      if (have) have.count++;
      else seen.set(key, { tag: t, count: 1 });
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }),
  );
}

/** Where a new note lands on the canvas: an open spot near the middle of
 *  the view the canvas last showed. */
function spotForNewNote(doc: CanvasDocument): { x: number; y: number } {
  const centre = screenToCanvas(
    { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    doc.viewport,
  );
  return findOpenSpot(doc, centre, TEXT_DEFAULTS.width, TEXT_DEFAULTS.height);
}

/**
 * A new note, filed under `folder`; returns its id. It is a text box of the
 * board either way, placed in open space near where the canvas last looked,
 * but a note written in the Notes view stays off the canvas (`hidden`, the
 * layers panel's eye) until someone puts it there: the view is its home.
 */
export function createNote(
  folder: string,
  title = 'Untitled',
  text = '',
  { onCanvas = false }: { onCanvas?: boolean } = {},
): string {
  const { doc } = useDocumentStore.getState();
  const spot = spotForNewNote(doc);
  const item = noteItem(doc, {
    folder,
    title,
    text,
    onCanvas,
    at: spot,
    zIndex: topZIndex(doc) + 1,
  });
  addItems([item], 'New note');
  return item.id;
}

export interface NoteSpec {
  folder: string;
  title: string;
  text: string;
  onCanvas: boolean;
  /** The centre of the box. */
  at: { x: number; y: number };
  zIndex: number;
  tags?: string[];
  createdAt?: string;
}

/** A note as a text item of the board, not yet added: the default look of
 *  a new text box, its title as the name, filed and placed as asked. */
export function noteItem(doc: CanvasDocument, spec: NoteSpec): TextItem {
  const defaults = useSessionStore.getState().textDefaults;
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  const folder = cleanFolderPath(spec.folder);
  return {
    id: newId(),
    type: 'text',
    x: spec.at.x - TEXT_DEFAULTS.width / 2,
    y: spec.at.y - TEXT_DEFAULTS.height / 2,
    width: TEXT_DEFAULTS.width,
    height: TEXT_DEFAULTS.height,
    rotation: 0,
    zIndex: spec.zIndex,
    locked: false,
    opacity: 1,
    groupId: null,
    name: spec.title.trim() || 'Untitled',
    createdAt: spec.createdAt ?? new Date().toISOString(),
    ...(folder ? { noteFolder: folder } : {}),
    ...(spec.tags?.length ? { tags: spec.tags } : {}),
    text: spec.text,
    fontSize: defaults.fontSize,
    fontFamily: defaults.fontFamily,
    color: 'default',
    background: dark ? '#1b1b1f' : '#ffffff',
    align: defaults.align,
    verticalAlign: 'top',
    autoHeight: true,
    ...(spec.onCanvas ? {} : { hidden: true }),
  };
}

/** Make sure every folder path (and its parents) exists in the settings. */
export function ensureFolders(paths: string[]): void {
  const { doc } = useDocumentStore.getState();
  const have = new Set(allFolders(doc));
  const add: string[] = [];
  for (const raw of paths) {
    const segs = cleanFolderPath(raw).split('/').filter(Boolean);
    for (let i = 1; i <= segs.length; i++) {
      const path = segs.slice(0, i).join('/');
      if (!have.has(path)) {
        have.add(path);
        add.push(path);
      }
    }
  }
  if (add.length) updateBoardSettings({ noteFolders: [...doc.settings.noteFolders, ...add] });
}

export const NOTE_COLOR_LABEL: Record<NoteColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  gray: 'Gray',
};

/** Tint the note's row in the view (null clears it). */
export function setNoteColor(id: string, color: NoteColor | null): void {
  updateItems([id], color ? 'Color note' : 'Clear note color', (d) => {
    if (d.type !== 'text') return;
    if (color) d.noteColor = color;
    else delete d.noteColor;
  });
}

/** "Folder/Subfolder/Title": the note's place as a path. */
export function notePathText(note: TextItem): string {
  const folder = noteFolderOf(note);
  return folder ? `${folder}/${noteTitle(note)}` : noteTitle(note);
}

/** The note in a window of its own, at its own address. */
export function openNoteWindow(id: string): void {
  window.open(`${location.origin}${notePath(id)}`, '_blank', 'noopener');
}

/** Put a note on the canvas, or take it off (it stays in the view). */
export function setNoteOnCanvas(id: string, on: boolean): void {
  setItemsHidden([id], !on);
}

/** A copy of the note beside it: the same text, folder, tags and look,
 *  titled "… copy". Returns the copy's id. */
export function duplicateNote(id: string): string | null {
  const it = useDocumentStore.getState().doc.items[id];
  if (it?.type !== 'text') return null;
  const source = it as TextItem;
  const copy = createNote(noteFolderOf(source), `${noteTitle(source)} copy`, source.text, {
    onCanvas: !source.hidden,
  });
  updateItems([copy], 'Duplicate note', (d) => {
    if (d.type !== 'text') return;
    d.fontFamily = source.fontFamily;
    d.fontSize = source.fontSize;
    d.color = source.color;
    d.background = source.background;
    d.align = source.align;
    if (source.tags?.length) d.tags = [...source.tags];
  });
  return copy;
}

export function renameNote(id: string, title: string): void {
  updateItems([id], 'Rename note', (d) => {
    if (d.type !== 'text') return;
    const t = title.trim();
    if (t) d.name = t;
    else delete d.name;
  });
}

export function deleteNote(id: string): void {
  removeItems([id], 'Delete note');
}

export function moveNoteToFolder(id: string, folder: string): void {
  const path = cleanFolderPath(folder);
  updateItems([id], 'Move note', (d) => {
    if (path) d.noteFolder = path;
    else delete d.noteFolder;
  });
}

/** A folder with nothing in it yet; returns its path. */
export function createFolder(parent: string, name: string): string | null {
  const path = cleanFolderPath(`${parent}/${name}`);
  if (!path) return null;
  const { doc } = useDocumentStore.getState();
  if (allFolders(doc).includes(path)) return path;
  updateBoardSettings({ noteFolders: [...doc.settings.noteFolders, path] });
  return path;
}

/** Rename a folder: its notes and subfolders follow. */
export function renameFolder(path: string, name: string): string | null {
  const next = cleanFolderPath(`${parentFolder(path)}/${name}`);
  if (!next || next === path) return path;
  const { doc } = useDocumentStore.getState();
  const moved = (p: string) =>
    p === path || p.startsWith(`${path}/`) ? next + p.slice(path.length) : p;
  const ids = notesOf(doc)
    .filter((n) => moved(noteFolderOf(n)) !== noteFolderOf(n))
    .map((n) => n.id);
  if (ids.length) {
    updateItems(ids, 'Rename folder', (d) => {
      d.noteFolder = moved(cleanFolderPath(d.noteFolder ?? ''));
    });
  }
  const folders = new Set(doc.settings.noteFolders.map(cleanFolderPath).map(moved));
  folders.add(next);
  updateBoardSettings({ noteFolders: [...folders].filter(Boolean) });
  return next;
}

/** Remove a folder: its notes move up to the parent, subfolders with them. */
export function deleteFolder(path: string): void {
  const { doc } = useDocumentStore.getState();
  const parent = parentFolder(path);
  const lifted = (p: string) =>
    p === path
      ? parent
      : p.startsWith(`${path}/`)
        ? cleanFolderPath(`${parent}/${p.slice(path.length + 1)}`)
        : p;
  const ids = notesOf(doc)
    .filter((n) => lifted(noteFolderOf(n)) !== noteFolderOf(n))
    .map((n) => n.id);
  if (ids.length) {
    updateItems(ids, 'Delete folder', (d) => {
      const to = lifted(cleanFolderPath(d.noteFolder ?? ''));
      if (to) d.noteFolder = to;
      else delete d.noteFolder;
    });
  }
  updateBoardSettings({
    noteFolders: [
      ...new Set(
        doc.settings.noteFolders
          .map(cleanFolderPath)
          .filter((p) => p !== path)
          .map(lifted)
          .filter(Boolean),
      ),
    ],
  });
}

/** The notes a note links to that are not on the board (titles). */
export function unresolvedLinks(doc: CanvasDocument, note: TextItem): string[] {
  const titles = new Set(
    notesOf(doc)
      .flatMap((n) => [noteTitle(n), n.name ?? ''])
      .map((t) => t.toLowerCase()),
  );
  const out: string[] = [];
  for (const l of wikiLinks(note.text)) {
    if (!titles.has(l.title.toLowerCase()) && !out.includes(l.title)) out.push(l.title);
  }
  return out;
}

// --- the editor's unsaved draft ----------------------------------------------
// The editor saves a moment after typing stops. Something else changing the
// note's text (the inspector's properties, a tool) asks it to save first, or
// the draft would write over the change.
const flushers = new Map<string, () => void>();

/** Register the editor showing note `id`; returns the way to unregister. */
export function onNoteFlush(id: string, flush: () => void): () => void {
  flushers.set(id, flush);
  return () => {
    if (flushers.get(id) === flush) flushers.delete(id);
  };
}

/** Save the editor's draft of note `id`, if one is open. */
export function flushNote(id: string): void {
  flushers.get(id)?.();
}
