/**
 * Simple markdown for short, people-written text: publication descriptions,
 * profile bios, comments. Rendered the same on the client and on the
 * server's public pages.
 *
 * Safe by construction rather than by sanitising: every character of the
 * input is HTML-escaped first, and the only markup that can appear in the
 * output comes from the fixed templates below. Links are the one place a
 * value reaches an attribute, and only http(s) URLs get through. There is
 * no raw HTML, no images, no headings: the subset is
 *
 *   **bold**  *italic*  _italic_  ~~struck~~  `code`
 *   [text](https://url)  bare https://urls
 *   - bullets / 1. numbered lists  > quotes  blank line = new paragraph
 */

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML-escape text (what every string reaches the output through). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;
/** A URL is tested on its escaped form: an entity that stands for a quote
 *  or an angle bracket means the source held one, and such a URL is refused
 *  outright rather than trusted to stay inside its attribute. */
const safeUrl = (escaped: string): boolean =>
  !/&(?:quot|#39|lt|gt);/.test(escaped) && SAFE_URL.test(escaped.replace(/&amp;/g, '&'));

/** Inline spans on an already-escaped line. */
function inline(escaped: string): string {
  let s = escaped;
  // Code first: nothing inside a code span is styled. Spans are parked
  // behind private-use placeholders while the rest is marked up.
  const codes: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\uE000${codes.length - 1}\uE001`;
  });
  // [text](url) — the url was escaped too; unescape only what a URL may hold.
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    if (!safeUrl(url)) return m;
    return `<a href="${url}" target="_blank" rel="noreferrer noopener">${text}</a>`;
  });
  // Bare URLs (not already inside an href or link text).
  s = s.replace(
    /(^|[\s(])((?:https?:\/\/)[^\s<>"']+?)([.,;:!?)]*)(?=$|[\s<])/g,
    (m, pre: string, url: string, tail: string) => {
      if (!safeUrl(url)) return m;
      return `${pre}<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>${tail}`;
    },
  );
  s = s.replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/~~(\S(?:[^~\n]*\S)?)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[^*\w])\*(\S(?:[^*\n]*\S)?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(\S(?:[^_\n]*\S)?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => codes[Number(i)] ?? '');
  return s;
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'quote'; lines: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim() === '') {
      flush();
      continue;
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (ul) {
      if (cur?.kind !== 'ul') {
        flush();
        cur = { kind: 'ul', items: [] };
      }
      cur.items.push(ul[1]!);
    } else if (ol) {
      if (cur?.kind !== 'ol') {
        flush();
        cur = { kind: 'ol', items: [] };
      }
      cur.items.push(ol[1]!);
    } else if (quote) {
      if (cur?.kind !== 'quote') {
        flush();
        cur = { kind: 'quote', lines: [] };
      }
      cur.lines.push(quote[1]!);
    } else if (cur?.kind === 'p') {
      cur.lines.push(line);
    } else {
      flush();
      cur = { kind: 'p', lines: [line] };
    }
  }
  flush();
  return out;
}

const LIMIT = 20_000;

/** Render simple markdown to HTML. The output holds only p, br, strong, em,
 *  del, code, a (http(s) only), ul, ol, li and blockquote. */
export function renderSimpleMarkdown(text: string): string {
  const src = (text ?? '').slice(0, LIMIT);
  return blocks(src)
    .map((b) => {
      switch (b.kind) {
        case 'p':
          return `<p>${b.lines.map((l) => inline(escapeHtml(l))).join('<br>')}</p>`;
        case 'quote':
          return `<blockquote><p>${b.lines.map((l) => inline(escapeHtml(l))).join('<br>')}</p></blockquote>`;
        case 'ul':
        case 'ol':
          return `<${b.kind}>${b.items.map((i) => `<li>${inline(escapeHtml(i))}</li>`).join('')}</${b.kind}>`;
      }
    })
    .join('');
}

/** The plain text of simple markdown: markers dropped, one paragraph per
 *  line. For previews, titles and meta descriptions. */
export function stripSimpleMarkdown(text: string): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1$2')
    .replace(/^\s*(?:[-*•]|\d+[.)]|>)\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
