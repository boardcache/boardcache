import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
import { codeLanguageFor } from './codeLanguages';

/**
 * Static code highlighting for code items at rest, Markdown fences and the
 * PDF export: the CodeMirror parser of the language (codeLanguages.ts), so
 * a snippet is coloured the same at rest as while it is edited. Loaded
 * lazily (this chunk carries the grammars) and registered through
 * lib/text/markdown's setCodeHighlighter while the Code Snippets plugin is
 * enabled. The output is `<span class="token …">` markup, the token names
 * src/styles/23-code.css and the PDF export's palette know.
 */

const tokens = tagHighlighter([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'token comment' },
  { tag: [t.meta, t.processingInstruction, t.documentMeta], class: 'token prolog' },
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.modifier,
      t.self,
    ],
    class: 'token keyword',
  },
  { tag: [t.string, t.special(t.string), t.docString, t.character], class: 'token string' },
  { tag: t.attributeValue, class: 'token attr-value' },
  { tag: [t.url, t.link], class: 'token url' },
  { tag: t.regexp, class: 'token regex' },
  { tag: [t.number, t.integer, t.float], class: 'token number' },
  { tag: t.bool, class: 'token boolean' },
  { tag: [t.atom, t.null, t.literal, t.unit], class: 'token constant' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    class: 'token function',
  },
  { tag: t.attributeName, class: 'token attr-name' },
  { tag: t.propertyName, class: 'token property' },
  { tag: [t.typeName, t.className], class: 'token class-name' },
  { tag: t.tagName, class: 'token tag' },
  { tag: [t.standard(t.variableName), t.standard(t.tagName)], class: 'token builtin' },
  { tag: t.namespace, class: 'token namespace' },
  { tag: [t.variableName, t.labelName], class: 'token variable' },
  {
    tag: [t.operator, t.arithmeticOperator, t.logicOperator, t.compareOperator],
    class: 'token operator',
  },
  {
    tag: [t.punctuation, t.bracket, t.separator, t.paren, t.brace, t.squareBracket],
    class: 'token punctuation',
  },
  { tag: t.deleted, class: 'token deleted' },
  { tag: t.heading, class: 'token important' },
]);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Walk the code's syntax tree, calling `styled` for each highlighted span
 *  and `plain` for the text between. False when the language is unknown. */
function walk(
  code: string,
  lang: string,
  plain: (text: string) => void,
  styled: (text: string, classes: string) => void,
): boolean {
  const language = codeLanguageFor(lang, code);
  if (!language) return false;
  const tree = language.parser.parse(code);
  let pos = 0;
  highlightTree(tree, tokens, (from, to, classes) => {
    if (from > pos) plain(code.slice(pos, from));
    styled(code.slice(from, to), classes);
    pos = to;
  });
  if (pos < code.length) plain(code.slice(pos));
  return true;
}

/** The code as HTML with `<span class="token …">` around each token, or
 *  null when the language is not one we carry. */
export function highlightCode(code: string, lang: string): string | null {
  let html = '';
  const ok = walk(
    code,
    lang,
    (text) => {
      html += escapeHtml(text);
    },
    (text, classes) => {
      html += `<span class="${classes}">${escapeHtml(text)}</span>`;
    },
  );
  return ok ? html : null;
}

export interface CodeToken {
  text: string;
  /** The token name (`keyword`, `string`, `class-name`); null for plain text. */
  type: string | null;
}

/** Flat token stream (for consumers that render their own colors — PDF). */
export function tokenizeCode(code: string, lang: string): CodeToken[] {
  const out: CodeToken[] = [];
  const ok = walk(
    code,
    lang,
    (text) => out.push({ text, type: null }),
    (text, classes) => out.push({ text, type: classes.split(' ')[1] ?? null }),
  );
  return ok ? out : [{ text: code, type: null }];
}
