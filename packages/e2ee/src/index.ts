/**
 * End-to-end encryption primitives (WebCrypto only — works in the browser and
 * in Node 22 for tests). Zero-knowledge key hierarchy:
 *
 *   password + salt --KDF (Argon2id today; PBKDF2 for older accounts)--> master
 *     master --HKDF "auth"--> authKey   (sent to server; it stores scrypt(authKey))
 *     master --HKDF "enc"-->  encKey    (NEVER leaves the client)
 *   ADK = random AES-256 key, encrypts all synced content
 *   wrappedADK = AES-GCM(encKey, ADK)   (stored on the server, useless without encKey)
 *     ADK --HKDF "asset-id"--> assetIdKey  (HMAC key; names assets on the server)
 *
 * The server therefore holds only scrypt(authKey), the salt, the wrapped ADK,
 * and ciphertext — it can never read board content or assets. Assets are
 * named on the server by HMAC(assetIdKey, sha256(plaintext)), so the server
 * learns neither the plaintext hash nor whether two accounts hold one file.
 */

const subtle = crypto.subtle;
const utf8 = new TextEncoder();

/** ArrayBuffer-backed bytes (what WebCrypto / Blob / fetch accept as BufferSource). */
type Bytes = Uint8Array<ArrayBuffer>;

// OWASP-recommended floor for PBKDF2-HMAC-SHA256 (legacy accounts).
const PBKDF2_ITERATIONS = 310_000;

/**
 * Key-derivation versions. New accounts use Argon2id (memory-hard: 64 MiB,
 * 3 passes); accounts created under PBKDF2 keep working and are migrated the
 * next time they sign in with their password. The version travels with the
 * salt (prelogin) so a client always derives the way the account was made.
 */
export type Kdf = 'pbkdf2-v1' | 'argon2id-v1';
export const CURRENT_KDF: Kdf = 'argon2id-v1';
const ARGON2 = { memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32 } as const;

// --- base64 (browser + Node) ------------------------------------------------

function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): Bytes {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomSalt(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

/** Base64 helpers for carrying ciphertext in JSON (e.g. board documents). */
export const toBase64 = (bytes: Bytes): string => toB64(bytes);
export const fromBase64 = (b64: string): Bytes => fromB64(b64);

// --- key derivation ---------------------------------------------------------

export interface DerivedKeys {
  /** Base64; sent to the server as the login secret (it never sees the password). */
  authKey: string;
  /** Wraps/unwraps the ADK; stays on the client. */
  encKey: CryptoKey;
}

async function hkdf(master: ArrayBuffer, info: string, bytes = 32): Promise<Bytes> {
  const key = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const out = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(info) },
    key,
    bytes * 8,
  );
  return new Uint8Array(out);
}

/** Argon2id at the account parameters (64 MiB, 3 passes), 32 bytes out.
 *  Shared by the account keys and the passphrase containers (backups,
 *  shares, board locks), so every human-chosen secret costs the same to guess. */
export async function argon2idRaw(password: string, salt: Uint8Array): Promise<Bytes> {
  const { argon2id } = await import('hash-wasm');
  const out = await argon2id({
    password: utf8.encode(password),
    salt,
    ...ARGON2,
    outputType: 'binary',
  });
  return new Uint8Array(
    out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer,
  );
}

async function masterKey(password: string, saltB64: string, kdf: Kdf): Promise<ArrayBuffer> {
  if (kdf === 'argon2id-v1') {
    const out = await argon2idRaw(password, fromB64(saltB64));
    return out.buffer;
  }
  const base = await subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    256,
  );
}

/** Derive the server-facing authKey and the local encKey from a password.
 *  `kdf` defaults to PBKDF2 for callers that predate versioning (board locks,
 *  recovery codes); accounts pass the version prelogin reports. */
export async function deriveKeys(
  password: string,
  saltB64: string,
  kdf: Kdf = 'pbkdf2-v1',
): Promise<DerivedKeys> {
  const master = await masterKey(password, saltB64, kdf);
  const authKey = toB64(await hkdf(master, 'refboard-auth-v1'));
  const encRaw = await hkdf(master, 'refboard-enc-v1');
  const encKey = await subtle.importKey('raw', encRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { authKey, encKey };
}

// --- AES-GCM helpers (packed as iv|ciphertext) ------------------------------

async function encrypt(key: CryptoKey, plaintext: Bytes): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

async function decrypt(key: CryptoKey, packed: Bytes): Promise<Bytes> {
  const iv = packed.subarray(0, 12);
  const ct = packed.subarray(12);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}

// --- account data key (ADK) -------------------------------------------------

/** A fresh random account data key (extractable so it can be wrapped). */
export function generateAdk(): Promise<CryptoKey> {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapAdk(encKey: CryptoKey, adk: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await subtle.exportKey('raw', adk));
  return toB64(await encrypt(encKey, raw));
}

/**
 * A human-typable recovery code: 128 bits as Crockford base32 in groups of 4
 * (BCRK prefix marks what the string is). Treated exactly like a machine-
 * generated password — deriveKeys() turns it into auth/enc keys.
 */
export function generateRecoveryCode(): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return `BCRK-${out.match(/.{1,4}/g)!.join('-')}`;
}

/** Canonicalize a typed recovery code (case, separators, ambiguous glyphs). */
export function normalizeRecoveryCode(raw: string): string {
  const body = raw
    .toUpperCase()
    .replace(/^BCRK/, '')
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return `BCRK-${body.match(/.{1,4}/g)?.join('-') ?? ''}`;
}

/**
 * Re-encrypt a wrapped ADK under a new encKey (password change). Works on the
 * raw bytes so the in-memory non-extractable ADK never needs exporting.
 */
export async function rewrapAdk(
  oldEncKey: CryptoKey,
  wrappedB64: string,
  newEncKey: CryptoKey,
): Promise<string> {
  const raw = await decrypt(oldEncKey, fromB64(wrappedB64));
  return toB64(await encrypt(newEncKey, raw));
}

/** Unwrap the ADK as a NON-extractable key (its bytes can never be read out again). */
export async function unwrapAdk(encKey: CryptoKey, wrappedB64: string): Promise<CryptoKey> {
  const raw = await decrypt(encKey, fromB64(wrappedB64));
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** The account's keys, both non-extractable: the ADK and the asset-id key
 *  derived from it (HKDF, so nothing new is stored on the server). */
export interface AccountKeys {
  adk: CryptoKey;
  /** HMAC-SHA256 key that names assets on the server (see serverAssetId). */
  assetIdKey: CryptoKey;
}

export async function unwrapKeys(encKey: CryptoKey, wrappedB64: string): Promise<AccountKeys> {
  const raw = await decrypt(encKey, fromB64(wrappedB64));
  const [adk, assetIdKey] = await Promise.all([
    subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']),
    assetIdKeyFromAdkBytes(raw),
  ]);
  return { adk, assetIdKey };
}

/** The asset-id key from the ADK's raw bytes (a client that holds them, like the CLI). */
export async function assetIdKeyFromAdkBytes(raw: Bytes): Promise<CryptoKey> {
  return subtle.importKey(
    'raw',
    await hkdf(raw.buffer as ArrayBuffer, 'boardcache-asset-id-v1'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * The name an asset goes by on the server: HMAC-SHA256 of its plaintext hash
 * under the account's asset-id key, as 64 hex characters (the same shape as
 * a hash, so nothing downstream changes). Deterministic per account, so a
 * device can ask "which of these do you lack" and find what another device
 * uploaded; opaque to the server, which cannot test a guessed file against
 * it or match one account's file with another's.
 */
export async function serverAssetId(assetIdKey: CryptoKey, plaintextHash: string): Promise<string> {
  const mac = new Uint8Array(await subtle.sign('HMAC', assetIdKey, utf8.encode(plaintextHash)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

// --- content encryption (assets, and boards next phase) ---------------------

/** Encrypt arbitrary bytes with the ADK. Returns iv|ciphertext. */
export async function encryptBytes(adk: CryptoKey, plaintext: Bytes): Promise<Bytes> {
  return encrypt(adk, plaintext);
}

export async function decryptBytes(adk: CryptoKey, packed: Bytes): Promise<Bytes> {
  return decrypt(adk, packed);
}

/** Frame a blob's mime + bytes so the type stays encrypted with the content. */
export function packAsset(mime: string, bytes: Bytes): Bytes {
  const m = utf8.encode(mime.slice(0, 255));
  const out = new Uint8Array(1 + m.length + bytes.length);
  out[0] = m.length;
  out.set(m, 1);
  out.set(bytes, 1 + m.length);
  return out;
}

export function unpackAsset(buf: Bytes): { mime: string; bytes: Bytes } {
  const mlen = buf[0]!;
  const mime = new TextDecoder().decode(buf.subarray(1, 1 + mlen));
  return { mime, bytes: buf.subarray(1 + mlen) };
}
