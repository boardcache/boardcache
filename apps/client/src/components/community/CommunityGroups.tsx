import { useEffect, useState } from 'react';
import { UiDialog } from '../ui/Dialog';
import {
  createGroup,
  deleteGroup,
  groupDetail,
  inviteToGroup,
  joinGroup,
  leaveGroup,
  listGroups,
  removeGroupMember,
  updateGroup,
  type CommunityGroup,
} from '../../lib/sync/community';
import { CloseIcon } from '../icons';

/**
 * Group management: create a group, invite members by username, allow a
 * verified email domain to join, leave/remove/delete. Groups are audiences
 * for restricted publications — the creator manages them.
 */

export function GroupsDialog({
  onClose,
  onChanged,
  initialOpen = null,
}: {
  onClose: () => void;
  onChanged: () => void;
  /** Group id to start expanded (the feed header's Edit button). */
  initialOpen?: string | null;
}) {
  const [mine, setMine] = useState<CommunityGroup[] | null>(null);
  const [joinable, setJoinable] = useState<CommunityGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [open, setOpen] = useState<string | null>(initialOpen); // expanded group id

  const refresh = () => {
    void listGroups()
      .then((g) => {
        setMine(g.mine);
        setJoinable(g.joinable);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Groups are unavailable.'),
      );
  };
  useEffect(refresh, []);
  const changed = () => {
    refresh();
    onChanged();
  };

  const create = async () => {
    setError(null);
    try {
      await createGroup({
        name: name.trim(),
        ...(domain.trim() ? { allowedDomain: domain.trim() } : {}),
      });
      setName('');
      setDomain('');
      changed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the group.');
    }
  };

  return (
    <UiDialog title="Groups" onClose={onClose} className="cmty-sheet" testId="groups-dialog">
      <div className="cmty-body">
        {error && <p className="cmty-error">{error}</p>}

        {mine === null ? (
          <div className="skeleton-wrap" aria-label="Loading">
            <span className="skeleton-line lg" />
            <span className="skeleton-line short" />
          </div>
        ) : (
          <>
            {mine.length === 0 && (
              <p className="cmty-hint">
                No groups yet. A group is a private audience — share published boards with its
                members instead of the whole community.
              </p>
            )}
            {mine.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                expanded={open === g.id}
                onToggle={() => setOpen(open === g.id ? null : g.id)}
                onChanged={changed}
                onError={setError}
              />
            ))}
            {joinable.length > 0 && (
              <>
                <p className="cmty-hint">Open to your email domain:</p>
                {joinable.map((g) => (
                  <div className="group-row" key={g.id}>
                    <span className="group-row-name">{g.name}</span>
                    <span className="group-row-meta">
                      {g.members} member{g.members === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      className="community-preview-btn"
                      data-testid={`group-join-${g.id}`}
                      onClick={() => {
                        void joinGroup(g.id).then(changed, (err: unknown) =>
                          setError(err instanceof Error ? err.message : 'Could not join.'),
                        );
                      }}
                    >
                      Join
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        <div className="cmty-field">
          <span>New group</span>
          <input
            value={name}
            placeholder="Group name"
            data-testid="group-new-name"
            onChange={(e) => setName(e.target.value)}
          />
          <input
            value={domain}
            placeholder="Allow email domain (optional) — e.g. acme.com"
            data-testid="group-new-domain"
            onChange={(e) => setDomain(e.target.value)}
          />
        </div>
        <div className="cmty-actions">
          <button type="button" className="cmty-ghost-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="sync-primary"
            disabled={!name.trim()}
            data-testid="group-create"
            onClick={() => void create()}
          >
            Create group
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

function GroupRow({
  group,
  expanded,
  onToggle,
  onChanged,
  onError,
}: {
  group: CommunityGroup;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const owner = group.role === 'owner';
  const [members, setMembers] = useState<{ username: string; role: string }[] | null>(null);
  const [invite, setInvite] = useState('');
  const [domain, setDomain] = useState(group.allowedDomain ?? '');

  useEffect(() => {
    if (!expanded || members !== null) return;
    void groupDetail(group.id)
      .then((d) => setMembers(d.members))
      .catch(() => setMembers([]));
  }, [expanded, members, group.id]);

  const fail = (err: unknown, fallback: string) =>
    onError(err instanceof Error ? err.message : fallback);

  return (
    <div className="group-block" data-testid={`group-${group.id}`}>
      <div className="group-row">
        <button type="button" className="group-row-name group-row-btn" onClick={onToggle}>
          {group.name}
        </button>
        <span className="group-row-meta">
          {group.members} member{group.members === 1 ? '' : 's'}
          {owner ? ' · yours' : ''}
        </span>
        {!owner && (
          <button
            type="button"
            className="cmty-link-btn"
            data-testid={`group-leave-${group.id}`}
            onClick={() =>
              void leaveGroup(group.id).then(onChanged, (e: unknown) => fail(e, 'Could not leave.'))
            }
          >
            Leave
          </button>
        )}
      </div>
      {expanded && (
        <div className="group-detail">
          {members === null ? (
            <p className="cmty-hint">Loading members</p>
          ) : (
            members.map((m) => (
              <div className="group-member" key={m.username}>
                <span>
                  {m.username}
                  {m.role === 'owner' ? ' (owner)' : ''}
                </span>
                {owner && m.role !== 'owner' && (
                  <button
                    type="button"
                    className="lib-row-x"
                    aria-label={`Remove ${m.username}`}
                    onClick={() => {
                      void removeGroupMember(group.id, m.username).then(
                        () => {
                          setMembers(null);
                          onChanged();
                        },
                        (e: unknown) => fail(e, 'Could not remove.'),
                      );
                    }}
                  >
                    <CloseIcon size={12} />
                  </button>
                )}
              </div>
            ))
          )}
          {owner && (
            <>
              <div className="group-invite">
                <input
                  value={invite}
                  placeholder="Invite by username"
                  data-testid={`group-invite-${group.id}`}
                  onChange={(e) => setInvite(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && invite.trim()) {
                      e.preventDefault();
                      void inviteToGroup(group.id, invite.trim()).then(
                        () => {
                          setInvite('');
                          setMembers(null);
                          onChanged();
                        },
                        (err: unknown) => fail(err, 'Could not invite.'),
                      );
                    }
                  }}
                />
                <input
                  value={domain}
                  placeholder="Allowed email domain"
                  data-testid={`group-domain-${group.id}`}
                  onChange={(e) => setDomain(e.target.value)}
                  onBlur={() => {
                    const next = domain.trim() || null;
                    if ((next ?? '') === (group.allowedDomain ?? '')) return;
                    void updateGroup(group.id, { allowedDomain: next }).then(
                      onChanged,
                      (e: unknown) => fail(e, 'Could not update the domain.'),
                    );
                  }}
                />
              </div>
              <button
                type="button"
                className="cmty-link-btn cmty-danger-link"
                data-testid={`group-delete-${group.id}`}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete the group “${group.name}”? Boards shared only with it become unreachable for its members.`,
                    )
                  ) {
                    void deleteGroup(group.id).then(onChanged, (e: unknown) =>
                      fail(e, 'Could not delete.'),
                    );
                  }
                }}
              >
                Delete group
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Header card above a group-scoped feed: name, members, Edit. */
export function GroupHeaderCard({
  groupId,
  revision,
  onEdit,
}: {
  groupId: string;
  revision: number;
  onEdit: () => void;
}) {
  const [detail, setDetail] = useState<{
    group: CommunityGroup;
    members: { username: string; role: string }[];
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void groupDetail(groupId)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId, revision]);

  if (!detail) {
    return (
      <div className="cp-card cg-card skeleton-wrap" aria-label="Loading group">
        <span className="skeleton-line lg" />
        <span className="skeleton-line short" />
      </div>
    );
  }
  const { group, members } = detail;
  const names = members.map((m) => m.username);
  const shown = names.slice(0, 6).join(', ');
  return (
    <div className="cp-card cg-card" data-testid="group-header">
      <div className="cg-head">
        <div className="cg-id">
          <h1>{group.name}</h1>
          <span className="cp-followers" data-testid="group-header-members">
            {group.members} member{group.members === 1 ? '' : 's'}
            {group.allowedDomain ? ` · open to @${group.allowedDomain}` : ''}
          </span>
          {names.length > 0 && (
            <span className="cg-names">
              {shown}
              {names.length > 6 ? ` +${names.length - 6} more` : ''}
            </span>
          )}
        </div>
        <button
          type="button"
          className="community-preview-btn"
          data-testid="group-header-edit"
          onClick={onEdit}
        >
          {group.role === 'owner' ? 'Edit group' : 'Group details'}
        </button>
      </div>
    </div>
  );
}
