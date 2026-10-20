import type { QrItem } from '@boardcache/schema';
import { QrContent } from '../components/items/QrContent';
import { defineItemType } from './registry';
import type { StageProps, MetaOverride } from './registry';
import type { PaintContext } from '../lib/media/paint';
import { drawQr } from '../lib/media/qr';
import type { Extracted } from '../lib/search/extract';
import { join, baseText } from '../lib/search/extract';

function QrCard({ item }: { item: QrItem }) {
  return (
    <span className="gallery-qr">
      <QrContent item={item} />
    </span>
  );
}

function Stage({ item }: StageProps<QrItem>) {
  return (
    <div className="lightbox-qr" onClick={(e) => e.stopPropagation()}>
      <QrContent item={item} />
    </div>
  );
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts). */
function paint(item: QrItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  drawQr(ctx, item, x, y, item.width, item.height);
}

/** What the board search index sees. */
function searchText(item: QrItem): Extracted {
  const title = item.name?.trim() ?? '';
  return { title, body: join(item.text, baseText(item)) };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: QrItem, base: { title: string }): MetaOverride {
  const out: MetaOverride = { title: base.title, detail: null };
  out.title = item.name ?? 'QR Code';
  out.detail = item.text
    ? item.text.length > 48
      ? `${item.text.slice(0, 48)}…`
      : item.text
    : null;
  return out;
}

export const qrType = defineItemType('qr', {
  popout: null,
  edit: { kind: 'sheet' },
  pdfCategory: 'image',
  meta,
  label: 'QR Code',
  searchText,
  thumbnail: paint,
  render: QrContent,
  card: QrCard,
  stage: Stage,
  cardAspect: null,
  cardAsset: null,
  cardCaption: (item) =>
    (item.name?.trim() ?? '') ||
    (item.text.length > 42 ? `${item.text.slice(0, 41)}…` : item.text) ||
    'QR Code',
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
