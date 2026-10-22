import { useEffect, useState } from 'react';
import { hasSyncServer, syncServerLabel } from '../../lib/sync/apiBase';
import { useSessionStore } from '../../state/sessionStore';
import { authConfig, syncApi } from '../../lib/sync/syncApi';
import { useSyncStore } from '../../state/syncStore';
import { UiDialog } from '../ui/Dialog';
import { DownloadIcon, GridIcon, LockIcon } from '../icons';
import { VerifyBlock } from './ProfilePanel';
import { pendingInvite } from '../../lib/inviteLink';
import { canPurchase } from '../../lib/mobile';
import {
  INTERVAL_LABELS,
  PLAN_COPY,
  PRICES,
  pendingPlan,
  setPendingPlan,
  startPendingCheckout,
} from '../../lib/plans';
import type { Interval, PlanChoice } from '../../lib/plans';

/**
 * Settings → Sync dialog. Sync is opt-in: the app is fully usable signed out.
 * Signing in to the sync server enables (later) per-board cloud sync. This
 * dialog only handles the account — register / sign in / sign out.
 */
export function SyncDialog() {
  const open = useSessionStore((s) => s.syncDialogOpen);
  // Remount the body each time it opens so the form starts fresh.
  return open ? <SyncDialogBody /> : null;
}

function SyncDialogBody() {
  const close = () => useSessionStore.getState().setSyncDialogOpen(false);

  const status = useSyncStore((s) => s.status);
  const account = useSyncStore((s) => s.account);
  const error = useSyncStore((s) => s.error);
  const busy = useSyncStore((s) => s.busy);
  const profile = useSyncStore((s) => s.profile);

  // Arriving by invite link: straight to sign-up, code in place.
  const [invited] = useState(() => pendingInvite() ?? '');
  const routedMode = useSessionStore((s) => s.syncDialogMode);
  const [mode, setModeState] = useState<'login' | 'register' | 'recover'>(
    invited ? 'register' : routedMode,
  );
  // The mode is also the route (/signup, /signin); recovery keeps /signin.
  const setMode = (next: 'login' | 'register' | 'recover') => {
    setModeState(next);
    useSessionStore.getState().setSyncDialogOpen(true, next === 'register' ? 'register' : 'login');
  };
  // Plan choice at sign-up (paid ones only where the server bills).
  const [plans, setPlans] = useState<{ billing: boolean; foundingOpen: boolean }>({
    billing: false,
    foundingOpen: false,
  });
  // A /signup?plan=… link preselects the plan; the preset is read once.
  const [preset] = useState(() => {
    const p = useSessionStore.getState().signupPreset;
    if (p) useSessionStore.getState().setSignupPreset(null);
    return p;
  });
  const [plan, setPlan] = useState<PlanChoice>(preset?.plan ?? 'free');
  // Monthly or Yearly; Yearly is the founding rate while seats last.
  const [period, setPeriod] = useState<'month' | 'yearly'>(preset?.period ?? 'yearly');
  const interval: Interval =
    period === 'month' ? 'month' : plans.foundingOpen ? 'founding' : 'year';
  const [recoveryCode, setRecoveryCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  // Product updates only, a few times a year; the box starts ticked and the
  // choice is sent as given.
  const [newsletter, setNewsletter] = useState(true);
  const [inviteCode, setInviteCode] = useState(invited);
  const [inviteOnly, setInviteOnly] = useState(false);
  // What the typed code grants. A code that carries a plan takes the person
  // straight to the account: no plan choice, no checkout. The answer is kept
  // with the code it was for, so a changed code never shows a stale grant.
  type Grant = { plan: 'personal' | 'team'; days: number | 'forever' };
  const [inviteLookup, setInviteLookup] = useState<{ code: string; grant: Grant | null } | null>(
    null,
  );
  const inviteKey = inviteCode.trim().toUpperCase().replace(/[\s-]/g, '');
  useEffect(() => {
    if (!inviteOnly || inviteKey.length !== 14) return;
    let live = true;
    void syncApi.inviteInfo(inviteCode.trim()).then((r) => {
      if (!live) return;
      setInviteLookup({
        code: inviteKey,
        grant: r.ok && r.days !== 0 ? { plan: r.plan, days: r.days } : null,
      });
    });
    return () => {
      live = false;
    };
  }, [inviteOnly, inviteCode, inviteKey]);
  const inviteGrant = inviteLookup?.code === inviteKey ? inviteLookup.grant : null;
  const granted = inviteOnly && inviteGrant !== null;
  // Drop any stale error from a previous session; learn whether sign-up needs a code.
  useEffect(() => {
    useSyncStore.getState().clearError();
    let live = true;
    void authConfig().then((c) => {
      if (!live) return;
      setInviteOnly(c.inviteOnly);
      setPlans({
        billing: c.billing === true && canPurchase(),
        foundingOpen: c.foundingOpen === true,
      });
    });
    return () => {
      live = false;
    };
  }, []);

  const mfa = useSyncStore((s) => s.mfa);
  const recoverNeedsCode = useSyncStore((s) => s.recoverNeedsCode);
  const [totpCode, setTotpCode] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mfa) {
      await useSyncStore.getState().loginTotp(totpCode.trim());
      return;
    }
    const fn =
      mode === 'login'
        ? useSyncStore.getState().login
        : mode === 'recover'
          ? (u: string, p: string) =>
              useSyncStore
                .getState()
                .recover(u, recoveryCode, p, recoverNeedsCode ? totpCode.trim() : undefined)
          : (u: string, p: string) =>
              useSyncStore.getState().register(u, p, {
                email: email.trim(),
                fullName: fullName.trim(),
                newsletter,
                ...(inviteOnly ? { inviteCode: inviteCode.trim() } : {}),
              });
    const toCheckout = plans.billing && plan !== 'free' && !granted;
    if (mode === 'register') {
      setPendingPlan(toCheckout ? { plan, interval } : null);
    }
    const ok = await fn(username.trim(), password);
    if (mode === 'register' && ok && toCheckout) {
      // Straight to checkout, unless the address has to be verified first:
      // then the verify step below says so and checkout follows the code.
      await useSyncStore.getState().refreshProfile();
      const profile = useSyncStore.getState().profile;
      if (!(profile?.verifyEnabled && !profile.emailVerified)) await startPendingCheckout();
    }
  };
  const pending = pendingPlan();

  const signedIn = status === 'signedIn' && account;

  const title = signedIn
    ? 'Board sync'
    : mfa
      ? 'One more step'
      : mode === 'login'
        ? 'Welcome back'
        : mode === 'recover'
          ? 'Recover your account'
          : 'Create your account';

  // The side panel: three promises, pinned to the top of the frame so a
  // long form scrolls past them. Hidden on narrow screens.
  const board = (
    <aside className="sync-aside" aria-hidden="true">
      <ul className="sync-aside-list">
        <li>
          <GridIcon size={18} />
          <span>
            <strong>Every reference, one canvas</strong>
            Images, video, documents, notes and links, with the connections drawn.
          </span>
        </li>
        <li>
          <LockIcon size={18} />
          <span>
            <strong>Encrypted on your device</strong>
            We store ciphertext. We cannot read your boards.
          </span>
        </li>
        <li>
          <DownloadIcon size={18} />
          <span>
            <strong>Always yours</strong>
            Every board exports as real files, any time, on any plan.
          </span>
        </li>
      </ul>
    </aside>
  );

  return (
    <UiDialog title={title} onClose={close} className="sync-sheet" testId="sync-dialog">
      <div className="sync-split">
        {board}
        <div className="sync-split-main">
          {!hasSyncServer() ? (
            <div className="sync-body">
              <p className="sync-note" data-testid="sync-unconfigured">
                This deployment has no sync server configured, so board sync isn’t available. The
                operator can enable it by declaring one in the app’s <code>config.json</code>.
              </p>
            </div>
          ) : signedIn ? (
            <div className="sync-body">
              <p className="sync-account" data-testid="sync-signed-in">
                Signed in as <strong>{account.username}</strong>
                {syncServerLabel() ? (
                  <>
                    {' '}
                    on <strong>{syncServerLabel()}</strong>
                  </>
                ) : null}
                .
              </p>
              {profile?.verifyEnabled && !profile.emailVerified && (
                <div className="sync-verify" data-testid="sync-verify">
                  <p className="sync-note">
                    <strong>Check your email.</strong> We sent a 6-digit code to{' '}
                    <strong>{profile.email || 'your address'}</strong>. Enter it here to confirm the
                    address.
                    {pending && (
                      <span data-testid="sync-pending-plan">
                        {' '}
                        Then we take you to checkout for {PLAN_COPY[pending.plan].name} ·{' '}
                        {PRICES[pending.plan][pending.interval]}.
                      </span>
                    )}
                  </p>
                  <VerifyBlock
                    hint={false}
                    onDone={() => void useSyncStore.getState().refreshProfile()}
                  />
                </div>
              )}
              <p className="sync-note">
                Boards stay offline by default. Turn on <strong>☁ Sync</strong> for a board in the
                library to back it up and keep it in sync across your devices — end-to-end
                encrypted, so the server can’t read it.
              </p>
              <div className="sync-actions">
                <button
                  type="button"
                  className="sync-primary"
                  onClick={() => void useSyncStore.getState().logout()}
                  disabled={busy}
                  data-testid="sync-logout"
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <form className="sync-body" onSubmit={submit}>
              <p className="sync-note">
                Sign in to a sync account to back up and sync boards across devices. This is
                optional — the app works fully offline without it.
              </p>
              {mode === 'register' && (
                <p className="sync-note sync-warn" data-testid="sync-e2e-warning">
                  Boards are end-to-end encrypted with your password — the server can’t read them.
                  After signing up, create a <strong>recovery kit</strong> in Settings → Sync;
                  without one, a forgotten password means synced boards can’t be recovered.
                </p>
              )}

              {mfa && (
                <label className="sync-field">
                  <span>Code from your authenticator app (or a recovery code)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    value={totpCode}
                    placeholder="123 456"
                    data-testid="sync-totp"
                    onChange={(e) => setTotpCode(e.target.value)}
                  />
                  <small className="sync-hint">
                    Your password was accepted. Enter the six-digit code to finish signing in.
                  </small>
                </label>
              )}
              {!mfa && (
                <>
                  <label className="sync-field">
                    <span>Username</span>
                    <input
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoFocus
                      data-autofocus
                      data-testid="sync-username"
                    />
                  </label>
                  {mode === 'recover' && (
                    <label className="sync-field">
                      <span>Recovery code</span>
                      <input
                        type="text"
                        value={recoveryCode}
                        placeholder="BCRK-XXXX-XXXX-…"
                        onChange={(e) => setRecoveryCode(e.target.value)}
                        data-testid="sync-recovery-code"
                      />
                    </label>
                  )}
                  {mode === 'recover' && recoverNeedsCode && (
                    <label className="sync-field">
                      <span>Code from your authenticator app (or a recovery code)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        autoFocus
                        value={totpCode}
                        placeholder="123 456"
                        data-testid="sync-recover-totp"
                        onChange={(e) => setTotpCode(e.target.value)}
                      />
                      <small className="sync-hint">
                        This account has two-factor authentication. The recovery code stands in for
                        the password, not for the authenticator.
                      </small>
                    </label>
                  )}
                  <label className="sync-field">
                    <span>{mode === 'recover' ? 'New password' : 'Password'}</span>
                    <input
                      type="password"
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="sync-password"
                    />
                  </label>
                  {mode === 'register' && (
                    <label className="sync-field">
                      <span>Your name</span>
                      <input
                        type="text"
                        required
                        autoComplete="name"
                        value={fullName}
                        placeholder="First and last name"
                        maxLength={120}
                        onChange={(e) => setFullName(e.target.value)}
                        data-testid="sync-name"
                      />
                    </label>
                  )}
                  {mode === 'register' && (
                    <label className="sync-field">
                      <span>Email</span>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        placeholder="you@example.com"
                        onChange={(e) => setEmail(e.target.value)}
                        data-testid="sync-email"
                      />
                    </label>
                  )}
                  {mode === 'register' && (
                    <label className="sync-consent">
                      <input
                        type="checkbox"
                        checked={newsletter}
                        onChange={(e) => setNewsletter(e.target.checked)}
                        data-testid="sync-newsletter"
                      />
                      <span>
                        Email me boardCache updates
                        <small>Product news. Never shared, unsubscribe any time.</small>
                      </span>
                    </label>
                  )}
                  {mode === 'register' && plans.billing && !granted && (
                    <fieldset className="sync-plans" data-testid="sync-plans">
                      <legend>Plan</legend>
                      <div className="sync-plan-list" role="radiogroup" aria-label="Plan">
                        {(['free', 'personal', 'team'] as const).map((id) => (
                          <label
                            key={id}
                            className={`sync-plan${plan === id ? ' active' : ''}`}
                            data-testid={`sync-plan-${id}`}
                          >
                            <input
                              type="radio"
                              name="plan"
                              value={id}
                              checked={plan === id}
                              onChange={() => setPlan(id)}
                            />
                            <span className="sync-plan-name">{PLAN_COPY[id].name}</span>
                            <span className="sync-plan-price">
                              {id === 'free' ? '$0' : PRICES[id][interval]}
                            </span>
                            <span className="sync-plan-line">{PLAN_COPY[id].line}</span>
                          </label>
                        ))}
                      </div>
                      {plan !== 'free' && (
                        <div
                          className="plan-interval"
                          role="radiogroup"
                          aria-label="Billing period"
                        >
                          {(['month', 'yearly'] as const).map((k) => (
                            <button
                              key={k}
                              type="button"
                              role="radio"
                              aria-checked={period === k}
                              className={period === k ? 'active' : ''}
                              data-testid={`sync-interval-${k === 'month' ? 'month' : 'year'}`}
                              onClick={() => setPeriod(k)}
                            >
                              {k === 'month'
                                ? INTERVAL_LABELS.month
                                : plans.foundingOpen
                                  ? INTERVAL_LABELS.founding
                                  : INTERVAL_LABELS.year}
                            </button>
                          ))}
                        </div>
                      )}
                      <small className="sync-hint">
                        {plan === 'free'
                          ? 'Upgrade any time from Settings → Sync.'
                          : 'Checkout opens once your account exists; change or cancel any time.'}
                      </small>
                    </fieldset>
                  )}
                  {mode === 'register' && inviteOnly && (
                    <label className="sync-field">
                      <span>Invite code</span>
                      <input
                        type="text"
                        required
                        autoComplete="off"
                        spellCheck={false}
                        value={inviteCode}
                        placeholder="BC-XXXX-XXXX-XXXX"
                        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                        data-testid="sync-invite"
                      />
                      <small className="sync-hint" data-testid="sync-invite-hint">
                        {inviteGrant ? (
                          <>
                            This invite includes {PLAN_COPY[inviteGrant.plan].name}
                            {inviteGrant.days === 'forever'
                              ? ', free for good.'
                              : `, free for ${inviteGrant.days} days. Upgrade any time.`}
                          </>
                        ) : invited && inviteCode === invited ? (
                          'Your invite code, from the link you opened.'
                        ) : (
                          <>
                            The beta is invite-only. No code yet?{' '}
                            <a
                              href="https://boardcache.com/waitlist"
                              target="_blank"
                              rel="noopener"
                            >
                              Join the waitlist
                            </a>
                            .
                          </>
                        )}
                      </small>
                    </label>
                  )}
                </>
              )}

              {error && (
                <p className="sync-error" role="alert" data-testid="sync-error">
                  {error}
                </p>
              )}
              {mode === 'register' && (
                <p className="sync-note sync-legal" data-testid="sync-legal">
                  By creating an account you agree to the{' '}
                  <a href="https://boardcache.com/terms" target="_blank" rel="noopener">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="https://boardcache.com/privacy" target="_blank" rel="noopener">
                    Privacy Policy
                  </a>
                  .
                </p>
              )}

              <div className="sync-actions">
                <button
                  type="submit"
                  className="sync-primary"
                  disabled={busy || status === 'loading'}
                  data-testid="sync-submit"
                >
                  {busy
                    ? 'Please wait'
                    : mfa
                      ? 'Verify'
                      : mode === 'login'
                        ? 'Sign in'
                        : mode === 'recover'
                          ? 'Recover account'
                          : 'Create account'}
                </button>
                {mfa && (
                  <button
                    type="button"
                    className="sync-link"
                    onClick={() => useSyncStore.getState().cancelMfa()}
                    data-testid="sync-mfa-cancel"
                  >
                    Back
                  </button>
                )}
                {!mfa && (
                  <button
                    type="button"
                    className="sync-link"
                    onClick={() => {
                      setMode(mode === 'login' ? 'register' : 'login');
                      useSyncStore.getState().clearError();
                    }}
                    data-testid="sync-toggle-mode"
                  >
                    {mode === 'login' ? 'Create an account' : 'I already have an account'}
                  </button>
                )}
                {mode === 'login' && (
                  <button
                    type="button"
                    className="sync-link"
                    onClick={() => {
                      setMode('recover');
                      useSyncStore.getState().clearError();
                    }}
                    data-testid="sync-forgot"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              {mode === 'recover' && (
                <p className="sync-note" data-testid="sync-recover-note">
                  Enter the recovery code from your recovery kit and pick a new password — your
                  synced boards stay intact. The code is single-use; generate a fresh kit afterwards
                  in Settings → Sync.
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </UiDialog>
  );
}
