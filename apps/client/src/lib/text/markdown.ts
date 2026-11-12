import DOMPurify from 'dompurify';
import { parseEmbedParams } from './embedParams';
import { bodyOf, parseFrontmatter, propertyText } from './frontmatter';
import type { Config as PurifyConfig } from 'dompurify';
import { marked } from 'marked';
import { create } from 'zustand';
import { VIEWER } from '../viewerMode';

// GitHub-flavored markdown, single newline = <br> (matches what people expect
// from a note editor like Obsidian).
marked.use({ gfm: true, breaks: true });

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// `[[Another Note]]` and `[[Another Note|shown as]]`: a link to the note of
// that title (lib/text/wikilinks resolves it). Rendered as an anchor the
// canvas, the lightbox and the Notes view each handle on click; the href
// is only there so the anchor stays an anchor through the sanitizer.
// `![[Picture]]`, `![[Picture|300]]`, `![[Picture|300|center]]`: an item of
// the board embedded at this spot, at a width in px and an alignment when given. The renderer leaves a host the
// EmbedPortals component fills (components/panels/MarkdownEmbeds).
marked.use({
  extensions: [
    {
      name: 'embed',
      level: 'inline',
      start: (src: string) => src.indexOf('![['),
      tokenizer(src: string) {
        const m = /^!\[\[([^[\]|\n]+?)((?:\|[^[\]|\n]*)*)\]\]/.exec(src);
        if (!m) return undefined;
        const title = m[1]!.trim();
        if (!title) return undefined;
        const { size, align } = parseEmbedParams(m[2] ?? '');
        return { type: 'embed', raw: m[0], title, size, align };
      },
      renderer(token) {
        const t = token as unknown as { title: string; size: string | null; align: string | null };
        const size = t.size ? ` data-size="${t.size}"` : '';
        const align = t.align ? ` data-align="${t.align}"` : '';
        return `<span class="md-embed" data-embed="${escapeHtml(t.title)}"${size}${align}></span>`;
      },
    },
    {
      name: 'wikilink',
      level: 'inline',
      start: (src: string) => src.indexOf('[['),
      tokenizer(src: string) {
        const m = /^\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/.exec(src);
        if (!m) return undefined;
        const title = m[1]!.trim();
        if (!title) return undefined;
        return { type: 'wikilink', raw: m[0], title, label: (m[2] ?? m[1]!).trim() || title };
      },
      renderer(token) {
        const t = token as unknown as { title: string; label: string };
        return `<a class="md-wikilink" href="#" data-note="${escapeHtml(t.title)}">${escapeHtml(t.label)}</a>`;
      },
    },
  ],
});

/**
 * marked doesn't sanitize, and although boards are the user's own content,
 * they sync, travel across team boards and community clones, and can be
 * imported — so raw HTML in the source must never run. DOMPurify does the
 * stripping (a hand-written allow-list is exactly the thing that gets
 * bypassed by an entity-encoded tab in a scheme); the profile below is the
 * one we want for notes: no forms, frames, media embeds, inline style, SVG or
 * MathML, and only http(s)/mailto/tel/blob links and sources.
 */
const PURIFY: PurifyConfig = {
  FORBID_TAGS: [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'link',
    'meta',
    'base',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'svg',
    'math',
    'template',
    'noscript',
  ],
  FORBID_ATTR: ['style', 'srcdoc', 'formaction', 'action', 'background', 'poster', 'ping'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|blob:|#|\/)/i,
  ADD_ATTR: ['target'],
};

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ...PURIFY });
}

/** Links open in a new tab and never leak the referrer or an opener. A
 *  note link stays in the app: its click is handled, never followed. */
function harden(root: DocumentFragment): void {
  root.querySelectorAll('a').forEach((a) => {
    if (a.classList.contains('md-wikilink')) return;
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noreferrer noopener');
  });
}

type TaskState = ' ' | 'x' | '/';
const STATE_NAME: Record<TaskState, string> = { ' ': 'todo', x: 'done', '/': 'doing' };

/** The leading task marker of a list item, removing it from the rendered text. */
function extractTaskState(li: Element): TaskState | null {
  // Loose lists wrap the content in a <p>; tight lists don't.
  const box = li.firstElementChild?.tagName === 'P' ? li.firstElementChild! : li;
  // marked turns "[ ]"/"[x]" into a leading <input type="checkbox"> (which the
  // sanitizer would otherwise strip).
  const input = box.querySelector(':scope > input[type="checkbox"]');
  if (input) {
    const checked = input.hasAttribute('checked');
    input.remove();
    return checked ? 'x' : ' ';
  }
  // "[/]" (in-progress) isn't standard GFM, so marked leaves it as literal text.
  const text = box.firstChild;
  if (text && text.nodeType === 3) {
    const value = text.textContent ?? '';
    const m = value.match(/^(\s*)\[\/\]\s?/);
    if (m) {
      text.textContent = value.replace(/^(\s*)\[\/\]\s?/, '$1');
      return '/';
    }
  }
  return null;
}

/** Turn task-list items into clickable, stateful checkboxes (data-task = order). */
function enhanceTaskLists(root: DocumentFragment): void {
  let index = 0;
  root.querySelectorAll('li').forEach((li) => {
    const state = extractTaskState(li);
    if (state === null) return;
    li.classList.add('task-item');
    li.setAttribute('data-state', STATE_NAME[state]);
    const checkbox = document.createElement('span');
    checkbox.className = 'task-check';
    checkbox.setAttribute('data-task', String(index));
    checkbox.setAttribute('role', 'checkbox');
    checkbox.setAttribute(
      'aria-checked',
      state === 'x' ? 'true' : state === '/' ? 'mixed' : 'false',
    );
    li.prepend(checkbox);
    index += 1;
  });
}

// --- pluggable code highlighting ------------------------------------------------
// A plugin (Code Snippets) may register a fence highlighter; the tick store
// lets markdown consumers re-render when it arrives or goes away.

type CodeHighlighter = (code: string, lang: string) => string | null;
let codeHighlighter: CodeHighlighter | null = null;

const highlightTick = create<{ n: number }>(() => ({ n: 0 }));

/** Subscribe to highlighter (de)registration so rendered markdown refreshes. */
export function useHighlightTick(): number {
  return highlightTick((s) => s.n);
}

export function setCodeHighlighter(fn: CodeHighlighter | null): void {
  codeHighlighter = fn;
  highlightTick.setState((s) => ({ n: s.n + 1 }));
}

/** Apply the registered highlighter to fenced code blocks (safe output: the
 *  highlighter only emits <span class="token …"> markup we generate). */
function highlightFences(root: DocumentFragment): void {
  if (!codeHighlighter) return;
  root.querySelectorAll('pre > code[class*="language-"]').forEach((code) => {
    const lang = /language-([\w+-]+)/.exec(code.className)?.[1];
    if (!lang) return;
    const html = codeHighlighter!(code.textContent ?? '', lang);
    if (html !== null) code.innerHTML = html;
  });
}

// --- LaTeX math ($…$ inline, $$…$$ display) via lazy KaTeX -------------------
// Math is extracted from the SOURCE before marked runs (markdown would mangle
// TeX underscores/backslashes), hidden behind private-use placeholders, and
// spliced back into the DOM after sanitize — like highlightFences, the output
// is markup we generate ourselves. KaTeX (~300KB + fonts) loads on first
// sight of math and bumps the highlight tick so mounted boxes re-render.

type Katex = { renderToString: (tex: string, opts: object) => string };
let katex: Katex | null = null;
let katexLoading = false;

function ensureKatex(): void {
  // The offline viewer is a single inlined file — dynamic chunks would break
  // its self-contained property, so it shows raw TeX source instead.
  if (VIEWER || katex || katexLoading) return;
  katexLoading = true;
  void Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
    katex = (m as { default?: Katex }).default ?? (m as unknown as Katex);
    highlightTick.setState((s) => ({ n: s.n + 1 }));
  });
}

interface MathSpan {
  tex: string;
  display: boolean;
}

const PH_OPEN = '';
const PH_CLOSE = '';
const PH_RE = /(\d+)/;

/** Replace math spans with placeholders, skipping code fences and inline
 *  code. Inline math needs non-space right after the opening $ and before the
 *  closing $ (so "$4.99 and $5.99" is never math); \$ escapes a literal $. */
function extractMath(src: string): { text: string; spans: MathSpan[] } {
  const spans: MathSpan[] = [];
  const stash = (tex: string, display: boolean): string => {
    spans.push({ tex, display });
    return `${PH_OPEN}${spans.length - 1}${PH_CLOSE}`;
  };
  const text = src
    .split(/(```[\s\S]*?```|`[^`\n]*`)/) // odd segments = code, untouched
    .map((seg, i) => {
      if (i % 2 === 1) return seg;
      return seg
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => stash(tex.trim(), true))
        .replace(/(^|[^\\$])\$(\S(?:[^$\n]*\S)?)\$(?!\$)/g, (_, pre: string, tex: string) =>
          tex.includes('\\') || /[a-zA-Z^_{}]/.test(tex)
            ? `${pre}${stash(tex, false)}`
            : `${pre}$${tex}$`,
        )
        .replace(/\\\$/g, '$');
    })
    .join('');
  return { text, spans };
}

/** Swap placeholders in text nodes for rendered KaTeX (or raw source while
 *  KaTeX is still loading / in the viewer). */
function injectMath(root: DocumentFragment, spans: MathSpan[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (PH_RE.test(n.textContent ?? '')) targets.push(n as Text);
  }
  for (const node of targets) {
    const frag = document.createDocumentFragment();
    let rest = node.textContent ?? '';
    for (let m = PH_RE.exec(rest); m; m = PH_RE.exec(rest)) {
      frag.append(rest.slice(0, m.index));
      const span = spans[Number(m[1])];
      if (span && katex) {
        const el = document.createElement(span.display ? 'div' : 'span');
        el.className = span.display ? 'md-math md-math-display' : 'md-math';
        el.innerHTML = katex.renderToString(span.tex, {
          throwOnError: false,
          displayMode: span.display,
          output: 'html',
        });
        frag.append(el);
      } else if (span) {
        // KaTeX not here yet — show the raw TeX; the tick re-renders later.
        frag.append(span.display ? `$$${span.tex}$$` : `$${span.tex}$`);
      }
      rest = rest.slice(m.index + m[0].length);
    }
    frag.append(rest);
    node.replaceWith(frag);
  }
}

/** Whether the canvas, the lightbox and their measurements show a note's
 *  properties (Settings → Text); the Notes view asks for them outright. */
let propertiesByDefault = false;
export function setPropertiesByDefault(show: boolean): void {
  if (propertiesByDefault === show) return;
  propertiesByDefault = show;
  // Mounted boxes and the lightbox render again (the tick they follow).
  highlightTick.setState((s) => ({ n: s.n + 1 }));
}

export interface RenderOptions {
  /** Show the properties block (frontmatter) as a table ahead of the page;
   *  left out, the canvas setting decides. */
  properties?: boolean;
}

/** The properties at the top of a note (its frontmatter) as a small table
 *  ahead of the page; nothing when the note has none, or when they are
 *  not wanted (the block is left out either way). */
function renderProperties(src: string, show: boolean): { html: string; body: string } {
  if (!src.startsWith('---')) return { html: '', body: src };
  const { props, body, lines } = parseFrontmatter(src);
  if (!lines) return { html: '', body: src };
  const keys = Object.keys(props);
  if (!keys.length || !show) return { html: '', body };
  const rows = keys
    .map(
      (k) =>
        `<div class="md-prop"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(propertyText(props[k]!))}</dd></div>`,
    )
    .join('');
  return { html: `<dl class="md-props">${rows}</dl>`, body };
}

/** Render markdown source to sanitized HTML for display. */
export function renderMarkdown(source: string, opts: RenderOptions = {}): string {
  const { html: props, body: src } = renderProperties(
    source ?? '',
    opts.properties ?? propertiesByDefault,
  );
  const hasMath = /\$/.test(src);
  const { text, spans } = hasMath ? extractMath(src) : { text: src, spans: [] };
  if (spans.length > 0) ensureKatex();
  // Task-list inputs are turned into our own spans BEFORE purification (which
  // would drop <input>); the result is purified as a string, then re-parsed.
  const staged = document.createElement('template');
  staged.innerHTML = props + (marked.parse(text, { async: false }) as string);
  enhanceTaskLists(staged.content);
  const tpl = document.createElement('template');
  tpl.innerHTML = sanitize(staged.innerHTML);
  harden(tpl.content);
  highlightFences(tpl.content); // after sanitize: our own generated spans only
  if (spans.length > 0) injectMath(tpl.content, spans); // ours too
  return tpl.innerHTML;
}

/** The data-task index of a clicked checkbox, or null if not on one. */
export function taskIndexFromTarget(target: EventTarget | null): number | null {
  const box = target instanceof Element ? target.closest('[data-task]') : null;
  if (!box) return null;
  const n = Number(box.getAttribute('data-task'));
  return Number.isInteger(n) ? n : null;
}

const TASK_LINE = /^(\s*[-*+]\s+)\[([ xX/])\](.*)$/;

/**
 * Cycle the Nth task marker in the source (todo → doing → done → todo). The
 * index matches the data-task order produced by enhanceTaskLists.
 */
/** Every task in the source, in the order the page numbers them. */
export function tasksOf(
  source: string,
): { index: number; line: number; text: string; state: ' ' | '/' | 'x' }[] {
  const out: { index: number; line: number; text: string; state: ' ' | '/' | 'x' }[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(TASK_LINE);
    if (!m) continue;
    const cur = m[2]!.toLowerCase();
    out.push({
      index: out.length,
      line: i,
      text: m[3]!.trim(),
      state: cur === 'x' ? 'x' : cur === '/' ? '/' : ' ',
    });
  }
  return out;
}

export function toggleTaskAt(source: string, index: number): string {
  const lines = source.split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(TASK_LINE);
    if (!m) continue;
    if (n === index) {
      const cur = m[2]!.toLowerCase();
      const next = cur === ' ' ? '/' : cur === '/' ? 'x' : ' ';
      lines[i] = `${m[1]}[${next}]${m[3]}`;
      return lines.join('\n');
    }
    n += 1;
  }
  return source;
}

/**
 * Measure the rendered height of markdown at a given box width, using the live
 * `.md-rendered` CSS so a stored item height matches what the box will show.
 */
export function measureMarkdownHeight(
  src: string,
  width: number,
  fontSize: number,
  fontFamily: string,
): number {
  const probe = document.createElement('div');
  probe.className = 'md-rendered md-text';
  probe.innerHTML = renderMarkdown(src);
  Object.assign(probe.style, {
    position: 'absolute',
    left: '-9999px',
    top: '0',
    visibility: 'hidden',
    boxSizing: 'border-box',
    width: `${width}px`,
    padding: '16px 20px', // mirrors .text-item — keep in sync with src/styles
    fontSize: `${fontSize}px`,
    fontFamily,
  });
  document.body.appendChild(probe);
  const height = Math.max(40, probe.offsetHeight);
  probe.remove();
  return height;
}

/** Flatten markdown to plain-ish text for canvas thumbnails / previews. */
export function markdownToPlainish(src: string): string {
  return bodyOf(src)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/```[^\n]*\n?/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1');
}
