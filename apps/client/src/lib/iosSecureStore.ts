import { isNativeShell } from './mobile';

/**
 * The iOS shell's Keychain-backed session token store, in the shape
 * lib/sync/apiBase expects (the desktop shell supplies the same through
 * Electron's safeStorage). Kept in its own import-free module: apiBase is
 * part of the viewer's single-file build, which cannot split code.
 */
interface SecureStorePlugin {
  get(): Promise<{ token: string | null; id: string | null }>;
  set(o: { token: string; id: string | null }): Promise<{ ok: boolean }>;
  clear(): Promise<{ ok: boolean }>;
}

/** The Keychain-backed token store, in the shape apiBase expects, or null outside the shell. */
export function iosSecureTokenStore(): {
  get: () => Promise<{ token: string; id: string | null } | null>;
  set: (token: string, id: string | null) => Promise<boolean>;
  clear: () => Promise<boolean>;
} | null {
  if (!isNativeShell()) return null;
  const store = (window as { Capacitor?: { Plugins?: { SecureStore?: SecureStorePlugin } } })
    .Capacitor?.Plugins?.SecureStore;
  if (!store) return null;
  return {
    get: async () => {
      const r = await store.get();
      return r.token ? { token: r.token, id: r.id } : null;
    },
    set: async (token, id) => (await store.set({ token, id })).ok,
    clear: async () => (await store.clear()).ok,
  };
}
