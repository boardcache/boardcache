import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoardsIcon,
  TemplateIcon,
  GearIcon,
  GlobeIcon,
  HamburgerIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  BadgeCheckIcon,
} from '../icons';
import { UiTooltip } from '../ui/Tooltip';
import { AuthedImg } from '../ui/AuthedImg';
import {
  blockCommunity,
  clonePublication,
  communityEmbedUrl,
  communityAssetUrl,
  communitySameOrigin,
  fetchMyProfile,
  listFavorites,
  type CommunityProfile,
  listPublications,
  setFavorite,
  type CommunityPublication,
  votePublication,
  fetchPublication,
} from '../../lib/sync/community';
import { CommunityDetailView, CommunityProfileView, UiStar } from './CommunityViews';
import { GroupHeaderCard, GroupsDialog } from './CommunityGroups';
import { listGroups, type CommunityGroup } from '../../lib/sync/community';
import { SimpleMarkdown } from '../ui/SimpleMarkdown';
import { resolveTheme, useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';
import * as DM from '@radix-ui/react-dropdown-menu';
import { RadixEntries } from '../menu/RadixEntries';

/**
 * Full-page Community area sharing the library's shell: same top bar
 * (logo, actions) and the same sidebar chassis — which holds the browse
 * links (sort) and the tag directory. Cards are cover-image tiles that
 * clone in place or open the public live-preview page.
 */

type Sort = 'hot' | 'top' | 'new' | 'popular' | 'favorites' | 'following';

/** Reddit-style ±1 votes: arrows + net score; optimistic via the response. */
export function VoteWidget({
  pub,
  signedIn,
  onScore,
}: {
  pub: Pick<CommunityPublication, 'id' | 'slug' | 'score' | 'myVote'>;
  signedIn: boolean;
  onScore: (id: string, score: number, myVote: number) => void;
}) {
  const cast = (dir: 1 | -1) => {
    const next: 1 | -1 | 0 = pub.myVote === dir ? 0 : dir;
    void votePublication(pub.id, next)
      .then((r) => onScore(pub.id, r.score, r.myVote))
      .catch(() => undefined);
  };
  return (
    <span className="vote-widget" data-testid={`community-vote-${pub.slug}`}>
      <button
        type="button"
        className={`vote-btn${pub.myVote === 1 ? ' voted-up' : ''}`}
        aria-pressed={pub.myVote === 1}
        aria-label="Upvote"
        disabled={!signedIn}
        title={signedIn ? 'Upvote' : 'Sign in to vote'}
        data-testid={`community-upvote-${pub.slug}`}
        onClick={() => cast(1)}
      >
        <ChevronUpIcon size={14} />
      </button>
      <span className="vote-score" data-testid={`community-score-${pub.slug}`}>
        {pub.score}
      </span>
      <button
        type="button"
        className={`vote-btn${pub.myVote === -1 ? ' voted-down' : ''}`}
        aria-pressed={pub.myVote === -1}
        aria-label="Downvote"
        disabled={!signedIn}
        title={signedIn ? 'Downvote' : 'Sign in to vote'}
        data-testid={`community-downvote-${pub.slug}`}
        onClick={() => cast(-1)}
      >
        <ChevronDownIcon size={14} />
      </button>
    </span>
  );
}

export function CommunityScreen() {
  const theme = useSessionStore((s) => s.theme);
  const resolved = resolveTheme(theme);
  const back = () => useSessionStore.getState().setView('library');
  const [sideOpen, setSideOpen] = useState(false);
  const [q, setQ] = useState('');
  // Browse state lives in the session store so every section has a ROUTE
  // (/community/top, /community/tag/x, /community/group/y — see router.ts).
  const { sort, tag, group } = useSessionStore((s) => s.communityBrowse);
  const setSort = (v: Sort) => useSessionStore.getState().setCommunityBrowse({ sort: v });
  const setTag = (v: string | null) => useSessionStore.getState().setCommunityBrowse({ tag: v });
  const setGroup = (v: string | null) =>
    useSessionStore.getState().setCommunityBrowse({ group: v });
  const [pubs, setPubs] = useState<CommunityPublication[] | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Group scope: a group id narrows the feed to boards shared with it.
  const [myGroups, setMyGroups] = useState<CommunityGroup[]>([]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupsFocus, setGroupsFocus] = useState<string | null>(null);
  const [groupsRev, setGroupsRev] = useState(0);

  // Sub-route (profile / detail) — the sidebar and header stay mounted.
  const route = useSessionStore((s) => s.communityRoute);
  const goto = (handle: string | null, slug: string | null = null, view = false) =>
    useSessionStore
      .getState()
      .setCommunityRoute(handle ? { handle, slug, ...(view && slug ? { view: true } : {}) } : null);

  // The live preview is a route of its own (/community/u/:h/:s/view), so
  // Back and Close both return to the post. The publication behind it is
  // whatever opened it, or fetched when the URL is opened directly.
  const previewHandle = route?.view && route.slug ? route.handle : null;
  const previewSlug = route?.view && route.slug ? route.slug : null;
  const [preview, setPreview] = useState<CommunityPublication | null>(null);
  // Opened from inside the app, the preview pushed a history entry: Close
  // steps back to wherever it was opened from (the feed, a profile, the
  // post). Opened by URL, there is nothing behind it: Close shows the post.
  const pushedPreview = useRef(false);
  const openPreview = (pub: CommunityPublication) => {
    setPreview(pub);
    pushedPreview.current = true;
    goto(pub.owner.handle, pub.slug, true);
  };
  const closePreview = useCallback(() => {
    if (!previewHandle || !previewSlug) return;
    if (pushedPreview.current) {
      pushedPreview.current = false;
      history.back();
    } else {
      useSessionStore.getState().setCommunityRoute({ handle: previewHandle, slug: previewSlug });
    }
  }, [previewHandle, previewSlug]);
  useEffect(() => {
    if (!previewHandle || !previewSlug) return;
    if (preview && preview.owner.handle === previewHandle && preview.slug === previewSlug) return;
    let alive = true;
    void fetchPublication(previewHandle, previewSlug)
      .then((r) => alive && setPreview(r.publication))
      .catch(
        () =>
          alive &&
          useSessionStore
            .getState()
            .setCommunityRoute({ handle: previewHandle, slug: previewSlug }),
      );
    return () => {
      alive = false;
    };
    // Keyed by the route; `preview` only short-circuits a fetch already made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewHandle, previewSlug]);
  // The preview frame's URL is minted per opening (a ticket for the view host).
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!previewHandle || !previewSlug) {
      queueMicrotask(() => setPreviewSrc(null));
      return;
    }
    let alive = true;
    void communityEmbedUrl(previewHandle, previewSlug)
      .then((url) => alive && setPreviewSrc(url))
      .catch(() => alive && setPreviewSrc(null));
    return () => {
      alive = false;
    };
  }, [previewHandle, previewSlug]);

  // The viewer's favorites (ids) — drives the stars and the Favorites scope.
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const applyScore = (id: string, score: number, myVote: number) =>
    setPubs((prev) => (prev ? prev.map((p) => (p.id === id ? { ...p, score, myVote } : p)) : prev));
  const toggleFavorite = (id: string, fav: boolean) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (fav) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  useEffect(() => {
    if (!previewHandle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewHandle, closePreview]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const scope = sort === 'favorites' || sort === 'following' ? sort : undefined;
      const order =
        scope || sort === 'favorites' || sort === 'following'
          ? undefined
          : (sort as 'hot' | 'top' | 'new' | 'popular');
      void listPublications({
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(scope ? { filter: scope } : {}),
        ...(order ? { sort: order } : {}),
        ...(group ? { group } : {}),
      })
        .then(setPubs)
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : 'Community is unavailable.'),
        );
    }, 200);
    return () => clearTimeout(timer);
    // `route` included so returning from a sub-view (edit/unpublish there)
    // shows a fresh listing.
  }, [q, sort, route, group]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pub of pubs ?? []) {
      for (const t of pub.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  }, [pubs]);

  const visible = useMemo(() => {
    let list = pubs ?? [];
    if (tag) list = list.filter((p) => p.tags.includes(tag));
    if (sort === 'popular') list = [...list].sort((a, b) => b.downloads - a.downloads);
    return list;
  }, [pubs, tag, sort]);

  const signedIn = useSyncStore((s) => s.status === 'signedIn') && communitySameOrigin();
  // The viewer's own community profile (handle + avatar) for the sidebar
  // link. Re-fetched when the route changes so an avatar/name edit on the
  // profile page shows up here immediately.
  const [myProfile, setMyProfile] = useState<CommunityProfile | null>(null);
  useEffect(() => {
    if (!signedIn) {
      queueMicrotask(() => setMyProfile(null));
      return;
    }
    void fetchMyProfile()
      .then(setMyProfile)
      .catch(() => setMyProfile(null));
  }, [signedIn, route]);
  // Exactly ONE of Community / My Profile highlights: the profile row wins
  // while viewing your own profile page.
  const onMyProfile = Boolean(
    myProfile && route && route.handle === myProfile.handle && !route.slug,
  );
  useEffect(() => {
    if (!signedIn) return;
    void listFavorites()
      .then((ids) => setFavorites(new Set(ids)))
      .catch(() => undefined);
    void listGroups()
      .then((g) => setMyGroups(g.mine))
      .catch(() => undefined);
  }, [signedIn]);
  // Hide/block: server-persisted for signed-in viewers, filtered locally
  // for instant feedback (listings re-filter on the server thereafter).
  const moderate = async (kind: 'user' | 'publication', pub: CommunityPublication) => {
    try {
      await blockCommunity(kind, kind === 'user' ? pub.owner.handle : pub.id);
      setPubs(
        (prev) =>
          prev?.filter((p) =>
            kind === 'user' ? p.owner.handle !== pub.owner.handle : p.id !== pub.id,
          ) ?? prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
    }
  };

  const clone = async (pub: CommunityPublication) => {
    setBusySlug(pub.slug);
    setError(null);
    try {
      await clonePublication(pub.owner.handle, pub.slug); // import opens the board
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clone failed.');
      setBusySlug(null);
    }
  };

  const pickSort = (next: Sort) => {
    setSort(next);
    setGroup(null);
    setSideOpen(false);
    goto(null);
  };
  const pickTag = (next: string | null) => {
    setTag(next);
    setSideOpen(false);
    goto(null);
  };
  // Community "home": back to the unfiltered browse root.
  const home = () => {
    setQ('');
    setTag(null);
    setSort('hot');
    setGroup(null);
    setSideOpen(false);
    goto(null);
  };

  // Members-only: the community requires a (free) account — the server
  // refuses signed-out reads, so the client leads with the join wall.
  if (!signedIn) {
    return (
      <div className="library-screen community-screen" data-testid="community-screen">
        <header className="library-header">
          <div className="library-header-left">
            <img
              src={resolved === 'dark' ? '/logo-dark.svg' : '/logo.svg'}
              alt="boardCache"
              className="library-logo"
              style={{ cursor: 'pointer' }}
              onClick={back}
            />
            <span className="community-crumb">Community</span>
          </div>
        </header>
        <div className="community-join-wall" data-testid="community-join-wall">
          <h1>A community of boards</h1>
          <p>
            boardCache members publish live boards here — browse them in place, clone them into your
            own library, and follow the people behind them. Joining is free.
          </p>
          <div className="community-join-actions">
            <button
              type="button"
              className="sync-primary"
              data-testid="community-join-signup"
              onClick={() => useSessionStore.getState().setSyncDialogOpen(true, 'register')}
            >
              Create a free account
            </button>
            <button
              type="button"
              className="sync-link"
              data-testid="community-join-signin"
              onClick={() => useSessionStore.getState().setSyncDialogOpen(true, 'login')}
            >
              I already have an account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="library-screen community-screen" data-testid="community-screen">
      <header className="library-header">
        <div className="library-header-left">
          <button
            type="button"
            className="library-menu-btn"
            onClick={() => setSideOpen(true)}
            aria-label="Browse and tags"
            data-testid="community-menu-btn"
          >
            <HamburgerIcon size={18} />
          </button>
          <img
            src={resolved === 'dark' ? '/logo-dark.svg' : '/logo.svg'}
            alt="boardCache"
            className="library-logo"
            style={{ cursor: 'pointer' }}
            onClick={back}
          />
          <span className="community-crumb header-mobile-hidden">Community</span>
        </div>
        <div className="community-search header-mobile-hidden">
          <SearchIcon size={15} />
          <input
            value={q}
            placeholder="Search boards, tags, people"
            data-testid="community-search"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="library-actions">
          {signedIn && (
            <UiTooltip label="Settings (profile, plan, appearance)">
              <button
                type="button"
                className="library-icon-btn header-mobile-hidden"
                data-testid="community-settings"
                aria-label="Settings"
                onClick={() => useSessionStore.getState().setSettingsOpen(true)}
              >
                <GearIcon size={16} />
              </button>
            </UiTooltip>
          )}
          <button
            type="button"
            className="library-theme-toggle"
            onClick={() =>
              useSessionStore.getState().setTheme(resolved === 'dark' ? 'light' : 'dark')
            }
            aria-label="Toggle light/dark theme"
            data-testid="theme-toggle"
          >
            {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <div className="library-body">
        {sideOpen && (
          <div
            className="library-side-backdrop"
            data-testid="community-side-backdrop"
            onClick={() => setSideOpen(false)}
          />
        )}
        <aside
          className={`library-sidebar${sideOpen ? ' open' : ''}`}
          data-testid="community-sidebar"
        >
          <div className="lib-side-navgroup">
            <button
              type="button"
              className="lib-side-nav"
              data-testid="community-nav-boards"
              onClick={back}
            >
              <BoardsIcon size={16} />
              <span className="lib-row-label">My Boards</span>
            </button>
            <button
              type="button"
              className="lib-side-nav"
              data-testid="community-nav-templates"
              onClick={() => {
                // Saving a community board files it under My Templates — keep
                // that section one click away from here.
                useSessionStore.getState().setLibraryFolder('templates');
                useSessionStore.getState().setView('library');
              }}
            >
              <TemplateIcon size={16} />
              <span className="lib-row-label">My Templates</span>
            </button>
            <button
              type="button"
              className={`lib-side-nav${onMyProfile ? '' : ' active'}`}
              data-testid="community-home"
              onClick={home}
            >
              <GlobeIcon size={16} />
              <span className="lib-row-label">Community</span>
            </button>
            {myProfile && (
              <button
                type="button"
                className={`lib-side-nav cs-profile-link${onMyProfile ? ' active' : ''}`}
                data-testid="community-my-profile"
                onClick={() => {
                  goto(myProfile.handle);
                  setSideOpen(false);
                }}
              >
                <span className="cs-profile-avatar">
                  {myProfile.avatarAsset ? (
                    <AuthedImg src={communityAssetUrl(myProfile.avatarAsset)} alt="" />
                  ) : (
                    <span>{(myProfile.displayName[0] ?? '@').toUpperCase()}</span>
                  )}
                </span>
                <span className="lib-row-label">My Profile</span>
              </button>
            )}
          </div>
          {/* On mobile the header slims down to logo + publish + theme; search
              and the My Boards link move into the drawer. */}
          <div className="community-side-mobile">
            <div className="community-search community-side-search">
              <SearchIcon size={15} />
              <input
                value={q}
                placeholder="Search boards, tags, people"
                data-testid="community-side-search"
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          <div className="lib-side-head">Browse</div>
          <button
            type="button"
            className={`lib-side-row${sort === 'hot' ? ' active' : ''}`}
            data-testid="community-sort-hot"
            onClick={() => pickSort('hot')}
          >
            <span className="lib-row-label">Hot</span>
          </button>
          <button
            type="button"
            className={`lib-side-row${sort === 'top' ? ' active' : ''}`}
            data-testid="community-sort-top"
            onClick={() => pickSort('top')}
          >
            <span className="lib-row-label">Top</span>
          </button>
          <button
            type="button"
            className={`lib-side-row${sort === 'new' ? ' active' : ''}`}
            data-testid="community-sort-new"
            onClick={() => pickSort('new')}
          >
            <span className="lib-row-label">Newest</span>
          </button>
          <button
            type="button"
            className={`lib-side-row${sort === 'popular' ? ' active' : ''}`}
            data-testid="community-sort-popular"
            onClick={() => pickSort('popular')}
          >
            <span className="lib-row-label">Popular</span>
          </button>
          {signedIn && (
            <>
              <button
                type="button"
                className={`lib-side-row${sort === 'favorites' ? ' active' : ''}`}
                data-testid="community-sort-favorites"
                onClick={() => pickSort('favorites')}
              >
                <span className="lib-row-label">Favorites</span>
              </button>
              <button
                type="button"
                className={`lib-side-row${sort === 'following' ? ' active' : ''}`}
                data-testid="community-sort-following"
                onClick={() => pickSort('following')}
              >
                <span className="lib-row-label">Following</span>
              </button>
            </>
          )}

          {signedIn && (
            <>
              <div className="lib-side-head community-tags-head">Groups</div>
              {myGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`lib-side-row${group === g.id ? ' active' : ''}`}
                  data-testid={`community-group-${g.id}`}
                  onClick={() => {
                    setGroup(group === g.id ? null : g.id);
                    setSideOpen(false);
                    goto(null);
                  }}
                >
                  <span className="lib-row-label">{g.name}</span>
                  <span className="lib-count">{g.members}</span>
                </button>
              ))}
              <button
                type="button"
                className="lib-side-row"
                data-testid="community-groups-manage"
                onClick={() => {
                  setGroupsFocus(null);
                  setGroupsOpen(true);
                }}
              >
                <span className="lib-row-label lib-side-add-label">Manage groups</span>
              </button>
            </>
          )}
          <div className="lib-side-head community-tags-head">Tags</div>
          <button
            type="button"
            className={`lib-side-row${tag === null ? ' active' : ''}`}
            data-testid="community-tag-all"
            onClick={() => pickTag(null)}
          >
            <span className="lib-row-label">All boards</span>
            <span className="lib-count">{pubs?.length ?? 0}</span>
          </button>
          {tags.map(([t, n]) => (
            <button
              key={t}
              type="button"
              className={`lib-side-row${tag === t ? ' active' : ''}`}
              data-testid={`community-tag-${t}`}
              onClick={() => pickTag(tag === t ? null : t)}
            >
              <span className="lib-row-label">{t}</span>
              <span className="lib-count">{n}</span>
            </button>
          ))}
        </aside>

        <main className="library-main community-main">
          {route ? (
            route.slug ? (
              <CommunityDetailView
                handle={route.handle}
                slug={route.slug}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                onPreview={openPreview}
              />
            ) : (
              <CommunityProfileView
                handle={route.handle}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
              />
            )
          ) : (
            <>
              {error && <p className="community-error">{error}</p>}
              {group && (
                <GroupHeaderCard
                  groupId={group}
                  revision={groupsRev}
                  onEdit={() => {
                    setGroupsFocus(group);
                    setGroupsOpen(true);
                  }}
                />
              )}
              {!pubs ? (
                <div
                  className="community-feed skeleton-wrap"
                  data-testid="community-feed-loading"
                  aria-label="Loading community boards"
                >
                  {Array.from({ length: 3 }, (_, i) => (
                    <div className="feed-item" key={i} aria-hidden>
                      <span className="skeleton-block skeleton-circle feed-avatar-skel" />
                      <div className="feed-body">
                        <span className="skeleton-line short" />
                        <span className="skeleton-block feed-cover-skel" />
                        <span className="skeleton-line lg" />
                        <span className="skeleton-line" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : visible.length === 0 ? (
                <p className="community-empty">
                  {q.trim() || tag
                    ? 'Nothing matches — try a different search.'
                    : 'Nothing published yet — be the first.'}
                </p>
              ) : (
                <div className="community-feed view-fade-in" data-testid="community-feed">
                  {visible.map((pub) => (
                    <article
                      className="feed-item"
                      key={pub.id}
                      data-testid={`community-card-${pub.slug}`}
                    >
                      <button
                        type="button"
                        className="feed-avatar"
                        aria-label={`@${pub.owner.handle}`}
                        onClick={() => goto(pub.owner.handle)}
                      >
                        {pub.owner.avatarAsset ? (
                          <AuthedImg
                            src={communityAssetUrl(pub.owner.avatarAsset)}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <span>{(pub.owner.displayName[0] ?? '@').toUpperCase()}</span>
                        )}
                      </button>
                      <div className="feed-body">
                        <div className="feed-head">
                          <button
                            type="button"
                            className="feed-name"
                            data-testid={`community-author-${pub.slug}`}
                            onClick={() => goto(pub.owner.handle)}
                          >
                            {pub.owner.displayName}
                          </button>
                          <span className="feed-handle">
                            @{pub.owner.handle}
                            {pub.owner.founding && (
                              <UiTooltip label="Founding member">
                                <span className="founding-mark" aria-label="Founding member">
                                  <BadgeCheckIcon size={12} />
                                </span>
                              </UiTooltip>
                            )}
                          </span>
                          <span className="feed-date">
                            ·{' '}
                            {new Date(pub.createdAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                          {signedIn && (
                            <DM.Root>
                              <DM.Trigger asChild>
                                <button
                                  type="button"
                                  className="community-card-more feed-more"
                                  aria-label="More"
                                  data-testid={`community-more-${pub.slug}`}
                                >
                                  ⋯
                                </button>
                              </DM.Trigger>
                              <DM.Portal>
                                <DM.Content
                                  className="menu-panel menu-list"
                                  align="end"
                                  sideOffset={4}
                                  collisionPadding={8}
                                >
                                  <RadixEntries
                                    entries={[
                                      {
                                        kind: 'action',
                                        label: 'Hide this board',
                                        onSelect: () => void moderate('publication', pub),
                                      },
                                      {
                                        kind: 'action',
                                        label: `Block @${pub.owner.handle}`,
                                        onSelect: () => void moderate('user', pub),
                                      },
                                    ]}
                                  />
                                </DM.Content>
                              </DM.Portal>
                            </DM.Root>
                          )}
                        </div>
                        <button
                          type="button"
                          className="community-cover feed-cover"
                          onClick={() => goto(pub.owner.handle, pub.slug)}
                          title={`Open ${pub.title}`}
                        >
                          {pub.coverAsset ? (
                            <AuthedImg
                              src={communityAssetUrl(pub.coverAsset)}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="community-cover-fallback">
                              {(pub.title[0] ?? 'b').toUpperCase()}
                            </span>
                          )}
                        </button>
                        <h3>
                          <button
                            type="button"
                            className="community-card-title feed-title"
                            onClick={() => goto(pub.owner.handle, pub.slug)}
                          >
                            {pub.title}
                          </button>
                        </h3>
                        {pub.description && (
                          <SimpleMarkdown text={pub.description} className="feed-desc" />
                        )}
                        {pub.tags.length > 0 && (
                          <span className="community-card-tags">
                            {pub.tags.slice(0, 4).map((t) => (
                              <button
                                key={t}
                                type="button"
                                className="community-tag"
                                onClick={() => setTag(t)}
                              >
                                {t}
                              </button>
                            ))}
                          </span>
                        )}
                        <div className="feed-meta">
                          {pub.visibility !== 'public' && (
                            <span className="community-pill community-pill-restricted">
                              {pub.visibility === 'groups' ? 'Groups' : 'Private'}
                            </span>
                          )}
                          v{pub.latestVersion} · {pub.itemCount} item
                          {pub.itemCount === 1 ? '' : 's'} · {pub.downloads} clone
                          {pub.downloads === 1 ? '' : 's'} · {pub.comments ?? 0} comment
                          {pub.comments === 1 ? '' : 's'}
                        </div>
                        <div className="feed-foot">
                          <span className="feed-foot-left">
                            <VoteWidget pub={pub} signedIn={signedIn} onScore={applyScore} />
                            <UiStar
                              fav={favorites.has(pub.id)}
                              count={pub.favorites}
                              onClick={() => {
                                if (!signedIn) return;
                                const next = !favorites.has(pub.id);
                                void setFavorite(pub.id, next).then(() => {
                                  toggleFavorite(pub.id, next);
                                  setPubs((prev) =>
                                    prev
                                      ? prev.map((p) =>
                                          p.id === pub.id
                                            ? { ...p, favorites: p.favorites + (next ? 1 : -1) }
                                            : p,
                                        )
                                      : prev,
                                  );
                                  if (sort === 'favorites' && !next) {
                                    setPubs((prev) => prev?.filter((p) => p.id !== pub.id) ?? prev);
                                  }
                                });
                              }}
                            />
                          </span>
                          <span className="feed-actions">
                            <button
                              type="button"
                              className="community-preview-btn"
                              data-testid={`community-preview-${pub.slug}`}
                              onClick={() => openPreview(pub)}
                            >
                              View Board
                            </button>
                            <button
                              type="button"
                              className="sync-primary"
                              disabled={busySlug !== null}
                              data-testid={`community-clone-${pub.slug}`}
                              onClick={() => void clone(pub)}
                            >
                              {busySlug === pub.slug ? 'Cloning' : 'Clone'}
                            </button>
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {groupsOpen && (
        <GroupsDialog
          initialOpen={groupsFocus}
          onClose={() => setGroupsOpen(false)}
          onChanged={() => {
            setGroupsRev((r) => r + 1);
            void listGroups()
              .then((g) => {
                setMyGroups(g.mine);
                if (group && !g.mine.some((x) => x.id === group)) setGroup(null);
              })
              .catch(() => undefined);
          }}
        />
      )}
      {previewHandle && previewSlug && (
        <div className="community-lightbox" data-testid="community-lightbox">
          <div className="community-lightbox-bar">
            <span className="community-lightbox-title">{preview?.title ?? ''}</span>
            <div className="community-lightbox-actions">
              <button
                type="button"
                className="community-preview-btn"
                data-testid="community-lightbox-close"
                onClick={closePreview}
              >
                Close
              </button>
            </div>
          </div>
          {previewSrc && (
            <iframe
              className="community-lightbox-frame"
              src={previewSrc}
              title={preview?.title ?? 'Board preview'}
              // Provider players (YouTube, Spotify) nest inside this frame and
              // only get what it delegates.
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"
            />
          )}
        </div>
      )}
    </div>
  );
}
