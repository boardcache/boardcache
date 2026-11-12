import { useMemo, useRef, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import type { TextItem } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FilePlusIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  RenameIcon,
  SearchIcon,
  SortIcon,
  StickyNoteIcon,
  TagIcon,
  TrashIcon,
  EyeIcon,
  EyeOffIcon,
  FolderInputIcon,
} from '../../components/icons';
import { RadixEntries } from '../../components/menu/RadixEntries';
import type { MenuEntry } from '../../lib/menuBuilders';
import { confirmDialog, promptText } from '../../components/ui/Prompt';
import { UiSelect } from '../../components/ui/Select';
import { useMobileViewport } from '../../hooks/useMobileViewport';
import { NOTE_DRAG_TYPE as DRAG_TYPE, noteTitle } from '../../lib/text/wikilinks';
import { useDocumentStore } from '../../state/documentStore';
import { notePath } from '../../lib/router';
import { showNotice } from '../../lib/notices';
import { NOTE_COLORS } from '@boardcache/schema';
import { importVaultFiles, vaultFromPickedFiles, vaultFromZip } from './importVault';
import {
  createFolder,
  createNote,
  NOTE_COLOR_LABEL,
  notePathText,
  openNoteWindow,
  setNoteColor,
  setNoteOnCanvas,
  deleteFolder,
  deleteNote,
  duplicateNote,
  renameNote,
  folderTree,
  moveNoteToFolder,
  noteTags,
  renameFolder,
  searchNotes,
  type FolderNode,
} from './notesModel';
import { activeNoteId, noteIsOpen, useNotesUi, type NotesSort } from './store';

const SORT_OPTIONS: { value: NotesSort; label: string }[] = [
  { value: 'title', label: 'Title A to Z' },
  { value: 'title-desc', label: 'Title Z to A' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

/**
 * The left sidebar: a search box, the folder tree of notes (folders fold,
 * notes drag between them) and the tags notes carry, each a filter. With
 * a search or a tag on, the tree gives way to the matching notes.
 */
export function NotesSidebar() {
  const doc = useDocumentStore((s) => s.doc);
  const query = useNotesUi((s) => s.query);
  const tag = useNotesUi((s) => s.tag);
  const sort = useNotesUi((s) => s.sort);
  const tree = useMemo(() => folderTree(doc, sort), [doc, sort]);
  const tags = useMemo(() => noteTags(doc), [doc]);
  const hits = useMemo(
    () => (query.trim() || tag ? searchNotes(doc, query, tag, sort) : null),
    [doc, query, tag, sort],
  );

  const newNote = () => {
    const id = createNote('');
    useNotesUi.getState().openNote(id, { newTab: true });
    useNotesUi.getState().setMode('edit');
    useNotesUi.getState().setTitleFocus(id);
  };
  const newFolder = async () => {
    const name = await promptText({ title: 'New folder', label: 'Name', placeholder: 'Folder' });
    if (name?.trim()) createFolder('', name);
  };
  // Import a folder of notes (an Obsidian vault, say), or a zip of one.
  const zipInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const importEntries: MenuEntry[] = [
    { kind: 'action', label: 'Folder', onSelect: () => dirInput.current?.click() },
    { kind: 'action', label: 'Zip archive', onSelect: () => zipInput.current?.click() },
  ];

  return (
    <aside className="notes-side notes-side-left" data-testid="notes-sidebar">
      <div className="notes-search">
        <SearchIcon size={14} />
        <input
          className="notes-search-input"
          data-testid="notes-search"
          placeholder="Search notes"
          aria-label="Search notes"
          value={query}
          onChange={(e) => useNotesUi.getState().setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') useNotesUi.getState().setQuery('');
          }}
        />
        {query && (
          <button
            type="button"
            className="notes-search-clear"
            aria-label="Clear search"
            onClick={() => useNotesUi.getState().setQuery('')}
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      <div className="notes-side-actions">
        <button
          type="button"
          className="view-icon-btn"
          title="New note"
          aria-label="New note"
          data-testid="notes-new"
          onClick={newNote}
        >
          <FilePlusIcon size={16} />
        </button>
        <button
          type="button"
          className="view-icon-btn"
          title="New folder"
          aria-label="New folder"
          data-testid="notes-new-folder"
          onClick={() => void newFolder()}
        >
          <FolderPlusIcon size={16} />
        </button>
        <DM.Root>
          <DM.Trigger asChild>
            <button
              type="button"
              className="view-icon-btn"
              title="Import"
              aria-label="Import"
              data-testid="notes-import"
            >
              <FolderInputIcon size={16} />
            </button>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content
              className="menu-panel menu-list"
              data-testid="notes-import-menu"
              align="start"
              side="bottom"
              sideOffset={4}
            >
              <RadixEntries entries={importEntries} />
            </DM.Content>
          </DM.Portal>
        </DM.Root>
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="notes-vault-zip-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void vaultFromZip(file).then((files) =>
              importVaultFiles(files, file.name.replace(/\.zip$/i, '')),
            );
          }}
        />
        <input
          ref={dirInput}
          type="file"
          // @ts-expect-error -- the folder picker; not in the DOM typings
          webkitdirectory=""
          multiple
          hidden
          data-testid="notes-vault-dir-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (!files.length) return;
            const root = (files[0]!.webkitRelativePath || '').split('/')[0] || 'the folder';
            void importVaultFiles(vaultFromPickedFiles(files), root);
          }}
        />
        <span className="view-sort notes-sort">
          <UiSelect
            value={sort}
            options={SORT_OPTIONS}
            onChange={(v) => useNotesUi.getState().setSort(v as NotesSort)}
            ariaLabel="Sort notes"
            testId="notes-sort"
            trigger={<SortIcon size={16} />}
          />
        </span>
      </div>
      <div className="notes-tree" role="tree" aria-label="Notes">
        {hits ? (
          <SearchResults hits={hits} />
        ) : (
          <>
            {tree.children.map((f) => (
              <FolderRow key={f.path} node={f} depth={0} />
            ))}
            {tree.notes.map((n) => (
              <NoteRow key={n.id} note={n} depth={0} />
            ))}
            {tree.children.length === 0 && tree.notes.length === 0 && (
              <p className="notes-empty-hint" data-testid="notes-empty">
                No notes yet. Every text box on the board is a note; New note adds one.
              </p>
            )}
          </>
        )}
      </div>
      {tags.length > 0 && (
        <div className="notes-tags" data-testid="notes-tags">
          <div className="notes-tags-head">
            <TagIcon size={12} /> Tags
          </div>
          <div className="notes-tags-list">
            {tags.map((t) => (
              <button
                key={t.tag}
                type="button"
                className={`notes-tag${tag?.toLowerCase() === t.tag.toLowerCase() ? ' active' : ''}`}
                data-testid="notes-tag"
                onClick={() =>
                  useNotesUi
                    .getState()
                    .setTag(tag?.toLowerCase() === t.tag.toLowerCase() ? null : t.tag)
                }
              >
                #{t.tag} <span className="notes-tag-count">{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function SearchResults({ hits }: { hits: { note: TextItem; snippet: string | null }[] }) {
  const tag = useNotesUi((s) => s.tag);
  const query = useNotesUi((s) => s.query);
  return (
    <div className="notes-results" data-testid="notes-results">
      <div className="notes-results-head">
        {hits.length === 0
          ? 'No notes match'
          : `${hits.length} ${hits.length === 1 ? 'note' : 'notes'}${tag ? ` tagged #${tag}` : ''}${query.trim() ? ` for “${query.trim()}”` : ''}`}
        {tag && (
          <button
            type="button"
            className="notes-search-clear"
            aria-label="Clear tag filter"
            data-testid="notes-tag-clear"
            onClick={() => useNotesUi.getState().setTag(null)}
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      {hits.map(({ note, snippet }) => (
        <NoteRow key={note.id} note={note} depth={0} snippet={snippet} />
      ))}
    </div>
  );
}

function FolderRow({ node, depth }: { node: FolderNode; depth: number }) {
  const collapsed = useNotesUi((s) => s.collapsed.has(node.path));
  const [over, setOver] = useState(false);
  const count = countNotes(node);
  const rename = async () => {
    const name = await promptText({ title: 'Rename folder', label: 'Name', initial: node.name });
    if (name?.trim()) renameFolder(node.path, name);
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete the folder “${node.name}”?`,
      body:
        count > 0
          ? `Its ${count === 1 ? 'note stays' : `${count} notes stay`} on the board and move up a level.`
          : 'The folder is empty.',
      confirmLabel: 'Delete folder',
    });
    if (ok) deleteFolder(node.path);
  };
  return (
    <div className="notes-folder" role="treeitem" aria-expanded={!collapsed}>
      <div
        className={`notes-row notes-folder-row${over ? ' drop' : ''}`}
        style={{ paddingLeft: 11 + depth * 14 }}
        data-testid="notes-folder"
        onClick={() => useNotesUi.getState().toggleFolder(node.path)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const id = e.dataTransfer.getData(DRAG_TYPE);
          if (id) {
            e.preventDefault();
            moveNoteToFolder(id, node.path);
          }
        }}
      >
        <span className="notes-row-chevron">
          {collapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
        </span>
        {collapsed ? <FolderIcon size={14} /> : <FolderOpenIcon size={14} />}
        <span className="notes-row-label">{node.name}</span>
        <span className="notes-row-count">{count}</span>
        <span className="notes-row-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="view-icon-btn small"
            title="Rename folder"
            aria-label="Rename folder"
            data-testid="notes-folder-rename"
            onClick={() => void rename()}
          >
            <RenameIcon size={12} />
          </button>
          <button
            type="button"
            className="view-icon-btn small"
            title="Delete folder"
            aria-label="Delete folder"
            data-testid="notes-folder-delete"
            onClick={() => void remove()}
          >
            <TrashIcon size={12} />
          </button>
        </span>
      </div>
      {!collapsed && (
        <div className="notes-folder-children" role="group">
          {node.children.map((f) => (
            <FolderRow key={f.path} node={f} depth={depth + 1} />
          ))}
          {node.notes.map((n) => (
            <NoteRow key={n.id} note={n} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function countNotes(node: FolderNode): number {
  return node.notes.length + node.children.reduce((n, c) => n + countNotes(c), 0);
}

function NoteRow({
  note,
  depth,
  snippet,
}: {
  note: TextItem;
  depth: number;
  snippet?: string | null;
}) {
  const active = useNotesUi(useShallow((s) => activeNoteId(s) === note.id));
  const open = useNotesUi((s) => noteIsOpen(s, note.id));
  // A phone shows one pane: picking a note shows the note.
  const mobile = useMobileViewport();
  const pick = (newTab: boolean) => {
    useNotesUi.getState().openNote(note.id, { newTab });
    if (mobile) {
      useNotesUi.getState().setLeft(false);
      useNotesUi.getState().setRight(false);
    }
  };
  // The row's menu: open here or in a split, rename, duplicate, delete.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const entries = (): MenuEntry[] => {
    const ui = useNotesUi.getState();
    return [
      { kind: 'action', label: 'Open', onSelect: () => pick(false) },
      { kind: 'action', label: 'Open in a new tab', onSelect: () => pick(true) },
      ...(mobile
        ? []
        : [
            {
              kind: 'action' as const,
              label: 'Open to the right',
              onSelect: () => ui.splitPane('right', { noteId: note.id }),
            },
            {
              kind: 'action' as const,
              label: 'Open below',
              onSelect: () => ui.splitPane('below', { noteId: note.id }),
            },
          ]),
      {
        kind: 'action',
        label: 'Open in a new window',
        onSelect: () => openNoteWindow(note.id),
      },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Color',
        children: [
          ...NOTE_COLORS.map((c) => ({
            kind: 'action' as const,
            label: NOTE_COLOR_LABEL[c],
            icon: <span className={`notes-tone-dot tone-${c}`} aria-hidden />,
            checked: note.noteColor === c,
            onSelect: () => setNoteColor(note.id, c),
          })),
          { kind: 'separator' as const },
          {
            kind: 'action' as const,
            label: 'None',
            checked: !note.noteColor,
            onSelect: () => setNoteColor(note.id, null),
          },
        ],
      },
      {
        kind: 'action',
        label: 'Copy link',
        onSelect: () => void copyNoteText(`${location.origin}${notePath(note.id)}`, 'Link copied.'),
      },
      {
        kind: 'action',
        label: 'Copy path',
        onSelect: () => void copyNoteText(notePathText(note), 'Path copied.'),
      },
      { kind: 'separator' },
      {
        kind: 'action',
        label: note.hidden ? 'Show on Canvas' : 'Hide from Canvas',
        icon: note.hidden ? <EyeIcon /> : <EyeOffIcon />,
        onSelect: () => setNoteOnCanvas(note.id, !!note.hidden),
      },
      {
        kind: 'action',
        label: 'Rename',
        onSelect: () =>
          void promptText({
            title: 'Rename note',
            label: 'Title',
            initial: noteTitle(note),
            confirmLabel: 'Rename',
          }).then((name) => {
            if (name?.trim()) renameNote(note.id, name);
          }),
      },
      {
        kind: 'action',
        label: 'Duplicate',
        onSelect: () => {
          const copy = duplicateNote(note.id);
          if (copy) ui.openNote(copy, { newTab: true });
        },
      },
      { kind: 'separator' },
      {
        kind: 'action',
        label: 'Delete',
        danger: true,
        onSelect: () =>
          void confirmDialog({
            title: `Delete “${noteTitle(note)}”?`,
            body: 'The text box leaves the board. Undo brings it back.',
            confirmLabel: 'Delete note',
          }).then((ok) => {
            if (ok) deleteNote(note.id);
          }),
      },
    ];
  };
  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-selected={active}
        className={`notes-row notes-note-row${active ? ' active' : open ? ' open' : ''}${
          note.noteColor ? ` tone-${note.noteColor}` : ''
        }`}
        style={{ paddingLeft: 11 + depth * 14 }}
        data-testid="notes-note"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, note.id);
          // Moved to a folder, or linked when dropped into a note's editor.
          e.dataTransfer.effectAllowed = 'linkMove';
        }}
        onClick={(e) => pick(e.metaKey || e.ctrlKey)}
        onDoubleClick={() => pick(true)}
        onAuxClick={(e) => {
          if (e.button === 1) pick(true);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <StickyNoteIcon size={14} />
        <span className="notes-row-text">
          <span className="notes-row-label">{noteTitle(note)}</span>
          {snippet && <span className="notes-row-snippet">{snippet}</span>}
        </span>
        {note.hidden && (
          <span className="notes-row-off" title="Not on the canvas" data-testid="notes-row-off">
            <EyeOffIcon size={12} />
          </span>
        )}
      </button>
      {menu && (
        <DM.Root open onOpenChange={(open) => !open && setMenu(null)}>
          <DM.Trigger asChild>
            <span
              style={{ position: 'fixed', left: menu.x, top: menu.y, width: 0, height: 0 }}
              aria-hidden
            />
          </DM.Trigger>
          <DM.Portal>
            <DM.Content
              className="menu-panel menu-list context-menu"
              data-testid="notes-note-menu"
              align="start"
              side="bottom"
              sideOffset={2}
              collisionPadding={8}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <RadixEntries entries={entries()} />
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      )}
    </>
  );
}

/** Put text on the clipboard and say so (the clipboard needs a user gesture, which the menu is). */
async function copyNoteText(text: string, said: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showNotice(said, { kind: 'info', timeoutMs: 2500 });
  } catch {
    showNotice('The clipboard could not be written.', { kind: 'warn' });
  }
}
