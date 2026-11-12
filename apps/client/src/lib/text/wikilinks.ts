import type { CanvasDocument, Item, TextItem } from '@boardcache/schema';
import { bodyOf } from './frontmatter';
import { markdownToPlainish } from './markdown';

/**
 * Notes are the board's text items, and `[[Another Note]]` in one of them
 * is a link to the note of that title. Titles are what the Notes view
 * shows: the item's name when it has one, else the first line of its text.
 * A link resolves by title, case-insensitively, names first, so a note can
 * be renamed on the canvas and still be found. `[[Title|shown as]]` keeps
 * the link under other words. Links inside code are not links.
 */

const isNote = (item: Item | undefined): item is TextItem => item?.type === 'text';

/** Every note on the board, in creation order where known. */
/** The type a note travels under in a drag (the Notes list's rows): its id. */
export const NOTE_DRAG_TYPE = 'application/x-boardcache-note';

export function notesOf(doc: CanvasDocument): TextItem[] {
  return Object.values(doc.items)
    .filter(isNote)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/** The title the Notes view shows for a note. */
export function noteTitle(item: TextItem): string {
  const named = item.name?.trim();
  if (named) return named;
  const first = markdownToPlainish(item.text).trim().split('\n')[0]?.trim() ?? '';
  return first.slice(0, 80) || 'Untitled';
}

export interface WikiLink {
  title: string;
  label: string;
}

/** Markdown with its code (fences and spans) blanked, so syntax inside code
 *  is never read as markup. Lengths are kept so positions still line up. */
function withoutCode(src: string): string {
  return src.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => m.replace(/[^\n]/g, ' '));
}

// A `!` before the brackets makes an embed (`![[Picture]]`), not a link.
const LINK_RE = /(!?)\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;

/** The links a note's text makes, in order, duplicates kept. */
export function wikiLinks(src: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of withoutCode(src).matchAll(LINK_RE)) {
    if (m[1]) continue;
    const title = m[2]!.trim();
    if (!title) continue;
    out.push({ title, label: (m[3] ?? m[2]!).trim() || title });
  }
  return out;
}

const fold = (s: string) => s.trim().toLowerCase();

/** The note a link's title names: by name first, then by shown title. */
export function findNoteByTitle(doc: CanvasDocument, title: string): TextItem | null {
  const want = fold(title);
  if (!want) return null;
  const notes = notesOf(doc);
  return (
    notes.find((n) => fold(n.name ?? '') === want) ??
    notes.find((n) => fold(noteTitle(n)) === want) ??
    null
  );
}

/** The notes whose text links to this one. */
export function backlinks(doc: CanvasDocument, noteId: string): TextItem[] {
  const target = doc.items[noteId];
  if (!isNote(target)) return [];
  const titles = new Set([fold(noteTitle(target)), ...(target.name ? [fold(target.name)] : [])]);
  return notesOf(doc).filter(
    (n) => n.id !== noteId && wikiLinks(n.text).some((l) => titles.has(fold(l.title))),
  );
}

/** The notes this one links to, resolved; unresolved titles are dropped. */
export function outgoingLinks(doc: CanvasDocument, note: TextItem): TextItem[] {
  const seen = new Set<string>();
  const out: TextItem[] = [];
  for (const link of wikiLinks(note.text)) {
    const hit = findNoteByTitle(doc, link.title);
    if (hit && hit.id !== note.id && !seen.has(hit.id)) {
      seen.add(hit.id);
      out.push(hit);
    }
  }
  return out;
}

export interface OutlineEntry {
  level: number;
  text: string;
  /** 0-based line of the heading in the source. */
  line: number;
  /** Position among the headings, as the rendered document counts them. */
  index: number;
}

/** The headings of a note, outside code, for an outline. */
export function outlineOf(src: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const lines = withoutCode(src).split('\n');
  const raw = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]!);
    if (!m) continue;
    const text = markdownToPlainish(raw[i]!.replace(/^#{1,6}\s+/, '').replace(/\s*#+\s*$/, ''))
      .replace(/\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g, (_, t: string, l?: string) => l ?? t)
      .trim();
    out.push({ level: m[1]!.length, text: text || 'Untitled heading', line: i, index: out.length });
  }
  return out;
}

/** The number of words in a note's text, code included. */
export function wordCount(src: string): number {
  const words = bodyOf(src).trim().match(/\S+/g);
  return words ? words.length : 0;
}
