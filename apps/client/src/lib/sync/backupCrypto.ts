/**
 * Passphrase encryption for backup/share containers: 'BCBKENC1' magic +
 * salt(16) + iv(12) + AES-256-GCM ciphertext, key from PBKDF2-SHA256. Used by
 * library backups, single-board exports, and public share snapshots (where
 * the "passphrase" is either a random link secret or a viewer password).
 * Kept dependency-free so the standalone share viewer can bundle it.
 */

const ENC_MAGIC = new TextEncoder().encode('BCBKENC1'); // 8 bytes
const PBKDF2_ITERS = 310_000;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a backup zip: magic + salt(16) + iv(12) + AES-GCM ciphertext. */
export async function encryptBackup(blob: Blob, passphrase: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    await blob.arrayBuffer(),
  );
  return new Blob([ENC_MAGIC as BlobPart, salt as BlobPart, iv as BlobPart, cipher], {
    type: 'application/octet-stream',
  });
}

/** True if the blob is a passphrase-encrypted backup container. */
export async function isEncryptedBackup(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  return head.length === 8 && head.every((b, i) => b === ENC_MAGIC[i]);
}

/** Decrypt an encrypted backup; throws on a wrong passphrase (GCM auth). */
export async function decryptBackup(blob: Blob, passphrase: string): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const salt = bytes.slice(8, 24);
  const iv = bytes.slice(24, 36);
  const key = await deriveKey(passphrase, salt);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      bytes.slice(36) as BufferSource,
    );
    return new Blob([plain], { type: 'application/zip' });
  } catch {
    throw new Error('Wrong passphrase (or the file is corrupted).');
  }
}
