/**
 * Frontmatter: a block of properties at the very top of a note, between two
 * `---` lines, as Obsidian writes it:
 *
 *     ---
 *     property: "Hello"
 *     another: 2
 *     tags:
 *       - one
 *       - two
 *     ---
 *
 * A small subset of YAML is read and written: one `key: value` per line,
 * with strings (bare or quoted), numbers, true/false, null, and lists as
 * `[a, b]` or as `- item` lines beneath the key. Anything the parser does
 * not understand stays a string, so a round trip never loses text.
 */

export type PropertyValue = string | number | boolean | null | string[];
export type Properties = Record<string, PropertyValue>;

export interface Frontmatter {
  /** The properties, in the order written. */
  props: Properties;
  /** The note without its frontmatter. */
  body: string;
  /** Where the body starts in the source (0 when there is no frontmatter). */
  bodyAt: number;
  /** Lines the frontmatter takes, fences included (0 when there is none). */
  lines: number;
}

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

/** The span of the frontmatter at the top of `src`: its line count and the
 *  offset the body starts at, or null when the note has none. */
export function frontmatterSpan(src: string): { lines: number; bodyAt: number } | null {
  if (!OPEN.test(src)) return null;
  const lines = src.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (CLOSE.test(lines[i]!.replace(/\r$/, ''))) {
      const bodyAt = lines.slice(0, i + 1).join('\n').length + 1;
      return { lines: i + 1, bodyAt: Math.min(bodyAt, src.length) };
    }
  }
  return null;
}

function scalar(raw: string): PropertyValue {
  const v = raw.trim();
  if (v === '') return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).replace(/\\"/g, '"');
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => String(scalar(s) ?? '')) : [];
  }
  return v;
}

/** Read the properties and the body of a note. */
export function parseFrontmatter(src: string): Frontmatter {
  const span = frontmatterSpan(src);
  if (!span) return { props: {}, body: src, bodyAt: 0, lines: 0 };
  const props: Properties = {};
  const lines = src.split('\n').slice(1, span.lines - 1);
  let listKey: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && listKey) {
      (props[listKey] as string[]).push(String(scalar(item[1]!) ?? ''));
      continue;
    }
    const m = /^([^\s:#][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.trim();
    const value = m[2] ?? '';
    if (value.trim() === '') {
      props[key] = [];
      listKey = key;
    } else {
      props[key] = scalar(value);
      listKey = null;
    }
  }
  return { props, body: src.slice(span.bodyAt), bodyAt: span.bodyAt, lines: span.lines };
}

function quote(s: string): string {
  const plain =
    s !== '' &&
    !/^[\s"'#[\]{}&*!|>%@`-]/.test(s) &&
    !/:\s|\s#|^\s|\s$|\n/.test(s) &&
    !/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(s);
  return plain ? s : `"${s.replace(/"/g, '\\"')}"`;
}

function serialize(value: PropertyValue): string[] {
  if (Array.isArray(value)) {
    return value.length ? ['', ...value.map((v) => `  - ${quote(v)}`)] : ['[]'];
  }
  if (value === null) return ['null'];
  if (typeof value === 'string') return [quote(value)];
  return [String(value)];
}

/** The note with these properties as its frontmatter (none = no block). */
export function withFrontmatter(src: string, props: Properties): string {
  const { body } = parseFrontmatter(src);
  const keys = Object.keys(props);
  if (!keys.length) return body;
  const lines = keys.flatMap((k) => {
    const [first, ...rest] = serialize(props[k]!);
    return [`${k}:${first ? ` ${first}` : ''}`, ...rest];
  });
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** The body of a note, its frontmatter left out. */
export function bodyOf(src: string): string {
  const span = frontmatterSpan(src);
  return span ? src.slice(span.bodyAt) : src;
}

/** A value as the text an input shows: lists joined by commas. */
export function propertyText(value: PropertyValue): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null) return '';
  return String(value);
}

/** A value typed into an input, kept to the kind it had: a list stays a
 *  list (split on commas), a number or a boolean that no longer reads as
 *  one becomes a string, and anything else is read as YAML would. */
export function propertyFromText(text: string, was: PropertyValue | undefined): PropertyValue {
  if (Array.isArray(was)) {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return scalar(text);
}

/** The heading a note opens with: a `# Title` as the first line of the
 *  body (blank lines before it allowed), with its line and offsets. */
export function leadingHeading(
  src: string,
): { text: string; line: number; from: number; to: number } | null {
  const span = frontmatterSpan(src);
  let at = span ? span.bodyAt : 0;
  let line = span ? span.lines : 0;
  while (at < src.length) {
    const end = src.indexOf('\n', at);
    const stop = end === -1 ? src.length : end;
    const raw = src.slice(at, stop);
    if (raw.trim()) {
      const m = /^#\s+(.+?)\s*#*\s*$/.exec(raw);
      return m ? { text: m[1]!.trim(), line, from: at, to: stop } : null;
    }
    if (end === -1) return null;
    at = end + 1;
    line += 1;
  }
  return null;
}
