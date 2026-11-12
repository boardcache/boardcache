import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { codeLanguageExtension } from './codeLanguages';

/**
 * CodeMirror 6 editor for code items — lazily imported (this chunk carries
 * CodeMirror and its grammars). Colors come from the Code Snippets theme
 * variables with GitHub-Light fallbacks, so the editor matches the static
 * view with or without the plugin enabled. Languages: codeLanguages.ts.
 */

// The same palette slots as the static view's token classes (see
// src/styles/23-code.css), with GitHub-Light fallbacks so a bare install
// still reads as code.
export const codeHighlightStyle = HighlightStyle.define([
  {
    tag: [t.comment, t.blockComment, t.lineComment],
    color: 'var(--code-comment, #6e7781)',
    fontStyle: 'italic',
  },
  {
    tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword],
    color: 'var(--code-keyword, #cf222e)',
  },
  {
    tag: [t.string, t.special(t.string), t.character, t.docString],
    color: 'var(--code-string, #0a3069)',
  },
  {
    tag: [t.number, t.integer, t.float, t.bool, t.atom, t.null],
    color: 'var(--code-number, #0550ae)',
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.attributeName],
    color: 'var(--code-function, #8250df)',
  },
  {
    tag: [t.typeName, t.className, t.tagName, t.namespace, t.standard(t.variableName)],
    color: 'var(--code-type, #953800)',
  },
  {
    tag: [t.variableName, t.propertyName, t.regexp, t.self],
    color: 'var(--code-variable, #0550ae)',
  },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--code-punct, #57606a)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--code-comment, #6e7781)' },
]);

const varTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--code-bg, #f6f8fa)',
    color: 'var(--code-fg, #1f2328)',
    fontSize: 'inherit',
    height: '100%',
  },
  '.cm-content': {
    fontFamily: 'var(--code-font, ui-monospace, Menlo, Consolas, monospace)',
    caretColor: 'var(--code-fg, #1f2328)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--code-comment, #6e7781)',
    border: 'none',
    fontFamily: 'var(--code-font, ui-monospace, Menlo, Consolas, monospace)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, currentColor 5%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--code-fg, #1f2328)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--code-fg, #1f2328) 18%, transparent) !important',
  },
});

export interface CodeEditorHandle {
  view: EditorView;
  getValue: () => string;
  destroy: () => void;
}

export function createCodeEditor(
  parent: HTMLElement,
  options: {
    doc: string;
    language: string;
    onChange?: (value: string) => void;
    onBlur?: () => void;
    onEscape?: () => void;
  },
): CodeEditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        indentOnInput(),
        codeLanguageExtension(options.language, options.doc),
        syntaxHighlighting(codeHighlightStyle),
        varTheme,
        EditorView.lineWrapping,
        keymap.of([
          {
            key: 'Escape',
            run: () => {
              options.onEscape?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange?.(update.state.doc.toString());
          if (options.onBlur && update.focusChanged && !update.view.hasFocus) options.onBlur();
        }),
      ],
    }),
  });
  return {
    view,
    getValue: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
  };
}
