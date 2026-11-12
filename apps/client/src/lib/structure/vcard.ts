/**
 * vCard (RFC 6350, with the 2.1 and 3.0 files address books still export)
 * in and out, for contact items. Reading takes what a phone, a mail client
 * or a CRM hands over: folded lines, escaped text, quoted-printable 2.1
 * values, Apple's item groups with their labels, inline photos (base64 or
 * a data URI). Writing emits vCard 3.0, the dialect every address book
 * reads, with the photo inline when the caller supplies its bytes.
 */

interface VcardField {
  label: string;
  value: string;
}

interface VcardPhoto {
  mime: string;
  /** Base64 bytes; absent when the card only pointed at a URL. */
  base64: string | null;
  url: string | null;
}

export interface VcardContact {
  uid: string | null;
  fullName: string;
  givenName: string;
  familyName: string;
  org: string;
  jobTitle: string;
  emails: VcardField[];
  phones: VcardField[];
  urls: VcardField[];
  addresses: VcardField[];
  /** `YYYY-MM-DD`, or `--MM-DD` without a year. */
  birthday: string | null;
  /** Social profiles (X-SOCIALPROFILE, IMPP): the label is the network. */
  socials: VcardField[];
  /** Custom fields (X-BOARDCACHE-FIELD with an item label). */
  fields: VcardField[];
  notes: string;
  photo: VcardPhoto | null;
}

// --- reading ---------------------------------------------------------------------

/** Join folded continuation lines (CRLF or LF followed by a space or tab);
 *  a 2.1 quoted-printable value continues past a trailing `=`. */
function unfold(text: string): string[] {
  const joined = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
  const out: string[] = [];
  let carry = '';
  for (const raw of joined.split('\n')) {
    const line = carry + raw;
    carry = '';
    if (/QUOTED-PRINTABLE/i.test(line) && line.endsWith('=')) {
      carry = line.slice(0, -1);
      continue;
    }
    if (line.length > 0) out.push(line);
  }
  if (carry) out.push(carry);
  return out;
}

interface Prop {
  group: string;
  name: string;
  /** Parameter values, upper-cased, keyed by name; bare 2.1 words file under TYPE. */
  params: Record<string, string[]>;
  value: string;
}

function parseLine(line: string): Prop | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  let value = line.slice(colon + 1);
  const [rawName = '', ...rawParams] = head.split(';');
  const dot = rawName.indexOf('.');
  const group = dot > 0 ? rawName.slice(0, dot).toUpperCase() : '';
  const name = (dot > 0 ? rawName.slice(dot + 1) : rawName).toUpperCase();
  const params: Record<string, string[]> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    const key = (eq > 0 ? p.slice(0, eq) : 'TYPE').toUpperCase();
    const vals = (eq > 0 ? p.slice(eq + 1) : p)
      .split(',')
      .map((v) => v.replace(/^"|"$/g, '').trim().toUpperCase())
      .filter(Boolean);
    (params[key] ??= []).push(...vals);
  }
  if (params.ENCODING?.includes('QUOTED-PRINTABLE')) value = decodeQuotedPrintable(value);
  return { group, name, params, value };
}

function decodeQuotedPrintable(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(ch.charCodeAt(0) & 0xff);
  }
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch {
    return String.fromCharCode(...bytes);
  }
}

/** `\n`, `\,`, `\;` and `\\` back to the characters they stand for. */
function unescapeText(s: string): string {
  return s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Split a compound value on unescaped semicolons. */
function splitComponents(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[i + 1];
      i++;
    } else if (ch === ';') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => unescapeText(c).trim());
}

/** The TYPE words that name a line (home, work, mobile), not how it is sent. */
const TYPE_NOISE = new Set(['INTERNET', 'VOICE', 'PREF', 'X400', 'TEXT', 'MSG', 'VIDEO']);
const TYPE_LABELS: Record<string, string> = { CELL: 'mobile', MOBILE: 'mobile' };

/** Apple writes labels as `_$!<Home>!$_`; a custom label is plain text. */
function cleanLabel(raw: string): string {
  return raw
    .replace(/^_\$!<(.*)>!\$_$/, '$1')
    .trim()
    .toLowerCase();
}

function labelOf(prop: Prop, groupLabels: Map<string, string>): string {
  const custom = prop.group && groupLabels.get(prop.group);
  if (custom) return custom;
  const types = (prop.params.TYPE ?? []).filter((t) => !TYPE_NOISE.has(t));
  const first = types[0];
  if (!first) return '';
  return TYPE_LABELS[first] ?? first.toLowerCase();
}

/** `19851210`, `1985-12-10`, `--1210`, `--12-10` (a time may follow). */
function readBirthday(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^--(\d{2})-?(\d{2})/.exec(v);
  if (m) return `--${m[1]}-${m[2]}`;
  return null;
}

function readPhoto(prop: Prop): VcardPhoto | null {
  const v = prop.value.trim();
  const dataUri = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/is.exec(v);
  if (dataUri) return { mime: dataUri[1] || 'image/jpeg', base64: dataUri[2]!, url: null };
  const enc = prop.params.ENCODING ?? [];
  const inline = enc.includes('B') || enc.includes('BASE64');
  if (inline || (!/^https?:/i.test(v) && /^[A-Za-z0-9+/=\s]+$/.test(v) && v.length > 64)) {
    const type = (prop.params.MEDIATYPE ?? prop.params.TYPE ?? [])[0];
    const mime = !type
      ? 'image/jpeg'
      : type.includes('/')
        ? type.toLowerCase()
        : `image/${type.toLowerCase()}`;
    return { mime, base64: v.replace(/\s+/g, ''), url: null };
  }
  if (/^https?:/i.test(v)) return { mime: '', base64: null, url: v };
  return null;
}

/** The first vCard stripped of its blanks: `BEGIN:VCARD` … `END:VCARD`, any version. */
export function parseVcf(text: string): VcardContact[] {
  const lines = unfold(text);
  const cards: VcardContact[] = [];
  let props: Prop[] | null = null;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN' && prop.value.trim().toUpperCase() === 'VCARD') {
      props = [];
      continue;
    }
    if (prop.name === 'END' && prop.value.trim().toUpperCase() === 'VCARD') {
      if (props) {
        const card = finishCard(props);
        if (card) cards.push(card);
      }
      props = null;
      continue;
    }
    props?.push(prop);
  }
  return cards;
}

function finishCard(props: Prop[]): VcardContact | null {
  const groupLabels = new Map<string, string>();
  // Custom fields keep their label's case ("Ship", not "ship").
  const groupLabelsRaw = new Map<string, string>();
  for (const p of props)
    if (p.name === 'X-ABLABEL' && p.group) {
      groupLabels.set(p.group, cleanLabel(p.value));
      groupLabelsRaw.set(p.group, unescapeText(p.value.replace(/^_\$!<(.*)>!\$_$/, '$1')).trim());
    }
  const c: VcardContact = {
    uid: null,
    fullName: '',
    givenName: '',
    familyName: '',
    org: '',
    jobTitle: '',
    emails: [],
    phones: [],
    urls: [],
    addresses: [],
    birthday: null,
    socials: [],
    fields: [],
    notes: '',
    photo: null,
  };
  const field = (p: Prop, value: string): VcardField => ({
    label: labelOf(p, groupLabels),
    value,
  });
  for (const p of props) {
    switch (p.name) {
      case 'UID':
        c.uid = p.value.trim() || null;
        break;
      case 'FN':
        c.fullName = unescapeText(p.value).trim();
        break;
      case 'N': {
        const [family = '', given = '', additional = ''] = splitComponents(p.value);
        c.familyName = family;
        c.givenName = [given, additional].filter(Boolean).join(' ');
        break;
      }
      case 'ORG':
        c.org = splitComponents(p.value).filter(Boolean).join(', ');
        break;
      case 'TITLE':
        c.jobTitle = unescapeText(p.value).trim();
        break;
      case 'ROLE':
        if (!c.jobTitle) c.jobTitle = unescapeText(p.value).trim();
        break;
      case 'TEL': {
        const v = unescapeText(p.value).replace(/^tel:/i, '').trim();
        if (v) c.phones.push(field(p, v));
        break;
      }
      case 'EMAIL': {
        const v = unescapeText(p.value).trim();
        if (v) c.emails.push(field(p, v));
        break;
      }
      case 'URL': {
        const v = unescapeText(p.value).trim();
        if (v) c.urls.push(field(p, v));
        break;
      }
      case 'ADR': {
        const parts = splitComponents(p.value)
          .map((s) => s.replace(/\n+/g, ', ').trim())
          .filter(Boolean);
        if (parts.length) c.addresses.push(field(p, parts.join(', ')));
        break;
      }
      case 'BDAY':
        c.birthday = readBirthday(p.value);
        break;
      case 'X-SOCIALPROFILE':
      case 'SOCIALPROFILE': {
        // Apple: `X-SOCIALPROFILE;type=twitter;x-user=ada:https://twitter.com/ada`.
        const v = unescapeText(p.value).trim();
        const net = (p.params.TYPE ?? []).filter((t) => !TYPE_NOISE.has(t))[0]?.toLowerCase();
        const user = p.params['X-USER']?.[0]?.toLowerCase();
        if (v || user) c.socials.push({ label: socialKey(net ?? ''), value: v || user! });
        break;
      }
      case 'IMPP': {
        // `IMPP;TYPE=home:xmpp:ada@example.com`: the scheme names the network.
        const v = unescapeText(p.value).trim();
        const m = /^([a-z][a-z0-9+.-]*):(.+)$/i.exec(v);
        if (m) c.socials.push({ label: m[1]!.toLowerCase(), value: m[2]! });
        else if (v) c.socials.push({ label: '', value: v });
        break;
      }
      case 'X-BOARDCACHE-FIELD': {
        const v = unescapeText(p.value).trim();
        const raw = p.group ? groupLabelsRaw.get(p.group) : undefined;
        if (v) c.fields.push({ label: raw ?? labelOf(p, groupLabels), value: v });
        break;
      }
      case 'NOTE':
        c.notes = [c.notes, unescapeText(p.value).trim()].filter(Boolean).join('\n');
        break;
      case 'PHOTO':
        if (!c.photo) c.photo = readPhoto(p);
        break;
    }
  }
  if (!c.fullName) c.fullName = [c.givenName, c.familyName].filter(Boolean).join(' ') || c.org;
  const empty =
    !c.fullName && !c.emails.length && !c.phones.length && !c.urls.length && !c.addresses.length;
  return empty ? null : c;
}

/** Apple's network words → the keys the app uses (`twitter` is X now). */
function socialKey(net: string): string {
  const k = net.trim().toLowerCase();
  return k === 'twitter' ? 'x' : k;
}

/** Does the text look like a vCard (pasted from an address book)? */
export function looksLikeVcf(text: string): boolean {
  return /^\s*BEGIN:VCARD/i.test(text) && /END:VCARD\s*$/i.test(text);
}

// --- writing ---------------------------------------------------------------------

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Fold a content line at 75 octets (continuations start with a space). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = ch;
      curBytes = n;
    } else {
      cur += ch;
      curBytes += n;
    }
  }
  if (cur) out.push(cur);
  return out.join('\r\n ');
}

/** Labels vCard spells as TYPE words; anything else goes out as an Apple item label. */
const LABEL_TYPES: Record<string, string> = {
  home: 'HOME',
  work: 'WORK',
  mobile: 'CELL',
  fax: 'FAX',
  pager: 'PAGER',
  main: 'MAIN',
  other: 'OTHER',
  pref: 'PREF',
};

export interface VcardWriteContact extends Omit<VcardContact, 'photo'> {
  photo: { mime: string; base64: string } | null;
}

/** vCard 3.0 text for the contacts, one card each. */
export function writeVcf(contacts: VcardWriteContact[]): string {
  const out: string[] = [];
  for (const c of contacts) {
    let groups = 0;
    const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];
    const labelled = (name: string, f: VcardField, value = escapeText(f.value)) => {
      const label = f.label.trim().toLowerCase();
      if (!label) lines.push(`${name}:${value}`);
      else if (LABEL_TYPES[label]) lines.push(`${name};TYPE=${LABEL_TYPES[label]}:${value}`);
      else {
        const g = `item${++groups}`;
        lines.push(`${g}.${name}:${value}`);
        lines.push(`${g}.X-ABLabel:${escapeText(f.label.trim())}`);
      }
    };
    if (c.uid) lines.push(`UID:${escapeText(c.uid)}`);
    lines.push(`N:${escapeText(c.familyName)};${escapeText(c.givenName)};;;`);
    lines.push(
      `FN:${escapeText(c.fullName || [c.givenName, c.familyName].filter(Boolean).join(' ') || c.org)}`,
    );
    if (c.org) lines.push(`ORG:${escapeText(c.org)}`);
    if (c.jobTitle) lines.push(`TITLE:${escapeText(c.jobTitle)}`);
    for (const f of c.phones) labelled('TEL', f);
    for (const f of c.emails) labelled('EMAIL', f);
    for (const f of c.urls) labelled('URL', f);
    for (const f of c.addresses) labelled('ADR', f, `;;${escapeText(f.value)};;;;`);
    if (c.birthday) lines.push(`BDAY:${c.birthday}`);
    for (const f of c.socials) {
      const net = f.label.trim().toLowerCase();
      lines.push(
        net
          ? `X-SOCIALPROFILE;TYPE=${net.replace(/[^a-z0-9-]/g, '')}:${escapeText(f.value)}`
          : `X-SOCIALPROFILE:${escapeText(f.value)}`,
      );
    }
    for (const f of c.fields) labelled('X-BOARDCACHE-FIELD', f);
    if (c.notes.trim()) lines.push(`NOTE:${escapeText(c.notes.trim())}`);
    if (c.photo) {
      const type = c.photo.mime.replace(/^image\//, '').toUpperCase() || 'JPEG';
      lines.push(`PHOTO;ENCODING=b;TYPE=${type}:${c.photo.base64}`);
    }
    lines.push('END:VCARD');
    out.push(lines.map(fold).join('\r\n'));
  }
  return out.join('\r\n') + '\r\n';
}
