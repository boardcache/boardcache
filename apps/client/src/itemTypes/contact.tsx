import { useShallow } from 'zustand/react/shallow';
import type { ContactField, ContactItem, Item } from '@boardcache/schema';
import { ContactContent, LineIcon } from '../components/items/ContactContent';
import { ItemThumb } from '../components/panels/ItemThumb';
import { CakeIcon, ContactIcon, PencilIcon } from '../components/icons';
import { mediaTitle } from '../lib/text/linkTitles';
import { useDocumentStore } from '../state/documentStore';
import { useSessionStore } from '../state/sessionStore';
import { defineItemType } from './registry';
import type { MetaOverride, StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import { blobToCanvas, memo } from '../lib/media/paint';
import { getAssetBlob } from '../lib/board/assetStore';
import { cardZoom } from '../lib/canvas/cardZoom';
import { VIEWER } from '../lib/viewerMode';
import {
  contactDetailLine,
  contactInitials,
  contactName,
  contactSubline,
  fieldHref,
  formatBirthday,
  labelText,
  openContactHref,
  socialLabel,
} from '../lib/structure/contacts';
import type { ContactLineKind } from '../lib/structure/contacts';
import { cardLines } from '../components/items/ContactContent';
import type { Extracted } from '../lib/search/extract';
import { baseText, join } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';

function ContactCard({ item }: { item: ContactItem }) {
  return (
    <span className="gallery-contact" data-testid="gallery-contact-thumb">
      <ContactContent item={item} mode="fit" />
    </span>
  );
}

type Kind = ContactLineKind;
type ListKey = 'emails' | 'phones' | 'urls' | 'addresses' | 'socials' | 'fields';
const SECTIONS: { kind: Kind; key: ListKey }[] = [
  { kind: 'email', key: 'emails' },
  { kind: 'phone', key: 'phones' },
  { kind: 'url', key: 'urls' },
  { kind: 'social', key: 'socials' },
  { kind: 'address', key: 'addresses' },
  { kind: 'field', key: 'fields' },
];

/** The label a details row prints: the network for a social line, else the label itself. */
const rowLabel = (kind: Kind, f: ContactField) =>
  kind === 'social' ? socialLabel(f.label) : labelText(f.label);

/** Every line of the contact with its label, each one a link that opens it
 *  (a custom field is just read). */
export function ContactDetails({
  item,
  testId = 'contact-details',
}: {
  item: ContactItem;
  testId?: string;
}) {
  const rows: { kind: Kind; field: ContactField }[] = SECTIONS.flatMap(({ kind, key }) =>
    item[key].map((field) => ({ kind, field })),
  );
  if (rows.length === 0 && !item.birthday) return null;
  return (
    <div className="contact-details" data-testid={testId}>
      {rows.map(({ kind, field }, i) =>
        kind === 'field' ? (
          <div
            key={`${kind}-${i}`}
            className="contact-details-row"
            data-testid="contact-detail-field"
          >
            <LineIcon kind={kind} size={15} />
            <span className="contact-details-label">{labelText(field.label)}</span>
            <span className="contact-details-value">{field.value}</span>
          </div>
        ) : (
          <a
            key={`${kind}-${i}`}
            className="contact-details-row"
            href={fieldHref(kind, field)}
            data-testid={`contact-detail-${kind}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openContactHref(fieldHref(kind, field));
            }}
          >
            <LineIcon kind={kind} size={15} />
            <span className="contact-details-label">{rowLabel(kind, field)}</span>
            <span className="contact-details-value">{field.value}</span>
          </a>
        ),
      )}
      {item.birthday && (
        <div className="contact-details-row" data-testid="contact-detail-birthday">
          <CakeIcon size={15} />
          <span className="contact-details-label">Birthday</span>
          <span className="contact-details-value">{formatBirthday(item.birthday)}</span>
        </div>
      )}
    </div>
  );
}

/** Items joined to the contact by a connector line, in reading order. */
function connectedItems(
  items: Record<string, Item>,
  connections: CanvasDocumentConnections,
  id: string,
) {
  const out: Item[] = [];
  for (const c of Object.values(connections)) {
    const other =
      c.from.kind === 'item' && c.from.id === id
        ? c.to
        : c.to.kind === 'item' && c.to.id === id
          ? c.from
          : null;
    if (!other || other.kind !== 'item') continue;
    const it = items[other.id];
    if (it && it.type !== 'contact' && !out.includes(it)) out.push(it);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
}
type CanvasDocumentConnections = ReturnType<typeof useDocumentStore.getState>['doc']['connections'];

/** The media joined to the contact by connector lines: a strip of thumbs,
 *  each one opening its item in the lightbox (Back returns to the contact). */
export function ConnectedMedia({
  item,
  testId = 'contact-media',
}: {
  item: ContactItem;
  testId?: string;
}) {
  const linked = useDocumentStore(
    useShallow((s) => connectedItems(s.doc.items, s.doc.connections, item.id)),
  );
  if (linked.length === 0) return null;
  const open = (id: string) => {
    const session = useSessionStore.getState();
    session.setLightboxReturn(item.id);
    session.setLightbox(id);
  };
  return (
    <div className="contact-media" data-testid={testId}>
      <div className="contact-media-head">Connected</div>
      <div className="contact-media-grid">
        {linked.map((it) => (
          <button
            type="button"
            key={it.id}
            className="contact-media-tile"
            data-testid="contact-media-tile"
            data-item-id={it.id}
            title={mediaTitle(it)}
            onClick={(e) => {
              e.stopPropagation();
              open(it.id);
            }}
          >
            <span className="contact-media-thumb">
              <ItemThumb item={it} />
            </span>
            <span className="contact-media-title">{mediaTitle(it)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stage({ item, ctx }: StageProps<ContactItem>) {
  const edit = () => {
    ctx.close();
    window.dispatchEvent(
      new CustomEvent('boardcache:edit-contact', { detail: { itemId: item.id } }),
    );
  };
  const contacts = () => {
    ctx.close();
    window.dispatchEvent(
      new CustomEvent('boardcache:open-contacts', { detail: { itemId: item.id } }),
    );
  };
  return (
    <div className="lightbox-contact" onClick={(e) => e.stopPropagation()}>
      <ContactContent item={item} mode="plain" />
      <ContactDetails item={item} />
      {item.notes?.trim() && <div className="contact-details-notes">{item.notes.trim()}</div>}
      <ConnectedMedia item={item} />
      {!VIEWER && (
        <div className="contact-stage-actions">
          <button
            type="button"
            className="btn btn-sm"
            data-testid="contact-stage-edit"
            onClick={edit}
          >
            <PencilIcon size={14} /> Edit Contact
          </button>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="contact-stage-contacts"
            onClick={contacts}
          >
            <ContactIcon size={14} /> Open Contacts
          </button>
        </div>
      )}
    </div>
  );
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Board thumbnail / snapshot painter (see lib/media/paint.ts): the card at
 *  its design size, zoomed like the card (the CSS sizes, mirrored). */
async function paint(item: ContactItem, p: PaintContext): Promise<void> {
  const { ctx, x, y } = p;
  const k = cardZoom(item);
  const W = item.width / Math.max(0.01, k);
  const H = item.height / Math.max(0.01, k);
  const font = 'Inter, system-ui, sans-serif';
  const photo = item.photoAssetId
    ? await memo(p.cache, `blob:${item.photoAssetId}`, async () => {
        const blob = await getAssetBlob(item.photoAssetId!);
        return blob ? blobToCanvas(blob) : null;
      })
    : null;
  if (item.photoAssetId && !photo) p.missing?.(item.photoAssetId);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, W - 1, H - 1, 12);
  ctx.fillStyle = p.card.bg;
  ctx.fill();
  ctx.strokeStyle = p.dark ? 'rgba(230,232,236,0.26)' : 'rgba(35,39,46,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();
  // The head: a 56px disc at (18, 16), the name and subline beside it.
  const pad = 18;
  const top = 16;
  const disc = 56;
  ctx.save();
  ctx.beginPath();
  ctx.arc(pad + disc / 2, top + disc / 2, disc / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = p.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)';
  ctx.fill();
  if (photo) {
    ctx.clip();
    const fit = Math.max(disc / photo.width, disc / photo.height);
    ctx.drawImage(
      photo,
      pad + (disc - photo.width * fit) / 2,
      top + (disc - photo.height * fit) / 2,
      photo.width * fit,
      photo.height * fit,
    );
  } else {
    ctx.fillStyle = p.card.text;
    ctx.font = `600 ${disc * 0.36}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(contactInitials(item), pad + disc / 2, top + disc / 2 + 1);
  }
  ctx.restore();
  const textX = pad + disc + 14;
  const textW = W - textX - pad;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = p.card.text;
  ctx.font = `700 19px ${font}`;
  const sub = contactSubline(item);
  const nameY = top + (sub ? 18 : disc / 2);
  ctx.fillText(ellipsize(ctx, contactName(item), textW), textX, nameY);
  if (sub) {
    ctx.fillStyle = p.card.sub;
    ctx.font = `400 13px ${font}`;
    ctx.fillText(ellipsize(ctx, sub, textW), textX, nameY + 22);
  }
  // The lines: 13px rows from the bottom up, a 13px glyph before each.
  const lines = cardLines(item);
  ctx.font = `400 13px ${font}`;
  const rowH = 20;
  let rowY = H - 16 - rowH * lines.length + rowH / 2;
  for (const { kind, field } of lines) {
    ctx.fillStyle = p.card.glyph;
    paintGlyph(ctx, kind, pad + 1, rowY);
    ctx.fillStyle = p.card.text;
    ctx.fillText(ellipsize(ctx, field.value, W - pad * 2 - 22), pad + 22, rowY);
    rowY += rowH;
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** A small mark standing in for the row's icon (the painter has no lucide). */
function paintGlyph(ctx: CanvasRenderingContext2D, kind: Kind, x: number, cy: number): void {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (kind === 'email') {
    ctx.rect(x, cy - 4.5, 13, 9);
    ctx.moveTo(x, cy - 4.5);
    ctx.lineTo(x + 6.5, cy + 1);
    ctx.lineTo(x + 13, cy - 4.5);
  } else if (kind === 'phone') {
    ctx.roundRect(x + 3, cy - 6, 7, 12, 1.5);
  } else if (kind === 'url') {
    ctx.arc(x + 6.5, cy, 6, 0, Math.PI * 2);
    ctx.moveTo(x + 0.5, cy);
    ctx.lineTo(x + 12.5, cy);
    ctx.moveTo(x + 6.5, cy - 6);
    ctx.lineTo(x + 6.5, cy + 6);
  } else {
    ctx.arc(x + 6.5, cy - 1.5, 4.5, Math.PI * 1.15, Math.PI * -0.15);
    ctx.lineTo(x + 6.5, cy + 6);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

/** What the board search index sees. */
function searchText(item: ContactItem): Extracted {
  const title = item.name?.trim() ?? '';
  const lines = [
    ...item.emails,
    ...item.phones,
    ...item.urls,
    ...item.addresses,
    ...item.socials,
    ...item.fields,
  ].flatMap((f) => [f.label, f.value]);
  return {
    title: title || contactName(item),
    body: join(contactSubline(item), ...lines, baseText(item)),
  };
}

/** Lightbox-panel / caption metadata: the name and one-line detail. */
function meta(item: ContactItem, base: { title: string }): MetaOverride {
  return { title: item.name ?? contactName(item) ?? base.title, detail: contactDetailLine(item) };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: ContactItem, _p: PopoutContext): string {
  const rows = SECTIONS.flatMap(({ kind, key }) =>
    item[key].map((f) =>
      kind === 'field'
        ? `<div class="ctrow"><span class="ctlabel">${escapeHtml(labelText(f.label))}</span><span>${escapeHtml(f.value)}</span></div>`
        : `<div class="ctrow"><span class="ctlabel">${escapeHtml(rowLabel(kind, f) || kind)}</span>${
            fieldHref(kind, f)
              ? `<a href="${escapeHtml(fieldHref(kind, f))}" target="_blank" rel="noreferrer noopener">${escapeHtml(f.value)}</a>`
              : `<span>${escapeHtml(f.value)}</span>`
          }</div>`,
    ),
  );
  if (item.birthday)
    rows.push(
      `<div class="ctrow"><span class="ctlabel">Birthday</span><span>${escapeHtml(formatBirthday(item.birthday))}</span></div>`,
    );
  const sub = contactSubline(item);
  return (
    `<style>.ctpop{max-width:360px;margin:0 auto;font-family:Inter,system-ui,sans-serif}.cthead{display:flex;align-items:center;gap:14px;margin-bottom:18px}` +
    `.ctavatar{width:64px;height:64px;border-radius:50%;background:rgba(127,127,127,.18);display:grid;place-items:center;font-weight:600;font-size:22px}` +
    `.ctname{font-size:22px;font-weight:700}.ctsub{opacity:.7;font-size:14px}.ctrow{display:flex;gap:12px;padding:6px 0;border-top:1px solid rgba(127,127,127,.25);font-size:14px}` +
    `.ctlabel{width:84px;flex:none;opacity:.6;text-transform:capitalize}.ctrow a{color:inherit}.ctnotes{margin-top:18px;white-space:pre-wrap;opacity:.85}</style>` +
    `<div class="ctpop"><div class="cthead"><div class="ctavatar">${escapeHtml(contactInitials(item))}</div><div><div class="ctname">${escapeHtml(contactName(item))}</div>` +
    (sub ? `<div class="ctsub">${escapeHtml(sub)}</div>` : '') +
    `</div></div>${rows.join('')}` +
    (item.notes?.trim() ? `<div class="ctnotes">${escapeHtml(item.notes.trim())}</div>` : '') +
    `</div>`
  );
}

export const contactType = defineItemType('contact', {
  popout,
  edit: { kind: 'event', event: 'boardcache:edit-contact' },
  pdfCategory: 'image',
  meta,
  label: 'Contact',
  searchText,
  thumbnail: paint,
  render: ContactContent,
  card: ContactCard,
  stage: Stage,
  cardAspect: () => CONTACT_ASPECT, // a business card, wider than tall
  cardAsset: null, // the gallery shows the whole card, photo included; pickers take the photo (thumbAssetOf)
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});

const CONTACT_ASPECT = 170 / 300;
