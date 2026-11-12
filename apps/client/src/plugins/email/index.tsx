import './style.css';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import type { Item } from '@boardcache/schema';
import { FolderInputIcon, MailIcon, PencilIcon, TrashIcon } from '../../components/icons';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { addParsedEmail, importEmailFiles } from '../../lib/import/importEmail';
import {
  addressList,
  boardEmails,
  emailFolderOf,
  emailTitle,
  headersText,
} from '../../lib/mail/email';
import { parseRfc822 } from '../../lib/mail/parseEmail';
import { requireType } from '../../lib/tools/shared';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { openPluginView, registerPlugin } from '../registry';
import { AccountDialog } from './AccountDialog';
import { removeAccount, useMailAccounts } from './accounts';
import { ComposeDialog } from './ComposeDialog';
import { EmailView } from './EmailView';
import { BOARD_ACCOUNT, useEmailUi } from './store';

/**
 * Email: messages on the board (dropped .eml, .emlx, .mbox and .msg
 * files, or saved from an account) and the Email view — a small mail
 * client over IMAP/SMTP accounts, reached through the sync server, with
 * the board's archive as its first account.
 */

const VIEW_ID = 'email';

function openEmail(itemId?: string): void {
  const ui = useEmailUi.getState();
  if (itemId) {
    ui.setAccount(BOARD_ACCOUNT);
    ui.setSelected(BOARD_ACCOUNT, itemId);
  }
  // The full view replaces whatever was showing — including the lightbox.
  useSessionStore.getState().setLightbox(null);
  openPluginView(VIEW_ID);
}

function EmailHost() {
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { itemId } = (e as CustomEvent<{ itemId?: string }>).detail ?? {};
      openEmail(itemId);
    };
    const onImport = () => fileInput.current?.click();
    window.addEventListener('boardcache:open-email', onOpen);
    window.addEventListener('boardcache:import-email', onImport);
    return () => {
      window.removeEventListener('boardcache:open-email', onOpen);
      window.removeEventListener('boardcache:import-email', onImport);
    };
  }, []);
  return (
    <>
      <AccountDialog />
      <ComposeDialog />
      <input
        ref={fileInput}
        type="file"
        accept=".eml,.emlx,.mbox,.mbx,.msg,message/rfc822"
        multiple
        hidden
        data-testid="email-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length)
            void importEmailFiles(
              files,
              clientToCanvas(window.innerWidth / 2, window.innerHeight / 2),
            );
        }}
      />
    </>
  );
}

/** Settings → Plugins → Email: the accounts, each with its editor. */
function EmailSettingsPanel() {
  const accounts = useMailAccounts();
  return (
    <div className="plugin-settings-fields">
      <p className="settings-hint">
        Mail accounts reach their IMAP and SMTP servers through your sync server, which connects for
        each request and keeps nothing. The sign-ins stay on this device and in your encrypted
        settings sync.
      </p>
      <div className="email-settings-accounts" data-testid="email-settings-accounts">
        {accounts.map((a) => (
          <div key={a.id} className="email-settings-account" data-testid="email-settings-account">
            <span className="email-settings-name">
              <MailIcon size={14} /> {a.name || a.email}
              <span className="email-settings-sub">{a.email}</span>
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-testid="email-settings-edit"
              onClick={() => useEmailUi.getState().setAccountDialog({ id: a.id })}
            >
              <PencilIcon size={13} /> Edit
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-danger"
              data-testid="email-settings-remove"
              onClick={() => removeAccount(a.id)}
            >
              <TrashIcon size={13} /> Remove
            </button>
          </div>
        ))}
      </div>
      <div>
        <button
          type="button"
          className="btn btn-sm"
          data-testid="email-settings-add"
          onClick={() => useEmailUi.getState().setAccountDialog({ id: null })}
        >
          Add Account
        </button>
      </div>
    </div>
  );
}

registerPlugin({
  manifest: {
    id: 'email',
    order: 58,
    name: 'Email',
    description:
      'Email messages on the board (drop .eml, .emlx, .mbox or .msg files) and an Email view: a small mail client over your IMAP/SMTP accounts, reached through your sync server.',
  },
  addMenu: [
    {
      label: 'Import Email Files',
      category: 'structure',
      icon: <FolderInputIcon />,
      onSelect: () => window.dispatchEvent(new CustomEvent('boardcache:import-email')),
    },
  ],
  Component: EmailHost,
  SettingsPanel: EmailSettingsPanel,
  itemMenu: (item: Item) =>
    item.type === 'email'
      ? [
          {
            kind: 'action',
            label: 'Open in Email',
            icon: <MailIcon />,
            onSelect: () => openEmail(item.id),
          },
        ]
      : [],
  views: [
    {
      id: VIEW_ID,
      label: 'Email',
      icon: <MailIcon />,
      Component: EmailView,
      // /b/:id/email[/:itemId]: a board message on the right.
      subPath: () => {
        const ui = useEmailUi.getState();
        const id = ui.accountId === BOARD_ACCOUNT ? ui.selected[BOARD_ACCOUNT] : null;
        return id ? [id] : [];
      },
      applySubPath: (segments) => {
        const [id] = segments;
        if (id && useDocumentStore.getState().doc.items[id]?.type === 'email') {
          useEmailUi.getState().setAccount(BOARD_ACCOUNT);
          useEmailUi.getState().setSelected(BOARD_ACCOUNT, id);
        }
      },
    },
  ],
  tools: [
    {
      name: 'list_emails',
      description:
        'The email messages on the board: each with its id, subject, sender, recipients, date, archive folder and attachment names. read_email gives the text and headers.',
      parameters: z.object({
        folder: z.string().optional().describe('Only messages in this archive folder'),
      }),
      access: 'read',
      execute: (args, ctx) =>
        boardEmails(ctx.doc())
          .filter((e) => args.folder === undefined || emailFolderOf(e) === args.folder)
          .map((e) => ({
            id: e.id,
            subject: e.subject,
            from: addressList(e.from),
            to: addressList(e.to),
            cc: addressList(e.cc),
            date: e.date,
            folder: emailFolderOf(e),
            attachments: e.attachments.map((a) => a.name),
          })),
    },
    {
      name: 'read_email',
      description:
        'One email message on the board in full: the envelope, the text body, the attachment list and, when asked, every header line.',
      parameters: z.object({
        id: z.string(),
        headers: z.boolean().optional().describe('Include the full headers (default false)'),
      }),
      access: 'read',
      execute: (args, ctx) => {
        const e = requireType(ctx, args.id, 'email');
        return {
          id: e.id,
          title: emailTitle(e),
          subject: e.subject,
          from: e.from,
          to: e.to,
          cc: e.cc,
          replyTo: e.replyTo,
          date: e.date,
          messageId: e.messageId,
          text: e.text,
          hasHtml: e.html !== null,
          attachments: e.attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size })),
          folder: emailFolderOf(e),
          ...(args.headers ? { headers: headersText(e) } : {}),
        };
      },
    },
    {
      name: 'add_email',
      description:
        'Put an email message on the board from its source text (RFC 822 / .eml as a string): the subject, the parties, the body and the attachments are read from it.',
      parameters: z.object({
        source: z.string().min(10).describe('The message as an .eml file reads'),
        folder: z.string().optional().describe('The archive folder to file it under'),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      access: 'write',
      execute: async (args, ctx) => {
        const parsed = await parseRfc822(new TextEncoder().encode(args.source));
        const centre = ctx.viewCenter();
        const id = await addParsedEmail(
          parsed,
          { x: args.x ?? centre.x, y: args.y ?? centre.y },
          args.folder ? { folder: args.folder } : {},
        );
        return { id, subject: parsed.subject };
      },
    },
  ],
});
