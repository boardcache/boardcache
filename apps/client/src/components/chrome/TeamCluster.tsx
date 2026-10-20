import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { apiFetch } from '../../lib/sync/apiBase';
import { closeBoard } from '../../lib/board/boardLibrary';
import { useCollabStore } from '../../state/collabStore';

type CollabStateMembers = { userId: string; username: string; role: string }[];
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { UiDialog } from '../ui/Dialog';
import { UiTooltip } from '../ui/Tooltip';
import { TeamChatWindow } from './TeamChat';
import { PeerAvatar } from './PeerAvatar';
import { ChatIcon } from '../icons';

/**
 * Team-board chrome: avatar stack + connection dot + "Team" button while a
 * collab session is live, and the Team dialog (members, invites, guest link).
 */

const useTeamDialog = create<{ open: boolean; toggle: (v: boolean) => void }>((set) => ({
  open: false,
  toggle: (open) => set({ open }),
}));

export function TeamCluster() {
  const status = useCollabStore((s) => s.status);
  const self = useCollabStore((s) => s.self);
  const peers = useCollabStore((s) => s.peers);
  const open = useTeamDialog((s) => s.open);
  const chatOpen = useCollabStore((s) => s.chatOpen);
  const chatUnread = useCollabStore((s) => s.chatUnread);
  if (status === 'off') return null;
  const everyone = [...(self ? [self] : []), ...Object.values(peers)];
  // Pages: name the sheet a peer is on when it isn't yours.
  const pageLabel = (p: { id: string; page?: string | null }): string => {
    const doc = useDocumentStore.getState().doc;
    if (doc.pages.length < 2 || p.id === useCollabStore.getState().self?.id) return '';
    const first = doc.pages[0]?.id ?? null;
    const mine = useSessionStore.getState().activePageId ?? first;
    const theirs = p.page ?? first;
    if (theirs === mine) return '';
    const name = doc.pages.find((pg) => pg.id === theirs)?.name;
    return name ? ` · on ${name}` : '';
  };

  return (
    <div className="team-cluster" data-testid="team-cluster">
      <span
        className={`team-dot team-dot-${status}`}
        title={status === 'online' ? 'Live' : 'Reconnecting'}
      />
      <div className="team-avatars" data-testid="team-avatars">
        {everyone.slice(0, 6).map((p) => (
          <UiTooltip
            key={p.id}
            label={`${p.name}${p.role === 'guest' ? ' (guest)' : ''}${pageLabel(p)}`}
          >
            <span className="team-avatar-slot">
              <PeerAvatar peer={p} />
            </span>
          </UiTooltip>
        ))}
        {everyone.length > 6 && (
          <span className="team-avatar team-avatar-more">+{everyone.length - 6}</span>
        )}
      </div>
      <UiTooltip label={chatOpen ? 'Close team chat' : 'Team chat'}>
        <button
          type="button"
          className={`team-chat-btn${chatOpen ? ' active' : ''}`}
          data-testid="team-chat-toggle"
          aria-pressed={chatOpen}
          aria-label="Team chat"
          onClick={() => useCollabStore.getState().setChatOpen(!chatOpen)}
        >
          <ChatIcon size={15} />
          {chatUnread > 0 && (
            <span className="team-chat-unread" data-testid="team-chat-unread">
              {chatUnread}
            </span>
          )}
        </button>
      </UiTooltip>
      <button
        type="button"
        className="team-open"
        data-testid="team-open"
        onClick={() => useTeamDialog.getState().toggle(true)}
      >
        Team
      </button>
      {open && <TeamDialog />}
      <TeamChatWindow />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function TeamDialog() {
  const close = () => useTeamDialog.getState().toggle(false);
  const boardName = useDocumentStore((s) => s.doc.name);
  const role = useCollabStore((s) => s.role);
  const boardId = useCollabStore((s) => s.boardId);
  const members = useCollabStore((s) => s.members);
  const guestSlug = useCollabStore((s) => s.guestSlug);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [assetBytes, setAssetBytes] = useState<number | null>(null);

  // Fresh read on open: member list + how much asset storage the board uses.
  useEffect(() => {
    if (!boardId || role === 'guest') return;
    let cancelled = false;
    void apiFetch(`/api/team/${boardId}`, { credentials: 'include' })
      .then(async (r) => (r.ok ? await r.json() : null))
      .then((data: { members?: CollabStateMembers; assetBytes?: number } | null) => {
        if (!data || cancelled) return;
        if (data.members) useCollabStore.getState().set({ members: data.members });
        if (typeof data.assetBytes === 'number') setAssetBytes(data.assetBytes);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, role]);

  const sendInvite = async () => {
    if (!invite.trim() || !boardId) return;
    setError(null);
    const res = await apiFetch(`/api/team/${boardId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: invite.trim() }),
    });
    const body = (await res.json()) as {
      members?: { userId: string; username: string; role: string }[];
      error?: string;
    };
    if (!res.ok) return setError(body.error ?? 'Invite failed.');
    useCollabStore.getState().set({ members: body.members ?? [] });
    setInvite('');
  };

  const toggleGuests = async (enabled: boolean) => {
    if (!boardId) return;
    const res = await apiFetch(`/api/team/${boardId}/guest-access`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) {
      const { guestSlug: slug } = (await res.json()) as { guestSlug: string | null };
      useCollabStore.getState().set({ guestSlug: slug });
    }
  };

  const guestLink = guestSlug ? `${location.origin}/guest/${guestSlug}` : null;

  return (
    <UiDialog
      title={`Team · ${boardName}`}
      onClose={close}
      className="team-sheet"
      testId="team-dialog"
    >
      <div className="team-body">
        <span className="lsp-field-label">Members</span>
        {members.map((m) => (
          <div className="team-member" key={m.userId}>
            <span className="team-member-name">{m.username}</span>
            <span className="team-member-role">{m.role}</span>
          </div>
        ))}
        {role === 'guest' && (
          <p className="settings-hint">
            You're here as a guest — members are managed by the owner.
          </p>
        )}
        {role === 'owner' && (
          <>
            <div className="team-invite">
              <input
                type="text"
                value={invite}
                placeholder="Invite by username"
                data-testid="team-invite-input"
                onChange={(e) => setInvite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendInvite();
                }}
              />
              <button
                type="button"
                className="sync-primary"
                data-testid="team-invite"
                onClick={() => void sendInvite()}
              >
                Invite
              </button>
            </div>
            {error && <p className="sync-error">{error}</p>}

            <span className="lsp-field-label">Anonymous guests</span>
            <label className="settings-row">
              <input
                type="checkbox"
                checked={guestSlug !== null}
                data-testid="team-guests-toggle"
                onChange={(e) => void toggleGuests(e.target.checked)}
              />
              <span>Allow anyone with the link to join and edit (they pick a display name)</span>
            </label>
            {guestLink && (
              <div className="team-guest-link" data-testid="team-guest-link">
                <code>{guestLink}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(guestLink);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </>
        )}
        <p className="settings-hint">
          Team boards live on your server (readable by it — that's what makes real-time editing
          possible). Private boards stay end-to-end encrypted.
          {assetBytes !== null && (
            <>
              {' '}
              <span data-testid="team-asset-size">
                Assets stored on the server: {formatBytes(assetBytes)}. Unused assets are cleaned up
                automatically (7-day grace); deleting the board removes everything.
              </span>
            </>
          )}
        </p>
        <div className="team-actions">
          <button
            type="button"
            className="team-leave"
            data-testid="team-leave"
            onClick={() => void closeBoard()}
          >
            Leave board
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
