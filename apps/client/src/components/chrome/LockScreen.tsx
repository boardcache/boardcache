import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockMethod, setLocalLockPassword, useLockScreenStore } from '../../lib/lockScreen';
import type { LockMethod } from '../../lib/lockScreen';
import { useSyncStore } from '../../state/syncStore';
import { UiDialog } from '../ui/Dialog';
import { LockIcon, ScanFaceIcon } from '../icons';
import { biometricKind, biometricUnlock } from '../../lib/iosNative';
import { shellPlatform } from '../../lib/mobile';

/** The gate itself: blurs everything beneath and takes the password. */
function Gate() {
  const unlock = useLockScreenStore((s) => s.unlock);
  const username = useSyncStore((s) => s.account?.username);
  const [method, setMethod] = useState<LockMethod | null>(null);
  const [biometric, setBiometric] = useState<'faceId' | 'touchId' | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void lockMethod().then((m) => live && setMethod(m));
    // iOS shell: offer the device's own check, and run it once straight away.
    void biometricKind().then((kind) => {
      if (!live || !kind) return;
      setBiometric(kind);
      void biometricUnlock().then((ok) => ok && useLockScreenStore.getState().unlockByDevice());
    });
    return () => {
      live = false;
    };
  }, [username]);

  // Nothing beneath takes focus or keys while the gate is up: every other
  // child of <body> (the app root, portaled dialogs) is inert meanwhile.
  useEffect(() => {
    const self = node.current;
    const others = [...document.body.children].filter((el) => el !== self) as HTMLElement[];
    for (const el of others) el.setAttribute('inert', '');
    return () => {
      for (const el of others) el.removeAttribute('inert');
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await unlock(password);
    setBusy(false);
    if (!ok) {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div className="lock-screen" ref={node} role="dialog" aria-modal="true" aria-label="Locked">
      <form className="lock-screen-card" onSubmit={(e) => void submit(e)} data-testid="lock-screen">
        <LockIcon size={26} />
        <h2>Locked</h2>
        <p className="sync-note">
          {method === 'account'
            ? `Enter the account password for ${username ?? 'your account'} to continue.`
            : 'Enter your lock password to continue.'}
        </p>
        <label className="sync-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            autoFocus
            data-testid="lock-screen-password"
          />
        </label>
        {error && (
          <p className="sync-error" role="alert" data-testid="lock-screen-error">
            That password doesn’t match.
          </p>
        )}
        <button
          type="submit"
          className="sync-primary"
          disabled={busy || !password}
          data-testid="lock-screen-unlock"
        >
          {busy ? 'Checking' : 'Unlock'}
        </button>
        {biometric && (
          <button
            type="button"
            className="sync-link"
            data-testid="lock-screen-biometric"
            onClick={() =>
              void biometricUnlock().then(
                (ok) => ok && useLockScreenStore.getState().unlockByDevice(),
              )
            }
          >
            <ScanFaceIcon size={14} />{' '}
            {biometric === 'faceId'
              ? 'Use Face ID'
              : shellPlatform() === 'android'
                ? 'Use fingerprint or face'
                : 'Use Touch ID'}
          </button>
        )}
      </form>
    </div>
  );
}

/** First lock without a password: set one for this device, then lock. */
function SetupDialog() {
  const close = () => useLockScreenStore.getState().setSetupOpen(false);
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 4) return setError('Use at least 4 characters.');
    if (password !== confirm) return setError('Passwords don’t match.');
    setBusy(true);
    await setLocalLockPassword(password);
    close();
    useLockScreenStore.getState().lock();
  };

  return (
    <UiDialog
      title="Lock screen"
      onClose={close}
      className="lock-sheet"
      testId="lock-setup-dialog"
      dismissable={!busy}
    >
      <form className="sync-body" onSubmit={(e) => void submit(e)}>
        <p className="sync-note">
          Set a password for the lock screen. It stays on this device and there is no recovery for
          it.
          {signedIn
            ? ' Signing in again makes your account password the lock password instead.'
            : ' Once you sign in, your account password takes over.'}
        </p>
        <label className="sync-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            data-autofocus
            data-testid="lock-setup-password"
          />
        </label>
        <label className="sync-field">
          <span>Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            data-testid="lock-setup-confirm"
          />
        </label>
        {error && (
          <p className="sync-error" role="alert">
            {error}
          </p>
        )}
        <div className="sync-actions">
          <button
            type="submit"
            className="sync-primary"
            disabled={busy}
            data-testid="lock-setup-submit"
          >
            Set and lock
          </button>
        </div>
      </form>
    </UiDialog>
  );
}

export function LockScreen() {
  const locked = useLockScreenStore((s) => s.locked);
  const setupOpen = useLockScreenStore((s) => s.setupOpen);
  if (locked) return createPortal(<Gate />, document.body);
  if (setupOpen) return <SetupDialog />;
  return null;
}
