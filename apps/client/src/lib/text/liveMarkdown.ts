import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder as placeholderExt,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';
import { codeHighlightStyle } from './codeEditor';
import { codeLanguageFor } from './codeLanguages';
import { splitEmbed, type EmbedAlign } from './embedParams';
import { frontmatterSpan, leadingHeading } from './frontmatter';
import type { LinkKind } from './linkTitles';
import { filterTitles } from './mdComplete';
import { continueList, filterSlash, type EditAction, type EditState } from './mdFormat';
import { tableNextCell } from './mdTable';
import {
  commitTableFields,
  enterTableFrom,
  focusTableCellAt,
  tableCellState,
  tableFold,
  tableSpans,
} from './liveTable';
import { NOTE_DRAG_TYPE } from './wikilinks';

/**
 * The live Markdown editor (CodeMirror 6), lazily imported like the code
 * editor. The source stays the truth; a view plugin styles it in place and
 * hides the markup on every line the selection is not on, so a note reads
 * as a page while it is written: headings large, emphasis emphasised,
 * links and [[links]] clickable, tasks as checkboxes, code highlighted.
 * Source mode is the same editor with the plugin off.
 */

// --- [[wikilinks]] and ![[embeds]] in the parse tree ------------------------
// `[[Title]]`, `[[Title|label]]` and `![[Title]]`, as lib/text/markdown
// renders them.
const BANG = 33;
const LBRACK = 91;
const RBRACK = 93;
const NEWLINE = 10;

const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: t.link },
    { name: 'Embed', style: t.link },
    { name: 'WikiLinkMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Link',
      parse(cx, next, pos) {
        const embed = next === BANG;
        const open = embed ? pos + 1 : pos;
        if (cx.char(open) !== LBRACK || cx.char(open + 1) !== LBRACK) return -1;
        let i = open + 2;
        for (; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === RBRACK) {
            if (cx.char(i + 1) === RBRACK) break;
            return -1;
          }
          if (ch === LBRACK || ch === NEWLINE) return -1;
        }
        if (i >= cx.end || i === open + 2) return -1;
        const end = i + 2;
        return cx.addElement(
          cx.elt(embed ? 'Embed' : 'WikiLink', pos, end, [
            cx.elt('WikiLinkMark', pos, open + 2),
            cx.elt('WikiLinkMark', end - 2, end),
          ]),
        );
      },
    },
  ],
};

// --- widgets ----------------------------------------------------------------

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  override eq(other: TaskWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos;
  }
  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span');
    box.className = `cm-live-task${this.checked ? ' done' : ''}`;
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.setAttribute('data-testid', 'live-task');
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({
        changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' },
      });
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** An embed's host: the EmbedPortals component fills it with the item. */
class EmbedWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly size: string | null,
    readonly align: EmbedAlign | null,
  ) {
    super();
  }
  override eq(other: EmbedWidget): boolean {
    return other.title === this.title && other.size === this.size && other.align === this.align;
  }
  override toDOM(): HTMLElement {
    const host = document.createElement('span');
    host.className = 'md-embed cm-live-embed';
    host.dataset.embed = this.title;
    if (this.size) host.dataset.size = this.size;
    if (this.align) host.dataset.align = this.align;
    return host;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const dot = document.createElement('span');
    dot.className = 'cm-live-bullet';
    dot.textContent = '•';
    return dot;
  }
}

class RuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const hr = document.createElement('span');
    hr.className = 'cm-live-hr';
    return hr;
  }
}

// --- the live decorations ---------------------------------------------------

/** Whether the properties block (frontmatter) is folded out of sight. */
const setHideFrontmatter = StateEffect.define<boolean>();
const hideFrontmatter = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setHideFrontmatter)) return e.value;
    return value;
  },
});
/** Whether the note's opening `# Heading` is folded (the title bar shows it). */
const setHideHeading = StateEffect.define<boolean>();
const hideHeading = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setHideHeading)) return e.value;
    return value;
  },
});

class EmptyWidget extends WidgetType {
  constructor(private readonly cls = 'cm-live-frontmatter-hidden') {
    super();
  }
  override eq(other: EmptyWidget): boolean {
    return other.cls === this.cls;
  }
  override toDOM() {
    const el = document.createElement('div');
    el.className = this.cls;
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

/** The span of the properties block at the top of the document, if any. */
function frontmatterOf(doc: EditorState['doc']): { lines: number; end: number } | null {
  if (doc.sliceString(0, 3) !== '---') return null;
  const fm = frontmatterSpan(doc.toString());
  return fm ? { lines: fm.lines, end: doc.line(fm.lines).to } : null;
}

/** Whether the selection touches the lines from `from` to `to`. */
function selectionTouches(state: EditorState, from: number, to: number): boolean {
  const a = state.doc.lineAt(from).number;
  const b = state.doc.lineAt(Math.max(from, to)).number;
  return state.selection.ranges.some((r) => {
    const ra = state.doc.lineAt(r.from).number;
    const rb = state.doc.lineAt(r.to).number;
    return rb >= a && ra <= b;
  });
}

/** The properties block folded away: a block replacement, which only a
 *  state field may provide (a view plugin's decorations stay in-line). It
 *  unfolds while the caret is in it, and when the live view is off. */
const frontmatterFold = StateField.define<DecorationSet>({
  create: (state) => foldDecorations(state),
  update: (value, tr) =>
    tr.docChanged ||
    tr.selection ||
    tr.effects.some((e) => e.is(setHideFrontmatter) || e.is(setHideHeading))
      ? foldDecorations(tr.state)
      : value,
  provide: (f) => EditorView.decorations.from(f),
});

function foldDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const fm = state.field(hideFrontmatter, false) ? frontmatterOf(state.doc) : null;
  if (fm && !selectionTouches(state, 0, fm.end)) {
    decos.push(Decoration.replace({ widget: new EmptyWidget(), block: true }).range(0, fm.end));
  }
  if (state.field(hideHeading, false)) {
    const h = leadingHeading(state.doc.toString());
    if (h && !selectionTouches(state, h.from, h.to)) {
      decos.push(
        Decoration.replace({
          widget: new EmptyWidget('cm-live-heading-hidden'),
          block: true,
        }).range(h.from, h.to),
      );
    }
  }
  return decos.length ? Decoration.set(decos, true) : Decoration.none;
}

/** Whether the properties block is folded right now. */
function frontmatterFolded(state: EditorState): boolean {
  if (!state.field(hideFrontmatter, false)) return false;
  const fm = frontmatterOf(state.doc);
  return !!fm && !selectionTouches(state, 0, fm.end);
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const decos: Range<Decoration>[] = [];

  // The lines the selection touches keep their markup.
  const active = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) active.add(n);
  }
  const onActive = (from: number, to: number): boolean => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(Math.max(from, to)).number;
    for (let n = a; n <= b; n++) if (active.has(n)) return true;
    return false;
  };
  const hide = (from: number, to: number) => {
    if (from < to && !onActive(from, to)) decos.push(Decoration.replace({}).range(from, to));
  };
  const mark = (from: number, to: number, cls: string, attributes?: Record<string, string>) => {
    if (from < to)
      decos.push(
        Decoration.mark(attributes ? { class: cls, attributes } : { class: cls }).range(from, to),
      );
  };
  const lines = (from: number, to: number, cls: string) => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(Math.max(from, to)).number;
    for (let n = a; n <= b; n++)
      decos.push(Decoration.line({ class: cls }).range(doc.line(n).from));
  };

  // Properties at the top (frontmatter) show as they are, one dim block;
  // nothing inside it is read as markup.
  const fm = frontmatterOf(doc);
  const fmEnd = fm ? fm.end : 0;
  // Folded away by the inspector's toggle (the fold is a state field's);
  // otherwise one dim run of lines.
  if (fm && !frontmatterFolded(state)) lines(0, fmEnd, 'cm-live-frontmatter');

  // Tables are whole widgets (liveTable.ts): nothing in them is markup here.
  const tables = tableSpans(state);
  const inTable = (from: number, to: number) => tables.some((t) => from >= t.from && to <= t.to);
  for (const range of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        const name = node.name;
        if (fm && name !== 'Document' && node.from < fmEnd) return false;
        if (name !== 'Document' && inTable(node.from, node.to)) return false;
        if (/^ATXHeading[1-6]$/.test(name)) {
          lines(node.from, node.from, `cm-live-h${name.slice(-1)}`);
          return;
        }
        if (name === 'SetextHeading1' || name === 'SetextHeading2') {
          lines(node.from, node.from, `cm-live-h${name.slice(-1)}`);
          return;
        }
        switch (name) {
          case 'HeaderMark': {
            const parent = node.node.parent?.name ?? '';
            if (parent.startsWith('Setext')) {
              // The ===/--- underline: the whole line goes.
              hide(node.from, node.to);
            } else {
              const line = doc.lineAt(node.from);
              hide(node.from, Math.min(node.to + 1, line.to));
            }
            return;
          }
          case 'Emphasis':
            mark(node.from, node.to, 'cm-live-em');
            return;
          case 'StrongEmphasis':
            mark(node.from, node.to, 'cm-live-strong');
            return;
          case 'Strikethrough':
            mark(node.from, node.to, 'cm-live-strike');
            return;
          case 'EmphasisMark':
          case 'StrikethroughMark':
            hide(node.from, node.to);
            return;
          case 'InlineCode':
            mark(node.from, node.to, 'cm-live-icode');
            return;
          case 'CodeMark': {
            const parent = node.node.parent?.name;
            if (parent === 'InlineCode') hide(node.from, node.to);
            else mark(node.from, node.to, 'cm-live-fence');
            return;
          }
          case 'CodeInfo':
            mark(node.from, node.to, 'cm-live-fence');
            return;
          case 'FencedCode':
          case 'CodeBlock':
            lines(node.from, node.to, 'cm-live-code');
            return;
          case 'Blockquote':
            lines(node.from, node.to, 'cm-live-quote');
            return;
          case 'QuoteMark': {
            const line = doc.lineAt(node.from);
            hide(node.from, Math.min(node.to + 1, line.to));
            return;
          }
          case 'ListMark': {
            const list = node.node.parent?.parent?.name;
            if (list === 'BulletList' && !onActive(node.from, node.to)) {
              // A task's box stands for the whole item: its dash is hidden
              // along with the space after it; a plain item gets a dot.
              const task = node.node.nextSibling?.name === 'Task';
              decos.push(
                task
                  ? Decoration.replace({}).range(node.from, node.node.nextSibling!.from)
                  : Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to),
              );
            }
            return;
          }
          case 'Task': {
            const checked = /\[[xX]\]/.test(doc.sliceString(node.from, node.to));
            lines(node.from, node.from, checked ? 'cm-live-done' : 'cm-live-todo');
            return;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(doc.sliceString(node.from, node.to));
            if (!onActive(node.from, node.to)) {
              decos.push(
                Decoration.replace({ widget: new TaskWidget(checked, node.from) }).range(
                  node.from,
                  node.to,
                ),
              );
            }
            return;
          }
          case 'Link':
          case 'Image': {
            const marks = node.node.getChildren('LinkMark');
            const url = node.node.getChild('URL');
            const href = url ? doc.sliceString(url.from, url.to) : '';
            mark(
              node.from,
              node.to,
              name === 'Image' ? 'cm-live-image' : 'cm-live-link',
              href ? { 'data-url': href } : undefined,
            );
            if (marks.length >= 2) {
              hide(marks[0]!.from, marks[0]!.to);
              hide(marks[1]!.from, node.to);
            }
            return;
          }
          case 'WikiLink': {
            const inner = doc.sliceString(node.from + 2, node.to - 2);
            const bar = inner.indexOf('|');
            const title = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
            mark(node.from, node.to, 'cm-live-wikilink', { 'data-note': title });
            if (bar >= 0) hide(node.from + 2, node.from + 2 + bar + 1);
            return;
          }
          case 'Embed': {
            if (onActive(node.from, node.to)) {
              mark(node.from, node.to, 'cm-live-wikilink');
              return;
            }
            const { title, params } = splitEmbed(doc.sliceString(node.from + 3, node.to - 2));
            decos.push(
              Decoration.replace({
                widget: new EmbedWidget(title, params.size, params.align),
              }).range(node.from, node.to),
            );
            return;
          }
          case 'WikiLinkMark':
            hide(node.from, node.to);
            return;
          case 'HorizontalRule':
            if (!onActive(node.from, node.to)) {
              decos.push(
                Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to),
              );
            }
            return;
          default:
            return;
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

const livePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        update.startState.field(hideFrontmatter, false) !==
          update.state.field(hideFrontmatter, false) ||
        update.startState.field(hideHeading, false) !== update.state.field(hideHeading, false)
      )
        this.decorations = buildDecorations(update.view);
    }
  },
  { decorations: (p) => p.decorations },
);

// --- edits through the shared EditAction vocabulary ------------------------

function editState(view: EditorView): EditState {
  const sel = view.state.selection.main;
  return { value: view.state.doc.toString(), selStart: sel.from, selEnd: sel.to };
}

/** Apply a whole-text edit as the smallest change that produces it. */
function applyEdit(view: EditorView, next: EditState): void {
  const old = view.state.doc.toString();
  if (old !== next.value) {
    let p = 0;
    const max = Math.min(old.length, next.value.length);
    while (p < max && old.charCodeAt(p) === next.value.charCodeAt(p)) p++;
    let s = 0;
    while (
      s < max - p &&
      old.charCodeAt(old.length - 1 - s) === next.value.charCodeAt(next.value.length - 1 - s)
    )
      s++;
    view.dispatch({
      changes: { from: p, to: old.length - s, insert: next.value.slice(p, next.value.length - s) },
      selection: { anchor: next.selStart, head: next.selEnd },
      scrollIntoView: true,
    });
    // An edit that leaves an open `[[` or `![[` at the caret (the toolbar's
    // Link to note, the slash menu's Embed item) offers the titles at once.
    if (/!?\[\[$/.test(next.value.slice(0, next.selStart))) startCompletion(view);
  } else {
    view.dispatch({ selection: { anchor: next.selStart, head: next.selEnd } });
  }
  view.focus();
}

// --- completions: `/` commands and `[[` titles ------------------------------

function slashSource(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/(?:^|\s)\/[^\s/]*$/);
  if (!m) return null;
  const slashAt = m.text.startsWith('/') ? m.from : m.from + 1;
  const query = context.state.sliceDoc(slashAt + 1, context.pos);
  const commands = filterSlash(query);
  if (!commands.length) return null;
  return {
    from: slashAt,
    filter: false,
    // Typing on re-ranks the list in place, synchronously: the menu never
    // goes dead between keystrokes, so an Enter right after a letter still
    // accepts instead of breaking the line.
    update: (_current, _from, _to, ctx) => slashSource(ctx),
    options: commands.map((cmd) => ({
      label: cmd.label,
      detail: cmd.hint,
      apply: (view, _completion, from, to) => {
        const value = view.state.doc.toString();
        const cleaned = value.slice(0, from) + value.slice(to);
        applyEdit(view, cmd.run({ value: cleaned, selStart: from, selEnd: from }));
      },
    })),
  };
}

function wikiSource(titles: (kind: LinkKind) => string[]) {
  const source = (context: CompletionContext): CompletionResult | null => {
    const m = context.matchBefore(/!?\[\[[^[\]\n]*$/);
    if (!m) return null;
    const embed = m.text.startsWith('!');
    const from = m.from + (embed ? 3 : 2);
    const names = filterTitles(
      titles(embed ? 'media' : 'note'),
      context.state.sliceDoc(from, context.pos),
    );
    if (!names.length) return null;
    return {
      from,
      filter: false,
      update: (_current, _from, _to, ctx) => source(ctx),
      options: names.map((title) => ({
        label: title,
        type: embed ? 'embed' : 'note',
        apply: (view, _completion, at, to) => {
          const closed = view.state.sliceDoc(to, to + 2) === ']]';
          const insert = closed ? title : `${title}]]`;
          view.dispatch({
            changes: { from: at, to, insert },
            selection: { anchor: at + insert.length + (closed ? 2 : 0) },
          });
        },
      })),
    };
  };
  return source;
}

// --- the editor -------------------------------------------------------------

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'inherit', fontSize: 'inherit' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
  '.cm-content': { padding: '0', fontFamily: 'inherit', caretColor: 'currentColor' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'currentColor' },
});

export interface LiveEditorOptions {
  doc: string;
  /** Styled in place (true) or plain source (false). */
  live: boolean;
  /** The properties block (frontmatter) folded away while live. */
  hideFrontmatter?: boolean | undefined;
  /** The opening `# Heading` folded away while live (a title bar shows it). */
  hideHeading?: boolean | undefined;
  placeholder?: string | undefined;
  onChange: (value: string) => void;
  onEscape?: (() => void) | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  /** A `[[link]]` clicked while rendered. */
  onWikiLink?: ((title: string, newTab: boolean) => void) | undefined;
  /** A link clicked while rendered. */
  onLink?: ((url: string) => void) | undefined;
  /** The titles `[[` (notes) and `![[` (media) complete to. */
  linkTitles?: ((kind: LinkKind) => string[]) | undefined;
  /** A note dragged in from the Notes list: its title, to link to it
   *  where it was dropped (null leaves the drop alone). */
  dropNoteTitle?: ((noteId: string) => string | null) | undefined;
  /** A small picture for an `![[` completion's title (null = none). */
  completionThumb?: ((title: string) => Node | null) | undefined;
}

export interface LiveEditorHandle {
  view: EditorView;
  getValue: () => string;
  /** Replace the text when it differs (an outside change). */
  setValue: (value: string) => void;
  setLive: (live: boolean) => void;
  setHideFrontmatter: (hide: boolean) => void;
  setHideHeading: (hide: boolean) => void;
  /** Run a toolbar/slash edit on the current selection. */
  apply: (action: EditAction) => void;
  /** The text and selection as they are. */
  state: () => EditState;
  /** Put the caret at the start of a (0-based) line and show it. */
  goToLine: (line: number) => void;
  focus: () => void;
  destroy: () => void;
}

export function createLiveEditor(
  parent: HTMLElement,
  options: LiveEditorOptions,
): LiveEditorHandle {
  const liveComp = new Compartment();
  const foldComp = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        history(),
        markdown({
          base: markdownLanguage,
          codeLanguages: (info) => codeLanguageFor(info),
          extensions: [WikiLink],
        }),
        syntaxHighlighting(codeHighlightStyle),
        liveComp.of(options.live ? livePlugin : []),
        hideFrontmatter.init(() => !!options.hideFrontmatter),
        hideHeading.init(() => !!options.hideHeading),
        foldComp.of(options.live ? [frontmatterFold, tableFold] : []),
        theme,
        EditorView.lineWrapping,
        options.placeholder ? placeholderExt(options.placeholder) : [],
        autocompletion({
          // One source for both menus: while any source is still being asked,
          // CodeMirror holds the open menu disabled and Enter breaks the line
          // instead of accepting, so the two must never be asked separately.
          override: [
            (ctx) =>
              wikiSource((kind) => options.linkTitles?.(kind) ?? [])(ctx) ?? slashSource(ctx),
          ],
          icons: false,
          addToOptions: [
            {
              render: (c) =>
                c.type === 'embed' ? (options.completionThumb?.(c.label) ?? null) : null,
              position: 20,
            },
          ],
          activateOnTyping: true,
          activateOnTypingDelay: 0,
          // Enter accepts as soon as the menu shows, as the textarea's menus
          // do (the default refuses Enter for 75 ms after opening).
          interactionDelay: 0,
        }),
        keymap.of([
          {
            key: 'Escape',
            run: () => {
              options.onEscape?.();
              return true;
            },
          },
          {
            key: 'Enter',
            run: (v) => {
              const next = continueList(editState(v));
              if (!next) return false;
              applyEdit(v, next);
              return true;
            },
          },
          {
            key: 'ArrowDown',
            run: (v) => enterTableFrom(v, true),
          },
          {
            key: 'ArrowUp',
            run: (v) => enterTableFrom(v, false),
          },
          {
            // Inside a table, Tab walks the cells (a new row after the last).
            key: 'Tab',
            run: (v) => {
              const next = tableNextCell(editState(v), false);
              if (!next) return false;
              applyEdit(v, next);
              return true;
            },
            shift: (v) => {
              const next = tableNextCell(editState(v), true);
              if (!next) return false;
              applyEdit(v, next);
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.domEventHandlers({
          keydown: (e) => {
            e.stopPropagation(); // never reach the app's shortcuts
            return false;
          },
          focus: () => {
            options.onFocus?.();
            return false;
          },
          blur: () => {
            options.onBlur?.();
            return false;
          },
          dragover: (e) => {
            if (!options.dropNoteTitle || !e.dataTransfer?.types.includes(NOTE_DRAG_TYPE))
              return false;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'link';
            return true;
          },
          drop: (e, v) => {
            const id = e.dataTransfer?.getData(NOTE_DRAG_TYPE);
            const title = id ? options.dropNoteTitle?.(id) : null;
            if (!title) return false;
            e.preventDefault();
            const at = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
            const insert = `[[${title}]]`;
            v.dispatch({
              changes: { from: at, insert },
              selection: { anchor: at + insert.length },
            });
            v.focus();
            return true;
          },
          mousedown: (e, v) => {
            // A rendered link follows on click; on the selection's line the
            // markup shows and the click places the caret instead.
            const target = (e.target as HTMLElement).closest?.('.cm-live-wikilink, .cm-live-link');
            if (!target || e.button !== 0) return false;
            const pos = v.posAtDOM(target);
            const line = v.state.doc.lineAt(pos).number;
            const onSelection = v.state.selection.ranges.some(
              (r) =>
                v.state.doc.lineAt(r.from).number <= line &&
                line <= v.state.doc.lineAt(r.to).number,
            );
            if (onSelection && v.hasFocus) return false;
            if (target.classList.contains('cm-live-wikilink')) {
              options.onWikiLink?.(target.getAttribute('data-note') ?? '', e.ctrlKey || e.metaKey);
            } else {
              const url = target.getAttribute('data-url');
              if (url) options.onLink?.(url);
            }
            e.preventDefault();
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (value) => {
      const current = view.state.doc.toString();
      if (value === current) return;
      const head = Math.min(view.state.selection.main.head, value.length);
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: head },
      });
    },
    setLive: (live) => {
      view.dispatch({
        effects: [
          liveComp.reconfigure(live ? livePlugin : []),
          foldComp.reconfigure(live ? [frontmatterFold, tableFold] : []),
        ],
      });
    },
    setHideFrontmatter: (hide) => {
      if (view.state.field(hideFrontmatter) !== hide)
        view.dispatch({ effects: setHideFrontmatter.of(hide) });
    },
    setHideHeading: (hide) => {
      if (view.state.field(hideHeading) !== hide)
        view.dispatch({ effects: setHideHeading.of(hide) });
    },
    apply: (action) => {
      // From a table cell the edit applies there, and lands back in a cell.
      commitTableFields(view);
      const next = action(tableCellState(view) ?? editState(view));
      applyEdit(view, next);
      focusTableCellAt(view, next.selStart);
    },
    state: () => tableCellState(view) ?? editState(view),
    goToLine: (line) => {
      const n = Math.max(1, Math.min(view.state.doc.lines, line + 1));
      const at = view.state.doc.line(n).from;
      view.dispatch({
        selection: { anchor: at },
        effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 40 }),
      });
      view.focus();
    },
    focus: () => {
      view.focus();
      const end = view.state.doc.length;
      if (view.state.selection.main.empty && view.state.selection.main.head === 0)
        view.dispatch({ selection: { anchor: end } });
    },
    destroy: () => view.destroy(),
  };
}
