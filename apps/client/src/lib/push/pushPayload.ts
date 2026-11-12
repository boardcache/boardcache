/**
 * What a reminder says, sealed for push. The client seals it under the
 * account's push key before the reminder's moment is registered with the
 * server; the service worker that receives the push opens it with the same
 * key, read from this device's IndexedDB. The server only ever holds the
 * ciphertext. Shared by the app and the service worker, so it imports
 * nothing: the cipher is AES-GCM with a 12-byte IV in front of the
 * ciphertext, as packages/e2ee frames everything else, in base64.
 */

export interface ReminderNote {
  /** The task's or event's name. */
  title: string;
  /** Said under the title: the board, or the kind of thing. */
  body?: string;
  /** App path to open when tapped. */
  path?: string;
}

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

const toB64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const fromB64 = (text: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export async function sealReminder(key: CryptoKey, note: ReminderNote): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8.encode(JSON.stringify(note))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toB64(out);
}

/** The note, or null when the payload is not for this key (another account's device). */
async function openReminder(key: CryptoKey, payload: string): Promise<ReminderNote | null> {
  try {
    const packed = fromB64(payload);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.subarray(0, 12) },
      key,
      packed.subarray(12),
    );
    const raw = JSON.parse(utf8d.decode(plain)) as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.title !== 'string') return null;
    return {
      title: r.title,
      ...(typeof r.body === 'string' ? { body: r.body } : {}),
      ...(isAppPath(r.path) ? { path: r.path } : {}),
    };
  } catch {
    return null;
  }
}

/** One push message from the server, as the service worker reads it. */
export type PushMessage =
  | { kind: 'notice'; title: string; body?: string; path?: string; collapseId?: string }
  | { kind: 'reminders'; items: { key: string; payload?: string; path?: string }[] };

export interface ShownNotification {
  title: string;
  body?: string;
  tag: string;
  path?: string;
}

/**
 * The notifications to show for a message. Reminders are opened with the
 * push key; one the key cannot open (or a row registered before push was
 * switched on, with no payload) still says that something is due, with the
 * link, so a reminder is never lost.
 */
export async function notificationsFor(
  msg: PushMessage,
  key: CryptoKey | null,
): Promise<ShownNotification[]> {
  if (msg.kind === 'notice') {
    if (typeof msg.title !== 'string' || !msg.title) return [];
    return [
      {
        title: msg.title,
        ...(msg.body ? { body: msg.body } : {}),
        tag: msg.collapseId ? `notice-${msg.collapseId}` : `notice-${Date.now()}`,
        ...(isAppPath(msg.path) ? { path: msg.path } : {}),
      },
    ];
  }
  if (msg.kind !== 'reminders' || !Array.isArray(msg.items)) return [];
  const out: ShownNotification[] = [];
  for (const item of msg.items) {
    if (typeof item.key !== 'string') continue;
    const note = key && item.payload ? await openReminder(key, item.payload) : null;
    const path = isAppPath(note?.path) ? note!.path : isAppPath(item.path) ? item.path : undefined;
    if (note) {
      out.push({
        title: note.title,
        ...(note.body ? { body: note.body } : {}),
        tag: item.key,
        ...(path ? { path } : {}),
      });
    } else {
      out.push({
        title: `${item.key.startsWith('event:') ? 'An event' : 'A task'} is due`,
        body: 'Open boardCache to see which.',
        tag: item.key,
        ...(path ? { path } : {}),
      });
    }
  }
  return out;
}

/** A path the app may open from a notification: its own, never another origin. */
export function isAppPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !/[\\\s]/.test(path)
  );
}
