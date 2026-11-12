import { createElement, useMemo, useState } from 'react';
import type { Item, TextItem } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import {
  BoardsIcon,
  ChatIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  InfoIcon,
  ListChecksIcon,
  NetworkIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
} from '../../components/icons';
import { UiTooltip } from '../../components/ui/Tooltip';
import { tasksOf, toggleTaskAt } from '../../lib/text/markdown';
import { usePluginItemSidePanel } from '../registry';
import { confirmDialog } from '../../components/ui/Prompt';
import { LightboxUrlEditor } from '../../components/lightbox/editors';
import { CommentsPanel } from '../../components/panels/CommentsPanel';
import { RelatedPanel } from '../../components/panels/RelatedPanel';
import { ItemThumb } from '../../components/panels/ItemThumb';
import { TagEditor } from '../../components/panels/TagEditor';
import { UiSelect } from '../../components/ui/Select';
import { connectionsFor } from '../../lib/canvas/connections';
import { groupMembers } from '../../lib/canvas/grouping';
import { mediaMeta } from '../../lib/mediaItems';
import {
  parseFrontmatter,
  propertyFromText,
  propertyText,
  withFrontmatter,
  type Properties,
} from '../../lib/text/frontmatter';
import { revealNoteOnCanvas } from '../../lib/text/noteNavigation';
import {
  backlinks,
  noteTitle,
  outgoingLinks,
  outlineOf,
  wordCount,
  type OutlineEntry,
} from '../../lib/text/wikilinks';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import {
  allFolders,
  createNote,
  setNoteOnCanvas,
  deleteNote,
  flushNote,
  moveNoteToFolder,
  noteFolderOf,
  unresolvedLinks,
} from './notesModel';
import { useNotesUi, type InspectorTab } from './store';

const TABS: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'outline', label: 'Document', icon: <FileTextIcon size={16} /> },
  { id: 'related', label: 'Related', icon: <NetworkIcon size={16} /> },
  { id: 'info', label: 'Info', icon: <InfoIcon size={16} /> },
  { id: 'tasks', label: 'Tasks', icon: <ListChecksIcon size={16} /> },
  { id: 'comments', label: 'Comments', icon: <ChatIcon size={16} /> },
  { id: 'assistant', label: 'Assistant', icon: <SparklesIcon size={16} /> },
];

/**
 * The right sidebar for the note on the stage: its outline (the headings,
 * each a jump), its details (folder, link, tags, where it is), its comments,
 * and what it relates to: the notes it links to and is linked from, its
 * connections, and the media grouped with it on the board.
 */
export function NoteInspector({ note }: { note: TextItem }) {
  const tab = useNotesUi((s) => s.inspector);
  const commentCount = useDocumentStore(
    (s) => Object.values(s.doc.comments).filter((c) => c.itemId === note.id).length,
  );
  const assistant = usePluginItemSidePanel();
  return (
    <aside className="notes-side notes-side-right" data-testid="notes-inspector">
      <div className="lsp-tabs notes-inspector-tabs" role="tablist">
        {TABS.map((t) => {
          const count = t.id === 'comments' ? commentCount : 0;
          const label = count ? `${t.label} (${count})` : t.label;
          return (
            <UiTooltip key={t.id} label={label}>
              <button
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-label={label}
                className={tab === t.id ? 'active' : ''}
                data-testid={`notes-inspector-${t.id}`}
                onClick={() => useNotesUi.getState().setInspector(t.id)}
              >
                {t.icon}
                {count > 0 && <span className="notes-inspector-count">{count}</span>}
              </button>
            </UiTooltip>
          );
        })}
      </div>
      <div className="notes-inspector-body">
        {tab === 'outline' ? (
          <DocumentTab note={note} />
        ) : tab === 'tasks' ? (
          <Tasks note={note} />
        ) : tab === 'info' ? (
          <Info note={note} />
        ) : tab === 'comments' ? (
          <CommentsPanel key={note.id} item={note} />
        ) : tab === 'assistant' ? (
          assistant ? (
            createElement(assistant, { itemId: note.id })
          ) : (
            <p className="notes-empty-hint" data-testid="notes-assistant-off">
              Enable the AI Generation plugin (Settings → Plugins) to chat about this note.
            </p>
          )
        ) : (
          <Related note={note} />
        )}
      </div>
    </aside>
  );
}

interface OutlineNode {
  entry: OutlineEntry;
  children: OutlineNode[];
}

/** The flat headings as a tree: a heading holds the deeper ones after it. */
function outlineTree(entries: OutlineEntry[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const entry of entries) {
    const node: OutlineNode = { entry, children: [] };
    while (stack.length && stack[stack.length - 1]!.entry.level >= entry.level) stack.pop();
    (stack.length ? stack[stack.length - 1]!.children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

/** Document: the note's properties (its frontmatter) above its outline. */
function DocumentTab({ note }: { note: TextItem }) {
  const showProps = useNotesUi((s) => s.showProps);
  return (
    <div className="lsp-section notes-document">
      <div className="lsp-field">
        <span className="notes-props-head">
          <span className="lsp-field-label">Properties</span>
          <UiTooltip
            label={showProps ? 'Hide properties in the note' : 'Show properties in the note'}
          >
            <button
              type="button"
              className="view-icon-btn small"
              aria-label={showProps ? 'Hide properties in the note' : 'Show properties in the note'}
              aria-pressed={showProps}
              data-testid="notes-props-toggle"
              onClick={() => useNotesUi.getState().setShowProps(!showProps)}
            >
              {showProps ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
            </button>
          </UiTooltip>
        </span>
        <Properties note={note} />
      </div>
      <div className="lsp-field">
        <span className="lsp-field-label">Outline</span>
        <Outline note={note} />
      </div>
    </div>
  );
}

/** Write the note's properties, saving the editor's draft first so the
 *  draft never writes over them. */
function writeProperties(note: TextItem, props: Properties): void {
  flushNote(note.id);
  const current = useDocumentStore.getState().doc.items[note.id];
  const text = current?.type === 'text' ? current.text : note.text;
  const next = withFrontmatter(text, props);
  if (next === text) return;
  updateItems([note.id], 'Edit properties', (d) => {
    if (d.type === 'text') d.text = next;
  });
}

/** A key no property has yet: `property`, then `property 2`, and so on. */
function freshKey(props: Properties): string {
  if (!('property' in props)) return 'property';
  for (let n = 2; ; n++) if (!(`property ${n}` in props)) return `property ${n}`;
}

/**
 * The properties at the top of the note, as rows of key and value: edit
 * either in place, add one, or take one away. Values keep their kind: a
 * list stays a list (commas between items), a number a number.
 */
function Properties({ note }: { note: TextItem }) {
  const props = useMemo(() => parseFrontmatter(note.text).props, [note.text]);
  const keys = Object.keys(props);
  const rename = (from: string, to: string) => {
    const key = to.trim();
    if (!key || key === from || key in props) return;
    const next: Properties = {};
    for (const k of keys) next[k === from ? key : k] = props[k]!;
    writeProperties(note, next);
  };
  const setValue = (key: string, text: string) => {
    const value = propertyFromText(text, props[key]);
    if (propertyText(value) === propertyText(props[key]!) && typeof value === typeof props[key])
      return;
    writeProperties(note, { ...props, [key]: value });
  };
  const remove = (key: string) => {
    const next = { ...props };
    delete next[key];
    writeProperties(note, next);
  };
  const add = () => writeProperties(note, { ...props, [freshKey(props)]: '' });
  return (
    <div className="notes-props" data-testid="notes-props">
      {keys.map((k) => (
        <div key={k} className="notes-prop" data-testid="notes-prop">
          <PropField
            className="notes-prop-field notes-prop-key"
            testId="notes-prop-key"
            label="Property name"
            value={k}
            onCommit={(v) => rename(k, v)}
          />
          <PropField
            className="notes-prop-field notes-prop-value"
            testId="notes-prop-value"
            label={`${k} value`}
            value={propertyText(props[k]!)}
            placeholder={Array.isArray(props[k]) ? 'a, b, c' : 'Value'}
            onCommit={(v) => setValue(k, v)}
          />
          <button
            type="button"
            className="notes-prop-remove"
            aria-label={`Remove ${k}`}
            title="Remove"
            data-testid="notes-prop-remove"
            onClick={() => remove(k)}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-sm notes-prop-add"
        data-testid="notes-prop-add"
        onClick={add}
      >
        <PlusIcon size={13} /> Add property
      </button>
    </div>
  );
}

/** A property's name or value: edited in place, committed on blur or Enter,
 *  Escape puts the note's own text back. */
function PropField({
  className,
  testId,
  label,
  value,
  placeholder,
  onCommit,
}: {
  className: string;
  testId: string;
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  return (
    <input
      className={className}
      data-testid={testId}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Tasks: every box in the note, ticked here as on the page; the text
 *  puts the cursor on its line. */
function Tasks({ note }: { note: TextItem }) {
  const tasks = useMemo(() => tasksOf(note.text), [note.text]);
  const open = tasks.filter((t) => t.state !== 'x').length;
  if (!tasks.length) {
    return (
      <p className="notes-empty-hint" data-testid="notes-tasks-empty">
        Boxes in the note (- [ ] Something to do) appear here.
      </p>
    );
  }
  const toggle = (index: number) => {
    flushNote(note.id);
    const current = useDocumentStore.getState().doc.items[note.id];
    const text = current?.type === 'text' ? current.text : note.text;
    const next = toggleTaskAt(text, index);
    if (next === text) return;
    updateItems([note.id], 'Toggle task', (d) => {
      if (d.type === 'text') d.text = next;
    });
  };
  return (
    <div className="lsp-section notes-tasks">
      <div className="lsp-field">
        <span className="lsp-field-label" data-testid="notes-tasks-count">
          {open === 0 ? 'All done' : `${open} of ${tasks.length} to do`}
        </span>
        <ul className="notes-task-list" data-testid="notes-task-list">
          {tasks.map((t) => (
            <li
              key={`${t.line}-${t.index}`}
              className="notes-task"
              data-state={t.state === 'x' ? 'done' : t.state === '/' ? 'partial' : 'todo'}
              data-testid="notes-task"
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={t.state === 'x' ? 'true' : t.state === '/' ? 'mixed' : 'false'}
                aria-label={t.text || 'Task'}
                className="task-check notes-task-check"
                data-testid="notes-task-check"
                onClick={() => toggle(t.index)}
              />
              <button
                type="button"
                className="notes-task-text"
                data-testid="notes-task-text"
                onClick={() => useNotesUi.getState().goToTask(t.index, t.line)}
              >
                {t.text || <em>Empty</em>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Outline({ note }: { note: TextItem }) {
  const entries = useMemo(() => outlineOf(note.text), [note.text]);
  const tree = useMemo(() => outlineTree(entries), [entries]);
  // Headings folded shut, by their position among the headings.
  const [folded, setFolded] = useState<Set<number>>(new Set());
  if (!entries.length) {
    return (
      <p className="notes-empty-hint" data-testid="notes-outline-empty">
        Headings in the note (# Title, ## Section) appear here.
      </p>
    );
  }
  const toggle = (index: number) =>
    setFolded((s) => {
      const next = new Set(s);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const rows = (nodes: OutlineNode[], depth: number): React.ReactNode =>
    nodes.map(({ entry, children }) => {
      const shut = folded.has(entry.index);
      return (
        <div key={`${entry.line}-${entry.index}`} className="notes-outline-node">
          <div className="notes-outline-row" style={{ paddingLeft: 4 + depth * 14 }}>
            {children.length > 0 ? (
              <button
                type="button"
                className="notes-outline-caret"
                aria-label={shut ? 'Expand' : 'Collapse'}
                aria-expanded={!shut}
                data-testid="notes-outline-caret"
                onClick={() => toggle(entry.index)}
              >
                {shut ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
              </button>
            ) : (
              <span className="notes-outline-caret" aria-hidden />
            )}
            <button
              type="button"
              className="notes-outline-label"
              data-testid="notes-outline-row"
              onClick={() => useNotesUi.getState().goToHeading(entry.index, entry.line)}
            >
              {entry.text}
            </button>
          </div>
          {!shut && children.length > 0 && rows(children, depth + 1)}
        </div>
      );
    });
  return (
    <div className="notes-outline" data-testid="notes-outline">
      {rows(tree, 0)}
    </div>
  );
}

function Info({ note }: { note: TextItem }) {
  const folders = useDocumentStore(useShallow((s) => allFolders(s.doc)));
  const page = useDocumentStore((s) =>
    note.pageId ? (s.doc.pages.find((p) => p.id === note.pageId)?.name ?? null) : null,
  );
  const words = wordCount(note.text);
  return (
    <div className="lsp-section notes-info">
      <div className="lsp-field">
        <span className="lsp-field-label">Folder</span>
        <UiSelect
          value={noteFolderOf(note)}
          ariaLabel="Folder"
          testId="notes-folder-select"
          options={[
            { value: '', label: 'No folder' },
            ...folders.map((f) => ({ value: f, label: f.split('/').join(' / ') })),
          ]}
          onChange={(v) => moveNoteToFolder(note.id, v)}
        />
      </div>
      <div className="lsp-field">
        <span className="lsp-field-label">Link</span>
        <LightboxUrlEditor key={`url-${note.id}`} item={note} />
      </div>
      <div className="lsp-field">
        <span className="lsp-field-label">Tags</span>
        <TagEditor key={`tags-${note.id}`} itemIds={[note.id]} testId="notes-tag-editor" />
      </div>
      <div className="lsp-field">
        <span className="lsp-field-label">About</span>
        <dl className="notes-stats" data-testid="notes-stats">
          <dt>Words</dt>
          <dd>{words}</dd>
          {note.createdAt && (
            <>
              <dt>Created</dt>
              <dd>{new Date(note.createdAt).toLocaleDateString()}</dd>
            </>
          )}
          {page && (
            <>
              <dt>Page</dt>
              <dd>{page}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="btns">
        <button
          type="button"
          className="btn btn-sm"
          data-testid="notes-show-on-canvas"
          onClick={() => revealNoteOnCanvas(note)}
        >
          <BoardsIcon size={13} /> Find on canvas
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="notes-canvas-toggle"
          aria-pressed={!note.hidden}
          onClick={() => setNoteOnCanvas(note.id, !!note.hidden)}
        >
          {note.hidden ? (
            <>
              <EyeIcon size={13} /> Show on canvas
            </>
          ) : (
            <>
              <EyeOffIcon size={13} /> Hide from canvas
            </>
          )}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="notes-delete"
          onClick={() =>
            void confirmDialog({
              title: `Delete “${noteTitle(note)}”?`,
              body: 'The text box leaves the board. Undo brings it back.',
              confirmLabel: 'Delete note',
            }).then((ok) => {
              if (ok) deleteNote(note.id);
            })
          }
        >
          <TrashIcon size={13} /> Delete
        </button>
      </div>
    </div>
  );
}

function Related({ note }: { note: TextItem }) {
  const doc = useDocumentStore((s) => s.doc);
  const out = useMemo(() => outgoingLinks(doc, note), [doc, note]);
  const back = useMemo(() => backlinks(doc, note.id), [doc, note.id]);
  const missing = useMemo(() => unresolvedLinks(doc, note), [doc, note]);
  // The media the note is tied to: what it is grouped with, and the items
  // its connections reach. Thumbnails; a click opens the lightbox, whose
  // bar leads back to the note.
  const media = useMemo(() => {
    const ids = new Set<string>();
    if (note.groupId) for (const id of groupMembers(doc, note.groupId)) ids.add(id);
    for (const c of connectionsFor(doc, note.id)) {
      const other = c.from.id === note.id ? c.to : c.from;
      if (other.kind === 'item') ids.add(other.id);
      else for (const id of groupMembers(doc, other.id)) ids.add(id);
    }
    ids.delete(note.id);
    return [...ids]
      .map((id) => doc.items[id])
      .filter((it): it is Item => !!it && it.type !== 'text');
  }, [doc, note.groupId, note.id]);
  const open = (id: string, e: React.MouseEvent) =>
    useNotesUi.getState().openNote(id, { newTab: e.metaKey || e.ctrlKey });
  const view = (id: string) => {
    const session = useSessionStore.getState();
    session.setLightboxReturn(note.id);
    session.setLightbox(id);
  };
  return (
    <div className="notes-related">
      <Section title="Media" testId="notes-media">
        {media.length > 0 ? (
          <div className="notes-media-grid">
            {media.map((it) => (
              <button
                key={it.id}
                type="button"
                className="notes-media-thumb"
                title={`${mediaMeta(it).title} · ${mediaMeta(it).typeLabel}`}
                aria-label={mediaMeta(it).title}
                data-testid="notes-media-thumb"
                onClick={() => view(it.id)}
              >
                <ItemThumb item={it} />
              </button>
            ))}
          </div>
        ) : (
          <p className="notes-empty-hint">
            Media grouped with the note, or connected to it, shows here.
          </p>
        )}
      </Section>
      <Section title="Links to" testId="notes-links-out">
        {out.map((n) => (
          <button
            key={n.id}
            type="button"
            className="notes-link-row"
            onClick={(e) => open(n.id, e)}
          >
            {noteTitle(n)}
          </button>
        ))}
        {missing.map((title) => (
          <button
            key={`new-${title}`}
            type="button"
            className="notes-link-row notes-link-missing"
            title="Not on the board yet: make it"
            data-testid="notes-link-missing"
            onClick={(e) => open(createNote('', title), e)}
          >
            {title}
            <span className="notes-link-make">Create</span>
          </button>
        ))}
        {out.length === 0 && missing.length === 0 && (
          <p className="notes-empty-hint">Write [[Another note]] to link one.</p>
        )}
      </Section>
      <Section title="Linked from" testId="notes-links-in">
        {back.map((n) => (
          <button
            key={n.id}
            type="button"
            className="notes-link-row"
            onClick={(e) => open(n.id, e)}
          >
            {noteTitle(n)}
          </button>
        ))}
        {back.length === 0 && <p className="notes-empty-hint">No note links here yet.</p>}
      </Section>
      <div data-testid="notes-connections">
        <RelatedPanel key={note.id} item={note} />
      </div>
    </div>
  );
}

function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="notes-section" data-testid={testId}>
      <div className="lsp-field-label">{title}</div>
      {children}
    </div>
  );
}
