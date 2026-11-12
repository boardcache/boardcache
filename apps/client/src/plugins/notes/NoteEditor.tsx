import { useEffect, useRef, useState } from 'react';
import type { TextItem } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import { MinusIcon, PlusIcon, MatchWidthIcon, TextSizeIcon } from '../../components/icons';
import { useNarrowPortrait, usePhoneViewport } from '../../hooks/useMobileViewport';
import {
  LiveMarkdownEditor,
  type LiveMarkdownEditorRef,
} from '../../components/panels/LiveMarkdownEditor';
import { MarkdownToolbar } from '../../components/panels/MarkdownToolbar';
import { UiSelect } from '../../components/ui/Select';
import { boardFontFamilies } from '../../lib/media/fontRegistry';
import { TEXT_FONTS } from '../../lib/text/textOptions';
import { collabNotifyDraft } from '../../lib/sync/collab';
import { EmbedPortals } from '../../components/panels/MarkdownEmbeds';
import { openUrl } from '../../lib/text/itemUrl';
import { findMediaByTitle, linkTitlesFor } from '../../lib/text/linkTitles';
import { acquireAssetUrl, releaseAssetUrl } from '../../lib/board/assetStore';
import { createRoot, type Root } from 'react-dom/client';
import { kindIcon, thumbAssetOf } from '../../components/panels/ItemThumb';
import { itemType } from '../../itemTypes';
import {
  measureMarkdownHeight,
  renderMarkdown,
  taskIndexFromTarget,
  toggleTaskAt,
  useHighlightTick,
} from '../../lib/text/markdown';
import { wikiLinkTarget } from '../../lib/text/noteNavigation';
import { findNoteByTitle, noteTitle, wordCount } from '../../lib/text/wikilinks';
import { useCollabStore } from '../../state/collabStore';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { leadingHeading } from '../../lib/text/frontmatter';
import { createNote, flushNote, onNoteFlush, renameNote } from './notesModel';
import { PAGE_WIDTH_MAX, PAGE_WIDTH_MIN, TEXT_SCALES, useNotesUi, type NotesMode } from './store';
import { shownNotesMode } from './NoteModeSwitch';

/** Typing rests this long before the note is saved to the board. */
const SAVE_MS = 500;

/** The font Source mode falls back to: the editor's own monospace. */
const SOURCE_DEFAULT = { value: '', label: 'Mono (default)' };

/**
 * One note on the stage: its title, the Edit / Source / Preview / Split
 * switch, the live Markdown editor (the page as it is written; Source shows
 * the plain text) and the rendered page. Edits save to the board a moment
 * after typing stops (and when the note leaves the stage), so the sidebar,
 * the outline and other tabs follow along. A `[[link]]` in the page opens
 * that note here; one that names no note makes it.
 */
export function NoteEditor({ note, focused = true }: { note: TextItem; focused?: boolean }) {
  useHighlightTick();
  const mode = useNotesUi((s) => s.mode);
  const setMode = useNotesUi((s) => s.setMode);
  const [draft, setDraft] = useState(note.text);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const previewRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LiveMarkdownEditorRef>(null);
  // A new note's title line takes the focus; the editor waits for Enter.
  const titleFocus = useNotesUi((s) => s.titleFocusId === note.id);

  // A peer typing in this note (team boards) shows in the page while our
  // own draft is untouched; their commit replaces it on the same terms.
  const remoteDraft = useCollabStore((s) => s.remoteDrafts[note.id]?.text);
  const [seenText, setSeenText] = useState(note.text);
  if (note.text !== seenText) {
    const untouched = draft === seenText;
    setSeenText(note.text);
    if (untouched) setDraft(note.text);
  }

  const flush = () => {
    const text = draftRef.current;
    collabNotifyDraft(note.id, null);
    const current = useDocumentStore.getState().doc.items[note.id];
    if (!current || current.type !== 'text' || text === current.text) return;
    const measured = measureMarkdownHeight(
      text || ' ',
      current.width,
      current.fontSize,
      current.fontFamily,
    );
    const height = current.autoHeight ? Math.max(current.height, measured) : current.height;
    updateItems([note.id], 'Edit note', (d) => {
      if (d.type !== 'text') return;
      d.text = text;
      d.height = height;
    });
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  // Save a moment after typing stops, and when the note leaves the stage.
  const timer = useRef<number | null>(null);
  const change = (v: string) => {
    setDraft(v);
    collabNotifyDraft(note.id, v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), SAVE_MS);
  };
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      flushRef.current();
    },
    [],
  );
  // Something else about to change the note's text (the inspector's
  // properties, a tool) asks for the draft to be saved first.
  useEffect(() => onNoteFlush(note.id, () => flushRef.current()), [note.id]);

  const changeMode = (m: NotesMode) => {
    flush();
    setMode(m);
  };
  const changeModeRef = useRef(changeMode);
  useEffect(() => {
    changeModeRef.current = changeMode;
  });

  // Ctrl/Cmd+E switches between writing and reading, wherever the focus is
  // (the focused pane's editor answers; the others follow the shared mode).
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key !== 'e' && e.key !== 'E') return;
      e.preventDefault();
      const current = useNotesUi.getState().mode;
      changeModeRef.current(current === 'preview' ? 'edit' : 'preview');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focused]);

  // The outline asked for a heading: scroll the page to it, or put the
  // caret on its line.
  const jump = useNotesUi((s) => s.jump);
  useEffect(() => {
    if (!jump || !focused) return;
    // A heading by its index, or (below zero) a task by its.
    const page = previewRef.current;
    const target =
      jump.index >= 0
        ? page?.querySelectorAll('h1, h2, h3, h4, h5, h6')[jump.index]
        : page?.querySelectorAll('.task-item')[-1 - jump.index];
    if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (mode !== 'preview') editorRef.current?.goToLine(jump.line);
  }, [jump, mode, focused]);

  /** A `[[link]]` followed, from the page or the editor: open that note,
   *  making it when no note has the title. */
  const followWikiLink = (title: string, newTab: boolean) => {
    const doc = useDocumentStore.getState().doc;
    const target = findNoteByTitle(doc, title);
    const id = target ? target.id : createNote('', title);
    useNotesUi.getState().openNote(id, { newTab });
  };

  /** A small picture beside an `![[` completion: the item's image, its
   *  colour, or nothing. Asset URLs taken here are given back on unmount. */
  const thumbUrls = useRef(new Map<string, string>());
  // The kind's symbol is a React icon: each one mounts in a root of its own
  // in the menu's row. CodeMirror builds the rows afresh on every keystroke,
  // so the roots of one pass are unmounted when the next pass begins (a
  // microtask after the first row of a pass), and all of them on unmount.
  const roots = useRef<{ current: Root[]; previous: Root[]; passOpen: boolean }>({
    current: [],
    previous: [],
    passOpen: false,
  });
  useEffect(
    () => () => {
      for (const assetId of thumbUrls.current.keys()) releaseAssetUrl(assetId);
      thumbUrls.current.clear();
      const r = roots.current;
      for (const root of [...r.previous, ...r.current]) root.unmount();
      r.previous = [];
      r.current = [];
    },
    [],
  );
  const mountIcon = (host: HTMLElement, icon: React.ReactNode) => {
    const r = roots.current;
    if (!r.passOpen) {
      r.passOpen = true;
      const stale = r.previous;
      r.previous = r.current;
      r.current = [];
      queueMicrotask(() => {
        r.passOpen = false;
        for (const root of stale) root.unmount();
      });
    }
    const root = createRoot(host);
    root.render(icon);
    r.current.push(root);
  };
  const completionThumb = (title: string): Node | null => {
    const it = findMediaByTitle(useDocumentStore.getState().doc, title);
    if (!it) return null;
    const box = document.createElement('span');
    box.className = 'cm-embed-thumb';
    const assetId = thumbAssetOf(it);
    if (assetId) {
      const img = document.createElement('img');
      img.alt = '';
      box.append(img);
      const known = thumbUrls.current.get(assetId);
      if (known) img.src = known;
      else
        void acquireAssetUrl(assetId).then((url) => {
          if (!url) return;
          thumbUrls.current.set(assetId, url);
          img.src = url;
        });
      return box;
    }
    const color = itemType(it).cardColor?.(it);
    if (color) box.style.background = color;
    else {
      box.classList.add('cm-embed-thumb-kind');
      mountIcon(box, kindIcon(it));
    }
    return box;
  };

  /** A note dragged in from the list: `[[its title]]` goes where it lands. */
  const dropNoteTitle = (id: string): string | null => {
    const it = useDocumentStore.getState().doc.items[id];
    return it?.type === 'text' ? noteTitle(it as TextItem) : null;
  };

  /** An embedded item opened: the lightbox, with the way back to this note. */
  const openEmbed = (itemId: string) => {
    const session = useSessionStore.getState();
    session.setLightboxReturn(note.id);
    session.setLightbox(itemId);
  };

  const onPageClick = (e: React.MouseEvent) => {
    const title = wikiLinkTarget(e.target);
    if (title) {
      e.preventDefault();
      followWikiLink(title, e.metaKey || e.ctrlKey);
      return;
    }
    const idx = taskIndexFromTarget(e.target);
    if (idx === null) return;
    change(toggleTaskAt(draftRef.current, idx));
  };

  // A phone held upright has no room for two panes: Split is not offered,
  // and a remembered Split shows as Edit until the phone turns.
  const narrow = useNarrowPortrait();
  const phone = usePhoneViewport();
  const [widthOpen, setWidthOpen] = useState(false);
  const shownMode = shownNotesMode(mode, narrow);
  const showEditor = shownMode !== 'preview';
  // Split: the two panes scroll together, by their share of the way down
  // (the sides have different heights, so ratios are the shared coordinate),
  // as the lightbox's split does.
  useEffect(() => {
    if (shownMode !== 'split') return;
    const body = bodyRef.current;
    const src = body?.querySelector<HTMLElement>('.note-editor-source');
    const pv = body?.querySelector<HTMLElement>('.note-editor-page');
    if (!src || !pv) return;
    let lock: 'src' | 'pv' | null = null;
    let unlock = 0;
    const sync = (from: HTMLElement, to: HTMLElement, tag: 'src' | 'pv') => () => {
      if (lock && lock !== tag) return; // the echo of our own write
      lock = tag;
      window.clearTimeout(unlock);
      unlock = window.setTimeout(() => (lock = null), 120);
      const denomFrom = from.scrollHeight - from.clientHeight;
      const denomTo = to.scrollHeight - to.clientHeight;
      if (denomFrom <= 0 || denomTo <= 0) return;
      to.scrollTop = (from.scrollTop / denomFrom) * denomTo;
    };
    const fromSource = sync(src, pv, 'src');
    const fromPage = sync(pv, src, 'pv');
    src.addEventListener('scroll', fromSource, { passive: true });
    pv.addEventListener('scroll', fromPage, { passive: true });
    return () => {
      src.removeEventListener('scroll', fromSource);
      pv.removeEventListener('scroll', fromPage);
      window.clearTimeout(unlock);
    };
  }, [shownMode]);

  const showPreview = shownMode === 'preview' || shownMode === 'split';
  const shown = remoteDraft !== undefined && draft === note.text ? remoteDraft : draft;
  const pageWidth = useNotesUi((s) => s.pageWidth);
  const textScale = useNotesUi((s) => s.textScale);
  const scaleAt = TEXT_SCALES.findIndex((v) => Math.abs(v - textScale) < 1e-6);
  const words = wordCount(draft);
  const chars = draft.length;

  // The note's font is the text box's own (the canvas and the lightbox show
  // it too; a new note takes the default from Settings); Source mode has a
  // font of its own, monospace unless chosen.
  const boardFonts = useDocumentStore(useShallow((s) => boardFontFamilies(s.doc)));
  const sourceFont = useNotesUi((s) => s.sourceFont);
  const showProps = useNotesUi((s) => s.showProps);
  // A note that opens with `# Heading` has its title there: the title field
  // shows it, and the page and the editor leave the line out rather than
  // say it twice. A name of its own that differs keeps the heading in view.
  const heading = leadingHeading(draft);
  const titleInBar = !!heading && (!note.name?.trim() || note.name.trim() === heading.text);
  const fontOptions = [
    ...TEXT_FONTS.map((f) => ({ value: f.value, label: f.label, style: { fontFamily: f.value } })),
    ...boardFonts.map((family) => ({
      value: `'${family}'`,
      label: family,
      group: 'Board fonts',
      style: { fontFamily: `'${family}'` },
    })),
  ];
  const fontSelect =
    shownMode === 'source' ? (
      <UiSelect
        value={sourceFont}
        options={[SOURCE_DEFAULT, ...fontOptions]}
        onChange={(v) => useNotesUi.getState().setSourceFont(v)}
        ariaLabel="Source font"
        testId="note-source-font"
      />
    ) : (
      <UiSelect
        value={note.fontFamily}
        options={
          fontOptions.some((o) => o.value === note.fontFamily)
            ? fontOptions
            : [{ value: note.fontFamily, label: 'Custom' }, ...fontOptions]
        }
        onChange={(v) =>
          updateItems([note.id], 'Font', (d) => {
            if (d.type === 'text') d.fontFamily = v;
          })
        }
        ariaLabel="Note font"
        testId="note-font"
      />
    );

  return (
    <div
      className={`note-editor${showProps ? '' : ' props-hidden'}${titleInBar ? ' title-in-bar' : ''}`}
      data-testid="note-editor"
      style={{
        ['--note-width' as string]: `${pageWidth}%`,
        ['--note-scale' as string]: String(textScale),
        ['--note-font' as string]: note.fontFamily,
        ...(sourceFont ? { ['--source-font' as string]: sourceFont } : {}),
      }}
    >
      <div className="note-editor-head">
        <NoteTitle
          key={note.id}
          note={note}
          heading={titleInBar ? heading.text : null}
          onEnter={() => editorRef.current?.focus()}
        />
      </div>
      {showEditor && <MarkdownToolbar extra={fontSelect} />}
      <div className={`note-editor-body mode-${shownMode}`} ref={bodyRef}>
        {showEditor && (
          <div className="note-editor-source" data-testid="note-editor-source">
            <LiveMarkdownEditor
              ref={editorRef}
              value={draft}
              onChange={change}
              live={shownMode === 'edit'}
              hideFrontmatter={!showProps}
              hideHeading={titleInBar}
              onEscape={() => flush()}
              autoFocus={(shownMode === 'edit' || shownMode === 'source') && !titleFocus}
              placeholder="Write in Markdown. [[Another note]] links to it; press / for commands"
              testId="note-editor-live"
              linkTitles={linkTitlesFor(note.id)}
              onWikiLink={followWikiLink}
              onLink={openUrl}
              onOpenEmbed={openEmbed}
              dropNoteTitle={dropNoteTitle}
              completionThumb={completionThumb}
            />
          </div>
        )}
        {showPreview && (
          <div
            className="note-editor-page"
            data-testid="note-editor-page"
            ref={previewRef}
            onClick={onPageClick}
          >
            <div
              className="md-rendered md-text"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(
                  shown.trim() ? shown : '_Nothing here yet. Edit to write._',
                  {
                    properties: true,
                  },
                ),
              }}
            />
            <EmbedPortals root={previewRef} onOpen={openEmbed} />
          </div>
        )}
      </div>
      <div className="note-status" data-testid="note-status">
        <span data-testid="note-status-counts">
          {words} {words === 1 ? 'word' : 'words'} · {chars}{' '}
          {chars === 1 ? 'character' : 'characters'}
        </span>
        <div className="notes-text-size" role="group" aria-label="Text size">
          <button
            type="button"
            className="view-icon-btn small"
            title="Smaller text"
            aria-label="Smaller text"
            disabled={scaleAt === 0}
            data-testid="notes-text-smaller"
            onClick={() => useNotesUi.getState().stepTextScale(-1)}
          >
            <MinusIcon size={13} />
          </button>
          <span className="notes-text-size-glyph" aria-hidden>
            <TextSizeIcon size={15} />
          </span>
          <button
            type="button"
            className="view-icon-btn small"
            title="Larger text"
            aria-label="Larger text"
            disabled={scaleAt === TEXT_SCALES.length - 1}
            data-testid="notes-text-larger"
            onClick={() => useNotesUi.getState().stepTextScale(1)}
          >
            <PlusIcon size={13} />
          </button>
        </div>
        {phone ? (
          // A phone has no room for the slider in the bar: an icon opens it
          // in a small sheet above.
          <span className="note-width note-width-phone">
            <button
              type="button"
              className={`view-icon-btn small${widthOpen ? ' active' : ''}`}
              title="Page width"
              aria-label="Page width"
              aria-expanded={widthOpen}
              data-testid="note-width-toggle"
              onClick={() => setWidthOpen((v) => !v)}
            >
              <MatchWidthIcon size={13} />
            </button>
            {widthOpen && (
              <label className="note-width-pop" data-testid="note-width-pop">
                <span>Width</span>
                <input
                  type="range"
                  min={PAGE_WIDTH_MIN}
                  max={PAGE_WIDTH_MAX}
                  step={1}
                  value={pageWidth}
                  aria-label="Page width"
                  data-testid="note-width"
                  onChange={(e) => useNotesUi.getState().setPageWidth(Number(e.target.value))}
                />
              </label>
            )}
          </span>
        ) : (
          <label className="note-width">
            <span>Width</span>
            <input
              type="range"
              min={PAGE_WIDTH_MIN}
              max={PAGE_WIDTH_MAX}
              step={1}
              value={pageWidth}
              aria-label="Page width"
              data-testid="note-width"
              onChange={(e) => useNotesUi.getState().setPageWidth(Number(e.target.value))}
            />
          </label>
        )}
      </div>
    </div>
  );
}

/** The note's name: shown as the title, edited in place. A note that opens
 *  with `# Heading` shows that heading here and an edit rewrites the line;
 *  a note without either shows its first line, greyed, until one is typed. */
function NoteTitle({
  note,
  heading,
  onEnter,
}: {
  note: TextItem;
  heading: string | null;
  /** Enter commits the title and hands the focus on (to the text). */
  onEnter: () => void;
}) {
  const [value, setValue] = useState(heading ?? note.name ?? '');
  const input = useRef<HTMLInputElement>(null);
  // A new note opens with its title line focused and selected, so the name
  // is the first thing written; the flag clears once the line is left.
  const wantFocus = useNotesUi((s) => s.titleFocusId === note.id);
  useEffect(() => {
    if (!wantFocus) return;
    input.current?.focus();
    input.current?.select();
  }, [wantFocus]);
  const [seen, setSeen] = useState(heading);
  if (heading !== seen) {
    setSeen(heading);
    if (heading !== null) setValue(heading);
  }
  const commit = () => {
    const next = value.trim();
    if (heading !== null) {
      if (next === heading) return;
      // The heading line carries the title: rewrite it (or, emptied, keep
      // the heading and show it again).
      flushNote(note.id);
      const current = useDocumentStore.getState().doc.items[note.id];
      if (current?.type !== 'text') return;
      const h = leadingHeading(current.text);
      if (!h || !next) {
        setValue(heading);
        return;
      }
      const text = `${current.text.slice(0, h.from)}# ${next}${current.text.slice(h.to)}`;
      updateItems([note.id], 'Rename note', (d) => {
        if (d.type !== 'text') return;
        d.text = text;
        if (d.name?.trim()) d.name = next;
      });
      return;
    }
    if ((note.name ?? '') !== next) renameNote(note.id, value);
  };
  return (
    <input
      ref={input}
      className="note-title"
      data-testid="note-title"
      value={value}
      placeholder={noteTitle(note)}
      aria-label="Note title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        commit();
        if (useNotesUi.getState().titleFocusId === note.id)
          useNotesUi.getState().setTitleFocus(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          onEnter();
        }
      }}
    />
  );
}
