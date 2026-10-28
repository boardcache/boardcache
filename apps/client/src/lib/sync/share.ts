import type { CanvasDocument } from '@boardcache/schema';
import { collectAssetIds } from '@boardcache/schema';
import { hasSyncServer } from './apiBase';
import { platform } from '../platform';
import { getAssetBlob } from '../board/assetStore';
import { contentBounds, renderRegion } from '../media/thumbnail';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Share links: a read-only snapshot of the board on the sync server, open
 * to anyone with the link at <view host>/s/<id>. The snapshot is plaintext,
 * like a Community publication: the server stores the document and each
 * asset by its hash, so the viewer paints at once, fetches assets as they
 * come into view, and the edge can cache them. A password, when set, is
 * checked by the server on every visit (nothing a visitor can download lets
 * them guess offline).
 *
 * Publishing: PUT the document (the server answers with the assets it lacks),
 * upload those one by one, then the card image. A republish moves only what
 * changed.
 */

export interface ShareRecord {
  shareId: string;
  hasPassword: boolean;
  sharedAt: string;
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
  const record = loadRecords()[boardId];
  // Records from the encrypted era carried the key; those shares are gone
  // from the server (the table was remade), so the board shares afresh.
  if (!record || 'secret' in record || 'wrappedSecret' in record) return null;
  return record;
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

/** The share's link. Shares render on the view host when the server names
 *  one (an origin with no session and no local boards); else here. */
export function shareLink(record: ShareRecord, viewUrl = ''): string {
  return `${viewUrl || location.origin}/s/${record.shareId}`;
}

async function failure(res: Response, what: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `${what} failed (${res.status}).`);
}

/**
 * Publish the document under the share id. `password`: a string sets one
 * (empty removes it); undefined keeps whatever the share has.
 */
async function publish(
  shareId: string,
  doc: CanvasDocument,
  password?: string,
): Promise<{ hasPassword: boolean }> {
  const res = await platform.sharePut(shareId, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      boardId: doc.id,
      title: doc.name,
      doc,
      ...(password === undefined ? {} : { password }),
    }),
  });
  if (!res.ok) throw await failure(res, 'Share upload');
  const { missing, hasPassword } = (await res.json()) as {
    missing: string[];
    hasPassword: boolean;
  };
  // Only what the server lacks travels; a republish is usually the document alone.
  const referenced = new Set(collectAssetIds(doc));
  for (const hash of missing) {
    if (!referenced.has(hash)) continue;
    const blob = await getAssetBlob(hash);
    if (!blob) continue; // absent locally: the viewer shows the item without its media
    const put = await platform.shareAssetPut(shareId, hash, blob);
    if (!put.ok) throw await failure(put, 'Asset upload');
  }
  await uploadCover(shareId, doc);
  return { hasPassword };
}

/** The card image for the link: the whole board, rendered light. */
async function uploadCover(shareId: string, doc: CanvasDocument): Promise<void> {
  try {
    const bounds = contentBounds(doc);
    if (!bounds) return;
    const background = doc.settings.background !== 'default' ? doc.settings.background : '#fafafa';
    const image = await renderRegion(doc, bounds, 1280, 800, background);
    await platform.shareCoverPut(shareId, image);
  } catch {
    /* the link works without a card */
  }
}

/** Create a share for the open board. An empty password means none. */
export async function createShare(password: string): Promise<ShareRecord> {
  const { doc } = useDocumentStore.getState();
  const shareId = randomToken(9); // 12 url-safe chars
  const { hasPassword } = await publish(shareId, doc, password.trim());
  const record: ShareRecord = { shareId, hasPassword, sharedAt: new Date().toISOString() };
  setShareRecord(doc.id, record);
  return record;
}

/** Republish the current board state under the existing share id. */
export async function updateShare(record: ShareRecord): Promise<ShareRecord> {
  const { doc } = useDocumentStore.getState();
  const { hasPassword } = await publish(record.shareId, doc);
  const next = { ...record, hasPassword, sharedAt: new Date().toISOString() };
  setShareRecord(doc.id, next);
  return next;
}

/**
 * Silent republish on board close. Failures are non-fatal; closing must
 * never block on this.
 */
export async function autoUpdateShare(doc: CanvasDocument): Promise<void> {
  const record = getShareRecord(doc.id);
  if (!record || !hasSyncServer()) return;
  // Already uploaded this doc version (ISO timestamps compare lexically). A
  // failed upload leaves sharedAt behind updatedAt, so it retries next close.
  if (record.sharedAt && record.sharedAt >= doc.updatedAt) return;
  try {
    await publish(record.shareId, doc);
    setShareRecord(doc.id, { ...record, sharedAt: new Date().toISOString() });
  } catch (err) {
    console.warn('boardCache: share auto-update failed', err);
  }
}

export async function removeShare(boardId: string, record: ShareRecord): Promise<void> {
  const res = await platform.shareDelete(record.shareId);
  if (!res.ok && res.status !== 404) throw await failure(res, 'Could not stop sharing');
  setShareRecord(boardId, null);
}
