import { create } from 'zustand';
import {
  decryptBytes,
  deriveKeys,
  encryptBytes,
  fromBase64,
  randomSalt,
  toBase64,
  unwrapAdk,
  CURRENT_KDF,
} from '@boardcache/e2ee';
import type { Kdf } from '@boardcache/e2ee';
import { loadAdkWrap } from './sync/keyStore';
import { useSyncStore } from '../state/syncStore';

/**
 * The lock screen: a password gate over the whole app. Signed in, the
 * account password opens it (checked offline by unwrapping the stored data
 * key; nothing goes to the server). Otherwise a lock password set here, kept
 * on this device as a salted verifier. An account's password takes over the
 * moment it is signed in, and the local one returns after sign-out.
 *
 * Locked state persists, so a reload or a closed tab stays locked.
 */
const KEY = 'boardcache.lockscreen';
const CHECK = 'boardcache-lock';

interface Stored {
  locked?: boolean;
  local?: { salt: string; check: string; kdf?: Kdf };
}

function read(): Stored {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored) ?? {};
  } catch {
    return {};
  }
}
function write(next: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* no storage: the lock lasts this page only */
  }
}

export type LockMethod = 'account' | 'local';

/** Which password opens the lock right now, or null when none is set. */
export async function lockMethod(): Promise<LockMethod | null> {
  if (useSyncStore.getState().status === 'signedIn' && (await loadAdkWrap())) return 'account';
  return read().local ? 'local' : null;
}

/** Set (or replace) the device's own lock password. */
export async function setLocalLockPassword(password: string): Promise<void> {
  const salt = randomSalt();
  const { encKey } = await deriveKeys(password, salt, CURRENT_KDF);
  const check = toBase64(await encryptBytes(encKey, new TextEncoder().encode(CHECK)));
  write({ ...read(), local: { salt, check, kdf: CURRENT_KDF } });
}

async function verify(password: string): Promise<boolean> {
  const method = await lockMethod();
  try {
    if (method === 'account') {
      const wrap = await loadAdkWrap();
      if (!wrap) return false;
      const { encKey } = await deriveKeys(password, wrap.salt, wrap.kdf);
      await unwrapAdk(encKey, wrap.wrappedAdk);
      return true;
    }
    const local = read().local;
    if (!local) return false;
    // Locks set before the version travelled with them were PBKDF2.
    const { encKey } = await deriveKeys(password, local.salt, local.kdf ?? 'pbkdf2-v1');
    const plain = await decryptBytes(encKey, fromBase64(local.check));
    return new TextDecoder().decode(plain) === CHECK;
  } catch {
    return false; // GCM refused the key: wrong password
  }
}

interface LockScreenState {
  locked: boolean;
  /** The "set a lock password" dialog, shown when locking with none set. */
  setupOpen: boolean;
  /** Lock now, or ask for a password first when none is set. */
  requestLock: () => Promise<void>;
  lock: () => void;
  unlock: (password: string) => Promise<boolean>;
  /** The device's own check passed (Face ID / Touch ID in the iOS shell). */
  unlockByDevice: () => void;
  setSetupOpen: (open: boolean) => void;
}

export const useLockScreenStore = create<LockScreenState>((set) => ({
  locked: read().locked === true,
  setupOpen: false,
  requestLock: async () => {
    if (await lockMethod()) {
      write({ ...read(), locked: true });
      set({ locked: true });
    } else set({ setupOpen: true });
  },
  lock: () => {
    write({ ...read(), locked: true });
    set({ locked: true });
  },
  unlock: async (password) => {
    if (!(await verify(password))) return false;
    write({ ...read(), locked: false });
    set({ locked: false });
    return true;
  },
  unlockByDevice: () => {
    write({ ...read(), locked: false });
    set({ locked: false });
  },
  setSetupOpen: (setupOpen) => set({ setupOpen }),
}));
