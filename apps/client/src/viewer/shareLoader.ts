import { unzip } from 'fflate';
import { parseDocument } from '@boardcache/schema';
import type { CanvasDocument } from '@boardcache/schema';
import { decryptBackup } from '../lib/sync/backupCrypto';
import type { ViewerAssetMeta } from '../lib/viewerMode';

/**
 * Loads a public share into the viewer: fetch the encrypted snapshot, decrypt
 * it locally (link secret or viewer password — the server never has the key),
 * unzip the .boardcache payload, and expose assets as object URLs through the
 * same window globals the offline viewer uses.
 */

interface ShareManifest {
  assets: Record<string, { mime: string; bytes: number }>;
}

export async function fetchShare(id: string): Promise<{ blob: Blob; hasPassword: boolean }> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
  if (res.status === 404) {
    throw new Error('This share link no longer exists — the owner may have stopped sharing.');
  }
  if (!res.ok) throw new Error(`Could not load the shared board (${res.status}).`);
  return { blob: await res.blob(), hasPassword: res.headers.get('x-has-password') === '1' };
}

function unzipAll(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => (err ? reject(err) : resolve(files)));
  });
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Throws 'Wrong passphrase' on a bad secret/password (GCM auth). */
export async function decryptShare(blob: Blob, secret: string): Promise<CanvasDocument> {
  const plain = await decryptBackup(blob, secret);
  const files = await unzipAll(new Uint8Array(await plain.arrayBuffer()));
  const manifestBytes = files['manifest.json'];
  const docBytes = files['document.json'];
  if (!manifestBytes || !docBytes) throw new Error('This share holds no readable board.');
  const manifest = JSON.parse(text(manifestBytes)) as ShareManifest;
  const doc = parseDocument(text(docBytes));

  const assets: Record<string, ViewerAssetMeta> = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.startsWith('assets/')) continue;
    const id = name.slice('assets/'.length);
    const mime = manifest.assets[id]?.mime ?? 'application/octet-stream';
    assets[id] = { url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })), mime };
  }
  window.__BOARD_ASSETS__ = assets;
  window.__BOARD__ = doc;
  return doc;
}
