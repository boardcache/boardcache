/**
 * Pure markdown editing transforms. Each takes the textarea's current value +
 * selection and returns the next value + selection, so they're trivially
 * testable and shared by every editor (canvas inline + lightbox).
 */
export interface EditState {
  value: string;
  selStart: number;
  selEnd: number;
}

export type EditAction = (s: EditState) => EditState;

/** A list marker at the start of a line: `- `, `* `, `+ `, `1. `, `2) `, with
 *  an optional `[ ]`/`[x]` task box. */
const LIST_LINE = /^(\s*)(?:([-*+])|(\d+)([.)]))[ \t]+(\[[ xX]\][ \t]+)?(.*)$/;

/**
 * Continue (or exit) a markdown list when Enter is pressed inside one. Returns
 * the next state, or null to fall back to a plain newline. On an empty list
 * item the marker is cleared instead (breaking out of the list).
 */
export function continueList(s: EditState): EditState | null {
  const { value, selStart, selEnd } = s;
  if (selStart !== selEnd) return null; // only for a collapsed caret

  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
  const nextNl = value.indexOf('\n', selStart);
  const lineEnd = nextNl === -1 ? value.length : nextNl;
  const line = value.slice(lineStart, lineEnd);

  const m = LIST_LINE.exec(line);
  if (!m) return null;
  const [, indent, bullet, num, delim, task, content] = m;

  // Empty item → break out of the list (clear the marker, keep the line).
  if (!content) {
    return {
      value: value.slice(0, lineStart) + value.slice(lineEnd),
      selStart: lineStart,
      selEnd: lineStart,
    };
  }

  // Otherwise start a fresh item of the same kind on a new line.
  const marker = bullet ?? `${Number(num) + 1}${delim}`;
  const prefix = `${indent}${marker} ${task ? '[ ] ' : ''}`;
  const insert = `\n${prefix}`;
  const caret = selStart + insert.length;
  return {
    value: value.slice(0, selStart) + insert + value.slice(selStart),
    selStart: caret,
    selEnd: caret,
  };
}

function wrapInline(marker: string): EditAction {
  return ({ value, selStart, selEnd }) => {
    const before = value.slice(0, selStart);
    const sel = value.slice(selStart, selEnd);
    const after = value.slice(selEnd);
    const m = marker.length;
    // Toggle off when the selection is already wrapped.
    if (sel.length >= m * 2 && sel.startsWith(marker) && sel.endsWith(marker)) {
      const inner = sel.slice(m, sel.length - m);
      return { value: before + inner + after, selStart, selEnd: selStart + inner.length };
    }
    const wrapped = marker + sel + marker;
    if (!sel) {
      const caret = selStart + m;
      return { value: before + wrapped + after, selStart: caret, selEnd: caret };
    }
    return { value: before + wrapped + after, selStart, selEnd: selStart + wrapped.length };
  };
}

/** Run `fn` on every line touched by the selection, keeping it selected. */
function eachLine(s: EditState, fn: (line: string, index: number) => string): EditState {
  const { value, selStart, selEnd } = s;
  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
  let lineEnd = value.indexOf('\n', selEnd);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const newBlock = block.split('\n').map(fn).join('\n');
  const end = lineStart + newBlock.length;
  // A bare caret (no selection, e.g. from the "/" menu) collapses to the line
  // end so the next keystroke appends; a real selection stays highlighted.
  const collapsed = selStart === selEnd;
  return {
    value: value.slice(0, lineStart) + newBlock + value.slice(lineEnd),
    selStart: collapsed ? end : lineStart,
    selEnd: end,
  };
}

export const bold: EditAction = wrapInline('**');
export const italic: EditAction = wrapInline('_');
export const strikethrough: EditAction = wrapInline('~~');
export const inlineCode: EditAction = wrapInline('`');

export function heading(level: number): EditAction {
  const prefix = '#'.repeat(level) + ' ';
  return (s) =>
    eachLine(s, (line) => {
      const stripped = line.replace(/^#{1,6}\s+/, '');
      return line.startsWith(prefix) ? stripped : prefix + stripped;
    });
}

export const bulletList: EditAction = (s) =>
  eachLine(s, (line) =>
    /^[-*+]\s+/.test(line) ? line.replace(/^[-*+]\s+/, '') : '- ' + line.replace(/^#{1,6}\s+/, ''),
  );

/** Task checkbox line: toggles "- [ ] " on/off (checked state preserved off). */
export const taskList: EditAction = (s) =>
  eachLine(s, (line) =>
    /^[-*+]\s+\[[ xX]\]\s+/.test(line)
      ? line.replace(/^[-*+]\s+\[[ xX]\]\s+/, '')
      : '- [ ] ' + line.replace(/^[-*+]\s+/, '').replace(/^#{1,6}\s+/, ''),
  );

export const numberedList: EditAction = (s) =>
  eachLine(s, (line, i) =>
    /^\d+\.\s+/.test(line) ? line.replace(/^\d+\.\s+/, '') : `${i + 1}. ` + line,
  );

export const quote: EditAction = (s) =>
  eachLine(s, (line) => (line.startsWith('> ') ? line.slice(2) : '> ' + line));

export const link: EditAction = ({ value, selStart, selEnd }) => {
  const before = value.slice(0, selStart);
  const text = value.slice(selStart, selEnd) || 'text';
  const after = value.slice(selEnd);
  const md = `[${text}](url)`;
  // Select the "url" placeholder so the user can type the destination.
  const urlStart = before.length + text.length + 3;
  return { value: before + md + after, selStart: urlStart, selEnd: urlStart + 3 };
};

export const codeBlock: EditAction = ({ value, selStart, selEnd }) => {
  const before = value.slice(0, selStart);
  const body = value.slice(selStart, selEnd);
  const after = value.slice(selEnd);
  const md = '```\n' + body + '\n```';
  const caret = before.length + 4; // after "```\n"
  return { value: before + md + after, selStart: caret, selEnd: caret + body.length };
};

export interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  run: EditAction;
}

/** Obsidian-style "/" menu options. */
const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'h1', label: 'Heading 1', hint: '#', run: heading(1) },
  { id: 'h2', label: 'Heading 2', hint: '##', run: heading(2) },
  { id: 'h3', label: 'Heading 3', hint: '###', run: heading(3) },
  { id: 'bullet', label: 'Bullet list', hint: '- ', run: bulletList },
  { id: 'checkbox', label: 'Checkbox', hint: '- [ ]', run: taskList },
  { id: 'number', label: 'Numbered list', hint: '1.', run: numberedList },
  { id: 'quote', label: 'Quote', hint: '>', run: quote },
  { id: 'code', label: 'Code block', hint: '```', run: codeBlock },
  { id: 'bold', label: 'Bold', hint: '**', run: bold },
  { id: 'italic', label: 'Italic', hint: '_', run: italic },
  { id: 'strike', label: 'Strikethrough', hint: '~~', run: strikethrough },
  { id: 'link', label: 'Link', hint: '[](…)', run: link },
];

/** Detect an open "/" command at the caret: at line start or after whitespace. */
export function detectSlash(value: string, caret: number): { query: string; start: number } | null {
  const upto = value.slice(0, caret);
  const m = upto.match(/(?:^|\s)\/([^\s/]*)$/);
  if (!m) return null;
  return { query: m[1] ?? '', start: caret - (m[1]?.length ?? 0) - 1 };
}

export function filterSlash(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.id.includes(q));
}
