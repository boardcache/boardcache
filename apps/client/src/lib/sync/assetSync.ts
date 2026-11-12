import { completeUpload, requestUploadUrl } from './syncApi';
import { apiFetch, apiUrl, syncRequestAuth } from './apiBase';
import {
  getAssetBlob,
  getRawAssetRecord,
  hasAsset,
  putLockedRecord,
  putPulledAsset,
  sha256Hex,
} from '../board/assetStore';
import { clearReplacement, queuedReplacements, replacementKey } from '../board/assetReplaceQueue';
import {
  decryptBytes,
  encryptBytes,
  packAsset,
  serverAssetId,
  unpackAsset,
} from '@boardcache/e2ee';
import { SyncError } from './syncApi';
import { requireAdk, requireAssetIdKey, useSyncStore } from '../../state/syncStore';
import { syncAssetLimitBytes } from '../limits';

/**
 * End-to-end-encrypted media transport, per board. A board's media is
 * immutable content under its hash, so syncing has no conflicts: push what
 * the server lacks for the board, pull what this device lacks. Bytes are
 * AES-GCM encrypted with the account data key before upload. Locally an
 * asset is its plaintext hash under its board; on the server it goes by a
 * name only this account can compute from the board id and the hash
 * (serverIdFor), so the server never learns the hash and one board's media
 * is never another's.
 */

// Names are deterministic per account key; remembered so a board's worth of
// hashes costs one HMAC each, and forgotten with the key on sign-out.
const names = new WeakMap<CryptoKey, Map<string, string>>();

async function remembered(key: CryptoKey, text: string, make: () => Promise<string>) {
  let map = names.get(key);
  if (!map) {
    map = new Map();
    names.set(key, map);
  }
  let id = map.get(text);
  if (!id) {
    id = await make();
    map.set(text, id);
  }
  return id;
}

/** The name a board's asset (by plaintext hash) goes by on the server for this account. */
export async function serverIdFor(board: string, hash: string): Promise<string> {
  const key = requireAssetIdKey();
  return remembered(key, `${board}/${hash}`, () => serverAssetId(key, hash, board));
}

/** The per-account name an asset went by before names were per board. */
async function legacyServerIdFor(hash: string): Promise<string> {
  const key = requireAssetIdKey();
  return remembered(key, hash, () => serverAssetId(key, hash));
}

/** Ask the server which of a board's hashes it doesn't have for this account. */
export async function missingOnServer(board: string, hashes: string[]): Promise<string[]> {
  if (hashes.length === 0) return [];
  const byId = new Map<string, string>();
  for (const hash of hashes) byId.set(await serverIdFor(board, hash), hash);
  let res: Response;
  try {
    res = await apiFetch('/api/assets/missing', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: [...byId.keys()] }),
    });
  } catch {
    throw new SyncError("Can't reach the sync server.");
  }
  if (!res.ok) throw new SyncError('Could not check assets on the server.');
  const data = (await res.json()) as { missing?: string[] };
  return (data.missing ?? []).map((id) => byId.get(id) ?? id);
}

/** The server's reason for the most recent failed asset upload (quota
 *  messages are user-worthy; pushBoard folds this into its sync error). */
export let lastAssetPushError: string | null = null;
/** HTTP status of the last rejected upload (0 = the request never completed). */
export let lastAssetPushStatus: number | null = null;

type PushOutcome = 'ok' | 'absent' | 'oversize' | 'failed';

/** PUT with upload-progress (fetch can't report it, XHR can). `direct` is a
 *  presigned bucket URL: no cookies, only the headers the signature covers.
 *  Otherwise it is a sync-server request and carries that server's auth —
 *  the bearer token for token clients (desktop, foreign-hosted), cookies
 *  where those work. */
async function putBinary(
  url: string,
  body: Uint8Array<ArrayBuffer>,
  onProgress?: (fraction: number) => void,
  direct?: { headers: Record<string, string> },
): Promise<boolean> {
  const auth = direct ? null : await syncRequestAuth();
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.withCredentials = auth?.withCredentials ?? false;
    if (direct) for (const [k, v] of Object.entries(direct.headers)) xhr.setRequestHeader(k, v);
    else {
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      for (const [k, v] of Object.entries(auth?.headers ?? {})) xhr.setRequestHeader(k, v);
    }
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (!ok) {
        lastAssetPushStatus = xhr.status;
        try {
          const parsed = JSON.parse(xhr.responseText) as { error?: string };
          lastAssetPushError = parsed.error ?? null;
        } catch {
          lastAssetPushError = null;
        }
      } else {
        lastAssetPushError = null;
        lastAssetPushStatus = null;
      }
      resolve(ok);
    };
    xhr.onerror = () => {
      lastAssetPushStatus = 0;
      lastAssetPushError = null;
      resolve(false);
    };
    xhr.send(body);
  });
}

/** Marks a sealed record in transit: the lock's layer travels as it is. The
 *  earlier form carried the board id after a semicolon; a prefix match
 *  reads both. */
const LOCKED_MIME_PREFIX = 'application/x-boardcache-locked';

/** Encrypt and upload one of a board's assets, saying why when it can't. */
async function pushAsset(
  board: string,
  hash: string,
  onProgress?: (fraction: number) => void,
  replace = false,
): Promise<PushOutcome> {
  const record = await getRawAssetRecord(board, hash);
  if (!record) return 'absent';
  // A doomed upload (over the server's per-asset cap) is skipped instead of
  // burning bandwidth on a guaranteed 413; pushBoard reports the specifics.
  if (record.blob.size > syncAssetLimitBytes()) return 'oversize';
  let mime: string;
  let bytes: Uint8Array<ArrayBuffer>;
  if (record.locked) {
    // A locked board's asset ships as its lock-ciphertext — the password
    // layer survives transport; the marker mime restores it as sealed.
    mime = LOCKED_MIME_PREFIX;
    bytes = new Uint8Array(await record.blob.arrayBuffer());
  } else {
    const blob = await getAssetBlob(hash, board);
    if (!blob) return 'absent';
    mime = blob.type || 'application/octet-stream';
    bytes = new Uint8Array(await blob.arrayBuffer());
  }
  const packed = packAsset(mime, bytes);
  const ciphertext = await encryptBytes(requireAdk(), packed);
  const id = await serverIdFor(board, hash);
  // Direct-to-bucket when the server offers it (bypasses the API and any
  // proxy body cap in front of it); otherwise the API PUT as before.
  try {
    const direct = await requestUploadUrl(id, ciphertext.byteLength, board);
    if (direct) {
      const stored = await putBinary(direct.url, ciphertext, onProgress, {
        headers: direct.headers,
      });
      if (stored && (await completeUpload(id, board))) return 'ok';
    }
  } catch (e) {
    lastAssetPushError = e instanceof Error ? e.message : null;
    if (lastAssetPushError) return 'failed'; // quota / size refusals are final
  }
  const query = new URLSearchParams({ board, ...(replace ? { replace: '1' } : {}) });
  const url = apiUrl(`/api/assets/${id}?${query}`);
  return (await putBinary(url, ciphertext, onProgress)) ? 'ok' : 'failed';
}

async function fetchWithPatience(url: string): Promise<Response> {
  let res = await apiFetch(url);
  // The server meters asset reads per address; a 429 asks for a pause, not
  // for giving the asset up until the next sync.
  for (let wait = 1000; res.status === 429 && wait <= 4000; wait *= 2) {
    await new Promise((r) => setTimeout(r, wait));
    res = await apiFetch(url);
  }
  return res;
}

/**
 * Download, decrypt, verify, and store one of a board's assets. No-op if the
 * board already has it — unless `replace`: the record here cannot be read,
 * and the server's copy is written over it. An object still under its
 * per-account name from before names were per board is taken from there and
 * moved to the board's name on the server, so the next lookup is direct.
 */
export async function pullAsset(
  board: string,
  hash: string,
  { replace = false } = {},
): Promise<boolean> {
  if (!replace && (await hasAsset(hash, board))) return true;
  const id = await serverIdFor(board, hash);
  let res = await fetchWithPatience(`/api/assets/${id}`);
  if (res.status === 404) {
    const legacy = await legacyServerIdFor(hash);
    res = await fetchWithPatience(`/api/assets/${legacy}`);
    if (res.ok) {
      void apiFetch('/api/assets/relabel', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairs: [{ from: legacy, to: id, board }] }),
      }).catch(() => undefined);
    }
  }
  if (!res.ok) return false;
  const packed = await decryptBytes(requireAdk(), new Uint8Array(await res.arrayBuffer()));
  const { mime, bytes } = unpackAsset(packed);
  if (mime.startsWith(LOCKED_MIME_PREFIX)) {
    await putLockedRecord(board, hash, new Blob([bytes as BlobPart]), { replace });
    return true;
  }
  const blob = new Blob([bytes], { type: mime });
  // Integrity: the decrypted plaintext must hash to the id we asked for.
  if ((await sha256Hex(blob)) !== hash) return false;
  return (await putPulledAsset(board, blob)) === hash;
}

export interface PushReport {
  pushed: number;
  /** Not stored on this device — only another device can upload these. */
  absent: string[];
  /** Over the per-asset sync limit. */
  oversize: string[];
  /** Attempted and refused (quota, size, network). */
  failed: string[];
}

/**
 * Push every asset of a board the server is missing, and report what
 * happened to the ones it still lacks. `onProgress` reports overall fraction
 * across all uploads (0..1).
 */
export async function pushAssets(
  board: string,
  hashes: string[],
  onProgress?: (fraction: number) => void,
): Promise<PushReport> {
  // Besides what the server lacks: what it holds in a form this device has
  // since changed (a lock's layer added or taken off), written again in place.
  const replace = await queuedReplacements();
  const missing = new Set(await missingOnServer(board, hashes));
  const queued = (h: string) => replace.has(replacementKey(board, h));
  const send = [...new Set(hashes)].filter((h) => missing.has(h) || queued(h));
  const report: PushReport = { pushed: 0, absent: [], oversize: [], failed: [] };
  for (let i = 0; i < send.length; i++) {
    const hash = send[i]!;
    const again = queued(hash) && !missing.has(hash);
    const outcome = await pushAsset(board, hash, (f) => onProgress?.((i + f) / send.length), again);
    if (outcome === 'ok') {
      report.pushed += 1;
      if (queued(hash)) await clearReplacement(board, hash);
    } else if (again) {
      if (outcome === 'absent') await clearReplacement(board, hash); // nothing here to write
    } else report[outcome].push(hash);
  }
  return report;
}

/** Write every queued replacement whose bytes this device holds, now (signed
 *  in only; otherwise the queue waits for the next sync). */
export async function flushAssetReplacements(): Promise<void> {
  if (useSyncStore.getState().status !== 'signedIn') return;
  const byBoard = new Map<string, string[]>();
  for (const key of await queuedReplacements()) {
    const slash = key.indexOf('/');
    const board = key.slice(0, slash);
    byBoard.set(board, [...(byBoard.get(board) ?? []), key.slice(slash + 1)]);
  }
  for (const [board, hashes] of byBoard) await pushAssets(board, hashes);
}

/** Pull every asset of a board not present locally. Returns how many were downloaded. */
export async function pullAssets(
  board: string,
  hashes: string[],
  onProgress?: (fraction: number) => void,
): Promise<number> {
  let pulled = 0;
  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i]!;
    if (!(await hasAsset(hash, board))) {
      if (await pullAsset(board, hash)) pulled += 1;
    }
    // Already-local assets count too — the bar tracks the whole board.
    onProgress?.((i + 1) / hashes.length);
  }
  return pulled;
}
