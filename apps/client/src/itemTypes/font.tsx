import { useEffect, useState } from 'react';
import type { FontItem } from '@boardcache/schema';
import { ensureFont } from '../lib/media/fontRegistry';
import { defineItemType } from './registry';
import { LightboxFont } from '../components/lightbox/LightboxFont';
import { FontContent } from '../components/items/FontContent';
import type { PaintContext } from '../lib/media/paint';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';
import type { MetaOverride } from './registry';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { getAssetBlob } from '../lib/board/assetStore';

function FontCard({ item }: { item: FontItem }) {
  const { family, assetId } = item;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void ensureFont(family, assetId).then((ok) => {
      if (alive && ok) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [family, assetId]);
  return (
    <span
      className="gallery-font"
      style={ready ? { fontFamily: `'${family.replace(/'/g, '')}'` } : undefined}
    >
      Aa
    </span>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: FontItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  // Specimen card in the font itself (loaded while the board is open).
  ctx.fillStyle = p.card.bg;
  ctx.fillRect(x, y, item.width, item.height);
  ctx.fillStyle = p.card.text;
  const size = Math.min(item.height * 0.34, item.width * 0.22);
  ctx.font = `${size}px "${item.family}", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    item.previewText || 'Aa',
    x + item.width / 2,
    y + item.height * 0.44,
    item.width - 16,
  );
  ctx.fillStyle = p.card.sub;
  ctx.font = `${Math.max(9, Math.min(item.width, item.height) * 0.09)}px sans-serif`;
  ctx.fillText(item.family, x + item.width / 2, y + item.height * 0.78, item.width - 16);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: FontItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title: title || item.family, body: join(item.previewText, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: FontItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.family;
  return out;
}

/** The item's own window (File → Pop Out): self-contained HTML. */
async function popout(item: FontItem, p: PopoutContext): Promise<string> {
  const { mintUrl } = p;
  const blob = await getAssetBlob(item.assetId);
  if (!blob) return `<div class="msg">Font file missing.</div>`;
  const src = mintUrl(blob);
  const fam = escapeHtml(item.family.replace(/'/g, ''));
  const line = 'The quick brown fox jumps over the lazy dog';
  const ramp = [14, 20, 28, 40, 56, 72]
    .map(
      (px) =>
        `<div class="frow"><span class="fsz">${px}px</span><span style="font-size:${px}px;font-family:'${fam}'">${line}</span></div>`,
    )
    .join('');
  return (
    `<style>@font-face{font-family:'${fam}';src:url(${src})}</style>` +
    `<div class="fontspec"><h1>${escapeHtml(item.family)}</h1>${ramp}` +
    `<p class="fglyphs" style="font-family:'${fam}'">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789</p></div>`
  );
}

export const fontType = defineItemType('font', {
  popout,
  edit: { kind: 'plugin' },
  pdfCategory: 'font',
  meta,
  label: 'Font',
  searchText,
  thumbnail: paint,
  render: FontContent,
  card: FontCard,
  stage: LightboxFont,
  cardAspect: null,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
