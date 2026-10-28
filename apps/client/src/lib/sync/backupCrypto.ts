import { argon2idRaw } from '@boardcache/e2ee';

/**
 * Passphrase encryption for backup/share containers: an 8-byte magic +
 * salt(16) + iv(12) + AES-256-GCM ciphertext. Used by library backups,
 * single-board exports, and public share snapshots (where the "passphrase"
 * is either a random link secret or a viewer password).
 *
 * 'BCBKENC2' derives the key with Argon2id at the account parameters
 * (64 MiB, 3 passes), so a human-chosen password costs a guesser as much
 * here as at sign-in. 'BCBKENC1' (PBKDF2-SHA256, 310k) is what older files
 * carry; they still open, and anything written now is ENC2.
 */

const MAGIC_V2 = new TextEncoder().encode('BCBKENC2'); // Argon2id
const MAGIC_V1 = new TextEncoder().encode('BCBKENC1'); // PBKDF2 (read only)
const PBKDF2_ITERS = 310_000;

async function aesKey(raw: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function deriveKeyV2(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  return aesKey(await argon2idRaw(passphrase, salt));
}

async function deriveKeyV1(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
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

const hasMagic = (head: Uint8Array, magic: Uint8Array) =>
  head.length >= 8 && magic.every((b, i) => head[i] === b);

/** Encrypt a backup zip: magic + salt(16) + iv(12) + AES-GCM ciphertext. */
export async function encryptBackup(blob: Blob, passphrase: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyV2(passphrase, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    await blob.arrayBuffer(),
  );
  return new Blob([MAGIC_V2 as BlobPart, salt as BlobPart, iv as BlobPart, cipher], {
    type: 'application/octet-stream',
  });
}

/** True if the blob is a passphrase-encrypted backup container. */
export async function isEncryptedBackup(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  return hasMagic(head, MAGIC_V2) || hasMagic(head, MAGIC_V1);
}

/** Decrypt an encrypted backup; throws on a wrong passphrase (GCM auth). */
export async function decryptBackup(blob: Blob, passphrase: string): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const salt = bytes.slice(8, 24);
  const iv = bytes.slice(24, 36);
  const key = hasMagic(bytes, MAGIC_V1)
    ? await deriveKeyV1(passphrase, salt)
    : await deriveKeyV2(passphrase, salt);
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
