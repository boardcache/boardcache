import type { EventItem } from '@boardcache/schema';
import { EventContent } from '../components/items/EventContent';
import { BellIcon, CalendarIcon, MapPinIcon, PencilIcon } from '../components/icons';
import { defineItemType } from './registry';
import type { MetaOverride, StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import { cardZoom } from '../lib/canvas/cardZoom';
import { VIEWER } from '../lib/viewerMode';
import {
  eventDetailLine,
  eventLeaf,
  eventTimeLine,
  isPastEvent,
  remindLabel,
} from '../lib/structure/events';
import type { Extracted } from '../lib/search/extract';
import { baseText, join } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

function EventCard({ item }: { item: EventItem }) {
  return (
    <span className="gallery-event" data-testid="gallery-event-thumb">
      <EventContent item={item} mode="fit" />
    </span>
  );
}

function Stage({ item, ctx }: StageProps<EventItem>) {
  const edit = () => {
    ctx.close();
    window.dispatchEvent(new CustomEvent('boardcache:edit-event', { detail: { itemId: item.id } }));
  };
  const calendar = () => {
    ctx.close();
    window.dispatchEvent(
      new CustomEvent('boardcache:open-calendar', { detail: { itemId: item.id } }),
    );
  };
  return (
    <div className="lightbox-event" onClick={(e) => e.stopPropagation()}>
      <EventContent item={item} mode="plain" />
      {(item.location || item.remindMinutes !== null || item.description) && (
        <div className="event-details" data-testid="event-details">
          {item.location && (
            <div className="event-details-row">
              <MapPinIcon size={15} />
              <span>{item.location}</span>
            </div>
          )}
          {item.remindMinutes !== null && (
            <div className="event-details-row">
              <BellIcon size={15} />
              <span>{remindLabel(item.remindMinutes)}</span>
            </div>
          )}
          {item.description && <div className="event-details-desc">{item.description}</div>}
        </div>
      )}
      {!VIEWER && (
        <div className="event-stage-actions">
          <button type="button" data-testid="event-stage-edit" onClick={edit}>
            <PencilIcon size={14} /> Edit Event
          </button>
          <button type="button" data-testid="event-stage-calendar" onClick={calendar}>
            <CalendarIcon size={14} /> Open Calendar
          </button>
        </div>
      )}
    </div>
  );
}

/** Word-wrap a line to `maxWidth`, at most `maxLines` lines (last one ellipsised). */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1]!;
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts): the leaf at
 *  its design size, zoomed like the card (the CSS sizes, mirrored). */
function paint(item: EventItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  const k = cardZoom(item);
  const W = item.width / Math.max(0.01, k);
  const H = item.height / Math.max(0.01, k);
  const leaf = eventLeaf(item);
  const band = p.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
  const font = 'Inter, system-ui, sans-serif';
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, W - 1, H - 1, 10);
  ctx.fillStyle = p.card.bg;
  ctx.fill();
  ctx.strokeStyle = p.dark ? 'rgba(230,232,236,0.26)' : 'rgba(35,39,46,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();
  ctx.globalAlpha = 0.78; // the leaf's ink is a step softer than body text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = W / 2;
  // Year band: 20px type, 6px of padding.
  const yearH = 36;
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, W, yearH);
  ctx.fillStyle = p.card.text;
  ctx.font = `500 20px ${font}`;
  ctx.fillText(leaf.year, cx, yearH / 2);
  if (isPastEvent(item)) {
    ctx.textAlign = 'left';
    ctx.fillStyle = p.card.sub;
    ctx.font = `600 11px ${font}`;
    ctx.fillText('PAST', 10, yearH / 2);
    ctx.textAlign = 'center';
  }
  // From the bottom: location (13px), title (19px, up to 3 lines), hours band (15px).
  ctx.font = `700 19px ${font}`;
  const titleLines = wrapLines(ctx, item.title, W - 28, 3);
  const locBlock = item.location ? 13 * 1.3 + 10 : 0;
  const titleBlock = 10 + titleLines.length * 19 * 1.2 + (item.location ? 6 : 12);
  const timeH = 30;
  const timeTop = H - locBlock - titleBlock - timeH;
  ctx.fillStyle = band;
  ctx.fillRect(0, timeTop, W, timeH);
  ctx.fillStyle = p.card.text;
  ctx.font = `400 15px ${font}`;
  ctx.fillText(eventTimeLine(item), cx, timeTop + timeH / 2, W - 24);
  ctx.font = `700 19px ${font}`;
  titleLines.forEach((line, i) => {
    ctx.fillText(line, cx, timeTop + timeH + 10 + 19 * 1.2 * (i + 0.5), W - 28);
  });
  if (item.location) {
    ctx.fillStyle = p.card.sub;
    ctx.font = `400 13px ${font}`;
    ctx.fillText(item.location, cx, timeTop + timeH + titleBlock + (13 * 1.3) / 2, W - 28);
  }
  // The leaf: weekday (22px), day (58% of the leaf, up to 110px), month
  // (24px); a short leaf keeps only the day, as the CSS does.
  const leafTop = yearH;
  const leafH = Math.max(44, timeTop - leafTop);
  const short = leafH <= 96;
  const daySize = Math.max(8, Math.min(110, leafH * (short ? 0.8 : 0.58)));
  const stack = short ? daySize : 22 * 1.2 + daySize + 24 * 1.2 + 4;
  let top = leafTop + (leafH - stack) / 2;
  ctx.fillStyle = p.card.text;
  if (!short) {
    ctx.font = `400 22px ${font}`;
    ctx.fillText(leaf.weekday, cx, top + (22 * 1.2) / 2, W - 24);
    top += 22 * 1.2 + 2;
  }
  ctx.font = `800 ${daySize}px ${font}`;
  ctx.fillText(leaf.day, cx, top + daySize / 2, W - 24);
  if (!short) {
    top += daySize + 2;
    ctx.font = `400 24px ${font}`;
    ctx.fillText(leaf.month, cx, top + (24 * 1.2) / 2, W - 24);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees. */
function searchText(item: EventItem): Extracted {
  const title = item.name?.trim() ?? '';
  return {
    title: title || item.title,
    body: join(eventDetailLine(item), item.location, item.description, baseText(item)),
  };
}

/** Lightbox-panel / caption metadata: the title and one-line detail. */
function meta(item: EventItem, base: { title: string }): MetaOverride {
  return { title: item.name ?? item.title ?? base.title, detail: eventDetailLine(item) };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: EventItem, _p: PopoutContext): string {
  const leaf = eventLeaf(item);
  return (
    `<style>.evpop{width:280px;margin:0 auto;border:1px solid rgba(127,127,127,.3);border-radius:12px;overflow:hidden;text-align:center;font-family:Inter,system-ui,sans-serif}` +
    `.evband{background:rgba(127,127,127,.14);padding:7px;font-size:22px}.evleaf{padding:14px 12px}.evwd{font-size:24px}.evday{font-size:100px;font-weight:800;line-height:1;letter-spacing:-.03em}.evmo{font-size:26px}` +
    `.evtime{background:rgba(127,127,127,.14);padding:7px;font-size:17px}.evtitle{padding:12px 16px 8px;font-size:21px;font-weight:700}.evloc{padding:0 16px 12px;opacity:.7}.evdesc{max-width:280px;margin:16px auto 0;white-space:pre-wrap;opacity:.85}</style>` +
    `<div class="evpop"><div class="evband">${escapeHtml(leaf.year)}</div>` +
    `<div class="evleaf"><div class="evwd">${escapeHtml(leaf.weekday)}</div><div class="evday">${escapeHtml(leaf.day)}</div><div class="evmo">${escapeHtml(leaf.month)}</div></div>` +
    `<div class="evtime">${escapeHtml(eventTimeLine(item))}</div><div class="evtitle">${escapeHtml(item.title)}</div>` +
    (item.location ? `<div class="evloc">${escapeHtml(item.location)}</div>` : '') +
    `</div>` +
    (item.description ? `<div class="evdesc">${escapeHtml(item.description)}</div>` : '')
  );
}

export const eventType = defineItemType('event', {
  popout,
  edit: { kind: 'event', event: 'boardcache:edit-event' },
  pdfCategory: 'image',
  meta,
  label: 'Event',
  searchText,
  thumbnail: paint,
  render: EventContent,
  card: EventCard,
  stage: Stage,
  cardAspect: () => 1.25, // the leaf is taller than wide
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});
