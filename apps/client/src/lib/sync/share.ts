import type { CanvasDocument } from '@boardcache/schema';
import { hasSyncServer } from './apiBase';
import { encryptBackup } from './backupCrypto';
import { decryptBytes, encryptBytes, fromBase64, toBase64 } from '@boardcache/e2ee';
import { loadAdk } from './keyStore';
import { platform } from '../platform';
import { exportBoardFile } from '../board/boardcacheFile';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Public board shares: an encrypted snapshot of the board uploaded to the
 * sync server, viewable read-only by anyone with the link at /s/<id>.
 *
 * Zero-knowledge either way:
 *  - link-only shares encrypt with a random secret that rides in the URL
 *    fragment (#...), which browsers never send to the server;
 *  - password shares encrypt with the password itself — nothing usable is in
 *    the link, and the viewer page derives the key locally (PBKDF2).
 */

export interface ShareRecord {
  shareId: string;
  /** Link-mode decryption secret; absent for password shares. */
  secret?: string;
  /**
   * Password-mode secret wrapped with the account data key (base64
   * iv+ciphertext). Lets this signed-in device republish the share on board
   * close without ever storing the password readably; useless without the
   * account.
   */
  wrappedSecret?: string;
  hasPassword: boolean;
  sharedAt: string;
}

async function wrapSecret(secret: string): Promise<string | null> {
  const adk = await loadAdk();
  if (!adk) return null;
  return toBase64(await encryptBytes(adk, new TextEncoder().encode(secret)));
}

async function unwrapSecret(wrapped: string): Promise<string | null> {
  const adk = await loadAdk();
  if (!adk) return null;
  try {
    return new TextDecoder().decode(await decryptBytes(adk, fromBase64(wrapped)));
  } catch {
    return null; // different account than the one that wrapped it
  }
}

const SHARES_KEY = 'boardcache:shares';

function loadRecords(): Record<string, ShareRecord> {
  try {
    return JSON.parse(localStorage.getItem(SHARES_KEY) ?? '{}') as Record<string, ShareRecord>;
  } catch {
    return {};
  }
}

function saveRecords(records: Record<string, ShareRecord>): void {
  localStorage.setItem(SHARES_KEY, JSON.stringify(records));
}

export function getShareRecord(boardId: string): ShareRecord | null {
  return loadRecords()[boardId] ?? null;
}

function setShareRecord(boardId: string, record: ShareRecord | null): void {
  const records = loadRecords();
  if (record) records[boardId] = record;
  else delete records[boardId];
  saveRecords(records);
}

function randomToken(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function shareLink(record: ShareRecord): string {
  const base = `${location.origin}/s/${record.shareId}`;
  return record.hasPassword ? base : `${base}#${record.secret ?? ''}`;
}

async function upload(
  shareId: string,
  doc: CanvasDocument,
  passphrase: string,
  hasPassword: boolean,
) {
  const snapshot = await exportBoardFile(doc);
  const encrypted = await encryptBackup(snapshot, passphrase);
  const res = await platform.sharePut(shareId, {
    credentials: 'include',
    headers: {
      'content-type': 'application/octet-stream',
      'x-board-id': doc.id,
      'x-has-password': hasPassword ? '1' : '0',
    },
    body: encrypted,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Share upload failed (${res.status}).`);
  }
}

/** Create a share for the open board. Empty password → link-secret mode. */
export async function createShare(password: string): Promise<ShareRecord> {
  const { doc } = useDocumentStore.getState();
  const shareId = randomToken(9); // 12 url-safe chars
  const hasPassword = password.trim().length > 0;
  const secret = hasPassword ? password.trim() : randomToken(16);
  await upload(shareId, doc, secret, hasPassword);
  const wrapped = hasPassword ? await wrapSecret(secret) : null;
  const record: ShareRecord = {
    shareId,
    hasPassword,
    sharedAt: new Date().toISOString(),
    ...(hasPassword ? {} : { secret }),
    ...(wrapped ? { wrappedSecret: wrapped } : {}),
  };
  setShareRecord(doc.id, record);
  return record;
}

/**
 * Re-upload the current board state under the existing share id. Password
 * shares need the password again — it is never stored.
 */
export async function updateShare(record: ShareRecord, password?: string): Promise<ShareRecord> {
  const { doc } = useDocumentStore.getState();
  let secret = record.hasPassword ? (password?.trim() ?? '') : (record.secret ?? '');
  if (!secret && record.wrappedSecret) secret = (await unwrapSecret(record.wrappedSecret)) ?? '';
  if (!secret) throw new Error('Enter the share password to update it.');
  await upload(record.shareId, doc, secret, record.hasPassword);
  // A typed password refreshes the wrapped copy (covers pre-wrap records).
  const wrapped =
    record.hasPassword && password?.trim() ? await wrapSecret(secret) : record.wrappedSecret;
  const next = {
    ...record,
    sharedAt: new Date().toISOString(),
    ...(wrapped ? { wrappedSecret: wrapped } : {}),
  };
  setShareRecord(doc.id, next);
  return next;
}

/**
 * Silent republish on board close. Link-mode shares carry their secret
 * locally; password shares carry it wrapped with the account data key, so a
 * signed-in device can republish without ever holding the password readably.
 * Failures are non-fatal; closing must never block on this.
 */
export async function autoUpdateShare(doc: CanvasDocument): Promise<void> {
  const record = getShareRecord(doc.id);
  if (!record || !hasSyncServer()) return;
  // Already uploaded this doc version (ISO timestamps compare lexically) —
  // skip the re-encrypt + upload. A failed upload leaves sharedAt behind
  // updatedAt, so it retries on the next close.
  if (record.sharedAt && record.sharedAt >= doc.updatedAt) return;
  const secret = record.hasPassword
    ? record.wrappedSecret && (await unwrapSecret(record.wrappedSecret))
    : record.secret;
  if (!secret) return;
  try {
    await upload(record.shareId, doc, secret, record.hasPassword);
    setShareRecord(doc.id, { ...record, sharedAt: new Date().toISOString() });
  } catch (err) {
    console.warn('boardCache: share auto-update failed', err);
  }
}

export async function removeShare(boardId: string, record: ShareRecord): Promise<void> {
  const res = await platform.shareDelete(record.shareId);
  if (!res.ok && res.status !== 404) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not stop sharing (${res.status}).`);
  }
  setShareRecord(boardId, null);
}
