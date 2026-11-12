import { newId } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import { getPluginSettings, usePluginSettings } from '../settingsStore';

/**
 * Mail accounts live in the plugin's settings on this device (and in the
 * encrypted settings sync when signed in): the server never keeps them. A
 * request to the sync server carries the account it is for, and the server
 * connects on the caller's behalf for that request alone.
 */

const PLUGIN_ID = 'email';

export interface MailServer {
  host: string;
  port: number;
  /** TLS from the start (993 / 465); off = STARTTLS where the server offers it. */
  secure: boolean;
  user: string;
  pass: string;
}

export interface MailAccount {
  id: string;
  /** How the account is listed ("Work"). */
  name: string;
  /** The address mail goes out as. */
  email: string;
  imap: MailServer;
  smtp: MailServer;
}

interface EmailSettings {
  accounts?: MailAccount[];
}

function clean(list: unknown): MailAccount[] {
  return Array.isArray(list)
    ? (list as MailAccount[]).filter((a) => a && typeof a === 'object' && typeof a.id === 'string')
    : [];
}

/** The accounts, reactive (a shallow compare: the list is rebuilt per read). */
export function useMailAccounts(): MailAccount[] {
  return usePluginSettings(
    useShallow((s) => clean((s.settings[PLUGIN_ID] as EmailSettings | undefined)?.accounts)),
  );
}

function mailAccounts(): MailAccount[] {
  return clean((getPluginSettings(PLUGIN_ID) as EmailSettings | undefined)?.accounts);
}

export function accountById(id: string | null): MailAccount | null {
  return id ? (mailAccounts().find((a) => a.id === id) ?? null) : null;
}

function save(accounts: MailAccount[]): void {
  const current = (getPluginSettings(PLUGIN_ID) as EmailSettings | undefined) ?? {};
  usePluginSettings.getState().set(PLUGIN_ID, { ...current, accounts });
}

/** Add or replace an account (by id); returns the saved account. */
export function saveAccount(account: Omit<MailAccount, 'id'> & { id?: string }): MailAccount {
  const saved: MailAccount = { ...account, id: account.id ?? newId() };
  const list = mailAccounts();
  const at = list.findIndex((a) => a.id === saved.id);
  if (at >= 0) list[at] = saved;
  else list.push(saved);
  save(list);
  return saved;
}

export function removeAccount(id: string): void {
  save(mailAccounts().filter((a) => a.id !== id));
}

export function blankServer(port: number): MailServer {
  return { host: '', port, secure: true, user: '', pass: '' };
}
