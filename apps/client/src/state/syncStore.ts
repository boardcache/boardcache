import { breachCount } from '../lib/sync/passwordCheck';
import type { MfaChallenge } from '../lib/sync/syncApi';
import { create } from 'zustand';
import { clearAdk, loadAdk, saveAdk } from '../lib/sync/keyStore';
import { ensureSyncAccount, syncedBoardIds as loadSyncedBoardIds } from '../lib/sync/syncMetaStore';
import { syncApi } from '../lib/sync/syncApi';
import type { Account, Entitlements, Profile } from '../lib/sync/syncApi';
import { SyncError } from '../lib/sync/syncApi';
import { clearPendingInvite } from '../lib/inviteLink';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';
/** Live sync activity, for the status indicator. */
export type SyncActivity = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

const MIN_PASSWORD = 8;

interface SyncState {
  status: AuthStatus;
  account: Account | null;
  /** Profile (display name, email, avatar flag); loaded lazily after sign-in. */
  profile: Profile | null;
  /** Re-fetch the profile (after edits). */
  refreshProfile: () => Promise<void>;
  /** Plan + quotas; loaded with the profile, refreshed after billing. */
  entitlements: Entitlements | null;
  refreshEntitlements: () => Promise<void>;
  /** Unwrapped account data key (encrypts synced content); null when locked/out. */
  adk: CryptoKey | null;
  error: string | null;
  busy: boolean;
  /** Current sync activity (drives the status indicator). */
  activity: SyncActivity;
  setActivity: (activity: SyncActivity) => void;
  /** Fraction (0..1) of a bulk pull in flight — the chip's progress bar. */
  progress: number | null;
  /** Human-readable detail of the current operation (e.g. "Uploading media 45%"). */
  detail: string | null;
  /** When the last successful sync completed (ms epoch), or null. */
  lastSyncedAt: number | null;

  /** Ids of boards opted into cloud sync — drives the per-board sync indicator. */
  syncedBoardIds: string[];
  /** Reload `syncedBoardIds` from local sync metadata. */
  refreshSyncedBoards: () => Promise<void>;

  /** Restore an existing session + locally-persisted key (called on startup). */
  refresh: () => Promise<void>;
  register: (
    username: string,
    password: string,
    details: { email: string; fullName: string; newsletter: boolean; inviteCode?: string },
  ) => Promise<boolean>;
  /** Forgot-password: recovery code → new password → signed in, ADK intact. */
  recover: (username: string, code: string, newPassword: string) => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  /** Set after a correct password on a two-factor account; cleared by loginTotp or cancelMfa. */
  mfa: MfaChallenge | null;
  loginTotp: (code: string) => Promise<boolean>;
  cancelMfa: () => void;
  logout: () => Promise<void>;
  clearError: () => void;
}

const message = (e: unknown): string =>
  e instanceof SyncError ? e.message : 'Something went wrong.';

export const useSyncStore = create<SyncState>((set, get) => ({
  status: 'loading',
  account: null,
  profile: null,
  refreshProfile: async () => {
    try {
      const before = get().profile;
      const profile = await syncApi.profile();
      set({ profile });
      // Just verified: everything that waited on it (sync first) may go.
      if (before && !before.emailVerified && profile.emailVerified) {
        const { startPendingCheckout } = await import('../lib/plans');
        if (!(await startPendingCheckout())) {
          void import('../lib/sync/boardSync').then((m) => m.reconcile());
        }
      }
    } catch {
      /* offline / signed out — keep whatever we had */
    }
  },
  entitlements: null,
  refreshEntitlements: async () => {
    try {
      const e = await syncApi.entitlements();
      // A server without the route (older / self-hosted) answers with
      // something else; only a real plan object may drive the UI.
      if (e && typeof e === 'object' && e.limits) set({ entitlements: e });
    } catch {
      /* same: keep the last known plan */
    }
  },
  adk: null,
  error: null,
  busy: false,
  activity: 'idle',
  progress: null,
  setActivity: (activity) => set({ activity }),
  detail: null,
  lastSyncedAt: null,

  syncedBoardIds: [],
  refreshSyncedBoards: async () => {
    set({ syncedBoardIds: [...(await loadSyncedBoardIds())] });
  },

  refresh: async () => {
    // Signed in only when we have BOTH a valid session and the local key —
    // the key never comes from the server, so a session alone can't decrypt.
    const [account, adk] = await Promise.all([syncApi.me(), loadAdk()]);
    if (account && adk) {
      await ensureSyncAccount(account.id);
      set({ account, adk, status: 'signedIn' });
      void get().refreshProfile();
      void get().refreshEntitlements();
    } else set({ account: null, adk: null, status: 'signedOut' });
    set({ syncedBoardIds: [...(await loadSyncedBoardIds())] });
  },

  register: async (username, password, details) => {
    if (password.length < MIN_PASSWORD) {
      set({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
      return false;
    }
    set({ busy: true, error: null });
    // The password protects the encryption key: a breached one is refused outright.
    if ((await breachCount(password)) > 0) {
      set({
        error: 'That password appears in known data breaches. Choose a different one.',
        busy: false,
      });
      return false;
    }
    try {
      const { account, adk } = await syncApi.register(username, password, details);
      await saveAdk(adk);
      await ensureSyncAccount(account.id);
      clearPendingInvite();
      set({ account, adk, status: 'signedIn', busy: false });
      void get().refreshProfile();
      void get().refreshEntitlements();
      return true;
    } catch (e) {
      set({ error: message(e), busy: false });
      return false;
    }
  },

  recover: async (username, code, newPassword) => {
    if (newPassword.length < MIN_PASSWORD) {
      set({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
      return false;
    }
    set({ busy: true, error: null });
    try {
      const { account, adk } = await syncApi.recoverAccount(username, code, newPassword);
      await saveAdk(adk);
      await ensureSyncAccount(account.id);
      set({ account, adk, status: 'signedIn', busy: false });
      void get().refreshProfile();
      void get().refreshEntitlements();
      return true;
    } catch (e) {
      set({ error: message(e), busy: false });
      return false;
    }
  },

  mfa: null,
  cancelMfa: () => set({ mfa: null, error: null }),
  loginTotp: async (code) => {
    const challenge = get().mfa;
    if (!challenge) return false;
    set({ busy: true, error: null });
    try {
      const { account, adk } = await syncApi.loginTotp(challenge, code);
      await saveAdk(adk);
      await ensureSyncAccount(account.id);
      set({ account, adk, status: 'signedIn', busy: false, mfa: null });
      void get().refreshProfile();
      void get().refreshEntitlements();
      return true;
    } catch (e) {
      set({ error: message(e), busy: false });
      return false;
    }
  },
  login: async (username, password) => {
    set({ busy: true, error: null });
    try {
      const result = await syncApi.login(username, password);
      if ('mfaToken' in result) {
        set({ mfa: result, busy: false });
        return false;
      }
      const { account, adk } = result;
      await saveAdk(adk);
      await ensureSyncAccount(account.id);
      set({ account, adk, status: 'signedIn', busy: false });
      void get().refreshProfile();
      void get().refreshEntitlements();
      return true;
    } catch (e) {
      set({ error: message(e), busy: false });
      return false;
    }
  },

  logout: async () => {
    set({ busy: true });
    try {
      await syncApi.logout();
    } catch {
      /* best-effort; clear locally regardless */
    }
    await clearAdk();
    // Remote stubs are server LISTINGS, not local data — drop them (and the
    // sync pairings) so the index shows only what lives on this device.
    try {
      const { getDb } = await import('../lib/db');
      const db = await getDb();
      const stubIds = new Set<string>();
      for (const r of await db.getAll('boards')) {
        if (r.remote) {
          stubIds.add(r.id);
          await db.delete('boards', r.id);
        }
      }
      // Downloaded boards KEEP their pairing (they show "Paused" and resume
      // on the next sign-in); only the removed stubs lose theirs.
      const { allSyncMeta, deleteSyncMeta } = await import('../lib/sync/syncMetaStore');
      for (const m of await allSyncMeta()) {
        if (stubIds.has(m.id)) await deleteSyncMeta(m.id);
      }
      window.dispatchEvent(new Event('boardcache:library-refresh'));
    } catch {
      /* purge is best-effort */
    }
    set({
      account: null,
      profile: null,
      entitlements: null,
      adk: null,
      status: 'signedOut',
      busy: false,
      error: null,
      activity: 'idle',
      progress: null,
      detail: null,
      lastSyncedAt: null,
    });
    void useSyncStore.getState().refreshSyncedBoards();
  },

  clearError: () => set({ error: null }),
}));

/** The unlocked account data key, or throw if the user isn't signed in. */
export function requireAdk(): CryptoKey {
  const adk = useSyncStore.getState().adk;
  if (!adk) throw new SyncError('Sign in to sync first.');
  return adk;
}
