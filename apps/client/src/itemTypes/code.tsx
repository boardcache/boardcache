import type { CodeItem } from '@boardcache/schema';
import { useHighlightedHtml, CodeContent } from '../components/items/CodeContent';
import { defineItemType } from './registry';
import type { StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

/** Mini highlighted code card (same theme vars as the canvas). */
function CodeCard({ item }: { item: CodeItem }) {
  const html = useHighlightedHtml(item.code.slice(0, 1200), item.language);
  return (
    <pre className="gallery-code" data-testid="gallery-code-thumb">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

function Stage({ item }: StageProps<CodeItem>) {
  return (
    <div className="lightbox-code" onClick={(e) => e.stopPropagation()}>
      <CodeContent item={item} lightbox />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: CodeItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  // Dark card with line bars — reads as "code" at thumbnail scale.
  ctx.fillStyle = '#282c34';
  ctx.fillRect(x, y, item.width, item.height);
  const pad = Math.min(item.width, item.height) * 0.08;
  const lineH = Math.max(3, item.height * 0.05);
  const gap = lineH * 1.6;
  const colors = ['#c678dd', '#98c379', '#61afef', '#abb2bf', '#d19a66'];
  let ly = y + pad + lineH;
  let i = 0;
  while (ly + lineH < y + item.height - pad) {
    const w = item.width * (0.35 + ((i * 37) % 45) / 100);
    ctx.fillStyle = colors[i % colors.length]!;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(
      x + pad + (i % 3 === 2 ? item.width * 0.08 : 0),
      ly,
      Math.min(w, item.width - pad * 2),
      lineH,
    );
    ctx.globalAlpha = 1;
    ly += gap;
    i += 1;
  }
}

/** What the board search index sees. */
function searchText(item: CodeItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title, body: join(item.language, item.code, baseText(item)) };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
async function popout(item: CodeItem, _p: PopoutContext): Promise<string> {
  const { highlightCode } = await import('../lib/text/codeHighlight');
  const body =
    (item.language ? highlightCode(item.code, item.language) : null) ?? escapeHtml(item.code);
  // Resolve the live theme variables so the popup matches the canvas.
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb;
  const tokenCss =
    `.codepop{white-space:pre-wrap;overflow-wrap:break-word;margin:0;padding:18px 22px;min-height:100vh;box-sizing:border-box;` +
    `background:${v('--code-bg', '#f6f8fa')};color:${v('--code-fg', '#1f2328')};` +
    `font:13px/1.55 ${v('--code-font', 'ui-monospace, Menlo, Consolas, monospace')};tab-size:2}` +
    `.token.comment{color:${v('--code-comment', '#6e7781')};font-style:italic}` +
    `.token.punctuation,.token.operator{color:${v('--code-punct', '#57606a')}}` +
    `.token.keyword,.token.atrule,.token.important{color:${v('--code-keyword', '#cf222e')}}` +
    `.token.string,.token.char,.token.attr-value,.token.template-string,.token.url{color:${v('--code-string', '#0a3069')}}` +
    `.token.number,.token.boolean,.token.constant,.token.symbol{color:${v('--code-number', '#0550ae')}}` +
    `.token.function,.token.selector,.token.attr-name,.token.property{color:${v('--code-function', '#8250df')}}` +
    `.token.class-name,.token.tag,.token.builtin,.token.namespace{color:${v('--code-type', '#953800')}}` +
    `.token.variable,.token.regex,.token.deleted{color:${v('--code-variable', '#0550ae')}}`;
  return `<style>${tokenCss}</style><pre class="codepop">${body}</pre>`;
}

export const codeType = defineItemType('code', {
  popout,
  edit: { kind: 'inline' },
  pdfCategory: 'code',
  meta: null,
  label: 'Code',
  searchText,
  thumbnail: paint,
  render: CodeContent,
  card: CodeCard,
  stage: Stage,
  cardAspect: null,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
