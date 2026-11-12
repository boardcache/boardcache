import { useState } from 'react';
import type { ContactField, ContactItem } from '@boardcache/schema';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { AtSignIcon, GlobeIcon, MailIcon, MapPinIcon, PhoneIcon, TagIcon } from '../icons';
import {
  CONTACT_CARD_W,
  contactInitials,
  contactName,
  contactSubline,
} from '../../lib/structure/contacts';
import type { ContactLineKind } from '../../lib/structure/contacts';
import { FittedCard, ScaledCard } from './ScaledCard';

/**
 * A contact as a business card: the photo (or initials) beside the name and
 * where they work, then up to three ways to reach them. Laid out at its
 * design width and zoomed like the other cards: a corner drag scales
 * everything, an edge drag gives the lines more or less room. One
 * component draws the canvas item (ScaledCard), the gallery card (fitted
 * to the card) and the lightbox.
 */

type AvatarSource = Pick<
  ContactItem,
  'fullName' | 'givenName' | 'familyName' | 'org' | 'photoAssetId'
>;

/** The photo, or two initials on a neutral disc. */
export function ContactAvatar({ item, size }: { item: AvatarSource; size?: number }) {
  const url = useAssetUrl(item.photoAssetId);
  // A photo that will not decode (a card's odd bytes) gives way to the initials.
  const [broken, setBroken] = useState<string | null>(null);
  const style = size ? { width: size, height: size, fontSize: size * 0.36 } : undefined;
  const show = url && broken !== url;
  return (
    <span className="contact-avatar" style={style} data-testid="contact-avatar">
      {show ? (
        <img src={url} alt="" draggable={false} onError={() => setBroken(url)} />
      ) : (
        contactInitials(item)
      )}
    </span>
  );
}

/** The lines the card has room for: first email, first phone, then the web,
 *  a social profile or the address. */
export function cardLines(item: ContactItem): { kind: ContactLineKind; field: ContactField }[] {
  const out: { kind: ContactLineKind; field: ContactField }[] = [];
  if (item.emails[0]) out.push({ kind: 'email', field: item.emails[0] });
  if (item.phones[0]) out.push({ kind: 'phone', field: item.phones[0] });
  if (item.urls[0]) out.push({ kind: 'url', field: item.urls[0] });
  else if (item.socials[0]) out.push({ kind: 'social', field: item.socials[0] });
  else if (item.addresses[0]) out.push({ kind: 'address', field: item.addresses[0] });
  return out.slice(0, 3);
}

export function LineIcon({ kind, size = 13 }: { kind: ContactLineKind; size?: number }) {
  if (kind === 'email') return <MailIcon size={size} />;
  if (kind === 'phone') return <PhoneIcon size={size} />;
  if (kind === 'url') return <GlobeIcon size={size} />;
  if (kind === 'social') return <AtSignIcon size={size} />;
  if (kind === 'field') return <TagIcon size={size} />;
  return <MapPinIcon size={size} />;
}

function Card({ item }: { item: ContactItem }) {
  const sub = contactSubline(item);
  return (
    <div className="contact-item" data-testid="contact-item">
      <div className="contact-head">
        <ContactAvatar item={item} />
        <div className="contact-names">
          <div className="contact-name" data-testid="contact-name">
            {contactName(item)}
          </div>
          {sub && (
            <div className="contact-sub" data-testid="contact-sub">
              {sub}
            </div>
          )}
        </div>
      </div>
      <div className="contact-lines">
        {cardLines(item).map(({ kind, field }, i) => (
          <div className="contact-line" key={`${kind}-${i}`} data-testid={`contact-line-${kind}`}>
            <LineIcon kind={kind} />
            <span>{field.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ContactContent({
  item,
  mode = 'canvas',
}: {
  item: ContactItem;
  /** canvas: zoomed like other cards; fit: scaled to the holding box; plain: as is. */
  mode?: 'canvas' | 'fit' | 'plain';
}) {
  if (mode === 'fit')
    return (
      <FittedCard baseW={CONTACT_CARD_W}>
        <Card item={item} />
      </FittedCard>
    );
  if (mode === 'plain') return <Card item={item} />;
  return (
    <ScaledCard item={item} baseW={CONTACT_CARD_W}>
      <Card item={item} />
    </ScaledCard>
  );
}
