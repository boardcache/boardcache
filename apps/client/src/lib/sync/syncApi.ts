import { crossOriginSync, getAuthToken, getAuthTokenId, setAuthToken, apiFetch } from './apiBase';
import { saveAdkWrap } from './keyStore';
import {
  CURRENT_KDF,
  deriveKeys,
  generateAdk,
  generateRecoveryCode,
  normalizeRecoveryCode,
  randomSalt,
  rewrapAdk,
  type Kdf,
  unwrapKeys,
  wrapAdk,
} from '@boardcache/e2ee';
import type { AccountKeys } from '@boardcache/e2ee';

/**
 * Client for the sync server's auth API. Zero-knowledge: the password never
 * leaves the device. We derive an authKey (sent for login) and an encKey (kept
 * local) from it; a random account data key (ADK) encrypts all synced content
 * and is uploaded only in password-wrapped form. Talks to `/api` on this
 * origin, or to a custom self-hosted server (lib/apiBase). Cookie sessions,
 * offline-tolerant.
 */

export interface Account {
  id: string;
  username: string;
}

/** How the server names this account's assets: 'hash' until the one-time
 *  relabel has run (lib/sync/assetIds), 'hmac-v1' after. */
export type AssetIdScheme = 'hash' | 'hmac-v1';

export interface Profile {
  username: string;
  /** The person's name, given at sign-up and shown to teammates. */
  name: string;
  email: string;
  hasAvatar: boolean;
  /** True when the server has SMTP configured (verification is a thing). */
  verifyEnabled: boolean;
  emailVerified: boolean;
  hasRecovery: boolean;
}

export interface Entitlements {
  enforced: boolean;
  /** True when this server has Stripe configured. */
  billing: boolean;
  plan: string;
  /** A complimentary plan from an invite: never billed, never lapses. */
  complimentary?: boolean;
  /** When this account took a founding-member price, else null. */
  foundingAt?: string | null;
  /** Founding prices still on offer (seats left). */
  foundingOpen?: boolean;
  /** null = unlimited */
  limits: {
    syncBytes: number | null;
    syncedBoards: number | null;
    teamBoardsOwned: number | null;
    teamMembersPerBoard: number | null;
  };
  usage: { syncBytes: number; syncedBoards: number; teamBoardsOwned: number };
}

interface HostedAiOp {
  provider: string;
  model: string;
  credits: number;
}

interface HostedAiCredits {
  /** null = unlimited (self-hosted / quotas off). */
  available: number | null;
  monthlyAllowance: number | null;
  monthlyUsed: number;
  purchased: number;
  month: string;
}

export interface HostedAiInfo {
  enabled: boolean;
  ops: {
    chat: HostedAiOp | null;
    agent: HostedAiOp | null;
    /** The frontier model behind "Think harder"; null = switch hidden. */
    deep?: HostedAiOp | null;
    image: HostedAiOp | null;
    /** Speech-to-text; its credit cost is per audio minute. */
    transcribe?: HostedAiOp | null;
  };
  pack: { credits: number; priceCents?: number; purchasable: boolean };
  /** null when not signed in. */
  credits: HostedAiCredits | null;
}

export interface UnlockedAccount {
  account: Account;
  /** Non-extractable AES-GCM key for encrypting/decrypting synced content. */
  adk: CryptoKey;
  /** Non-extractable HMAC key that names assets on the server. */
  assetIdKey: CryptoKey;
  /** How the server names this account's assets right now. */
  assetIds: AssetIdScheme;
}

export class SyncError extends Error {
  /** A machine-readable reason the server attached, when it did (e.g. 'mfa'). */
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    if (code !== undefined) this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // apiFetch picks the right auth per deployment: cookie same-origin/shells,
    // bearer + no credentials for cross-origin http clients.
    res = await apiFetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new SyncError("Can't reach the sync server. Check your connection.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & T;
  if (!res.ok) {
    throw new SyncError(
      data.error ?? 'Something went wrong.',
      typeof data.code === 'string' ? data.code : undefined,
    );
  }
  return data;
}

/** A password that checked out on an account with two-factor authentication. */
export interface MfaChallenge {
  mfaToken: string;
  salt: string;
  /** Kept in memory only, to unwrap the data key once the code is accepted. */
  encKey: CryptoKey;
  kdf: Kdf;
  /** Kept in memory only until the sign-in completes (a legacy account is then upgraded). */
  password: string;
}

async function finishLogin(
  res: {
    user: Account;
    wrappedAdk: string;
    assetIds?: AssetIdScheme;
    token?: string;
    tokenId?: string;
  },
  encKey: CryptoKey,
  upgrade?: { kdf: Kdf; salt: string; password: string },
): Promise<UnlockedAccount> {
  if (res.token) setAuthToken(res.token, res.tokenId ?? null);
  let keys: AccountKeys;
  try {
    keys = await unwrapKeys(encKey, res.wrappedAdk);
  } catch {
    throw new SyncError('Could not unlock your encryption key.');
  }
  if (upgrade) {
    await saveAdkWrap({ kdf: upgrade.kdf, salt: upgrade.salt, wrappedAdk: res.wrappedAdk });
  }
  // A legacy-KDF account moves to the current derivation now that the
  // password is known to be right; best effort, never in the way.
  if (upgrade && upgrade.kdf !== CURRENT_KDF) {
    void syncApi.upgradeKdf(upgrade, encKey, res.wrappedAdk).catch(() => undefined);
  }
  return { account: res.user, ...keys, assetIds: res.assetIds ?? 'hash' };
}

export const syncApi = {
  /** Who is signed in (session only), or null. Never throws — null when offline. */
  async me(): Promise<(Account & { assetIds: AssetIdScheme }) | null> {
    try {
      const { user, assetIds } = await request<{
        user: Account | null;
        assetIds?: AssetIdScheme;
      }>('/auth/me');
      return user ? { ...user, assetIds: assetIds ?? 'hash' } : null;
    } catch {
      return null;
    }
  },

  /** What an invite code grants, without spending it (sign-up form preview). */
  async inviteInfo(
    code: string,
  ): Promise<
    { ok: true; plan: 'personal' | 'team'; days: number | 'forever' } | { ok: false; error: string }
  > {
    return request(`/auth/invite?code=${encodeURIComponent(code)}`);
  },

  async register(
    username: string,
    password: string,
    details: { email: string; fullName: string; newsletter: boolean; inviteCode?: string },
  ): Promise<UnlockedAccount> {
    const { email, fullName, newsletter, inviteCode } = details;
    const salt = randomSalt();
    const { authKey, encKey } = await deriveKeys(password, salt, CURRENT_KDF);
    const wrappedAdk = await wrapAdk(encKey, await generateAdk());
    const { user, token, tokenId, assetIds } = await request<{
      user: Account;
      token?: string;
      tokenId?: string;
      assetIds?: AssetIdScheme;
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        authKey,
        kdfSalt: salt,
        kdf: CURRENT_KDF,
        wrappedAdk,
        email,
        fullName,
        newsletter,
        ...(inviteCode ? { inviteCode } : {}),
        // Cross-origin pages can't keep the session cookie — take a token.
        ...(crossOriginSync() ? { issueToken: true } : {}),
      }),
    });
    if (token) setAuthToken(token, tokenId ?? null);
    await saveAdkWrap({ kdf: CURRENT_KDF, salt, wrappedAdk });
    return {
      account: user,
      ...(await unwrapKeys(encKey, wrappedAdk)),
      assetIds: assetIds ?? 'hmac-v1',
    };
  },

  async login(username: string, password: string): Promise<UnlockedAccount | MfaChallenge> {
    const { salt, kdf = 'pbkdf2-v1' } = await request<{ salt: string; kdf?: Kdf }>(
      '/auth/prelogin',
      {
        method: 'POST',
        body: JSON.stringify({ username }),
      },
    );
    const { authKey, encKey } = await deriveKeys(password, salt, kdf);
    const res = await request<{
      user?: Account;
      wrappedAdk?: string;
      token?: string;
      tokenId?: string;
      mfaRequired?: boolean;
      mfaToken?: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        authKey,
        ...(crossOriginSync() ? { issueToken: true } : {}),
      }),
    });
    // Enrolled accounts: the password was right, a code finishes the sign-in.
    if (res.mfaRequired && res.mfaToken) {
      return { mfaToken: res.mfaToken, salt, encKey, kdf, password };
    }
    return finishLogin(
      res as { user: Account; wrappedAdk: string; token?: string; tokenId?: string },
      encKey,
      { kdf, salt, password },
    );
  },

  /**
   * Move an account created under PBKDF2 to Argon2id: fresh keys from the
   * same password with a new salt, the data key re-wrapped, the server
   * handed the new login secret. The data key itself never changes.
   */
  async upgradeKdf(
    old: { password: string; salt: string; kdf: Kdf },
    oldEncKey: CryptoKey,
    wrappedAdk: string,
  ): Promise<void> {
    const newSalt = randomSalt();
    const next = await deriveKeys(old.password, newSalt, CURRENT_KDF);
    const newWrappedAdk = await rewrapAdk(oldEncKey, wrappedAdk, next.encKey);
    // The server takes a credential change only with the current login
    // secret alongside, so it is derived again here the account's old way.
    const current = await deriveKeys(old.password, old.salt, old.kdf);
    await request('/auth/kdf', {
      method: 'POST',
      body: JSON.stringify({
        oldAuthKey: current.authKey,
        authKey: next.authKey,
        kdfSalt: newSalt,
        wrappedAdk: newWrappedAdk,
        kdf: CURRENT_KDF,
      }),
    });
    await saveAdkWrap({ kdf: CURRENT_KDF, salt: newSalt, wrappedAdk: newWrappedAdk });
  },

  /** Second step of sign-in for accounts with two-factor authentication. */
  async loginTotp(challenge: MfaChallenge, code: string): Promise<UnlockedAccount> {
    const res = await request<{
      user: Account;
      wrappedAdk: string;
      token?: string;
      tokenId?: string;
    }>('/auth/login/totp', {
      method: 'POST',
      body: JSON.stringify({ mfaToken: challenge.mfaToken, code }),
    });
    return finishLogin(res, challenge.encKey, {
      kdf: challenge.kdf,
      salt: challenge.salt,
      password: challenge.password,
    });
  },

  async totpStatus(): Promise<{ enabled: boolean; recoveryCodesLeft: number }> {
    return request('/auth/totp');
  },
  async totpSetup(): Promise<{ secret: string; uri: string }> {
    return request('/auth/totp/setup', { method: 'POST', body: '{}' });
  },
  /** Turn the pending authenticator on. The password rides along: a session alone must not enrol one. */
  async totpEnable(username: string, password: string, code: string): Promise<string[]> {
    const { salt, kdf = 'pbkdf2-v1' } = await request<{ salt: string; kdf?: Kdf }>(
      '/auth/prelogin',
      { method: 'POST', body: JSON.stringify({ username }) },
    );
    const { authKey } = await deriveKeys(password, salt, kdf);
    const { recoveryCodes } = await request<{ recoveryCodes: string[] }>('/auth/totp/enable', {
      method: 'POST',
      body: JSON.stringify({ code, authKey }),
    });
    return recoveryCodes;
  },
  async totpDisable(username: string, password: string, code: string): Promise<void> {
    const { salt, kdf = 'pbkdf2-v1' } = await request<{ salt: string; kdf?: Kdf }>(
      '/auth/prelogin',
      { method: 'POST', body: JSON.stringify({ username }) },
    );
    const { authKey } = await deriveKeys(password, salt, kdf);
    await request('/auth/totp/disable', {
      method: 'POST',
      body: JSON.stringify({ authKey, code }),
    });
  },

  /** Delete the signed-in account: password, and the authenticator code when enabled. */
  async deleteAccount(username: string, password: string, code?: string): Promise<void> {
    const { salt, kdf = 'pbkdf2-v1' } = await request<{ salt: string; kdf?: Kdf }>(
      '/auth/prelogin',
      { method: 'POST', body: JSON.stringify({ username }) },
    );
    const { authKey } = await deriveKeys(password, salt, kdf);
    await request('/auth/delete-account', {
      method: 'POST',
      body: JSON.stringify({ authKey, ...(code ? { code } : {}) }),
    });
  },

  async logout(): Promise<void> {
    // Token mode: revoke the token server-side, then forget it locally.
    const tokenId = getAuthTokenId();
    if (getAuthToken()) {
      await request(`/tokens/${tokenId}`, { method: 'DELETE' }).catch(() => undefined);
      setAuthToken(null);
    }
    await request('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined);
  },

  async profile(): Promise<Profile> {
    return request<Profile>('/profile');
  },

  async entitlements(): Promise<Entitlements> {
    return request<Entitlements>('/entitlements');
  },

  async hostedAi(): Promise<HostedAiInfo> {
    return request<HostedAiInfo>('/ai/hosted');
  },

  /** Returns a Stripe URL for a one-time AI credit-pack purchase. */
  async billingCredits(quantity = 1): Promise<string> {
    const { url } = await request<{ url: string }>('/billing/credits', {
      method: 'POST',
      body: JSON.stringify({ quantity }),
    });
    return url;
  },

  /** Returns a Stripe URL to redirect the browser to. */
  async billingCheckout(
    plan: 'personal' | 'team',
    interval: 'month' | 'year' | 'founding' = 'month',
  ): Promise<string> {
    const { url } = await request<{ url: string }>('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan, interval }),
    });
    return url;
  },

  async billingPortal(): Promise<string> {
    const { url } = await request<{ url: string }>('/billing/portal', {
      method: 'POST',
      body: '{}',
    });
    return url;
  },

  async updateProfile(name: string, email: string): Promise<void> {
    await request('/profile', { method: 'PUT', body: JSON.stringify({ name, email }) });
  },

  async uploadAvatar(blob: Blob): Promise<void> {
    // apiFetch, not a bare fetch: token clients need the bearer header.
    const res = await apiFetch('/api/profile/avatar', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Asset-Mime': blob.type || 'image/png',
      },
      body: blob,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new SyncError(data.error ?? 'Avatar upload failed.');
    }
  },

  async deleteAvatar(): Promise<void> {
    await request('/profile/avatar', { method: 'DELETE' });
  },

  async verifyEmail(code: string): Promise<void> {
    await request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ code }) });
  },

  async resendVerification(): Promise<void> {
    await request('/auth/resend-verification', { method: 'POST', body: '{}' });
  },

  /**
   * Create (or replace) the account's recovery kit. Requires the current
   * password to decrypt the wrapped ADK; the returned code is shown ONCE.
   * The code is treated exactly like a password: the server stores only
   * scrypt(recoveryAuthKey) and the recovery-wrapped ADK.
   */
  async createRecoveryKit(username: string, password: string): Promise<string> {
    const { salt, kdf = 'pbkdf2-v1' } = await request<{ salt: string; kdf?: Kdf }>(
      '/auth/prelogin',
      {
        method: 'POST',
        body: JSON.stringify({ username }),
      },
    );
    const pw = await deriveKeys(password, salt, kdf);
    const { wrappedAdk } = await request<{ wrappedAdk: string | null }>('/auth/me');
    if (!wrappedAdk) throw new SyncError('Not signed in.');
    const code = generateRecoveryCode();
    const recoverySalt = randomSalt();
    const rec = await deriveKeys(code, recoverySalt);
    let recoveryWrappedAdk: string;
    try {
      recoveryWrappedAdk = await rewrapAdk(pw.encKey, wrappedAdk, rec.encKey);
    } catch {
      throw new SyncError('Current password is incorrect.');
    }
    await request('/auth/recovery', {
      method: 'PUT',
      body: JSON.stringify({
        recoveryAuthKey: rec.authKey,
        recoverySalt,
        recoveryWrappedAdk,
        authKey: pw.authKey, // the kit can replace the password, so setting it takes the password
      }),
    });
    return code;
  },

  async deleteRecoveryKit(): Promise<void> {
    await request('/auth/recovery', { method: 'DELETE' });
  },

  /**
   * Forgot-password recovery: prove the recovery code, set a new password,
   * and come back signed in with the ADK intact (every synced board stays
   * readable). The kit burns on success. Two steps so the commit is atomic:
   * fetch the recovery-wrapped ADK (verifying the code), then swap
   * credentials with a correctly re-wrapped ADK. An account with two-factor
   * authentication also needs its authenticator code (`totpCode`): the server
   * answers with code 'mfa' until it gets one.
   */
  async recoverAccount(
    username: string,
    rawCode: string,
    newPassword: string,
    totpCode?: string,
  ): Promise<UnlockedAccount> {
    const code = normalizeRecoveryCode(rawCode);
    const { salt } = await request<{ salt: string }>('/auth/recover-prelogin', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    const rec = await deriveKeys(code, salt);
    const { recoveryWrappedAdk } = await request<{ recoveryWrappedAdk: string }>(
      '/auth/recover-fetch',
      { method: 'POST', body: JSON.stringify({ username, recoveryAuthKey: rec.authKey }) },
    );
    let keys: AccountKeys;
    try {
      keys = await unwrapKeys(rec.encKey, recoveryWrappedAdk);
    } catch {
      throw new SyncError('That recovery code doesn’t match.');
    }
    const newSalt = randomSalt();
    const next = await deriveKeys(newPassword, newSalt, CURRENT_KDF);
    const newWrappedAdk = await rewrapAdk(rec.encKey, recoveryWrappedAdk, next.encKey);
    const res = await request<{ user: Account; assetIds?: AssetIdScheme }>('/auth/recover', {
      method: 'POST',
      body: JSON.stringify({
        username,
        recoveryAuthKey: rec.authKey,
        newAuthKey: next.authKey,
        newKdfSalt: newSalt,
        newKdf: CURRENT_KDF,
        newWrappedAdk,
        ...(totpCode ? { code: totpCode } : {}),
      }),
    });
    await saveAdkWrap({ kdf: CURRENT_KDF, salt: newSalt, wrappedAdk: newWrappedAdk });
    return { account: res.user, ...keys, assetIds: res.assetIds ?? 'hash' };
  },

  /**
   * Zero-knowledge password change: derive old/new authKeys client-side,
   * re-wrap the ADK bytes under the new encKey, and swap everything on the
   * server in one call. The ADK itself never changes, so synced content
   * stays readable everywhere.
   */
  async changePassword(username: string, oldPassword: string, newPassword: string): Promise<void> {
    const { salt, kdf = 'pbkdf2-v1' } = await request<{ salt: string; kdf?: Kdf }>(
      '/auth/prelogin',
      {
        method: 'POST',
        body: JSON.stringify({ username }),
      },
    );
    const old = await deriveKeys(oldPassword, salt, kdf);
    const { wrappedAdk } = await request<{ user: Account | null; wrappedAdk: string | null }>(
      '/auth/me',
    );
    if (!wrappedAdk) throw new SyncError('Not signed in.');
    const newSalt = randomSalt();
    const next = await deriveKeys(newPassword, newSalt, CURRENT_KDF);
    let newWrappedAdk: string;
    try {
      newWrappedAdk = await rewrapAdk(old.encKey, wrappedAdk, next.encKey);
    } catch {
      throw new SyncError('Current password is incorrect.');
    }
    await request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        oldAuthKey: old.authKey,
        newAuthKey: next.authKey,
        newKdfSalt: newSalt,
        newKdf: CURRENT_KDF,
        newWrappedAdk,
      }),
    });
  },
};

// --- launch plumbing: sign-up mode, feedback, direct uploads ----------------

/** What the sign-up form needs before an account exists. */
export interface AuthConfig {
  inviteOnly: boolean;
  waitlist: boolean;
  /** Paid plans may be chosen at sign-up (Stripe configured). */
  billing?: boolean;
  foundingOpen?: boolean;
  /** Where share links point (the view host); empty = this origin. */
  viewUrl?: string;
}

export async function authConfig(): Promise<AuthConfig> {
  try {
    return await request<AuthConfig>('/auth/config');
  } catch {
    return { inviteOnly: false, waitlist: false }; // older servers: open registration
  }
}

export async function sendFeedback(body: {
  category: string;
  message: string;
  email?: string;
  diagnostics?: Record<string, unknown>;
}): Promise<void> {
  await request('/feedback', { method: 'POST', body: JSON.stringify(body) });
}

/** A presigned PUT for one asset, or null when the server stores blobs itself. */
export async function requestUploadUrl(
  hash: string,
  bytes: number,
): Promise<{ url: string; headers: Record<string, string> } | null> {
  const res = await apiFetch(`/api/assets/${hash}/upload-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bytes }),
  });
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(
      ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Upload refused.',
    );
  return (await res.json()) as { url: string; headers: Record<string, string> };
}

export async function completeUpload(hash: string): Promise<boolean> {
  const res = await apiFetch(`/api/assets/${hash}/complete`, { method: 'POST' });
  return res.ok;
}
