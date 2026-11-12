import { useState } from 'react';
import { UiDialog } from '../../components/ui/Dialog';
import { confirmDialog } from '../../components/ui/Prompt';
import { showNotice } from '../../lib/notices';
import { accountById, blankServer, removeAccount, saveAccount, type MailServer } from './accounts';
import { testAccount } from './mailApi';
import { BOARD_ACCOUNT, useEmailUi } from './store';

/**
 * Add or edit a mail account: a name and the address, the IMAP server and
 * the SMTP server (the same sign-in unless told otherwise), a test button
 * that connects to both through the sync server, and Delete for an
 * account being edited. The passwords stay on this device.
 */

export function AccountDialog() {
  const dialog = useEmailUi((s) => s.accountDialog);
  if (!dialog) return null;
  return <AccountForm key={dialog.id ?? 'new'} id={dialog.id} />;
}

function AccountForm({ id }: { id: string | null }) {
  const existing = accountById(id);
  const [name, setName] = useState(existing?.name ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [imap, setImap] = useState<MailServer>(existing?.imap ?? blankServer(993));
  const [smtp, setSmtp] = useState<MailServer>(existing?.smtp ?? blankServer(465));
  const [sameLogin, setSameLogin] = useState(
    !existing ||
      (existing.smtp.user === existing.imap.user && existing.smtp.pass === existing.imap.pass),
  );
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const close = () => useEmailUi.getState().setAccountDialog(null);

  const smtpFinal = (): MailServer =>
    sameLogin ? { ...smtp, user: imap.user, pass: imap.pass } : smtp;
  const complete = email.trim() && imap.host.trim() && imap.user && smtp.host.trim();

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const out = await testAccount(imap, smtpFinal());
      setResult(
        out.smtp === false
          ? 'IMAP signed in; the SMTP server refused the sign-in.'
          : 'Signed in to both servers.',
      );
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'The test failed.');
    } finally {
      setTesting(false);
    }
  };
  const save = () => {
    if (!complete) return;
    const saved = saveAccount({
      ...(id ? { id } : {}),
      name: name.trim() || email.trim(),
      email: email.trim(),
      imap: { ...imap, host: imap.host.trim() },
      smtp: { ...smtpFinal(), host: smtp.host.trim() },
    });
    close();
    useEmailUi.getState().setAccount(saved.id);
    showNotice(id ? 'Account saved.' : 'Account added.');
  };
  const remove = async () => {
    if (!id) return;
    const ok = await confirmDialog({
      title: 'Remove this account?',
      body: 'Its sign-in leaves this device. Messages saved to boards stay.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    removeAccount(id);
    close();
    useEmailUi.getState().setAccount(BOARD_ACCOUNT);
  };
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();

  const serverFields = (
    label: string,
    s: MailServer,
    set: (next: MailServer) => void,
    prefix: string,
    login: boolean,
  ) => (
    <>
      <div className="email-account-row">
        <label className="plugin-settings-field email-account-host">
          <span>{label} server</span>
          <input
            value={s.host}
            placeholder={prefix === 'imap' ? 'imap.example.com' : 'smtp.example.com'}
            autoComplete="off"
            data-testid={`email-${prefix}-host`}
            onChange={(e) => set({ ...s, host: e.target.value })}
            onKeyDown={stop}
          />
        </label>
        <label className="plugin-settings-field email-account-port">
          <span>Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={s.port}
            data-testid={`email-${prefix}-port`}
            onChange={(e) => set({ ...s, port: Number(e.target.value) || 0 })}
            onKeyDown={stop}
          />
        </label>
        <label className="plugin-settings-check">
          <input
            type="checkbox"
            checked={s.secure}
            data-testid={`email-${prefix}-secure`}
            onChange={(e) => set({ ...s, secure: e.target.checked })}
          />
          <span>TLS</span>
        </label>
      </div>
      {login && (
        <div className="email-account-row">
          <label className="plugin-settings-field">
            <span>User name</span>
            <input
              value={s.user}
              autoComplete="off"
              data-testid={`email-${prefix}-user`}
              onChange={(e) => set({ ...s, user: e.target.value })}
              onKeyDown={stop}
            />
          </label>
          <label className="plugin-settings-field">
            <span>Password</span>
            <input
              type="password"
              value={s.pass}
              autoComplete="new-password"
              data-testid={`email-${prefix}-pass`}
              onChange={(e) => set({ ...s, pass: e.target.value })}
              onKeyDown={stop}
            />
          </label>
        </div>
      )}
    </>
  );

  return (
    <UiDialog
      title={existing ? 'Edit Account' : 'Add Mail Account'}
      onClose={close}
      size="wide"
      testId="email-account-dialog"
    >
      <div className="plugin-settings-fields email-account-form">
        <div className="email-account-row">
          <label className="plugin-settings-field">
            <span>Name</span>
            <input
              value={name}
              placeholder="Work"
              autoFocus
              data-testid="email-account-name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={stop}
            />
          </label>
          <label className="plugin-settings-field">
            <span>Email address</span>
            <input
              type="email"
              value={email}
              placeholder="you@example.com"
              autoComplete="off"
              data-testid="email-account-email"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={stop}
            />
          </label>
        </div>
        {serverFields('IMAP', imap, setImap, 'imap', true)}
        {serverFields('SMTP', smtp, setSmtp, 'smtp', !sameLogin)}
        <label className="plugin-settings-check">
          <input
            type="checkbox"
            checked={sameLogin}
            data-testid="email-smtp-same"
            onChange={(e) => setSameLogin(e.target.checked)}
          />
          <span>SMTP uses the IMAP sign-in</span>
        </label>
        <p className="settings-hint">
          The sign-in stays on this device (and in your encrypted settings sync). Your sync server
          connects to the mail servers for you and keeps nothing.
        </p>
        {result && (
          <p className="email-account-result" data-testid="email-account-result">
            {result}
          </p>
        )}
        <div className="ui-prompt-actions">
          {existing && (
            <button type="button" data-testid="email-account-remove" onClick={() => void remove()}>
              Remove
            </button>
          )}
          <button
            type="button"
            data-testid="email-account-test"
            disabled={testing || !imap.host.trim()}
            onClick={() => void test()}
          >
            {testing ? 'Testing' : 'Test'}
          </button>
          <span className="email-spacer" />
          <button
            type="button"
            className="sync-primary"
            data-testid="email-account-save"
            disabled={!complete}
            onClick={save}
          >
            {existing ? 'Save' : 'Add Account'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
