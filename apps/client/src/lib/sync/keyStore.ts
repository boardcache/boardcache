import type { Kdf } from '@boardcache/e2ee';
import { getDb } from '../db';

/**
 * Local persistence of the unwrapped account data key. It's stored as a
 * non-extractable CryptoKey, so reloads stay unlocked without re-entering the
 * password, yet the raw key bytes can't be exfiltrated. (Local boards are
 * already plaintext in IndexedDB — the ADK protects data on the *server*.)
 *
 * Beside it, the wrapped form with its KDF parameters: the lock screen checks
 * the account password offline by re-deriving the key and unwrapping this.
 * It reveals nothing the server doesn't already hold. (The `keys` store is
 * typed for CryptoKeys, so the wrap sits in `meta`.)
 */
const ADK = 'adk';
const AID = 'assetIdKey';
const PUSH = 'pushKey';
const WRAP = 'adkWrap';
const LAST_USER = 'lastUser';

export interface AdkWrap {
  kdf: Kdf;
  salt: string;
  wrappedAdk: string;
}

export async function saveAdk(adk: CryptoKey): Promise<void> {
  await (await getDb()).put('keys', adk, ADK);
}

export async function loadAdk(): Promise<CryptoKey | null> {
  return (await (await getDb()).get('keys', ADK)) ?? null;
}

/** The HMAC key that names this account's assets on the server; derived from
 *  the ADK at unwrap time, so a device signed in before it existed has none
 *  and signs in again once. */
export async function saveAssetIdKey(key: CryptoKey): Promise<void> {
  await (await getDb()).put('keys', key, AID);
}

export async function loadAssetIdKey(): Promise<CryptoKey | null> {
  return (await (await getDb()).get('keys', AID)) ?? null;
}

/** The key reminders are sealed under for push (derived from the ADK at
 *  unwrap time; the service worker reads it from the same store). A device
 *  signed in before it existed has none until it signs in again. */
export async function savePushKey(key: CryptoKey): Promise<void> {
  await (await getDb()).put('keys', key, PUSH);
}

export async function loadPushKey(): Promise<CryptoKey | null> {
  return (await (await getDb()).get('keys', PUSH)) ?? null;
}

export async function saveAdkWrap(wrap: AdkWrap): Promise<void> {
  await (await getDb()).put('meta', wrap, WRAP);
}

export async function loadAdkWrap(): Promise<AdkWrap | null> {
  const raw = (await (await getDb()).get('meta', WRAP)) as AdkWrap | undefined;
  return raw && typeof raw === 'object' && typeof raw.wrappedAdk === 'string' ? raw : null;
}

/** The account this device signed in to last, so a lapsed session can say
 *  whose it was and offer the name back on the sign-in form. */
export async function saveLastUser(username: string): Promise<void> {
  await (await getDb()).put('meta', username, LAST_USER);
}

export async function loadLastUser(): Promise<string | null> {
  const raw = await (await getDb()).get('meta', LAST_USER);
  return typeof raw === 'string' && raw ? raw : null;
}

export async function clearAdk(): Promise<void> {
  const db = await getDb();
  await db.delete('keys', ADK);
  await db.delete('keys', AID);
  await db.delete('keys', PUSH);
  await db.delete('meta', WRAP);
  await db.delete('meta', LAST_USER);
}
