import { useEffect, useRef, useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { RadixEntries } from '../menu/RadixEntries';
import { AuthedImg } from '../ui/AuthedImg';
import { UiDialog } from '../ui/Dialog';
import { UiSelect } from '../ui/Select';
import {
  blockCommunity,
  clonePublication,
  deletePublication,
  restoreVersion,
  themedCover,
  themedPreview,
  updatePublication,
  fetchCommunityUser,
  fetchMyProfile,
  fetchPublication,
  saveProfile,
  sendReport,
  setFavorite,
  setFollow,
  listFollowRequests,
  answerFollowRequest,
  type FollowRequest,
  uploadAvatar,
  communityAssetUrl,
  communitySameOrigin,
  type CommunityPublication,
  type CommunityUser,
  communityPageUrl,
} from '../../lib/sync/community';

import { resolveTheme, useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';
import {
  BadgeCheckIcon,
  BookmarkIcon,
  CopyIcon,
  FlagIcon,
  MoreIcon,
  PencilIcon,
  StarIcon,
  TrashIcon,
} from '../icons';
import { confirmDialog } from '../ui/Prompt';
import { UiTooltip } from '../ui/Tooltip';
import { VoteWidget } from './CommunityScreen';
import { SharingFields, parsePeople, type SharingValue } from '../dialogs/SharingFields';
import { SimpleMarkdown } from '../ui/SimpleMarkdown';
import { CommunityComments } from './CommunityComments';

/**
 * In-app community sub-views (profile + publication detail). They render in
 * CommunityScreen's main column so the sidebar — the main nav — never
 * disappears; the /u pages remain the logged-out/SEO surface.
 */

const goto = (handle: string | null, slug: string | null = null): void =>
  useSessionStore.getState().setCommunityRoute(handle ? { handle, slug } : null);

const assetUrl = (hash: string): string => communityAssetUrl(hash);

/** The theme in use, for picking a publication's light or dark cover. */
function useResolvedTheme(): 'light' | 'dark' {
  const theme = useSessionStore((s) => s.theme);
  return resolveTheme(theme);
}

// ── profile ────────────────────────────────────────────────────────────────

/** SPA breadcrumbs: Community › @publisher › Board. Segments navigate the
 *  in-app community routes (the header/sidebar stay mounted). */
function CommunityCrumbs({ handle, title }: { handle: string; title?: string }) {
  const go = (route: { handle: string; slug: string | null } | null) =>
    useSessionStore.getState().setCommunityRoute(route);
  return (
    <nav className="community-crumbs" aria-label="Breadcrumb" data-testid="community-crumbs">
      <button type="button" data-testid="crumb-community" onClick={() => go(null)}>
        Community
      </button>
      <span className="crumb-sep" aria-hidden>
        ›
      </span>
      {title !== undefined ? (
        <>
          <button
            type="button"
            data-testid="crumb-profile"
            onClick={() => go({ handle, slug: null })}
          >
            @{handle}
          </button>
          <span className="crumb-sep" aria-hidden>
            ›
          </span>
          <span className="crumb-current">{title}</span>
        </>
      ) : (
        <span className="crumb-current">@{handle}</span>
      )}
    </nav>
  );
}

export function CommunityProfileView({
  handle,
  favorites,
  onToggleFavorite,
}: {
  handle: string;
  favorites: Set<string>;
  onToggleFavorite: (id: string, fav: boolean) => void;
}) {
  const theme = useResolvedTheme();
  const [user, setUser] = useState<CommunityUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const signedIn = useSyncStore((s) => s.status === 'signedIn') && communitySameOrigin();

  const load = () => {
    void fetchCommunityUser(handle)
      .then(setUser)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Profile unavailable.'),
      );
  };
  useEffect(load, [handle]);

  if (error) return <p className="community-error">{error}</p>;
  if (!user) {
    return (
      <div className="community-profile skeleton-wrap" aria-label="Loading profile">
        <CommunityCrumbs handle={handle} />
        <div className="cp-card" aria-hidden>
          <div className="cp-head">
            <span className="skeleton-block skeleton-circle cp-avatar-skel" />
            <div className="cp-id">
              <span className="skeleton-line lg" />
              <span className="skeleton-line short" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  const { profile } = user;

  const followState = user.viewerFollowState ?? (user.viewerFollows ? 'following' : 'none');
  const toggleFollow = async () => {
    try {
      if (followState === 'none') {
        // Private profiles turn this into a pending request.
        const state = await setFollow(handle, true);
        setUser({
          ...user,
          viewerFollowState: state === 'accepted' ? 'following' : 'pending',
          viewerFollows: state === 'accepted',
          followers: user.followers + (state === 'accepted' ? 1 : 0),
        });
        if (state === 'accepted') load(); // a public profile may follow-gate nothing, but refresh counts
      } else {
        // Following OR pending → withdraw.
        await setFollow(handle, false);
        setUser({
          ...user,
          viewerFollowState: 'none',
          viewerFollows: false,
          followers: user.followers - (followState === 'following' ? 1 : 0),
        });
        if (followState === 'following') load(); // may have just lost access to a private profile
      }
    } catch {
      /* signed-out or transient — leave as-is */
    }
  };

  return (
    <div className="community-profile view-fade-in" data-testid="community-profile">
      <CommunityCrumbs handle={handle} />
      <div className="cp-card">
        <header className="cp-head">
          <div className="cp-avatar">
            {profile.avatarAsset ? (
              <AuthedImg src={assetUrl(profile.avatarAsset)} alt="" />
            ) : (
              <span>{(profile.displayName[0] ?? '@').toUpperCase()}</span>
            )}
          </div>
          <div className="cp-id">
            <h1>{profile.displayName}</h1>
            <span className="cp-handle">@{profile.handle}</span>
            {profile.founding && (
              <UiTooltip label="Founding member: one of the first 250 accounts">
                <span className="founding-badge" data-testid="founding-badge">
                  <BadgeCheckIcon size={13} />
                  Founding member
                </span>
              </UiTooltip>
            )}
            <span className="cp-followers" data-testid="profile-followers">
              {user.followers} follower{user.followers === 1 ? '' : 's'}
              {!user.restricted && (
                <>
                  {' '}
                  · {user.publications.length} board
                  {user.publications.length === 1 ? '' : 's'}
                </>
              )}
              {profile.private && <span className="cp-private-badge">Private</span>}
            </span>
          </div>
          <div className="cp-actions">
            {user.isSelf ? (
              <button
                type="button"
                className="community-preview-btn"
                data-testid="profile-edit"
                onClick={() => setEditing(true)}
              >
                Edit profile
              </button>
            ) : (
              signedIn && (
                <>
                  <button
                    type="button"
                    className={followState === 'none' ? 'sync-primary' : 'community-preview-btn'}
                    data-testid="profile-follow"
                    onClick={() => void toggleFollow()}
                  >
                    {followState === 'following'
                      ? 'Following'
                      : followState === 'pending'
                        ? 'Requested'
                        : profile.private
                          ? 'Request to follow'
                          : 'Follow'}
                  </button>
                  {/* Subtle overflow: block lives here, not as a headline button. */}
                  <DM.Root>
                    <DM.Trigger asChild>
                      <button
                        type="button"
                        className="community-card-more"
                        aria-label="More"
                        data-testid="profile-more"
                      >
                        <MoreIcon size={15} />
                      </button>
                    </DM.Trigger>
                    <DM.Portal>
                      <DM.Content className="menu-panel menu-list" align="end" sideOffset={4}>
                        <RadixEntries
                          entries={[
                            {
                              kind: 'action',
                              label: `Block @${profile.handle}`,
                              onSelect: () =>
                                void blockCommunity('user', profile.handle).then(() => goto(null)),
                            },
                          ]}
                        />
                      </DM.Content>
                    </DM.Portal>
                  </DM.Root>
                </>
              )
            )}
          </div>
        </header>
        {(profile.bio || profile.link) && (
          <div className="cp-bio">
            {profile.bio && <SimpleMarkdown text={profile.bio} />}
            {profile.link && (
              <a href={profile.link} target="_blank" rel="noreferrer noopener" className="cp-link">
                {profile.link.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        )}
      </div>

      {user.isSelf && <FollowRequestsPanel onAnswered={load} />}

      {user.restricted ? (
        <p className="community-empty" data-testid="profile-restricted">
          This profile is private — its boards are visible to approved followers only.
        </p>
      ) : user.publications.length === 0 ? (
        <p className="community-empty">Nothing published yet.</p>
      ) : (
        <div className="community-grid view-cards">
          {user.publications.map((pub) => (
            <article
              className="community-card"
              key={pub.id}
              data-testid={`profile-card-${pub.slug}`}
            >
              <button
                type="button"
                className="community-cover"
                onClick={() => goto(handle, pub.slug)}
                title={`Open ${pub.title}`}
              >
                {themedCover(pub, theme) ? (
                  <AuthedImg src={assetUrl(themedCover(pub, theme)!)} alt="" loading="lazy" />
                ) : (
                  <span className="community-cover-fallback">
                    {(pub.title[0] ?? 'b').toUpperCase()}
                  </span>
                )}
              </button>
              <div className="community-card-body">
                <h3>
                  <button
                    type="button"
                    className="community-card-title"
                    onClick={() => goto(handle, pub.slug)}
                  >
                    {pub.title}
                  </button>
                </h3>
                <span className="community-card-date">
                  {new Date(pub.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                {pub.description && (
                  <SimpleMarkdown text={pub.description} className="feed-desc card-desc-clamp" />
                )}
                <div className="feed-meta">
                  {pub.visibility !== 'public' && (
                    <span className="community-pill community-pill-restricted">
                      {pub.visibility === 'groups' ? 'Groups' : 'Private'}
                    </span>
                  )}
                  v{pub.latestVersion} · {pub.itemCount} item{pub.itemCount === 1 ? '' : 's'} ·{' '}
                  {pub.downloads} clone{pub.downloads === 1 ? '' : 's'} · {pub.comments ?? 0}{' '}
                  comment
                  {pub.comments === 1 ? '' : 's'}
                </div>
                <div className="feed-foot">
                  <span className="feed-foot-left">
                    <VoteWidget
                      pub={pub}
                      signedIn={signedIn}
                      onScore={(id, score, myVote) =>
                        setUser((prev) =>
                          prev
                            ? {
                                ...prev,
                                publications: prev.publications.map((x) =>
                                  x.id === id ? { ...x, score, myVote } : x,
                                ),
                              }
                            : prev,
                        )
                      }
                    />
                    <UiStar
                      fav={favorites.has(pub.id)}
                      count={pub.favorites}
                      onClick={() => {
                        if (!signedIn) return;
                        const next = !favorites.has(pub.id);
                        void setFavorite(pub.id, next).then(() => {
                          onToggleFavorite(pub.id, next);
                          setUser((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  publications: prev.publications.map((x) =>
                                    x.id === pub.id
                                      ? { ...x, favorites: x.favorites + (next ? 1 : -1) }
                                      : x,
                                  ),
                                }
                              : prev,
                          );
                        });
                      }}
                    />
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <EditProfileDialog
          profile={profile}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Pending follow requests on the viewer's own (private) profile. */
function FollowRequestsPanel({ onAnswered }: { onAnswered: () => void }) {
  const [requests, setRequests] = useState<FollowRequest[] | null>(null);
  useEffect(() => {
    void listFollowRequests()
      .then(setRequests)
      .catch(() => setRequests([]));
  }, []);
  if (!requests || requests.length === 0) return null;
  const answer = (req: FollowRequest, action: 'accept' | 'decline') => {
    void answerFollowRequest(req.handle, action)
      .then(() => {
        setRequests((prev) => prev?.filter((r) => r.handle !== req.handle) ?? prev);
        if (action === 'accept') onAnswered(); // follower count changed
      })
      .catch(() => undefined);
  };
  return (
    <div className="cp-requests" data-testid="follow-requests">
      <h2>Follow requests</h2>
      {requests.map((req) => (
        <div className="cp-request" key={req.handle} data-testid={`follow-request-${req.handle}`}>
          <span className="cp-request-avatar">
            {req.avatarAsset ? (
              <AuthedImg src={assetUrl(req.avatarAsset)} alt="" />
            ) : (
              <span>{(req.displayName[0] ?? '@').toUpperCase()}</span>
            )}
          </span>
          <button type="button" className="cp-request-id" onClick={() => goto(req.handle)}>
            <strong>{req.displayName}</strong>
            <span>@{req.handle}</span>
          </button>
          <span className="cp-request-actions">
            <button
              type="button"
              className="sync-primary"
              data-testid={`follow-accept-${req.handle}`}
              onClick={() => answer(req, 'accept')}
            >
              Accept
            </button>
            <button
              type="button"
              className="community-preview-btn"
              data-testid={`follow-decline-${req.handle}`}
              onClick={() => answer(req, 'decline')}
            >
              Decline
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

function EditProfileDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile: CommunityUser['profile'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [link, setLink] = useState(profile.link ?? '');
  const [priv, setPriv] = useState(profile.private ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const avatar = fileRef.current?.files?.[0];
      if (avatar) await uploadAvatar(avatar);
      await saveProfile({ handle: profile.handle, displayName, bio, link, private: priv });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the profile.');
      setBusy(false);
    }
  };

  return (
    <UiDialog
      title="Edit profile"
      onClose={onClose}
      className="cmty-sheet"
      size="wide"
      testId="profile-edit-dialog"
    >
      <div className="cmty-body">
        {error && <p className="cmty-error">{error}</p>}
        <div className="cmty-field">
          <span>Avatar</span>
          <div className="cmty-avatar-row">
            <span className="cmty-avatar-preview">
              {avatarPreview ? (
                <img src={avatarPreview} alt="" />
              ) : profile.avatarAsset ? (
                <AuthedImg src={assetUrl(profile.avatarAsset)} alt="" />
              ) : (
                <span>{(displayName[0] ?? '@').toUpperCase()}</span>
              )}
            </span>
            <button
              type="button"
              className="community-preview-btn"
              onClick={() => fileRef.current?.click()}
            >
              Choose image
            </button>
            <input
              type="file"
              accept="image/*"
              hidden
              ref={fileRef}
              data-testid="profile-edit-avatar"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                setAvatarPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </div>
        </div>
        <label className="cmty-field">
          <span>Display name</span>
          <input
            value={displayName}
            data-testid="profile-edit-name"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="cmty-field">
          <span>Bio</span>
          <textarea
            value={bio}
            placeholder="Tell people what you make"
            data-testid="profile-edit-bio"
            onChange={(e) => setBio(e.target.value)}
          />
        </label>
        <label className="cmty-field">
          <span>Link</span>
          <input
            value={link}
            placeholder="your-site.com"
            data-testid="profile-edit-link"
            onChange={(e) => setLink(e.target.value)}
          />
        </label>
        <label className="cmty-check">
          <input
            type="checkbox"
            checked={priv}
            data-testid="profile-edit-private"
            onChange={(e) => setPriv(e.target.checked)}
          />
          <span>
            <strong>Private profile</strong> — your boards and profile details are visible only to
            followers you approve. New follows arrive as requests.
          </span>
        </label>
        <div className="cmty-actions">
          <button
            type="button"
            className="cmty-link-btn"
            data-testid="profile-edit-settings"
            onClick={() => {
              onClose();
              useSessionStore.getState().setSettingsSection('sync');
              useSessionStore.getState().setSettingsOpen(true);
            }}
          >
            Account settings
          </button>
          <button type="button" className="cmty-ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sync-primary"
            disabled={busy}
            data-testid="profile-edit-save"
            onClick={() => void save()}
          >
            {busy ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

// ── publication detail ─────────────────────────────────────────────────────

export function CommunityDetailView({
  handle,
  slug,
  favorites,
  onToggleFavorite,
  onPreview,
}: {
  handle: string;
  slug: string;
  favorites: Set<string>;
  onToggleFavorite: (id: string, fav: boolean) => void;
  onPreview: (pub: CommunityPublication, version?: number) => void;
}) {
  const theme = useResolvedTheme();
  const [pub, setPub] = useState<CommunityPublication | null>(null);
  const [sharing, setSharingInfo] = useState<{ groupIds: string[]; people: string[] } | null>(null);
  const [versions, setVersions] = useState<
    { version: number; changelog: string; createdAt: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  /** A report about one comment (its id), rather than the board. */
  const [reportComment, setReportComment] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const signedIn = useSyncStore((s) => s.status === 'signedIn') && communitySameOrigin();
  const myHandle = useMyHandle();
  const isOwner = myHandle !== null && myHandle === handle;

  useEffect(() => {
    // Reset async — a sync setState inside an effect cascades renders.
    queueMicrotask(() => setPub(null));
    void fetchPublication(handle, slug)
      .then((r) => {
        setPub(r.publication);
        setVersions(r.versions);
        setSharingInfo(r.sharing ?? null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'This board is unavailable.'),
      );
  }, [handle, slug]);

  if (error) return <p className="community-error">{error}</p>;
  if (!pub) {
    return (
      <div className="community-detail skeleton-wrap" aria-label="Loading board">
        <CommunityCrumbs handle={handle} title={slug} />
        <div className="cd-card" aria-hidden>
          <span className="skeleton-line lg" />
          <span className="skeleton-line short" />
        </div>
        <span className="skeleton-block cd-hero-skel" aria-hidden />
      </div>
    );
  }

  const fav = favorites.has(pub.id);
  const hero = themedPreview(pub, theme);

  const clone = async () => {
    setBusy(true);
    try {
      await clonePublication(handle, slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clone failed.');
      setBusy(false);
    }
  };

  const saveAsTemplate = async () => {
    setBusy(true);
    try {
      const { clonePublicationAsTemplate } = await import('../../lib/sync/community');
      await clonePublicationAsTemplate(handle, slug);
      const { showNotice } = await import('../../lib/notices');
      showNotice('Saved to My Templates — start boards from it in your library.', {
        id: 'community-template-saved',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save as template failed.');
    } finally {
      setBusy(false);
    }
  };

  const refetch = () =>
    fetchPublication(handle, slug).then((r) => {
      setPub(r.publication);
      setVersions(r.versions);
      setSharingInfo(r.sharing ?? null);
    });

  const unpublish = async () => {
    const ok = await confirmDialog({
      title: 'Unpublish this board?',
      body: 'It disappears from the community, with its versions and comments. Your own board is untouched.',
      confirmLabel: 'Unpublish',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deletePublication(pub.id);
      goto(null); // back to the browse feed (which refetches)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unpublish.');
      setBusy(false);
    }
  };

  const restore = async (version: number) => {
    const ok = await confirmDialog({
      title: `Restore v${version}?`,
      body: `It becomes the newest version again, as v${(pub.latestVersion ?? 0) + 1}; the history stays.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await restoreVersion(pub.id, version);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore that version.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="community-detail view-fade-in" data-testid="community-detail">
      <CommunityCrumbs handle={handle} title={pub.title} />
      <div className="cd-card">
        <header className="cd-head">
          <h1>{pub.title}</h1>
          {/* Overflow: the link, and the owner's edit or a viewer's report.
              It ends the title row on every screen. */}
          <DM.Root>
            <DM.Trigger asChild>
              <button
                type="button"
                className="community-preview-btn cd-more"
                aria-label="More actions"
                data-testid="detail-more"
              >
                <MoreIcon size={15} />
              </button>
            </DM.Trigger>
            <DM.Portal>
              <DM.Content className="menu-panel menu-list" align="end" sideOffset={4}>
                <RadixEntries
                  entries={[
                    {
                      kind: 'action',
                      label: 'Copy link',
                      icon: <CopyIcon />,
                      onSelect: () => {
                        void navigator.clipboard
                          .writeText(communityPageUrl(handle, slug))
                          .then(async () => {
                            const { showNotice } = await import('../../lib/notices');
                            showNotice('Link copied.', { id: 'community-link-copied' });
                          })
                          .catch(() => undefined);
                      },
                    },
                    {
                      kind: 'action',
                      label: 'Copy board link',
                      icon: <CopyIcon />,
                      onSelect: () => {
                        void navigator.clipboard
                          .writeText(`${communityPageUrl(handle, slug)}/board`)
                          .then(async () => {
                            const { showNotice } = await import('../../lib/notices');
                            showNotice('Board link copied.', { id: 'community-link-copied' });
                          })
                          .catch(() => undefined);
                      },
                    },
                    { kind: 'separator' },
                    {
                      kind: 'action',
                      label: 'Save as template',
                      icon: <BookmarkIcon />,
                      disabled: busy,
                      onSelect: () => void saveAsTemplate(),
                    },
                    isOwner
                      ? {
                          kind: 'action',
                          label: 'Unpublish',
                          icon: <TrashIcon />,
                          danger: true,
                          onSelect: () => void unpublish(),
                        }
                      : {
                          kind: 'action',
                          label: 'Report',
                          icon: <FlagIcon />,
                          danger: true,
                          onSelect: () => setReporting(true),
                        },
                  ]}
                />
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <div className="cd-id">
            <button type="button" className="cd-author" onClick={() => goto(handle)}>
              <span className="cd-author-avatar">
                {pub.owner.avatarAsset ? (
                  <AuthedImg src={assetUrl(pub.owner.avatarAsset)} alt="" />
                ) : (
                  <span>{(pub.owner.displayName[0] ?? '@').toUpperCase()}</span>
                )}
              </span>
              <span className="cd-author-name">{pub.owner.displayName}</span>
            </button>
            <span className="community-card-date cd-date">
              {new Date(pub.createdAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
            <div className="cd-social">
              <VoteWidget
                pub={pub}
                signedIn={signedIn}
                onScore={(_id, score, myVote) =>
                  setPub((prev) => (prev ? { ...prev, score, myVote } : prev))
                }
              />
              {signedIn && (
                <UiStar
                  fav={fav}
                  count={pub.favorites}
                  onClick={() => {
                    void setFavorite(pub.id, !fav).then(() => {
                      onToggleFavorite(pub.id, !fav);
                      setPub((prev) =>
                        prev ? { ...prev, favorites: prev.favorites + (fav ? -1 : 1) } : prev,
                      );
                    });
                  }}
                />
              )}
            </div>
          </div>
          <div className="cd-actions">
            <button
              type="button"
              className="sync-primary"
              data-testid="detail-preview"
              onClick={() => onPreview(pub)}
            >
              View Board
            </button>
            <button
              type="button"
              className="community-preview-btn"
              disabled={busy}
              data-testid="detail-clone"
              onClick={() => void clone()}
            >
              {busy ? 'Cloning' : 'Clone'}
            </button>
            {isOwner && (
              <button
                type="button"
                className="community-preview-btn cd-icon-btn"
                data-testid="detail-edit"
                onClick={() => setEditing(true)}
              >
                <PencilIcon size={13} />
                Edit
              </button>
            )}
          </div>
          {pub.openLink && pub.visibility === 'public' && (
            <p className="cmty-hint cd-open-note" data-testid="detail-open-link">
              Open to anyone with the link, no account needed.
            </p>
          )}
          <span className="feed-meta cd-meta">
            {pub.visibility !== 'public' && (
              <span className="community-pill community-pill-restricted">
                {pub.visibility === 'groups' ? 'Groups' : 'Private'}
              </span>
            )}
            v{pub.latestVersion} · {pub.itemCount} item{pub.itemCount === 1 ? '' : 's'} ·{' '}
            {pub.downloads} clone{pub.downloads === 1 ? '' : 's'} ·{' '}
            <span data-testid="cd-meta-comments">
              {pub.comments ?? 0} comment{pub.comments === 1 ? '' : 's'}
            </span>
          </span>
        </header>
      </div>

      {hero && (
        <button type="button" className="cd-hero" onClick={() => onPreview(pub)} title="View board">
          <AuthedImg src={assetUrl(hero)} alt="" />
        </button>
      )}

      {pub.description && (
        <SimpleMarkdown text={pub.description} className="cd-description" testId="cd-description" />
      )}
      {pub.tags.length > 0 && (
        <span className="community-card-tags">
          {pub.tags.map((t) => (
            <span key={t} className="community-tag">
              {t}
            </span>
          ))}
        </span>
      )}

      {versions.length > 0 && (
        <div className="cd-versions">
          <h2>Versions</h2>
          {versions.map((v, i) => (
            <div className="cd-version" key={v.version} data-testid="cd-version">
              <span className="cd-v">v{v.version}</span>
              <span className="cd-changelog">{v.changelog || '—'}</span>
              <span className="cd-date">{new Date(v.createdAt).toLocaleDateString()}</span>
              <button
                type="button"
                className="cmty-link-btn"
                data-testid="cd-version-view"
                onClick={() => onPreview(pub, i === 0 ? undefined : v.version)}
              >
                View
              </button>
              {isOwner && i > 0 && (
                <button
                  type="button"
                  className="cmty-link-btn"
                  disabled={busy}
                  data-testid="cd-version-restore"
                  onClick={() => void restore(v.version)}
                >
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <CommunityComments
        publicationId={pub.id}
        handle={handle}
        slug={slug}
        signedIn={signedIn}
        isOwner={isOwner}
        onCount={(n) => setPub((p) => (p ? { ...p, comments: n } : p))}
        onReport={(id) => setReportComment(id)}
      />

      {(reporting || reportComment) && (
        <ReportDialog
          handle={handle}
          slug={slug}
          title={reportComment ? 'a comment' : pub.title}
          {...(reportComment ? { commentId: reportComment } : {})}
          onClose={() => {
            setReporting(false);
            setReportComment(null);
          }}
        />
      )}
      {editing && (
        <EditPostDialog
          pub={pub}
          sharing={sharing}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void fetchPublication(handle, slug).then((r) => {
              setPub(r.publication);
              setVersions(r.versions);
              setSharingInfo(r.sharing ?? null);
            });
          }}
          onDeleted={() => {
            setEditing(false);
            goto(null); // back to the browse feed (which refetches)
          }}
        />
      )}
    </div>
  );
}

export function UiStar({
  fav,
  onClick,
  count,
}: {
  fav: boolean;
  onClick: () => void;
  /** Favorite total — renders the star as a counted chip (feed/detail). */
  count?: number;
}) {
  return (
    <button
      type="button"
      className={`community-star${fav ? ' fav' : ''}${count !== undefined ? ' with-count' : ''}`}
      aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={fav}
      data-testid="community-star"
      onClick={onClick}
    >
      <StarIcon size={14} />
      {count !== undefined && <span className="community-star-count">{count}</span>}
    </button>
  );
}

function EditPostDialog({
  pub,
  sharing: initialSharing,
  onClose,
  onSaved,
  onDeleted,
}: {
  pub: CommunityPublication;
  sharing: { groupIds: string[]; people: string[] } | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(pub.title);
  const [description, setDescription] = useState(pub.description);
  const [tags, setTags] = useState(pub.tags.join(', '));
  const [license, setLicense] = useState(pub.license);
  const [sharing, setSharing] = useState<SharingValue>({
    visibility: pub.visibility,
    openLink: pub.openLink ?? false,
    groupIds: initialSharing?.groupIds ?? [],
    people: (initialSharing?.people ?? []).join(', '),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updatePublication(pub.id, {
        title,
        description,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        license,
        visibility: sharing.visibility,
        openLink: sharing.openLink,
        groupIds: sharing.groupIds,
        people: parsePeople(sharing.people),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the changes.');
      setBusy(false);
    }
  };

  return (
    <UiDialog
      title="Edit post"
      onClose={onClose}
      className="cmty-sheet"
      size="wide"
      testId="post-edit-dialog"
    >
      <div className="cmty-body">
        {error && <p className="cmty-error">{error}</p>}
        <label className="cmty-field">
          <span>Title</span>
          <input
            value={title}
            data-testid="post-edit-title"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="cmty-field">
          <span>Description</span>
          <textarea
            value={description}
            placeholder="What is this board?"
            data-testid="post-edit-description"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="cmty-field">
          <span>Tags</span>
          <input
            value={tags}
            placeholder="Tags, comma separated (max 8)"
            data-testid="post-edit-tags"
            onChange={(e) => setTags(e.target.value)}
          />
        </label>
        <SharingFields value={sharing} onChange={setSharing} />
        <div className="cmty-field">
          <span>License</span>
          <UiSelect
            ariaLabel="License"
            testId="post-edit-license"
            value={license}
            onChange={setLicense}
            options={[
              { value: 'all-rights-reserved', label: 'All rights reserved' },
              { value: 'cc-by', label: 'CC BY 4.0 — reuse with credit' },
              { value: 'cc-by-sa', label: 'CC BY-SA 4.0 — share-alike' },
              { value: 'cc-by-nc', label: 'CC BY-NC 4.0 — non-commercial' },
              { value: 'cc0', label: 'CC0 — public domain' },
            ]}
          />
        </div>
        <div className="cmty-actions">
          <button
            type="button"
            className="cmty-link-btn cmty-danger-link"
            data-testid="post-unpublish"
            onClick={() => {
              void confirmDialog({
                title: 'Unpublish this board?',
                body: 'It disappears from the community, with its versions and comments. Your own board is untouched.',
                confirmLabel: 'Unpublish',
              }).then((ok) => {
                if (ok) void deletePublication(pub.id).then(onDeleted);
              });
            }}
          >
            Unpublish
          </button>
          <button type="button" className="cmty-ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sync-primary"
            disabled={busy}
            data-testid="post-edit-save"
            onClick={() => void save()}
          >
            {busy ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

function ReportDialog({
  handle,
  slug,
  title,
  commentId,
  onClose,
}: {
  handle: string;
  slug: string;
  title: string;
  /** Set when the report is about one comment under the board. */
  commentId?: string;
  onClose: () => void;
}) {
  const [category, setCategory] = useState('inappropriate');
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [gf, setGf] = useState(false);
  const [acc, setAcc] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const send = async () => {
    if (!reason.trim()) {
      setStatus('Tell us what’s wrong first.');
      return;
    }
    if (category === 'copyright' && (!gf || !acc)) {
      setStatus('Copyright claims require both statements to be checked.');
      return;
    }
    try {
      await sendReport({
        handle,
        slug,
        category: category as 'copyright' | 'inappropriate' | 'spam' | 'other',
        reason,
        email,
        ...(commentId ? { commentId } : {}),
      });
      setStatus('Thanks — your report was received.');
      setTimeout(onClose, 1200);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not send the report.');
    }
  };

  return (
    <UiDialog
      title={`Report “${title}”`}
      onClose={onClose}
      className="cmty-sheet"
      size="wide"
      testId="report-dialog"
    >
      <div className="cmty-body">
        <UiSelect
          ariaLabel="Report category"
          testId="report-category"
          value={category}
          onChange={setCategory}
          options={[
            { value: 'inappropriate', label: 'Inappropriate or harmful content' },
            { value: 'copyright', label: 'Copyright infringement (DMCA)' },
            { value: 'spam', label: 'Spam or misleading' },
            { value: 'other', label: 'Something else' },
          ]}
        />
        <textarea
          value={reason}
          placeholder="Tell us what’s wrong — for copyright claims, identify the original work and where it appears."
          data-testid="report-reason"
          onChange={(e) => setReason(e.target.value)}
        />
        <input
          type="email"
          value={email}
          placeholder="Your email (required for copyright claims)"
          data-testid="report-email"
          onChange={(e) => setEmail(e.target.value)}
        />
        {category === 'copyright' && (
          <>
            <label className="cmty-check">
              <input type="checkbox" checked={gf} onChange={(e) => setGf(e.target.checked)} /> I
              have a good-faith belief that the use of the material is not authorized by the
              copyright owner, its agent, or the law.
            </label>
            <label className="cmty-check">
              <input type="checkbox" checked={acc} onChange={(e) => setAcc(e.target.checked)} /> The
              information in this notice is accurate, and under penalty of perjury, I am the owner
              (or authorized to act for the owner) of the copyright claimed.
            </label>
          </>
        )}
        {status && (
          <p className="cmty-hint" data-testid="report-status">
            {status}
          </p>
        )}
        <div className="cmty-actions">
          <button type="button" className="cmty-ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sync-primary"
            data-testid="report-send"
            onClick={() => void send()}
          >
            Send report
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

/** Preload the viewer's own handle (Edit profile entry points may want it). */
function useMyHandle(): string | null {
  const [handle, setHandle] = useState<string | null>(null);
  const signedIn = useSyncStore((s) => s.status === 'signedIn') && communitySameOrigin();
  useEffect(() => {
    if (!signedIn) return;
    void fetchMyProfile()
      .then((p) => setHandle(p?.handle ?? null))
      .catch(() => setHandle(null));
  }, [signedIn]);
  return handle;
}
