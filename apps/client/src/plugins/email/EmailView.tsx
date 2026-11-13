import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EmailAddress, EmailItem } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import {
  BoardsIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  FolderIcon,
  FolderOpenIcon,
  ForwardIcon,
  GearIcon,
  InboxIcon,
  LoopIcon,
  MailIcon,
  MailOpenIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  ReplyAllIcon,
  ReplyIcon,
  SearchIcon,
  TrashIcon,
} from '../../components/icons';
import { ThemeToggle } from '../../components/chrome/ThemeToggle';
import { PopOutViewButton } from '../../components/chrome/PopOutViewButton';
import { ViewBarButton } from '../../components/chrome/ViewBarButton';
import {
  EmailReader,
  emailViewOfItem,
  type EmailView as ReaderView,
} from '../../components/items/EmailReader';
import { confirmDialog } from '../../components/ui/Prompt';
import { UiSelect } from '../../components/ui/Select';
import { useMobileViewport } from '../../hooks/useMobileViewport';
import { revealItemPage } from '../../lib/board/pages';
import { getCanvasContainer } from '../../lib/canvas/canvasDom';
import { screenToCanvas } from '../../lib/canvas/coords';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { addParsedEmail } from '../../lib/import/importEmail';
import {
  addressList,
  addressShort,
  boardEmails,
  emailFolderOf,
  emailSender,
  emailSnippet,
  emailTitle,
  formatEmailDate,
} from '../../lib/mail/email';
import { parseRfc822, type ParsedEmail } from '../../lib/mail/parseEmail';
import { MAX_EMAIL_HTML, sanitizeEmailHtml } from '../../lib/mail/sanitizeEmailHtml';
import { usePlatformCaps } from '../../lib/platform';
import { syncUrl } from '../../lib/router';
import { buildFolderTree, countItems, type FolderNode } from '../../lib/structure/folders';
import { textFromHtml } from '../../lib/text/safeUrl';
import { showNotice } from '../../lib/notices';
import { removeItems, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useMailAccounts, type MailAccount } from './accounts';
import { loadPage } from './pages';
import {
  deleteMessage,
  deleteMessages,
  fetchFolders,
  fetchSource,
  setFlags,
  setFlagsMany,
  type MailFolder,
  type MailSummary,
} from './mailApi';
import {
  BOARD_ACCOUNT,
  openKey,
  pageKey,
  useEmailUi,
  type ComposeDraft,
  type OpenMessage,
} from './store';

/**
 * The Email view: an inbox on the gallery chassis. The account selector
 * and its folders on the left (the board's own archive is the first
 * "account"), the folder's messages in the middle, the open message in
 * the reader on the right. Mail accounts reach their servers through the
 * sync server; pages read once are kept for the session. Phones show one
 * pane at a time.
 */

const SPECIAL_ORDER = ['\\Inbox', '\\Drafts', '\\Sent', '\\Archive', '\\Junk', '\\Trash'];

function folderRank(f: MailFolder): number {
  if (f.path.toUpperCase() === 'INBOX') return -1;
  const at = f.specialUse ? SPECIAL_ORDER.indexOf(f.specialUse) : -1;
  return at < 0 ? SPECIAL_ORDER.length : at;
}

/** IMAP folders as a tree by their delimiter, special folders first. */
function imapTree(folders: MailFolder[]): FolderNode<MailFolder> {
  const root: FolderNode<MailFolder> = { path: '', name: 'Folders', children: [], items: [] };
  const nodes = new Map<string, FolderNode<MailFolder>>([['', root]]);
  const sorted = [...folders].sort(
    (a, b) =>
      folderRank(a) - folderRank(b) ||
      a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }),
  );
  for (const f of sorted) {
    const parts = f.delimiter ? f.path.split(f.delimiter) : [f.path];
    const parentPath = parts.slice(0, -1).join(f.delimiter || '/');
    const parent = nodes.get(parentPath) ?? root;
    const node: FolderNode<MailFolder> = { path: f.path, name: f.name, children: [], items: [f] };
    parent.children.push(node);
    nodes.set(f.path, node);
  }
  return root;
}

/** Whether an account's own address is in a list (replies leave it out). */
const isOwn = (a: EmailAddress, account: MailAccount) =>
  a.address.trim().toLowerCase() === account.email.trim().toLowerCase();

const quoted = (m: ReaderView): string =>
  `\n\nOn ${formatEmailDate(m.date, true) || 'an earlier date'}, ${addressList(m.from) || 'someone'} wrote:\n${(
    m.text || ''
  )
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')}`;

/** A reply, a reply to all, or a forward of a message as a compose draft. */
function draftFor(
  kind: 'reply' | 'replyAll' | 'forward',
  m: ReaderView,
  ids: { messageId: string | null; references: string | null },
  account: MailAccount,
): ComposeDraft {
  const subject = m.subject.replace(/^\s*(re|fwd?)\s*:\s*/i, '');
  if (kind === 'forward') {
    return {
      accountId: account.id,
      to: '',
      cc: '',
      bcc: '',
      subject: `Fwd: ${subject}`,
      text: `\n\n---------- Forwarded message ----------\nFrom: ${addressList(m.from)}\nDate: ${formatEmailDate(m.date, true)}\nSubject: ${m.subject}\nTo: ${addressList(m.to)}\n\n${m.text}`,
    };
  }
  const replyTo = (m.replyTo.length ? m.replyTo : m.from).filter((a) => !isOwn(a, account));
  const others =
    kind === 'replyAll'
      ? [...m.to, ...m.cc].filter(
          (a) => !isOwn(a, account) && !replyTo.some((r) => r.address === a.address),
        )
      : [];
  const refs = [ids.references, ids.messageId].filter(Boolean).join(' ');
  return {
    accountId: account.id,
    to: addressList(replyTo),
    cc: addressList(others),
    bcc: '',
    subject: `Re: ${subject}`,
    text: quoted(m),
    ...(ids.messageId ? { inReplyTo: ids.messageId } : {}),
    ...(refs ? { references: refs } : {}),
  };
}

/** A fetched message, parsed and sanitised for the reader. */
function openOf(key: string, parsed: ParsedEmail, raw: Uint8Array): OpenMessage {
  const html =
    parsed.html && parsed.html.length <= MAX_EMAIL_HTML ? sanitizeEmailHtml(parsed.html) : null;
  const text =
    parsed.text.trim() ||
    (parsed.html ? textFromHtml(parsed.html).replace(/\s+/g, ' ').trim() : '');
  const references =
    parsed.headers.find((h) => h.name.toLowerCase() === 'references')?.value ?? null;
  return {
    key,
    raw,
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo,
    references,
    view: {
      subject: parsed.subject,
      from: parsed.from,
      to: parsed.to,
      cc: parsed.cc,
      replyTo: parsed.replyTo,
      date: parsed.date,
      text,
      html,
      headers: parsed.headers,
      attachments: parsed.attachments.map((a) => ({
        name: a.name,
        mime: a.mime,
        size: a.bytes.byteLength,
        cid: a.cid,
        load: async () =>
          new Blob(
            [
              a.bytes.buffer.slice(
                a.bytes.byteOffset,
                a.bytes.byteOffset + a.bytes.byteLength,
              ) as ArrayBuffer,
            ],
            {
              type: a.mime,
            },
          ),
      })),
    },
  };
}

async function loadFolders(account: MailAccount): Promise<void> {
  const ui = useEmailUi.getState();
  ui.setFolders(account.id, {
    list: ui.folders[account.id]?.list ?? [],
    loading: true,
    error: null,
  });
  try {
    const list = await fetchFolders(account);
    useEmailUi.getState().setFolders(account.id, { list, loading: false, error: null });
  } catch (err) {
    useEmailUi.getState().setFolders(account.id, {
      list: ui.folders[account.id]?.list ?? [],
      loading: false,
      error: err instanceof Error ? err.message : 'The folders could not be read.',
    });
  }
}

/** Fetch and parse one message; marks it read on the server. */
async function openMessage(account: MailAccount, folder: string, msg: MailSummary): Promise<void> {
  const key = openKey(account.id, folder, msg.uid);
  const ui = useEmailUi.getState();
  if (ui.open[key] && !('error' in ui.open[key]!)) return;
  ui.setOpen(key, { key, loading: true });
  try {
    const raw = await fetchSource(account, folder, msg.uid);
    const parsed = await parseRfc822(raw);
    useEmailUi.getState().setOpen(key, openOf(key, parsed, raw));
    if (!msg.seen) {
      void setFlags(account, folder, msg.uid, { add: ['\\Seen'] }).then(() =>
        useEmailUi
          .getState()
          .setPageMessages(pageKey(account.id, folder), (list) =>
            list.map((m) => (m.uid === msg.uid ? { ...m, seen: true } : m)),
          ),
      );
    }
  } catch (err) {
    useEmailUi.getState().setOpen(key, {
      key,
      error: err instanceof Error ? err.message : 'The message could not be read.',
    });
  }
}

export function EmailView() {
  const accounts = useMailAccounts();
  const accountId = useEmailUi((s) => s.accountId);
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const onBoard = accountId === BOARD_ACCOUNT || !account;
  const mobile = useMobileViewport();
  const pane = useEmailUi((s) => s.pane);
  const caps = usePlatformCaps();
  const back = () => useSessionStore.getState().setView('canvas');
  const folder = useEmailUi((s) => s.folder[accountId] ?? '');
  const selected = useEmailUi((s) => s.selected[accountId] ?? null);

  useEffect(() => {
    syncUrl();
  }, [accountId, selected]);
  // An account's folders load when it comes into view; its inbox first.
  useEffect(() => {
    if (!account) return;
    if (!useEmailUi.getState().folders[account.id]) void loadFolders(account);
  }, [account]);
  const folderCount = useEmailUi((s) => s.folders[accountId]?.list.length ?? 0);
  useEffect(() => {
    if (!account || !folderCount) return;
    const list = useEmailUi.getState().folders[account.id]?.list ?? [];
    if (!folder) {
      const inbox =
        list.find((f) => f.path.toUpperCase() === 'INBOX') ?? list.find((f) => !f.noSelect);
      if (inbox) useEmailUi.getState().setFolder(account.id, inbox.path);
    }
  }, [account, folder, folderCount]);
  useEffect(() => {
    if (!account || !folder) return;
    if (!useEmailUi.getState().pages[pageKey(account.id, folder)]) void loadPage(account, folder);
  }, [account, folder]);

  const options = [
    { value: BOARD_ACCOUNT, label: 'This board' },
    ...accounts.map((a) => ({ value: a.id, label: a.name || a.email })),
  ];
  const sideW = useEmailUi((s) => s.sideW);
  const listW = useEmailUi((s) => s.listW);
  const composeAccount = account ?? accounts[0] ?? null;
  const showFolders = !mobile || pane === 'folders';
  const showList = !mobile || pane === 'list';
  const showReader = !mobile || pane === 'reader';
  const ui = () => useEmailUi.getState();

  return (
    <div className="gallery-screen email-screen" data-testid="email-screen">
      <header className="gallery-header view-bar email-bar">
        <div className="gallery-header-left">
          <ViewBarButton
            label="Back to canvas"
            icon={<BoardsIcon size={16} />}
            testId="email-back"
            onClick={back}
          />
          <h1>Email</h1>
        </div>
        <div className="gallery-actions">
          <PopOutViewButton testId="email-popout" />
          <ThemeToggle className="view-icon-btn" testId="email-theme-toggle" />
        </div>
      </header>
      <div className={`email-body${mobile ? ' email-one-pane' : ''}`}>
        {showFolders && (
          <aside
            className="email-side"
            data-testid="email-side"
            style={mobile ? undefined : { width: sideW }}
          >
            <div className="email-account-pick">
              <UiSelect
                value={accountId}
                options={options}
                onChange={(v) => ui().setAccount(v)}
                ariaLabel="Account"
                testId="email-account"
              />
              <button
                type="button"
                className="view-icon-btn"
                title={account ? 'Account settings' : 'Add a mail account'}
                aria-label={account ? 'Account settings' : 'Add a mail account'}
                data-testid="email-account-settings"
                onClick={() => ui().setAccountDialog({ id: account?.id ?? null })}
              >
                {account ? <GearIcon size={16} /> : <PlusIcon size={16} />}
              </button>
            </div>
            {onBoard ? <BoardFolders /> : <AccountFolders account={account} />}
            {!caps.mail && accounts.length > 0 && (
              <p className="email-side-note" data-testid="email-offline">
                Mail accounts need your sync server and a sign-in under Board sync.
              </p>
            )}
            {mobile && (
              <button
                type="button"
                className="btn btn-sm email-pane-next"
                onClick={() => ui().setPane('list')}
              >
                Messages <ChevronRightIcon size={14} />
              </button>
            )}
          </aside>
        )}
        {!mobile && <PaneHandle pane="side" />}
        {showList && (
          <section
            className="email-list"
            data-testid="email-list"
            style={mobile ? undefined : { width: listW }}
          >
            {mobile && (
              <button
                type="button"
                className="email-page-back"
                data-testid="email-list-back"
                onClick={() => ui().setPane('folders')}
              >
                <ChevronLeftIcon size={16} /> Folders
              </button>
            )}
            {composeAccount && (
              <button
                type="button"
                className="btn btn-sm email-compose-btn"
                data-testid="email-new"
                disabled={!caps.mail}
                onClick={() =>
                  ui().setCompose({
                    accountId: composeAccount.id,
                    to: '',
                    cc: '',
                    bcc: '',
                    subject: '',
                    text: '',
                  })
                }
              >
                <PencilIcon size={14} /> Compose
              </button>
            )}
            {onBoard ? <BoardList /> : <AccountList account={account} folder={folder} />}
          </section>
        )}
        {!mobile && <PaneHandle pane="list" />}
        {showReader && (
          <main className="email-detail" data-testid="email-detail">
            {onBoard ? (
              <BoardReader id={selected} mobile={mobile} />
            ) : (
              <AccountReader account={account} folder={folder} uid={selected} mobile={mobile} />
            )}
          </main>
        )}
      </div>
    </div>
  );
}

/* --- The board's own archive ------------------------------------------------ */

function BoardFolders() {
  const doc = useDocumentStore((s) => s.doc);
  const tree = useMemo(
    () =>
      buildFolderTree(
        boardEmails(doc),
        emailFolderOf,
        doc.settings.emailFolders,
        'Messages',
        () => 0,
      ),
    [doc],
  );
  const folder = useEmailUi((s) => s.folder[BOARD_ACCOUNT] ?? '');
  const total = countItems(tree);
  return (
    <div className="email-folders" role="tree" aria-label="Folders">
      <button
        type="button"
        role="treeitem"
        aria-selected={folder === ''}
        className={`email-folder-row${folder === '' ? ' active' : ''}`}
        data-testid="email-folder"
        onClick={() => useEmailUi.getState().setFolder(BOARD_ACCOUNT, '')}
      >
        <InboxIcon size={14} />
        <span className="email-folder-name">All messages</span>
        <span className="email-folder-count">{total}</span>
      </button>
      {tree.children.map((node) => (
        <GenericFolderRow
          key={node.path}
          node={node}
          depth={0}
          count={countItems(node)}
          active={folder}
          accountId={BOARD_ACCOUNT}
        />
      ))}
    </div>
  );
}

function GenericFolderRow<T>({
  node,
  depth,
  count,
  active,
  accountId,
  unseen,
}: {
  node: FolderNode<T>;
  depth: number;
  count: number | null;
  active: string;
  accountId: string;
  unseen?: number | null;
}) {
  const collapsed = useEmailUi((s) => s.collapsed.has(`${accountId}:${node.path}`));
  const hasChildren = node.children.length > 0;
  return (
    <div
      className="email-folder"
      role="treeitem"
      aria-expanded={hasChildren ? !collapsed : undefined}
    >
      <button
        type="button"
        className={`email-folder-row${active === node.path ? ' active' : ''}${unseen ? ' unread' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        data-testid="email-folder"
        onClick={() => useEmailUi.getState().setFolder(accountId, node.path)}
      >
        <span
          className="email-folder-chevron"
          onClick={(e) => {
            if (!hasChildren) return;
            e.stopPropagation();
            useEmailUi.getState().toggleFolder(`${accountId}:${node.path}`);
          }}
        >
          {hasChildren ? (
            collapsed ? (
              <ChevronRightIcon size={12} />
            ) : (
              <ChevronDownIcon size={12} />
            )
          ) : null}
        </span>
        {active === node.path ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />}
        <span className="email-folder-name">{node.name}</span>
        {unseen ? (
          <span className="email-folder-count unread" data-testid="email-folder-unseen">
            {unseen}
          </span>
        ) : count !== null ? (
          <span className="email-folder-count">{count}</span>
        ) : null}
      </button>
      {hasChildren && !collapsed && (
        <div className="email-folder-children" role="group">
          {node.children.map((c) => (
            <GenericFolderRow
              key={c.path}
              node={c}
              depth={depth + 1}
              count={countItems(c)}
              active={active}
              accountId={accountId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BoardList() {
  const doc = useDocumentStore((s) => s.doc);
  const folder = useEmailUi((s) => s.folder[BOARD_ACCOUNT] ?? '');
  const query = useEmailUi((s) => s.query);
  const selected = useEmailUi((s) => s.selected[BOARD_ACCOUNT] ?? null);
  const items = useMemo(() => {
    const all = boardEmails(doc).filter(
      (e) => !folder || emailFolderOf(e) === folder || emailFolderOf(e).startsWith(`${folder}/`),
    );
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length
      ? all.filter((e) => {
          const hay =
            `${e.subject} ${addressList(e.from)} ${addressList(e.to)} ${e.text}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
      : all;
  }, [doc, folder, query]);
  return (
    <>
      <SearchBox placeholder="Search messages" />
      <div className="email-rows" data-testid="email-rows">
        {items.map((e) => (
          <MessageRow
            key={e.id}
            active={selected === e.id}
            seen
            from={emailSender(e)}
            subject={e.subject}
            snippet={emailSnippet(e.text, 120)}
            date={formatEmailDate(e.date)}
            attachments={e.attachments.length > 0}
            onClick={() => useEmailUi.getState().setSelected(BOARD_ACCOUNT, e.id)}
          />
        ))}
        {items.length === 0 && (
          <p className="email-empty" data-testid="email-empty">
            {boardEmails(doc).length
              ? 'No messages match.'
              : 'No messages on this board yet. Drop .eml, .emlx, .mbox or .msg files on the canvas, or save one from an account.'}
          </p>
        )}
      </div>
    </>
  );
}

function BoardReader({ id, mobile }: { id: string | null; mobile: boolean }) {
  const item = useDocumentStore((s) => {
    const it = id ? s.doc.items[id] : undefined;
    return it?.type === 'email' ? (it as EmailItem) : null;
  });
  const folders = useDocumentStore(
    useShallow((s) => {
      const set = new Set<string>(s.doc.settings.emailFolders);
      for (const e of boardEmails(s.doc)) if (emailFolderOf(e)) set.add(emailFolderOf(e));
      return [...set].sort();
    }),
  );
  useEffect(() => {
    if (id && !item) useEmailUi.getState().setSelected(BOARD_ACCOUNT, null);
  }, [id, item]);
  if (!item) return <div className="email-detail-empty">Pick a message</div>;
  const view = emailViewOfItem(item);
  const showOnBoard = () => {
    const session = useSessionStore.getState();
    session.setLightbox(null);
    session.setView('canvas');
    session.setSelection([item.id]);
    revealItemPage(item.id);
    requestAnimationFrame(() => fitViewportTo(item, getCanvasContainer()));
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${emailTitle(item)}”?`,
      body: 'The message leaves the board. Undo brings it back.',
      confirmLabel: 'Delete',
    });
    if (ok) removeItems([item.id], 'Delete email');
  };
  const ROOT = '/';
  return (
    <div className="email-page">
      {mobile && <PaneBack />}
      <EmailReader
        message={view}
        actions={
          <>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-testid="email-show-on-board"
              title="Show on Board"
              onClick={showOnBoard}
            >
              <BoardsIcon size={14} /> <span className="email-action-label">Show on Board</span>
            </button>
            <UiSelect
              value={emailFolderOf(item) || ROOT}
              options={[
                { value: ROOT, label: 'Messages' },
                ...folders.map((p) => ({ value: p, label: p })),
              ]}
              onChange={(v) =>
                updateItems([item.id], 'Move email', (d) => {
                  if (d.type !== 'email') return;
                  if (v === ROOT) delete d.folder;
                  else d.folder = v;
                })
              }
              ariaLabel="Folder"
              testId="email-item-folder"
            />
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-danger"
              data-testid="email-item-delete"
              title="Delete"
              onClick={() => void remove()}
            >
              <TrashIcon size={14} /> <span className="email-action-label">Delete</span>
            </button>
          </>
        }
      />
    </div>
  );
}

/* --- A mail account ----------------------------------------------------------- */

function AccountFolders({ account }: { account: MailAccount | null }) {
  const state = useEmailUi((s) => (account ? s.folders[account.id] : undefined));
  const folder = useEmailUi((s) => (account ? (s.folder[account.id] ?? '') : ''));
  const tree = useMemo(() => imapTree(state?.list ?? []), [state?.list]);
  if (!account) return null;
  const render = (node: FolderNode<MailFolder>, depth: number) => {
    const f = node.items[0];
    return (
      <GenericFolderRow
        key={node.path}
        node={node}
        depth={depth}
        count={f?.messages ?? null}
        unseen={f?.unseen ?? null}
        active={folder}
        accountId={account.id}
      />
    );
  };
  return (
    <div className="email-folders" role="tree" aria-label="Folders">
      <div className="email-folders-head">
        <span>Folders</span>
        <button
          type="button"
          className="view-icon-btn small"
          title="Refresh folders"
          aria-label="Refresh folders"
          data-testid="email-folders-refresh"
          disabled={state?.loading}
          onClick={() => void loadFolders(account)}
        >
          <span className={state?.loading ? 'email-spin' : undefined}>
            <LoopIcon size={13} />
          </span>
        </button>
      </div>
      {state?.error && (
        <p className="email-side-note" role="alert" data-testid="email-folders-error">
          {state.error}
        </p>
      )}
      {tree.children.map((n) => render(n, 0))}
    </div>
  );
}

function AccountList({ account, folder }: { account: MailAccount | null; folder: string }) {
  const key = account ? pageKey(account.id, folder) : '';
  const page = useEmailUi((s) => (key ? s.pages[key] : undefined));
  const selected = useEmailUi((s) => (account ? (s.selected[account.id] ?? null) : null));
  const query = useEmailUi((s) => s.query);
  const scroller = useRef<HTMLDivElement>(null);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el || !account || !folder || !page || page.loading || page.done) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80)
      void loadPage(account, folder, true);
  }, [account, folder, page]);
  // Several messages at once: ticked by their boxes (Shift for a run,
  // Ctrl/Cmd-click on a row for one more), acted on from the bar above.
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [anchorUid, setAnchorUid] = useState<number | null>(null);
  const folderKey = account ? pageKey(account.id, folder) : '';
  // Another folder: a fresh selection (reset while rendering, the way React
  // resets derived state, rather than an effect that renders twice).
  const [pickedFor, setPickedFor] = useState(folderKey);
  if (pickedFor !== folderKey) {
    setPickedFor(folderKey);
    setPicked(new Set());
    setAnchorUid(null);
  }
  if (!account) return null;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const messages = (page?.messages ?? []).filter(
    (m) =>
      !terms.length ||
      terms.every((t) =>
        `${m.subject} ${addressList(m.from)} ${addressList(m.to)}`.toLowerCase().includes(t),
      ),
  );
  const pick = (uid: number, shift: boolean, toggle = true) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (shift && anchorUid !== null) {
        const order = messages.map((m) => m.uid);
        const a = order.indexOf(anchorUid);
        const b = order.indexOf(uid);
        if (a >= 0 && b >= 0) {
          for (const u of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(u);
          return next;
        }
      }
      if (toggle && next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
    if (!shift || anchorUid === null) setAnchorUid(uid);
  };
  const clearPicks = () => {
    setPicked(new Set());
    setAnchorUid(null);
  };
  const pickedList = () => messages.filter((m) => picked.has(m.uid)).map((m) => m.uid);
  const markPicked = async (seen: boolean) => {
    const uids = pickedList();
    if (!uids.length) return;
    try {
      await setFlagsMany(
        account,
        folder,
        uids,
        seen ? { add: ['\\Seen'] } : { remove: ['\\Seen'] },
      );
      const set = new Set(uids);
      useEmailUi
        .getState()
        .setPageMessages(folderKey, (list) =>
          list.map((m) => (set.has(m.uid) ? { ...m, seen } : m)),
        );
      clearPicks();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'The flags could not be set.', {
        kind: 'warn',
      });
    }
  };
  const deletePicked = async () => {
    const uids = pickedList();
    if (!uids.length) return;
    const ok = await confirmDialog({
      title: uids.length === 1 ? 'Delete this message?' : `Delete ${uids.length} messages?`,
      body: 'They move to the Trash folder when the server has one, else they are gone.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteMessages(account, folder, uids);
      const set = new Set(uids);
      useEmailUi
        .getState()
        .setPageMessages(folderKey, (list) => list.filter((m) => !set.has(m.uid)));
      if (selected && set.has(Number(selected))) {
        useEmailUi.getState().setSelected(account.id, null);
        useEmailUi.getState().setOpen(openKey(account.id, folder, Number(selected)), null);
      }
      clearPicks();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'The messages could not be deleted.', {
        kind: 'warn',
      });
    }
  };
  return (
    <>
      {picked.size > 0 ? (
        <div className="email-list-head email-select-bar" data-testid="email-select-bar">
          <span className="email-select-count" data-testid="email-select-count">
            {picked.size} selected
          </span>
          <span className="email-spacer" />
          <button
            type="button"
            className="view-icon-btn"
            title="Mark as read"
            aria-label="Mark as read"
            data-testid="email-select-read"
            onClick={() => void markPicked(true)}
          >
            <MailOpenIcon size={16} />
          </button>
          <button
            type="button"
            className="view-icon-btn"
            title="Mark as unread"
            aria-label="Mark as unread"
            data-testid="email-select-unread"
            onClick={() => void markPicked(false)}
          >
            <MailIcon size={16} />
          </button>
          <button
            type="button"
            className="view-icon-btn"
            title="Delete"
            aria-label="Delete"
            data-testid="email-select-delete"
            onClick={() => void deletePicked()}
          >
            <TrashIcon size={16} />
          </button>
          <button
            type="button"
            className="view-icon-btn"
            title="Clear the selection"
            aria-label="Clear the selection"
            data-testid="email-select-clear"
            onClick={clearPicks}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      ) : (
        <div className="email-list-head">
          <SearchBox placeholder="Search this folder" />
          <button
            type="button"
            className="view-icon-btn"
            title="Refresh"
            aria-label="Refresh"
            data-testid="email-list-refresh"
            disabled={!folder || page?.loading}
            onClick={() => folder && void loadPage(account, folder)}
          >
            <span className={page?.loading ? 'email-spin' : undefined}>
              <LoopIcon size={16} />
            </span>
          </button>
        </div>
      )}
      {page?.error && (
        <p className="email-side-note" role="alert" data-testid="email-list-error">
          {page.error}
        </p>
      )}
      <div
        className={`email-rows${picked.size ? ' picking' : ''}`}
        data-testid="email-rows"
        ref={scroller}
        onScroll={onScroll}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && picked.size) {
            e.stopPropagation();
            clearPicks();
          }
        }}
      >
        {messages.map((m) => (
          <MessageRow
            key={m.uid}
            active={selected === String(m.uid)}
            picked={picked.has(m.uid)}
            seen={m.seen}
            from={m.from[0] ? addressShort(m.from[0]) : 'Unknown sender'}
            subject={m.subject}
            snippet=""
            date={formatEmailDate(m.date)}
            attachments={m.hasAttachments}
            onPick={(shift) => pick(m.uid, shift)}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) {
                pick(m.uid, false);
                return;
              }
              if (e.shiftKey && anchorUid !== null) {
                pick(m.uid, true);
                return;
              }
              useEmailUi.getState().setSelected(account.id, String(m.uid));
              void openMessage(account, folder, m);
            }}
          />
        ))}
        {page && !page.loading && messages.length === 0 && !page.error && (
          <p className="email-empty" data-testid="email-empty">
            {terms.length ? 'No messages match.' : 'This folder is empty.'}
          </p>
        )}
        {page?.loading && <p className="email-empty">Loading</p>}
        {page && !page.loading && !page.done && messages.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost email-more"
            data-testid="email-more"
            onClick={() => void loadPage(account, folder, true)}
          >
            Older messages
          </button>
        )}
      </div>
    </>
  );
}

function AccountReader({
  account,
  folder,
  uid,
  mobile,
}: {
  account: MailAccount | null;
  folder: string;
  uid: string | null;
  mobile: boolean;
}) {
  const key = account && uid ? openKey(account.id, folder, Number(uid)) : '';
  const state = useEmailUi((s) => (key ? s.open[key] : undefined));
  const inDrafts = useEmailUi(
    (s) =>
      !!account &&
      !!s.folders[account.id]?.list.some((f) => f.path === folder && f.specialUse === '\\Drafts'),
  );
  const summary = useEmailUi((s) =>
    account && uid
      ? s.pages[pageKey(account.id, folder)]?.messages.find((m) => String(m.uid) === uid)
      : undefined,
  );
  const [saving, setSaving] = useState(false);
  if (!account) return <div className="email-detail-empty">Add a mail account to read it here</div>;
  if (!uid) return <div className="email-detail-empty">Pick a message</div>;
  if (!state || ('loading' in state && state.loading))
    return <div className="email-detail-empty">Loading</div>;
  if ('error' in state)
    return (
      <div className="email-detail-empty" role="alert" data-testid="email-open-error">
        {state.error}
      </div>
    );
  const open = state;
  const compose = (kind: 'reply' | 'replyAll' | 'forward') =>
    useEmailUi
      .getState()
      .setCompose(
        draftFor(
          kind,
          open.view,
          { messageId: open.messageId, references: open.references },
          account,
        ),
      );
  const header = (name: string) =>
    open.view.headers.find((h) => h.name.toLowerCase() === name)?.value ?? '';
  const editDraft = () =>
    useEmailUi.getState().setCompose({
      accountId: account.id,
      to: addressList(open.view.to),
      cc: addressList(open.view.cc),
      bcc: header('bcc'),
      subject: open.view.subject,
      text: open.view.text,
      html: open.view.html,
      ...(header('in-reply-to') ? { inReplyTo: header('in-reply-to') } : {}),
      ...(header('references') ? { references: header('references') } : {}),
      draft: { folder, uid: Number(uid) },
    });
  const saveToBoard = async () => {
    setSaving(true);
    try {
      const parsed = await parseRfc822(open.raw);
      const centre = screenToCanvas(
        { x: window.innerWidth / 2, y: window.innerHeight / 2 },
        useDocumentStore.getState().doc.viewport,
      );
      const id = await addParsedEmail(parsed, centre, {
        source: { account: account.name || account.email, mailbox: folder },
      });
      showNotice('Saved to the board.');
      void id;
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'The message could not be saved.', {
        kind: 'warn',
      });
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Delete this message?',
      body: 'It moves to the Trash folder when the server has one, else it is gone.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteMessage(account, folder, Number(uid));
      useEmailUi
        .getState()
        .setPageMessages(pageKey(account.id, folder), (list) =>
          list.filter((m) => String(m.uid) !== uid),
        );
      useEmailUi.getState().setSelected(account.id, null);
      useEmailUi.getState().setOpen(key, null);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'The message could not be deleted.', {
        kind: 'warn',
      });
    }
  };
  const toggleUnread = async () => {
    if (!summary) return;
    try {
      await setFlags(
        account,
        folder,
        Number(uid),
        summary.seen ? { remove: ['\\Seen'] } : { add: ['\\Seen'] },
      );
      useEmailUi
        .getState()
        .setPageMessages(pageKey(account.id, folder), (list) =>
          list.map((m) => (String(m.uid) === uid ? { ...m, seen: !summary.seen } : m)),
        );
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'The flag could not be set.', {
        kind: 'warn',
      });
    }
  };
  return (
    <div className="email-page">
      {mobile && <PaneBack />}
      <EmailReader
        message={open.view}
        actions={
          <>
            {inDrafts && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                data-testid="email-edit-draft"
                title="Edit Draft"
                onClick={editDraft}
              >
                <PencilIcon size={14} /> <span className="email-action-label">Edit Draft</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-testid="email-reply"
              title="Reply"
              onClick={() => compose('reply')}
            >
              <ReplyIcon size={14} /> <span className="email-action-label">Reply</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-testid="email-reply-all"
              title="Reply All"
              onClick={() => compose('replyAll')}
            >
              <ReplyAllIcon size={14} /> <span className="email-action-label">Reply All</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-testid="email-forward"
              title="Forward"
              onClick={() => compose('forward')}
            >
              <ForwardIcon size={14} /> <span className="email-action-label">Forward</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-testid="email-save"
              title="Save to Board"
              disabled={saving}
              onClick={() => void saveToBoard()}
            >
              <BoardsIcon size={14} /> <span className="email-action-label">Save to Board</span>
            </button>
            {summary && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                data-testid="email-toggle-unread"
                title={summary.seen ? 'Mark Unread' : 'Mark Read'}
                onClick={() => void toggleUnread()}
              >
                {summary.seen ? <MailIcon size={14} /> : <MailOpenIcon size={14} />}{' '}
                <span className="email-action-label">
                  {summary.seen ? 'Mark Unread' : 'Mark Read'}
                </span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-danger"
              data-testid="email-delete"
              title="Delete"
              onClick={() => void remove()}
            >
              <TrashIcon size={14} /> <span className="email-action-label">Delete</span>
            </button>
          </>
        }
      />
    </div>
  );
}

/* --- Shared bits ---------------------------------------------------------------- */

/** The 1px divider after a pane; dragging it sets that pane's width. */
function PaneHandle({ pane }: { pane: 'side' | 'list' }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="email-pane-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={pane === 'side' ? 'Folders width' : 'Message list width'}
      data-testid={`email-pane-handle-${pane}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const prev = e.currentTarget.previousElementSibling as HTMLElement | null;
        start.current = { x: e.clientX, w: prev?.getBoundingClientRect().width ?? 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        useEmailUi.getState().setPaneWidth(pane, s.w + e.clientX - s.x);
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    />
  );
}

function SearchBox({ placeholder }: { placeholder: string }) {
  const query = useEmailUi((s) => s.query);
  return (
    <div className="email-search">
      <SearchIcon size={14} />
      <input
        className="email-search-input"
        data-testid="email-search"
        placeholder={placeholder}
        aria-label={placeholder}
        value={query}
        onChange={(e) => useEmailUi.getState().setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') useEmailUi.getState().setQuery('');
        }}
      />
      {query && (
        <button
          type="button"
          className="email-search-clear"
          aria-label="Clear search"
          onClick={() => useEmailUi.getState().setQuery('')}
        >
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  );
}

function MessageRow({
  active,
  picked,
  seen,
  from,
  subject,
  snippet,
  date,
  attachments,
  onClick,
  onPick,
}: {
  active: boolean;
  picked?: boolean;
  seen: boolean;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  attachments: boolean;
  onClick: (e: React.MouseEvent) => void;
  /** The row's box ticked (Shift extends the run from the last tick); a
   *  list without one (the board's own archive) shows no box. */
  onPick?: (shift: boolean) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`email-row${active ? ' active' : ''}${seen ? '' : ' unread'}${picked ? ' picked' : ''}`}
      data-testid="email-row"
      data-unread={seen ? undefined : 'true'}
      data-picked={picked ? 'true' : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
    >
      {onPick && (
        <button
          type="button"
          role="checkbox"
          aria-checked={!!picked}
          aria-label={picked ? 'Deselect this message' : 'Select this message'}
          className="email-row-check"
          data-testid="email-row-check"
          onClick={(e) => {
            e.stopPropagation();
            onPick(e.shiftKey);
          }}
        >
          {picked && <CheckIcon size={11} />}
        </button>
      )}
      <span className="email-row-dot" aria-hidden />
      <span className="email-row-text">
        <span className="email-row-top">
          <span className="email-row-from">{from}</span>
          <span className="email-row-date">{date}</span>
        </span>
        <span className="email-row-subject">
          {attachments && <PaperclipIcon size={12} />}
          <span className="email-row-subject-text">{subject.trim() || '(No subject)'}</span>
        </span>
        {snippet && <span className="email-row-snippet">{snippet}</span>}
      </span>
    </div>
  );
}

function PaneBack() {
  return (
    <button
      type="button"
      className="email-page-back"
      data-testid="email-reader-back"
      onClick={() => useEmailUi.getState().setPane('list')}
    >
      <ChevronLeftIcon size={16} /> Messages
    </button>
  );
}
