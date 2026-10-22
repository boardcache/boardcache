import { TwoFactorSection } from './TwoFactorSection';
import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../lib/sync/apiBase';
import { AuthedImg } from '../ui/AuthedImg';
import { syncApi } from '../../lib/sync/syncApi';
import { confirmDialog } from '../ui/Prompt';
import { useSyncStore } from '../../state/syncStore';

/**
 * Profile settings (Settings → Sync): name, email, avatar, password.
 * Name and avatar are shown to other people on team boards; the password
 * change is zero-knowledge (keys re-derived client-side, the ADK is re-wrapped
 * so synced content stays readable).
 */
export function ProfilePanel() {
  const profile = useSyncStore((s) => s.profile);
  const account = useSyncStore((s) => s.account);
  const refreshProfile = useSyncStore((s) => s.refreshProfile);

  const [name, setName] = useState(profile?.name ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [avatarRev, setAvatarRev] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Adopt the profile once it loads (or after an outside refresh).
  const [seen, setSeen] = useState(profile);
  if (profile !== seen) {
    setSeen(profile);
    setName(profile?.name ?? '');
    setEmail(profile?.email ?? '');
  }

  useEffect(() => {
    if (!profile) void refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await syncApi.updateProfile(name, email);
      await refreshProfile();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the profile.');
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const blob = await squareAvatar(file);
      await syncApi.uploadAvatar(blob);
      await refreshProfile();
      setAvatarRev((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Avatar upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const removeAvatar = async () => {
    setBusy(true);
    setError(null);
    try {
      await syncApi.deleteAvatar();
      await refreshProfile();
      setAvatarRev((r) => r + 1);
    } finally {
      setBusy(false);
    }
  };

  // --- password change ---
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async () => {
    if (!account) return;
    if (pwNew.length < 8) {
      setPwMsg({ ok: false, text: 'New password must be at least 8 characters.' });
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwMsg({ ok: false, text: 'New passwords don’t match.' });
      return;
    }
    setBusy(true);
    setPwMsg(null);
    try {
      await syncApi.changePassword(account.username, pwCurrent, pwNew);
      setPwMsg({ ok: true, text: 'Password changed. Other devices must sign in again.' });
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
    } catch (e) {
      setPwMsg({
        ok: false,
        text: e instanceof Error ? e.message : 'Couldn’t change the password.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-panel settings-card" data-testid="profile-panel">
      <h4>Profile</h4>
      <p className="settings-hint">
        Your name and avatar are what teammates see on team boards. Email is for your own reference;
        account recovery works only through your recovery kit below (the password encrypts your
        data, so the server can’t reset it).
      </p>

      <div className="profile-avatar-row">
        {profile?.hasAvatar ? (
          <AuthedImg
            className="profile-avatar"
            src={`${apiUrl('/api/profile/avatar')}?v=${avatarRev}`}
            alt="Your avatar"
            data-testid="profile-avatar-img"
          />
        ) : (
          <span className="profile-avatar profile-avatar-empty" data-testid="profile-avatar-empty">
            {(name || account?.username || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          data-testid="profile-avatar-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void pickAvatar(f);
          }}
        />
        <button
          type="button"
          disabled={busy}
          data-testid="profile-avatar-upload"
          onClick={() => fileRef.current?.click()}
        >
          {profile?.hasAvatar ? 'Replace avatar' : 'Upload avatar'}
        </button>
        {profile?.hasAvatar && (
          <button type="button" disabled={busy} onClick={() => void removeAvatar()}>
            Remove
          </button>
        )}
      </div>

      <label className="sync-field">
        <span>Name</span>
        <input
          value={name}
          maxLength={120}
          autoComplete="name"
          placeholder={account?.username ?? ''}
          data-testid="profile-name"
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <label className="sync-field">
        <span>Email</span>
        <input
          value={email}
          type="email"
          maxLength={200}
          placeholder="you@example.com"
          data-testid="profile-email"
          onChange={(e) => {
            setEmail(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      {profile?.verifyEnabled && (
        <div className="profile-verify" data-testid="profile-verify">
          {profile.emailVerified ? (
            <span className="profile-msg ok" data-testid="profile-verified">
              Email verified ✓
            </span>
          ) : (
            <VerifyBlock onDone={() => void refreshProfile()} />
          )}
        </div>
      )}
      <div className="profile-actions">
        <button
          type="button"
          className="sync-primary"
          disabled={busy || (name === (profile?.name ?? '') && email === (profile?.email ?? ''))}
          data-testid="profile-save"
          onClick={() => void save()}
        >
          Save profile
        </button>
        {saved && (
          <span className="profile-saved" data-testid="profile-saved">
            Saved
          </span>
        )}
      </div>

      <RecoverySection />
      <TwoFactorSection />

      <button
        type="button"
        className="sync-link profile-pw-toggle"
        data-testid="profile-pw-toggle"
        onClick={() => setPwOpen((o) => !o)}
      >
        {pwOpen ? 'Hide password change' : 'Change password'}
      </button>
      {pwOpen && (
        <div className="profile-password">
          <label className="sync-field">
            <span>Current password</span>
            <input
              type="password"
              value={pwCurrent}
              autoComplete="current-password"
              data-testid="profile-pw-current"
              onChange={(e) => setPwCurrent(e.target.value)}
            />
          </label>
          <label className="sync-field">
            <span>New password</span>
            <input
              type="password"
              value={pwNew}
              autoComplete="new-password"
              data-testid="profile-pw-new"
              onChange={(e) => setPwNew(e.target.value)}
            />
          </label>
          <label className="sync-field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={pwConfirm}
              autoComplete="new-password"
              data-testid="profile-pw-confirm"
              onChange={(e) => setPwConfirm(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="sync-primary"
            disabled={busy || !pwCurrent || !pwNew}
            data-testid="profile-pw-submit"
            onClick={() => void changePassword()}
          >
            Change password
          </button>
        </div>
      )}
      {(error || pwMsg) && (
        <p
          className={`profile-msg${(pwMsg?.ok ?? false) && !error ? ' ok' : ' err'}`}
          role="alert"
          data-testid="profile-msg"
        >
          {error ?? pwMsg!.text}
        </p>
      )}
      <DeleteAccountSection />
    </div>
  );
}

/**
 * The end of the account: password (and the authenticator code when two-
 * factor is on), one confirmation, then everything on the server goes and
 * this device signs out. Boards kept only here stay.
 */
function DeleteAccountSection() {
  const deleteAccount = useSyncStore((s) => s.deleteAccount);
  const busy = useSyncStore((s) => s.busy);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    setErr(null);
    if (next) {
      const status = await syncApi.totpStatus().catch(() => null);
      setNeedsCode(Boolean(status?.enabled));
    }
  };

  const confirm = async () => {
    setErr(null);
    const sure = await confirmDialog({
      title: 'Delete your account?',
      body: 'Your synced boards and media, team boards you own, your community profile and anything you published are removed from the server, and any subscription is cancelled. Boards kept only on this device stay. This cannot be undone.',
      confirmLabel: 'Delete account',
    });
    if (!sure) return;
    const ok = await deleteAccount(password, needsCode ? code.trim() : undefined);
    if (!ok) setErr(useSyncStore.getState().error ?? 'Could not delete the account.');
  };

  return (
    <div className="profile-delete" data-testid="profile-delete">
      <button
        type="button"
        className="sync-link profile-delete-toggle"
        data-testid="profile-delete-toggle"
        onClick={() => void toggle()}
      >
        {open ? 'Keep my account' : 'Delete account'}
      </button>
      {open && (
        <div className="profile-password">
          <p className="settings-hint">
            Deleting removes everything this account holds on the server and signs you out
            everywhere. Boards kept only on this device are not affected.
          </p>
          <label className="sync-field">
            <span>Current password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              data-testid="profile-delete-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {needsCode && (
            <label className="sync-field">
              <span>Code from your authenticator app (or a recovery code)</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                placeholder="123 456"
                data-testid="profile-delete-code"
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          <button
            type="button"
            className="sync-primary profile-delete-submit"
            disabled={busy || !password || (needsCode && !code.trim())}
            data-testid="profile-delete-submit"
            onClick={() => void confirm()}
          >
            Delete my account
          </button>
          {err && (
            <p className="profile-msg err" role="alert" data-testid="profile-delete-error">
              {err}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Recovery kit: a one-time code that re-wraps the ADK, so a forgotten
 * password no longer means losing every synced board. Generating needs the
 * current password (it decrypts the wrapped ADK); the code displays once.
 */
function RecoverySection() {
  const profile = useSyncStore((s) => s.profile);
  const account = useSyncStore((s) => s.account);
  const refreshProfile = useSyncStore((s) => s.refreshProfile);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!account) return;
    setBusy(true);
    setErr(null);
    try {
      const c = await syncApi.createRecoveryKit(account.username, password);
      setCode(c);
      setPassword('');
      await refreshProfile();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Couldn’t create the recovery kit.');
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!code || !account) return;
    const text = [
      'boardCache account recovery kit',
      '================================',
      '',
      `Account:  ${account.username}`,
      `Created:  ${new Date().toLocaleString()}`,
      '',
      `Recovery code:  ${code}`,
      '',
      'Keep this file somewhere safe (password manager, printed copy).',
      'If you forget your password, choose “Forgot password?” at sign-in and',
      'enter this code — it restores access to all your synced boards and is',
      'single-use: recovering (or regenerating) invalidates it.',
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'boardcache-recovery-kit.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="profile-recovery" data-testid="profile-recovery">
      <div className="profile-recovery-head">
        <span className="profile-recovery-status" data-testid="recovery-status">
          {profile?.hasRecovery
            ? 'Recovery kit: active ✓'
            : 'No recovery kit — a forgotten password loses your synced boards.'}
        </span>
        <button
          type="button"
          className="sync-link"
          data-testid="recovery-toggle"
          onClick={() => {
            setOpen((o) => !o);
            setCode(null);
            setErr(null);
          }}
        >
          {open ? 'Close' : profile?.hasRecovery ? 'Regenerate' : 'Create recovery kit'}
        </button>
      </div>
      {open && code === null && (
        <div className="profile-recovery-form">
          <label className="sync-field">
            <span>Current password (decrypts your key)</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              data-testid="recovery-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="sync-primary"
            disabled={busy || !password}
            data-testid="recovery-generate"
            onClick={() => void generate()}
          >
            Generate code
          </button>
          {err && <p className="profile-msg err">{err}</p>}
        </div>
      )}
      {code && (
        <div className="profile-recovery-code" data-testid="recovery-code-box">
          <p className="profile-recovery-warn">
            This code is shown ONCE. Save it now — it’s the only way back in if you forget your
            password.
          </p>
          <code data-testid="recovery-code">{code}</code>
          <div className="profile-actions">
            <button
              type="button"
              className="sync-primary"
              onClick={download}
              data-testid="recovery-download"
            >
              Download .txt
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(code);
              }}
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Code entry + resend for pending email verification (servers with mail).
 *  `hint` false drops the lead line when the caller has written its own. */
export function VerifyBlock({ onDone, hint = true }: { onDone: () => void; hint?: boolean }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await syncApi.verifyEmail(code.trim());
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await syncApi.resendVerification();
      setMsg('New code sent — check your inbox.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Couldn’t send the code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-verify-block">
      {hint && (
        <span className="profile-verify-hint">
          Unverified — enter the 6-digit code we emailed you.
        </span>
      )}
      <div className="profile-verify-row">
        <input
          value={code}
          inputMode="numeric"
          maxLength={6}
          placeholder="123456"
          data-testid="profile-verify-code"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <button
          type="button"
          className="sync-primary"
          disabled={busy || code.length !== 6}
          data-testid="profile-verify-submit"
          onClick={() => void verify()}
        >
          Verify
        </button>
        <button
          type="button"
          className="sync-link"
          disabled={busy}
          data-testid="profile-verify-resend"
          onClick={() => void resend()}
        >
          Resend code
        </button>
      </div>
      {msg && (
        <p className="profile-msg err" data-testid="profile-verify-msg">
          {msg}
        </p>
      )}
    </div>
  );
}

/** Downscale any image file to a 192px cover square (webp) for the avatar. */
async function squareAvatar(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('That file isn’t a readable image.'));
      img.src = url;
    });
    const SIZE = 192;
    const cv = document.createElement('canvas');
    cv.width = SIZE;
    cv.height = SIZE;
    const ctx = cv.getContext('2d')!;
    const scale = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/webp', 0.9));
    if (!blob) throw new Error('Could not encode the avatar.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
