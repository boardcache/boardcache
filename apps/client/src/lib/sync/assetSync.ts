import { completeUpload, requestUploadUrl } from './syncApi';
import { apiFetch, apiUrl, syncRequestAuth } from './apiBase';
import {
  getAssetBlob,
  getRawAssetRecord,
  hasAsset,
  putAsset,
  putLockedAssetRecord,
  sha256Hex,
} from '../board/assetStore';
import {
  decryptBytes,
  encryptBytes,
  packAsset,
  serverAssetId,
  unpackAsset,
} from '@boardcache/e2ee';
import { SyncError } from './syncApi';
import { requireAdk, requireAssetIdKey } from '../../state/syncStore';
import { syncAssetLimitBytes } from '../limits';

/**
 * End-to-end-encrypted, content-addressed asset transport. Assets are immutable
 * so syncing has no conflicts: push what the server lacks, pull what we lack.
 * Bytes are AES-GCM encrypted with the account data key before upload. Locally
 * an asset is its plaintext hash; on the server it goes by a name only this
 * account can compute (serverIdFor), so the server never learns the hash.
 */

// Names are deterministic per account key; remembered so a board's worth of
// hashes costs one HMAC each, and forgotten with the key on sign-out.
const names = new WeakMap<CryptoKey, Map<string, string>>();

/** The name an asset (by plaintext hash) goes by on the server for this account. */
export async function serverIdFor(hash: string): Promise<string> {
  const key = requireAssetIdKey();
  let map = names.get(key);
  if (!map) {
    map = new Map();
    names.set(key, map);
  }
  let id = map.get(hash);
  if (!id) {
    id = await serverAssetId(key, hash);
    map.set(hash, id);
  }
  return id;
}

/** Ask the server which of these hashes it doesn't have for this account. */
export async function missingOnServer(hashes: string[]): Promise<string[]> {
  if (hashes.length === 0) return [];
  const byId = new Map<string, string>();
  for (const hash of hashes) byId.set(await serverIdFor(hash), hash);
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

/** Encrypt and upload one local asset, saying why when it can't. */
const LOCKED_MIME_PREFIX = 'application/x-boardcache-locked;board=';

async function pushAsset(
  hash: string,
  onProgress?: (fraction: number) => void,
): Promise<PushOutcome> {
  const record = await getRawAssetRecord(hash);
  if (!record) return 'absent';
  // A doomed upload (over the server's per-asset cap) is skipped instead of
  // burning bandwidth on a guaranteed 413; pushBoard reports the specifics.
  if (record.blob.size > syncAssetLimitBytes()) return 'oversize';
  let mime: string;
  let bytes: Uint8Array<ArrayBuffer>;
  if (record.lock) {
    // A locked board's asset ships as its lock-ciphertext — the password
    // layer survives transport; the marker mime restores it as locked.
    mime = `${LOCKED_MIME_PREFIX}${record.lock.boardId}`;
    bytes = new Uint8Array(await record.blob.arrayBuffer());
  } else {
    const blob = await getAssetBlob(hash);
    if (!blob) return 'absent';
    mime = blob.type || 'application/octet-stream';
    bytes = new Uint8Array(await blob.arrayBuffer());
  }
  const packed = packAsset(mime, bytes);
  const ciphertext = await encryptBytes(requireAdk(), packed);
  const id = await serverIdFor(hash);
  // Direct-to-bucket when the server offers it (bypasses the API and any
  // proxy body cap in front of it); otherwise the API PUT as before.
  try {
    const direct = await requestUploadUrl(id, ciphertext.byteLength);
    if (direct) {
      const stored = await putBinary(direct.url, ciphertext, onProgress, {
        headers: direct.headers,
      });
      if (stored && (await completeUpload(id))) return 'ok';
    }
  } catch (e) {
    lastAssetPushError = e instanceof Error ? e.message : null;
    if (lastAssetPushError) return 'failed'; // quota / size refusals are final
  }
  return (await putBinary(apiUrl(`/api/assets/${id}`), ciphertext, onProgress)) ? 'ok' : 'failed';
}

/** Download, decrypt, verify, and store one asset. No-op if already present. */
export async function pullAsset(hash: string): Promise<boolean> {
  if (await hasAsset(hash)) return true;
  const res = await apiFetch(`/api/assets/${await serverIdFor(hash)}`);
  if (!res.ok) return false;
  const packed = await decryptBytes(requireAdk(), new Uint8Array(await res.arrayBuffer()));
  const { mime, bytes } = unpackAsset(packed);
  if (mime.startsWith(LOCKED_MIME_PREFIX)) {
    const boardId = mime.slice(LOCKED_MIME_PREFIX.length);
    await putLockedAssetRecord(hash, new Blob([bytes as BlobPart]), boardId);
    return true;
  }
  const blob = new Blob([bytes], { type: mime });
  // Integrity: the decrypted plaintext must hash to the id we asked for.
  if ((await sha256Hex(blob)) !== hash) return false;
  return (await putAsset(blob)) === hash;
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
 * Push every asset the server is missing, and report what happened to the
 * ones it still lacks. `onProgress` reports overall fraction across all
 * uploads (0..1).
 */
export async function pushAssets(
  hashes: string[],
  onProgress?: (fraction: number) => void,
): Promise<PushReport> {
  const missing = await missingOnServer(hashes);
  const report: PushReport = { pushed: 0, absent: [], oversize: [], failed: [] };
  for (let i = 0; i < missing.length; i++) {
    const hash = missing[i]!;
    const outcome = await pushAsset(hash, (f) => onProgress?.((i + f) / missing.length));
    if (outcome === 'ok') report.pushed += 1;
    else report[outcome].push(hash);
  }
  return report;
}

/** Pull every asset not present locally. Returns how many were downloaded. */
export async function pullAssets(
  hashes: string[],
  onProgress?: (fraction: number) => void,
): Promise<number> {
  let pulled = 0;
  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i]!;
    if (!(await hasAsset(hash))) {
      if (await pullAsset(hash)) pulled += 1;
    }
    // Already-local assets count too — the bar tracks the whole board.
    onProgress?.((i + 1) / hashes.length);
  }
  return pulled;
}
