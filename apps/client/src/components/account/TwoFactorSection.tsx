import { useEffect, useState } from 'react';
import { QR_PAD, qrCode, qrPathData } from '../../lib/media/qr';
import { syncApi } from '../../lib/sync/syncApi';
import { useSyncStore } from '../../state/syncStore';

/**
 * Two-factor authentication (authenticator app). Enrolment: scan, confirm
 * one code, save the recovery codes shown once. Turning it off needs the
 * password and a current code.
 */
type Step = 'idle' | 'scan' | 'codes' | 'disable';

export function TwoFactorSection() {
  const account = useSyncStore((s) => s.account);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [recoveryLeft, setRecoveryLeft] = useState(0);
  const [step, setStep] = useState<Step>('idle');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const s = await syncApi.totpStatus();
      setEnabled(s.enabled);
      setRecoveryLeft(s.recoveryCodesLeft);
    } catch {
      setEnabled(null);
    }
  };
  useEffect(() => {
    // Deferred so the effect body itself sets no state (lint rule).
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, []);

  const begin = async () => {
    setBusy(true);
    setErr(null);
    try {
      setSetup(await syncApi.totpSetup());
      setCode('');
      setStep('scan');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the setup.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!account) return;
    setBusy(true);
    setErr(null);
    try {
      const codes = await syncApi.totpEnable(account.username, password, code.trim());
      setPassword('');
      setRecoveryCodes(codes);
      setStep('codes');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That code did not match.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!account) return;
    setBusy(true);
    setErr(null);
    try {
      await syncApi.totpDisable(account.username, password, code.trim());
      setPassword('');
      setCode('');
      setStep('idle');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not turn it off.');
    } finally {
      setBusy(false);
    }
  };

  const qr = setup ? qrCode(setup.uri) : null;
  const status =
    enabled === null
      ? 'Two-factor authentication'
      : enabled
        ? `Two-factor authentication: on ✓ · ${recoveryLeft} recovery ${recoveryLeft === 1 ? 'code' : 'codes'} left`
        : 'Two-factor authentication: off — an authenticator app adds a second check at sign-in.';

  return (
    <div className="profile-recovery" data-testid="profile-totp">
      <div className="profile-recovery-head">
        <span className="profile-recovery-status" data-testid="totp-status">
          {status}
        </span>
        {enabled !== null && step === 'idle' && (
          <button
            type="button"
            className="sync-link"
            data-testid="totp-toggle"
            disabled={busy}
            onClick={() => {
              setErr(null);
              if (enabled) {
                setCode('');
                setStep('disable');
              } else void begin();
            }}
          >
            {enabled ? 'Turn off' : 'Turn on'}
          </button>
        )}
        {step !== 'idle' && step !== 'codes' && (
          <button type="button" className="sync-link" onClick={() => setStep('idle')}>
            Cancel
          </button>
        )}
      </div>

      {step === 'scan' && setup && (
        <div className="profile-recovery-form" data-testid="totp-scan">
          <p className="profile-recovery-warn">
            Scan this with your authenticator app, then enter the six-digit code it shows.
          </p>
          {qr && (
            <svg
              className="profile-totp-qr"
              viewBox={`0 0 ${qr.size + QR_PAD * 2} ${qr.size + QR_PAD * 2}`}
              role="img"
              aria-label="Authenticator setup code"
            >
              <rect width="100%" height="100%" fill="#fff" />
              <path d={qrPathData(qr)} fill="#000" />
            </svg>
          )}
          <p className="profile-recovery-code">
            Can’t scan? Enter this key: <code data-testid="totp-secret">{setup.secret}</code>
          </p>
          <label className="sync-field">
            <span>Current password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              data-testid="totp-enable-password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
          <label className="sync-field">
            <span>Code from the app</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              placeholder="123 456"
              data-testid="totp-code"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') void confirm();
              }}
            />
          </label>
          <button
            type="button"
            className="sync-primary"
            disabled={busy || !password || code.replace(/\s/g, '').length !== 6}
            data-testid="totp-confirm"
            onClick={() => void confirm()}
          >
            {busy ? 'Checking' : 'Turn on'}
          </button>
        </div>
      )}

      {step === 'codes' && (
        <div className="profile-recovery-form" data-testid="totp-recovery-codes">
          <p className="profile-recovery-warn">
            Save these recovery codes somewhere safe. Each signs you in once if you lose the
            authenticator. They are shown only now.
          </p>
          <pre className="profile-totp-codes">{recoveryCodes.join('\n')}</pre>
          <button
            type="button"
            className="sync-primary"
            data-testid="totp-codes-done"
            onClick={() => setStep('idle')}
          >
            I’ve saved them
          </button>
        </div>
      )}

      {step === 'disable' && (
        <div className="profile-recovery-form" data-testid="totp-disable">
          <label className="sync-field">
            <span>Current password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              data-testid="totp-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="sync-field">
            <span>Code from the app (or a recovery code)</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              data-testid="totp-disable-code"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
          <button
            type="button"
            className="sync-primary"
            disabled={busy || !password || !code.trim()}
            data-testid="totp-disable-confirm"
            onClick={() => void disable()}
          >
            {busy ? 'Please wait' : 'Turn off two-factor'}
          </button>
        </div>
      )}

      {err && (
        <p className="sync-error" role="alert" data-testid="totp-error">
          {err}
        </p>
      )}
    </div>
  );
}
