import type { TitleItem } from '@boardcache/schema';
import {
  TITLE_LINE_HEIGHT,
  titleFontSize,
  titleLines,
  titlePadding,
  titleFont,
} from '../lib/text/titleFit';
import { defineItemType } from './registry';
import { useRef } from 'react';
import { updateItems } from '../state/commands';
import { TitleContent } from '../components/items/TitleContent';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import type { MetaOverride } from './registry';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

const PAPER = 'var(--new-text-bg, var(--panel-solid))';

/**
 * Title preview: an SVG sized by the item's own box, so the fitted text and
 * its styling scale down to the thumb exactly as they render on the canvas.
 */
function TitleCard({ item }: { item: TitleItem }) {
  const fs = titleFontSize(item, item.width, item.height);
  const lines = titleLines(item);
  const pad = titlePadding(item.width, item.height);
  const lineH = fs * TITLE_LINE_HEIGHT;
  const blockH = lines.length * lineH;
  const startY =
    item.alignV === 'top'
      ? pad
      : item.alignV === 'bottom'
        ? item.height - pad - blockH
        : (item.height - blockH) / 2;
  const anchor = item.alignH === 'left' ? 'start' : item.alignH === 'right' ? 'end' : 'middle';
  const x =
    item.alignH === 'left' ? pad : item.alignH === 'right' ? item.width - pad : item.width / 2;
  return (
    <svg
      className="gallery-title-thumb"
      viewBox={`0 0 ${item.width} ${item.height}`}
      data-testid="gallery-title-thumb"
    >
      {/* Transparent on the canvas; the card shows the theme's text paper, like text boxes. */}
      <rect x={0} y={0} width={item.width} height={item.height} fill={item.background ?? PAPER} />
      {lines.map((line, i) => (
        <text
          key={i}
          x={x}
          y={startY + lineH * (i + 0.5)}
          textAnchor={anchor}
          dominantBaseline="central"
          style={{
            fontFamily: item.fontFamily,
            fontWeight: item.bold ? 700 : 400,
            fontStyle: item.italic ? 'italic' : 'normal',
            fontSize: fs,
            fill: item.color ?? 'var(--new-text-ink, var(--text-primary))',
          }}
        >
          {line || ' '}
        </text>
      ))}
    </svg>
  );
}

/** Title items edit their text right in the stage (same commit rules as the
 *  canvas inline editor: blur/Enter commits, empty falls back to "Title"). */
function TitleStage({ item }: { item: TitleItem }) {
  const draft = useRef(item.text);
  const commit = () => {
    const text = draft.current.replace(/\n+$/g, '');
    if (text !== item.text) {
      updateItems([item.id], 'Edit title', (d) => {
        if (d.type === 'title') d.text = text || 'Title';
      });
    }
  };
  return (
    <div className="lightbox-title-stage" onClick={(e) => e.stopPropagation()}>
      <textarea
        className="lightbox-title-text"
        defaultValue={item.text}
        data-testid="lightbox-title-stage-input"
        spellCheck={false}
        style={{
          fontFamily: item.fontFamily,
          fontWeight: item.bold ? 700 : 400,
          fontStyle: item.italic ? 'italic' : 'normal',
          textAlign: item.alignH,
          color: item.color ?? 'var(--text-primary)',
          ...(item.background ? { background: item.background } : {}),
        }}
        onChange={(e) => (draft.current = e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: TitleItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  if (item.background) {
    ctx.fillStyle = item.background;
    ctx.fillRect(x, y, item.width, item.height);
  }
  const fs = titleFontSize(item, item.width, item.height);
  const pad = titlePadding(item.width, item.height);
  ctx.font = titleFont(item, fs);
  ctx.fillStyle = item.color ?? (p.dark ? '#e6e8ea' : '#1b1f24');
  ctx.textBaseline = 'middle';
  const lines = item.text.split('\n');
  const lineH = fs * TITLE_LINE_HEIGHT;
  const blockH = lines.length * lineH;
  const startY =
    item.alignV === 'top'
      ? y + pad + lineH / 2
      : item.alignV === 'bottom'
        ? y + item.height - pad - blockH + lineH / 2
        : y + item.height / 2 - blockH / 2 + lineH / 2;
  lines.forEach((line, i) => {
    const wLine = ctx.measureText(line).width;
    const lx =
      item.alignH === 'left'
        ? x + pad
        : item.alignH === 'right'
          ? x + item.width - pad - wLine
          : x + item.width / 2 - wLine / 2;
    ctx.fillText(line, lx, startY + i * lineH);
  });
}

/** What the board search index sees. */
function searchText(item: TitleItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title, body: join(item.text, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: TitleItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.name ?? item.text;
  out.detail = 'Title';
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: TitleItem, _p: PopoutContext): string {
  const fs = titleFontSize(item, item.width, item.height);
  const pad = titlePadding(item.width, item.height);
  const lineH = fs * TITLE_LINE_HEIGHT;
  const lines = item.text.split('\n');
  const blockH = lines.length * lineH;
  const startY =
    item.alignV === 'top'
      ? pad + lineH / 2
      : item.alignV === 'bottom'
        ? item.height - pad - blockH + lineH / 2
        : item.height / 2 - blockH / 2 + lineH / 2;
  const anchor = item.alignH === 'left' ? 'start' : item.alignH === 'right' ? 'end' : 'middle';
  const tx =
    item.alignH === 'left' ? pad : item.alignH === 'right' ? item.width - pad : item.width / 2;
  const color =
    item.color ?? (matchMedia('(prefers-color-scheme: dark)').matches ? '#e6e8ea' : '#1b1f24');
  const spans = lines
    .map(
      (line, i) =>
        `<text x="${tx}" y="${startY + i * lineH}" text-anchor="${anchor}" dominant-baseline="middle" fill="${escapeHtml(color)}" style="font:${item.italic ? 'italic ' : ''}${item.bold ? '700' : '400'} ${fs}px ${escapeHtml(item.fontFamily)}">${escapeHtml(line)}</text>`,
    )
    .join('');
  return `<svg viewBox="0 0 ${item.width} ${item.height}" style="width:min(92vw,1100px);max-height:92vh">${item.background ? `<rect width="100%" height="100%" fill="${escapeHtml(item.background)}" rx="8"/>` : ''}${spans}</svg>`;
}

export const titleType = defineItemType('title', {
  popout,
  edit: { kind: 'sheet' },
  // Titles are canvas signage, not assets: they stay out of the Asset PDF.
  pdfCategory: null,
  meta,
  label: 'Title',
  searchText,
  thumbnail: paint,
  render: TitleContent,
  card: TitleCard,
  stage: TitleStage,
  cardAspect: null,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  // The card is paper edge to edge (the SVG only spans its own aspect band).
  cardFrameStyle: (item) => ({ background: item.background ?? PAPER }),
  cardPlayBadge: false,
  cardComponent: null,
});
