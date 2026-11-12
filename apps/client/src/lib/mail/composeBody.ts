import { marked } from 'marked';
import { sanitizeEmailHtml } from './sanitizeEmailHtml';

/**
 * The bodies a composed message can be written in, and the moves between
 * them: plain text becomes simple HTML (quoted lines as a blockquote),
 * Markdown renders through marked, and whatever HTML goes out is
 * sanitised the same way received mail is.
 */

export type ComposeFormat = 'html' | 'markdown' | 'plain';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text as HTML: paragraphs on blank lines, `> ` runs as a blockquote. */
export function plainToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(escape).join('<br>')}</p>`);
    para = [];
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${plainToHtml(quote.join('\n'))}</blockquote>`);
    quote = [];
  };
  for (const line of lines) {
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      quote.push(q[1]!);
    } else {
      flushQuote();
      if (line.trim() === '') flushPara();
      else para.push(line);
    }
  }
  flushPara();
  flushQuote();
  return out.join('\n');
}

/** Markdown as sanitised HTML for a message body. */
export function markdownToHtml(source: string): string {
  return sanitizeEmailHtml(marked.parse(source, { async: false }) as string);
}

/** A formatting move the compose toolbar offers. */
export type ComposeTool =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'heading'
  | 'quote'
  | 'bullets'
  | 'numbers'
  | 'code'
  | 'link';

/** The Markdown source with the tool applied to the selection. */
export function applyMarkdownTool(
  source: string,
  start: number,
  end: number,
  tool: ComposeTool,
  url?: string,
): { value: string; start: number; end: number } {
  const sel = source.slice(start, end);
  const wrap = (open: string, close = open) => ({
    value: source.slice(0, start) + open + sel + close + source.slice(end),
    start: start + open.length,
    end: end + open.length,
  });
  const prefixLines = (prefix: (i: number) => string) => {
    const from = source.lastIndexOf('\n', start - 1) + 1;
    const toEnd = source.indexOf('\n', end);
    const to = toEnd === -1 ? source.length : toEnd;
    const block = source
      .slice(from, to)
      .split('\n')
      .map((l, i) => prefix(i) + l)
      .join('\n');
    return {
      value: source.slice(0, from) + block + source.slice(to),
      start: from,
      end: from + block.length,
    };
  };
  switch (tool) {
    case 'bold':
      return wrap('**');
    case 'italic':
      return wrap('_');
    case 'strike':
      return wrap('~~');
    case 'code':
      return sel.includes('\n') ? wrap('```\n', '\n```') : wrap('`');
    case 'heading':
      return prefixLines(() => '## ');
    case 'quote':
      return prefixLines(() => '> ');
    case 'bullets':
      return prefixLines(() => '- ');
    case 'numbers':
      return prefixLines((i) => `${i + 1}. `);
    case 'link': {
      const text = sel || url || '';
      const open = '[';
      const close = `](${url ?? ''})`;
      return {
        value: source.slice(0, start) + open + text + close + source.slice(end),
        start: start + open.length,
        end: start + open.length + text.length,
      };
    }
  }
}
