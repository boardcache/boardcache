import type { ContactlistItem } from '@boardcache/schema';
import { ContactListContent, ContactListStage } from '../components/items/ContactListContent';
import { ContactIcon, DownloadIcon, PencilIcon } from '../components/icons';
import { defineItemType } from './registry';
import type { MetaOverride, StageProps } from './registry';
import type { PaintContext } from '../lib/media/paint';
import { cardZoom } from '../lib/canvas/cardZoom';
import { downloadContactsVcf } from '../lib/export/exportVcf';
import { VIEWER } from '../lib/viewerMode';
import {
  contactInitials,
  contactLetter,
  contactName,
  contactSubline,
  listContacts,
} from '../lib/structure/contacts';
import type { Extracted } from '../lib/search/extract';
import { baseText, join } from '../lib/search/extract';
import { escapeHtml } from '../lib/canvas/popoutHtml';
import type { PopoutContext } from '../lib/canvas/popoutHtml';
import { useDocumentStore } from '../state/documentStore';

function ContactListCard({ item }: { item: ContactlistItem }) {
  return (
    <span className="gallery-contact" data-testid="gallery-contactlist-thumb">
      <ContactListContent item={item} mode="fit" />
    </span>
  );
}

function Stage({ item, ctx }: StageProps<ContactlistItem>) {
  const rename = () => {
    ctx.close();
    window.dispatchEvent(
      new CustomEvent('boardcache:edit-contactlist', { detail: { itemId: item.id } }),
    );
  };
  const contacts = () => {
    ctx.close();
    window.dispatchEvent(new CustomEvent('boardcache:open-contacts', { detail: {} }));
  };
  const exportList = () => {
    const doc = useDocumentStore.getState().doc;
    void downloadContactsVcf(listContacts(doc, item.id), doc);
  };
  return (
    <div className="lightbox-contact" onClick={(e) => e.stopPropagation()}>
      <ContactListStage
        item={item}
        actions={
          !VIEWER && (
            <div className="contact-stage-actions">
              <button
                type="button"
                className="btn btn-sm"
                data-testid="contactlist-stage-rename"
                onClick={rename}
              >
                <PencilIcon size={14} /> Rename List
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="contactlist-stage-contacts"
                onClick={contacts}
              >
                <ContactIcon size={14} /> Open Contacts
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                data-testid="contactlist-stage-export"
                onClick={exportList}
              >
                <DownloadIcon size={14} /> Export .vcf
              </button>
            </div>
          )
        }
      />
    </div>
  );
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Board thumbnail / snapshot painter: the list at its design size, zoomed
 *  like the card (the CSS sizes, mirrored): the head, then the rows with
 *  their letter headings as far as the box goes. */
function paint(item: ContactlistItem, p: PaintContext): void {
  const { ctx, x, y } = p;
  const k = cardZoom(item);
  const W = item.width / Math.max(0.01, k);
  const H = item.height / Math.max(0.01, k);
  const font = 'Inter, system-ui, sans-serif';
  const rows = listContacts(useDocumentStore.getState().doc, item.id);
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
  const pad = 14;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = p.card.text;
  ctx.font = `700 15px ${font}`;
  ctx.fillText(ellipsize(ctx, item.title, W - pad * 2 - 40), pad, 22);
  ctx.textAlign = 'right';
  ctx.fillStyle = p.card.sub;
  ctx.font = `500 12px ${font}`;
  ctx.fillText(String(rows.length), W - pad, 22);
  ctx.textAlign = 'left';
  ctx.strokeStyle = p.dark ? 'rgba(230,232,236,0.14)' : 'rgba(35,39,46,0.14)';
  ctx.beginPath();
  ctx.moveTo(0, 44);
  ctx.lineTo(W, 44);
  ctx.stroke();
  let yy = 44;
  let letter = '';
  const disc = 30;
  for (const c of rows) {
    if (yy > H) break;
    const l = contactLetter(c);
    if (l !== letter) {
      letter = l;
      ctx.fillStyle = p.card.sub;
      ctx.font = `600 11px ${font}`;
      ctx.fillText(l, pad + 2, yy + 14);
      yy += 24;
    }
    ctx.beginPath();
    ctx.arc(pad + disc / 2, yy + 21, disc / 2, 0, Math.PI * 2);
    ctx.fillStyle = p.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)';
    ctx.fill();
    ctx.fillStyle = p.card.text;
    ctx.font = `600 11px ${font}`;
    ctx.textAlign = 'center';
    ctx.fillText(contactInitials(c), pad + disc / 2, yy + 22);
    ctx.textAlign = 'left';
    const tx = pad + disc + 10;
    const sub = contactSubline(c);
    ctx.font = `400 13px ${font}`;
    ctx.fillText(ellipsize(ctx, contactName(c), W - tx - pad), tx, sub ? yy + 14 : yy + 21);
    if (sub) {
      ctx.fillStyle = p.card.sub;
      ctx.font = `400 11px ${font}`;
      ctx.fillText(ellipsize(ctx, sub, W - tx - pad), tx, yy + 29);
    }
    yy += 42;
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** What the board search index sees: the title and every row's name. */
function searchText(item: ContactlistItem): Extracted {
  const rows = listContacts(useDocumentStore.getState().doc, item.id);
  return {
    title: item.name?.trim() || item.title,
    body: join(...rows.map((c) => `${contactName(c)} ${contactSubline(c)}`), baseText(item)),
  };
}

function meta(item: ContactlistItem, base: { title: string }): MetaOverride {
  const n = listContacts(useDocumentStore.getState().doc, item.id).length;
  return {
    title: item.name ?? item.title ?? base.title,
    detail: n === 1 ? '1 contact' : `${n} contacts`,
  };
}

/** The item's own window (File → Pop Out): self-contained HTML. */
function popout(item: ContactlistItem, _p: PopoutContext): string {
  const rows = listContacts(useDocumentStore.getState().doc, item.id);
  return (
    `<style>.clpop{max-width:420px;margin:0 auto;font-family:Inter,system-ui,sans-serif}.clpop h2{font-size:20px;margin:0 0 14px}` +
    `.clrow{display:flex;gap:12px;align-items:center;padding:8px 0;border-top:1px solid rgba(127,127,127,.25)}` +
    `.clavatar{width:32px;height:32px;border-radius:50%;background:rgba(127,127,127,.18);display:grid;place-items:center;font-weight:600;font-size:12px;flex:none}` +
    `.clsub{opacity:.7;font-size:12px}</style>` +
    `<div class="clpop"><h2>${escapeHtml(item.title)}</h2>` +
    rows
      .map(
        (c) =>
          `<div class="clrow"><div class="clavatar">${escapeHtml(contactInitials(c))}</div><div><div>${escapeHtml(contactName(c))}</div>` +
          (contactSubline(c) ? `<div class="clsub">${escapeHtml(contactSubline(c))}</div>` : '') +
          `</div></div>`,
      )
      .join('') +
    `</div>`
  );
}

export const contactlistType = defineItemType('contactlist', {
  popout,
  edit: { kind: 'event', event: 'boardcache:edit-contactlist' },
  pdfCategory: 'image',
  meta,
  label: 'Contact List',
  searchText,
  thumbnail: paint,
  render: ContactListContent,
  card: ContactListCard,
  stage: Stage,
  cardAspect: () => CONTACT_LIST_ASPECT,
  cardAsset: null,
  cardCaption: null,
  cardColor: null,
  cardFrameStyle: null,
  cardPlayBadge: false,
  cardComponent: null,
});

const CONTACT_LIST_ASPECT = 400 / 320;
