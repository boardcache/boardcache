import type { EmailAddress } from '@boardcache/schema';
import { platform } from '../../lib/platform';
import type { MailAccount, MailServer } from './accounts';

/**
 * The mail proxy on the sync server: every call names the account's server
 * and credentials (kept on this device), the server connects for that call
 * and hangs up. Folders, a page of a mailbox, one message's source, flags,
 * deletion and sending.
 */

export interface MailFolder {
  path: string;
  name: string;
  delimiter: string;
  /** \Inbox, \Sent, \Drafts, \Trash, \Junk, \Archive, \All — when the server says. */
  specialUse: string | null;
  /** A folder that holds no messages (a parent only). */
  noSelect: boolean;
  messages: number | null;
  unseen: number | null;
}

export interface MailSummary {
  uid: number;
  seq: number;
  date: string | null;
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  size: number;
  hasAttachments: boolean;
}

export interface MailPage {
  messages: MailSummary[];
  /** How many the mailbox holds. */
  exists: number;
  /** The lowest sequence number on this page (ask for the ones before it). */
  firstSeq: number;
}

const server = (s: MailServer) => ({
  host: s.host.trim(),
  port: s.port,
  secure: s.secure,
  user: s.user,
  pass: s.pass,
});

async function post<T>(op: string, body: unknown, raw = false): Promise<T> {
  const res = await platform.mailRequest(op, body);
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      data?.error ??
        (res.status === 401
          ? 'Sign in to sync to reach your mail.'
          : `Mail request failed (${res.status}).`),
    );
  }
  return (raw ? new Uint8Array(await res.arrayBuffer()) : await res.json()) as T;
}

export const testAccount = (imap: MailServer, smtp: MailServer | null) =>
  post<{ imap: boolean; smtp: boolean | null }>('test', {
    imap: server(imap),
    ...(smtp ? { smtp: server(smtp) } : {}),
  });

export const fetchFolders = (acct: MailAccount) =>
  post<{ folders: MailFolder[] }>('folders', { imap: server(acct.imap) }).then((r) => r.folders);

export const fetchPage = (acct: MailAccount, folder: string, beforeSeq?: number, limit = 50) =>
  post<MailPage>('list', {
    imap: server(acct.imap),
    folder,
    limit,
    ...(beforeSeq ? { beforeSeq } : {}),
  });

export const fetchSource = (acct: MailAccount, folder: string, uid: number) =>
  post<Uint8Array>('source', { imap: server(acct.imap), folder, uid }, true);

export const setFlags = (
  acct: MailAccount,
  folder: string,
  uid: number,
  change: { add?: string[]; remove?: string[] },
) => post<{ ok: true }>('flags', { imap: server(acct.imap), folder, uid, ...change });

export const deleteMessage = (acct: MailAccount, folder: string, uid: number) =>
  post<{ ok: true; movedTo: string | null }>('delete', { imap: server(acct.imap), folder, uid });

/** The same for a set of messages, in one request. */
export const setFlagsMany = (
  acct: MailAccount,
  folder: string,
  uids: number[],
  change: { add?: string[]; remove?: string[] },
) => post<{ ok: true }>('flags', { imap: server(acct.imap), folder, uids, ...change });

export const deleteMessages = (acct: MailAccount, folder: string, uids: number[]) =>
  post<{ ok: true; movedTo: string | null }>('delete', { imap: server(acct.imap), folder, uids });

export interface OutgoingMail {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  /** The HTML alternative, already sanitised. */
  html?: string;
  inReplyTo?: string;
  references?: string;
  /** The draft this message came from; it goes once the message is sent or saved. */
  draft?: { folder: string; uid: number };
}

const sender = (acct: MailAccount) => (acct.name ? `${acct.name} <${acct.email}>` : acct.email);

export const sendMail = (acct: MailAccount, mail: OutgoingMail) =>
  post<{ messageId: string | null; savedToSent: boolean }>('send', {
    smtp: server(acct.smtp),
    imap: server(acct.imap),
    from: sender(acct),
    ...mail,
  });

/** Files the message under the account's Drafts folder. */
export const saveDraft = (acct: MailAccount, mail: OutgoingMail) =>
  post<{ ok: true; folder: string }>('draft', {
    imap: server(acct.imap),
    from: sender(acct),
    ...mail,
  });
