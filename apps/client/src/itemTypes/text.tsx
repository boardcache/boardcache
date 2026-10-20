import type { TextItem } from '@boardcache/schema';
import { readableTextColor } from '../lib/color/color';
import { renderMarkdown, markdownToPlainish } from '../lib/text/markdown';
import { resolveTheme, useSessionStore } from '../state/sessionStore';
import { defineItemType } from './registry';
import { LightboxText } from '../components/lightbox/LightboxText';
import { TextContent } from '../components/items/TextContent';
import type { PaintContext } from '../lib/media/paint';
import { drawMarkdownText } from '../lib/export/exportText';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import type { MetaOverride } from './registry';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

/** The rendered markdown on the box background (white/black per theme when unset). */
function TextCard({ item }: { item: TextItem }) {
  const dark = resolveTheme(useSessionStore((s) => s.theme)) === 'dark';
  const bg =
    item.background === 'auto'
      ? 'var(--new-text-bg, var(--panel-solid))'
      : (item.background ?? (dark ? '#16181d' : '#ffffff'));
  const fg =
    item.color !== 'default'
      ? item.color
      : item.background === 'auto' || !item.background
        ? 'var(--new-text-ink, var(--text-primary))'
        : readableTextColor(item.background);
  return (
    <div
      className="gallery-text md-rendered"
      style={{ background: bg, color: fg, fontFamily: item.fontFamily, textAlign: item.align }}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text || 'Text') }}
    />
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: TextItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  drawMarkdownText(ctx, item, x, y);
}

/** What the board search index sees. */
function searchText(item: TextItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title, body: join(item.text, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: TextItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  // Title from the first line of the content, with markdown syntax stripped.
  out.title =
    item.name ?? (markdownToPlainish(item.text).trim().split('\n')[0]?.slice(0, 60) || 'Text');
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: TextItem, _p: PopoutContext): string {
  const color = item.color === 'default' ? '#ececec' : item.color;
  const bg = item.background ?? '#1b1b1f';
  const body = item.text.trim() ? renderMarkdown(item.text) : 'Empty text';
  return `<div class="text md-rendered" style="color:${escapeHtml(color)};background:${escapeHtml(bg)};text-align:${item.align};font-family:${escapeHtml(item.fontFamily)}">${body}</div>`;
}

export const textType = defineItemType('text', {
  popout,
  edit: { kind: 'inline' },
  pdfCategory: 'text',
  meta,
  label: 'Text',
  searchText,
  thumbnail: paint,
  render: TextContent,
  card: TextCard,
  stage: LightboxText,
  // Tall text boxes would produce absurdly tall previews: cap the ratio.
  cardAspect: (item) => Math.min(item.height / Math.max(1, item.width), 1.6),
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
