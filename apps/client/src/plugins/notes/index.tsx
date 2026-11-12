import { useEffect } from 'react';
import { z } from 'zod';
import './style.css';
import { StickyNoteIcon } from '../../components/icons';
import { clip, requireLive, requireType } from '../../lib/tools/shared';
import {
  parseFrontmatter,
  withFrontmatter,
  type Properties,
  type PropertyValue,
} from '../../lib/text/frontmatter';
import {
  backlinks,
  findNoteByTitle,
  noteTitle,
  notesOf,
  outgoingLinks,
  wordCount,
} from '../../lib/text/wikilinks';
import type { CanvasDocument, Item } from '@boardcache/schema';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { openPluginView, registerPlugin } from '../registry';
import { NotesView } from './NotesView';
import {
  allFolders,
  cleanFolderPath,
  createNote,
  setNoteOnCanvas,
  flushNote,
  moveNoteToFolder,
  noteFolderOf,
} from './notesModel';
import { activeNoteId, useNotesUi } from './store';

/**
 * Notes: every text box on the board as a note, in a full-screen view
 * with folders, tags, tabs, an outline, search and `[[links]]` between
 * notes. The view is the plugin; the data is the board's own text items
 * (plus `noteFolder` on each and the empty folders in the settings).
 */

const PLUGIN_ID = 'notes';
const VIEW_ID = 'notes';

export function openNotes(noteId?: string): void {
  useSessionStore.getState().setLightbox(null);
  if (noteId) useNotesUi.getState().openNote(noteId);
  openPluginView(VIEW_ID);
}

/** The lightbox and the text style panel ask for the view by event, so
 *  the core needs no import of the plugin. */
function NotesHost() {
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { itemId } = (e as CustomEvent<{ itemId?: string }>).detail ?? {};
      openNotes(itemId);
    };
    window.addEventListener('boardcache:open-notes', onOpen);
    return () => window.removeEventListener('boardcache:open-notes', onOpen);
  }, []);
  return null;
}

const noteSummary = (doc: CanvasDocument, n: Item) =>
  n.type === 'text'
    ? {
        id: n.id,
        title: noteTitle(n),
        folder: noteFolderOf(n),
        tags: n.tags ?? [],
        words: wordCount(n.text),
        onCanvas: !n.hidden,
        linksTo: outgoingLinks(doc, n).map((o) => noteTitle(o)),
        linkedFrom: backlinks(doc, n.id).length,
        preview: clip(n.text.replace(/\s+/g, ' ').trim(), 120),
      }
    : null;

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 57,
    name: 'Notes',
    description:
      'A notes view of the board: every text box as a note, with folders, tags, tabs, an outline, search and [[links]] between notes.',
  },
  Component: NotesHost,
  views: [
    {
      id: VIEW_ID,
      label: 'Notes',
      icon: <StickyNoteIcon />,
      Component: NotesView,
      // /b/:id/notes[/:noteId]: the note on the stage.
      subPath: () => {
        const id = activeNoteId(useNotesUi.getState());
        return id ? [id] : [];
      },
      applySubPath: (segments) => {
        const [id] = segments;
        if (id && useDocumentStore.getState().doc.items[id]?.type === 'text') {
          useNotesUi.getState().openNote(id);
        }
      },
    },
  ],
  itemMenu: (item) =>
    item.type === 'text'
      ? [
          {
            kind: 'action',
            label: 'Open in Notes',
            icon: <StickyNoteIcon />,
            onSelect: () => openNotes(item.id),
          },
        ]
      : [],
  tools: [
    {
      name: 'list_notes',
      description:
        'The notes on the board (every text box): id, title, folder, tags, word count, the notes each links to with [[Title]] and how many link to it. Filter by folder or tag.',
      parameters: z.object({
        folder: z
          .string()
          .optional()
          .describe('Only notes under this folder path ("Research/Ideas")'),
        tag: z.string().optional(),
      }),
      access: 'read',
      execute: (args, ctx) => {
        const doc = ctx.doc();
        const folder = args.folder ? cleanFolderPath(args.folder) : null;
        const tag = args.tag?.toLowerCase();
        const notes = notesOf(doc)
          .filter(
            (n) =>
              !folder || noteFolderOf(n) === folder || noteFolderOf(n).startsWith(`${folder}/`),
          )
          .filter((n) => !tag || (n.tags ?? []).some((t) => t.toLowerCase() === tag))
          .map((n) => noteSummary(doc, n));
        return { count: notes.length, folders: allFolders(doc), notes };
      },
    },
    {
      name: 'read_note',
      description:
        'A note’s full markdown text, by id or by title (the [[Title]] a link would use).',
      parameters: z.object({ id: z.string().optional(), title: z.string().optional() }),
      access: 'read',
      execute: (args, ctx) => {
        const doc = ctx.doc();
        const note = args.id
          ? requireType(ctx, requireLive(ctx, [args.id])[0]!, 'text')
          : args.title
            ? findNoteByTitle(doc, args.title)
            : null;
        if (!note) throw new Error('Give the id or the title of a note on the board.');
        return {
          ...noteSummary(doc, note),
          properties: parseFrontmatter(note.text).props,
          text: note.text,
          linkedFromTitles: backlinks(doc, note.id).map((b) => noteTitle(b)),
        };
      },
    },
    {
      name: 'set_note_properties',
      description:
        'Set properties on a note (its frontmatter: the --- block at the top, as Obsidian keeps it). Given keys are set (a string, number, boolean, null or a list of strings each), listed keys are removed, the rest stay. Returns the properties after the change.',
      parameters: z.object({
        id: z.string(),
        set: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
          )
          .optional()
          .describe('Properties to set, by name'),
        remove: z.array(z.string()).optional().describe('Property names to take away'),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const [id] = requireLive(ctx, [args.id]);
        const note = requireType(ctx, id!, 'text');
        flushNote(id!);
        const current = ctx.doc().items[id!];
        const text = current?.type === 'text' ? current.text : note.text;
        const props: Properties = { ...parseFrontmatter(text).props };
        for (const k of args.remove ?? []) delete props[k];
        for (const [k, v] of Object.entries(args.set ?? {}) as [string, PropertyValue][]) {
          const key = k.trim();
          if (key) props[key] = v;
        }
        const next = withFrontmatter(text, props);
        if (next !== text) {
          updateItems([id!], 'Edit properties', (d) => {
            if (d.type === 'text') d.text = next;
          });
        }
        return { id, properties: props };
      },
    },
    {
      name: 'write_note',
      description:
        'A new note on the board (a text box): its title, markdown text, an optional folder path and tags. Link other notes with [[Their Title]] in the text. Returns the id.',
      parameters: z.object({
        title: z.string(),
        text: z.string().default(''),
        folder: z.string().optional(),
        tags: z.array(z.string()).optional(),
        onCanvas: z
          .boolean()
          .default(true)
          .describe('false keeps the note to the Notes view, off the canvas'),
      }),
      access: 'write',
      execute: (args) => {
        const id = createNote(args.folder ?? '', args.title, args.text, {
          onCanvas: args.onCanvas,
        });
        if (args.tags?.length) {
          updateItems([id], 'Tag note', (d) => {
            d.tags = args.tags;
          });
        }
        return { id };
      },
    },
    {
      name: 'edit_note',
      description:
        'Change a note: any of its title, its whole markdown text, its folder path ("" for the top level), its tags, or whether it shows on the canvas.',
      parameters: z.object({
        id: z.string(),
        title: z.string().optional(),
        text: z.string().optional(),
        folder: z.string().optional(),
        tags: z.array(z.string()).optional(),
        onCanvas: z.boolean().optional(),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const [id] = requireLive(ctx, [args.id]);
        requireType(ctx, id!, 'text');
        if (args.folder !== undefined) moveNoteToFolder(id!, args.folder);
        updateItems([id!], 'Edit note', (d) => {
          if (d.type !== 'text') return;
          if (args.title !== undefined) {
            const t = args.title.trim();
            if (t) d.name = t;
            else delete d.name;
          }
          if (args.text !== undefined) d.text = args.text;
          if (args.tags !== undefined) d.tags = args.tags;
        });
        if (args.onCanvas !== undefined) setNoteOnCanvas(id!, args.onCanvas);
        return { id };
      },
    },
  ],
});
