import type { CanvasDocument } from '@boardcache/schema';
import {
  apiFetch,
  communityBase,
  communityPagesUrl,
  setCommunityPagesBase,
  communityEnabled,
  communityFetch,
  communityUrl,
  hasSyncServer,
  syncServerBaseValue,
} from './apiBase';
import { exportBoardFile } from '../board/boardcacheFile';
import { contentBounds, coverBounds, renderRegion } from '../media/thumbnail';
import { importBoardFromFile } from '../board/transfer';

/**
 * Client half of Community publishing (the server half is SaaS-only; on
 * servers without it every call here 404s and the UI stays hidden).
 * Publishing is an explicit exit from E2E encryption: the user exports a
 * plaintext snapshot and uploads it for public browsing/cloning.
 */

export interface CommunityProfile {
  handle: string;
  displayName: string;
  bio: string;
  link?: string;
  avatarAsset?: string | null;
  /** Private profiles show content only to approved followers. */
  private?: boolean;
  /** Took a founding-member price: a badge for life. */
  founding?: boolean;
}

export interface CommunityUser {
  profile: CommunityProfile;
  followers: number;
  viewerFollows: boolean;
  /** none → not following; pending → requested, awaiting approval. */
  viewerFollowState: 'none' | 'pending' | 'following';
  /** True when the profile is private and the viewer isn't approved. */
  restricted: boolean;
  isSelf: boolean;
  publications: CommunityPublication[];
}

export interface FollowRequest {
  handle: string;
  displayName: string;
  avatarAsset: string | null;
  requestedAt: string;
}

export interface CommunityPublication {
  id: string;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  license: string;
  downloads: number;
  favorites: number;
  /** Visible comments under the board. */
  comments?: number;
  /** Net votes (up − down) — the feed's ranking signal. */
  score: number;
  /** The signed-in viewer's own vote: 1, -1 or 0. */
  myVote: number;
  visibility: 'public' | 'groups' | 'private';
  owner: { handle: string; displayName: string; avatarAsset?: string | null; founding?: boolean };
  createdAt: string;
  updatedAt: string;
  latestVersion?: number;
  itemCount?: number;
  sizeBytes?: number;
  coverAsset?: string | null;
  previewAsset?: string | null;
}

let enabled = false;
let probing: Promise<boolean> | null = null;

/**
 * Does the community origin offer Community? The community lives on the
 * OFFICIAL server by default, so this is true even for clients with no (or
 * their own) sync server. Only a YES is remembered: a probe that failed —
 * offline at launch, a hiccup before sign-in — is asked again next time, so
 * the section appears as soon as the server answers instead of staying
 * hidden until a reload.
 */
export function communityAvailable(): Promise<boolean> {
  if (!communityEnabled()) return Promise.resolve(false); // switched off in config.json
  if (enabled) return Promise.resolve(true);
  probing ??= communityFetch('/api/community/config')
    .then(
      async (res) => {
        if (!res.ok) return false;
        // The server says where its public pages are (the web app, when
        // the API is a host of its own).
        const cfg = (await res.json().catch(() => ({}))) as { appUrl?: unknown };
        setCommunityPagesBase(cfg.appUrl);
        return true;
      },
      () => false,
    )
    .then((ok) => {
      enabled = ok;
      probing = null;
      return ok;
    });
  return probing;
}

/**
 * Can the signed-in user PARTICIPATE (publish, star, follow, hide)?
 * Only when their sync account lives on the same server as the community —
 * cookie or bearer, the auth then reaches the community routes. A client
 * syncing elsewhere (or nowhere) browses and clones anonymously.
 */
export function communitySameOrigin(): boolean {
  return hasSyncServer() && communityBase() === (syncServerBaseValue() ?? '__none__');
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Community request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

export async function fetchMyProfile(): Promise<CommunityProfile | null> {
  const res = await communityFetch('/api/community/profile', { credentials: 'include' });
  return (await json<{ profile: CommunityProfile | null }>(res)).profile;
}

export async function saveProfile(profile: {
  handle: string;
  displayName: string;
  bio?: string;
  link?: string;
  private?: boolean;
}): Promise<CommunityProfile> {
  const res = await communityFetch('/api/community/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(profile),
  });
  return (await json<{ profile: CommunityProfile }>(res)).profile;
}

export async function listPublications(
  opts: {
    q?: string;
    mine?: boolean;
    filter?: 'favorites' | 'following';
    group?: string;
    /** Feed ranking: 'hot' (votes vs age — the server default), 'top', 'new', 'popular'. */
    sort?: 'hot' | 'top' | 'new' | 'popular';
  } = {},
): Promise<CommunityPublication[]> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.mine) params.set('mine', '1');
  if (opts.filter) params.set('filter', opts.filter);
  if (opts.group) params.set('group', opts.group);
  if (opts.sort) params.set('sort', opts.sort);
  const res = await communityFetch(`/api/community/publications?${params}`, {
    credentials: 'include',
  });
  return (await json<{ publications: CommunityPublication[] }>(res)).publications;
}

export async function createPublication(meta: {
  title: string;
  slug?: string;
  description: string;
  tags: string[];
  license: string;
  attest: boolean;
  visibility?: 'public' | 'groups' | 'private';
  groupIds?: string[];
  people?: string[];
}): Promise<{ id: string; slug: string }> {
  const res = await communityFetch('/api/community/publications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(meta),
  });
  return json(res);
}

/**
 * Snapshot the doc (optionally stripping comments — usually private
 * annotations) and upload it as the publication's next version.
 */
export async function uploadVersion(
  publicationId: string,
  doc: CanvasDocument,
  opts: { includeComments: boolean; changelog?: string },
): Promise<number> {
  const snapshot: CanvasDocument = opts.includeComments ? doc : { ...doc, comments: {} };
  const blob = await exportBoardFile(snapshot);
  const res = await communityFetch(`/api/community/publications/${publicationId}/versions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      ...(opts.changelog ? { 'x-changelog': opts.changelog.slice(0, 500) } : {}),
    },
    credentials: 'include',
    body: blob,
  });
  return (await json<{ version: number }>(res)).version;
}

/**
 * Render + upload the publication images: a browse-card cover and a larger
 * page preview (the public page's static hero — the live viewer only loads
 * inside the fullscreen lightbox). Same whole-board snapshot the library
 * thumbnails use. Best-effort — publishing already succeeded when this runs.
 */
export async function uploadCover(
  publicationId: string,
  version: number,
  doc: CanvasDocument,
): Promise<void> {
  try {
    // Card cover honors a user-chosen cover item (Set Cover); the larger
    // page preview always captures the whole board.
    const cardBounds = coverBounds(doc);
    const pageBounds = contentBounds(doc);
    if (!cardBounds || !pageBounds) return;
    // Covers are public artifacts: boards with an explicit background keep
    // it; the theme-dependent default renders light so cards look uniform.
    const background = doc.settings.background !== 'default' ? doc.settings.background : '#fafafa';
    const base = `/api/community/publications/${publicationId}/versions/${version}/cover`;
    const post = async (blob: Blob, kind: 'cover' | 'preview') => {
      await apiFetch(kind === 'cover' ? base : `${base}?kind=preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        credentials: 'include',
        body: blob,
      });
    };
    await post(await renderRegion(doc, cardBounds, 1280, 800, background), 'cover');
    await post(await renderRegion(doc, pageBounds, 2560, 1600, background), 'preview');
  } catch {
    /* cards fall back to the letter tile */
  }
}

/** Live-viewer embed URL (fullscreen preview lightboxes): the view host
 *  shows the preview under a short-lived ticket the server mints for the
 *  signed-in member, so the frame carries no session of its own. */
export async function communityEmbedUrl(handle: string, slug: string): Promise<string> {
  const res = await communityFetch('/api/community/view-ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ handle, slug }),
  });
  return (await json<{ url: string }>(res)).url;
}

/** Download a published version and run it through the normal board import. */
export async function clonePublication(
  handle: string,
  slug: string,
  version: number | 'latest' = 'latest',
): Promise<void> {
  const res = await communityFetch(
    `/api/community/publications/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/versions/${version}/file`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error('Could not download the board.');
  const blob = await res.blob();
  await importBoardFromFile(new File([blob], `${slug}.boardcache`, { type: 'application/zip' }));
}

/** Download a published version straight into My Templates (not opened).
 *  Signed in, the template opts into sync like any saved template. */
export async function clonePublicationAsTemplate(
  handle: string,
  slug: string,
  version: number | 'latest' = 'latest',
): Promise<void> {
  const res = await communityFetch(
    `/api/community/publications/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/versions/${version}/file`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error('Could not download the board.');
  const blob = await res.blob();
  const { importBoardFile } = await import('../board/boardcacheFile');
  const { id, locked } = await importBoardFile(blob);
  if (locked) throw new Error('Locked boards cannot become templates.');
  const { loadBoardRecord, saveBoardRecord } = await import('../board/boardLibrary');
  const doc = await loadBoardRecord(id);
  if (!doc) throw new Error('The downloaded board failed to import.');
  await saveBoardRecord({ ...doc, settings: { ...doc.settings, isTemplate: true } }, true);
  const { useSyncStore } = await import('../../state/syncStore');
  if (useSyncStore.getState().status === 'signedIn') {
    const { enableBoardSync, markBoardDirty } = await import('./boardSync');
    await enableBoardSync(id);
    await markBoardDirty(id);
  }
}

/** Public page URL for a publication (share links) on the host that serves them. */
export const communityPageUrl = (handle: string, slug: string): string =>
  communityPagesUrl(`/u/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`);

/** Asset bytes (covers, avatars) from the community origin. */
export const communityAssetUrl = (hash: string): string =>
  communityUrl(`/api/community/assets/${hash}`);

/** Hide a publication or block a publisher for the signed-in viewer. */
export async function blockCommunity(kind: 'user' | 'publication', target: string): Promise<void> {
  const res = await communityFetch('/api/community/blocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ kind, target }),
  });
  if (!res.ok) throw new Error('Could not save that. Sign in and try again.');
}

/** Public profile + its publications, with the viewer's relationship. */
export async function fetchCommunityUser(handle: string): Promise<CommunityUser> {
  const res = await communityFetch(`/api/community/users/${encodeURIComponent(handle)}`, {
    credentials: 'include',
  });
  return json<CommunityUser>(res);
}

/** One publication's detail (metadata + versions). */
export async function fetchPublication(
  handle: string,
  slug: string,
): Promise<{
  publication: CommunityPublication;
  versions: { version: number; changelog: string; createdAt: string }[];
  sharing?: { groupIds: string[]; people: string[] };
}> {
  const res = await communityFetch(
    `/api/community/publications/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`,
    { credentials: 'include' },
  );
  return json(res);
}

export async function uploadAvatar(blob: Blob): Promise<void> {
  const res = await communityFetch('/api/community/profile/avatar', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    credentials: 'include',
    body: blob,
  });
  await json(res);
}

/** Follow (or unfollow). Following a private profile returns state 'pending'
 *  until the owner approves the request. */
export async function setFollow(
  handle: string,
  follow: boolean,
): Promise<'none' | 'pending' | 'accepted'> {
  const res = await communityFetch('/api/community/follows', {
    method: follow ? 'POST' : 'DELETE',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ handle }),
  });
  const body = await json<{ state?: 'pending' | 'accepted' }>(res);
  return follow ? (body.state ?? 'accepted') : 'none';
}

/** Pending follow requests on MY (private) profile. */
export async function listFollowRequests(): Promise<FollowRequest[]> {
  const res = await communityFetch('/api/community/follow-requests', {
    credentials: 'include',
  });
  return (await json<{ requests: FollowRequest[] }>(res)).requests;
}

export async function answerFollowRequest(
  handle: string,
  action: 'accept' | 'decline',
): Promise<void> {
  const res = await communityFetch('/api/community/follow-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ handle, action }),
  });
  await json(res);
}

/** Cast (or clear, vote=0) the viewer's vote; returns the new score. */
export async function votePublication(
  publicationId: string,
  vote: 1 | -1 | 0,
): Promise<{ score: number; myVote: number }> {
  const res = await communityFetch('/api/community/votes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ publicationId, vote }),
  });
  return json<{ score: number; myVote: number }>(res);
}

export async function listFavorites(): Promise<string[]> {
  const res = await communityFetch('/api/community/favorites', { credentials: 'include' });
  return (await json<{ ids: string[] }>(res)).ids;
}

export async function setFavorite(publicationId: string, fav: boolean): Promise<void> {
  const res = await communityFetch('/api/community/favorites', {
    method: fav ? 'POST' : 'DELETE',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ publicationId }),
  });
  await json(res);
}

export interface CommunityComment {
  id: string;
  parentId: string | null;
  /** Simple markdown; empty when deleted. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  author: { handle: string; displayName: string; avatarAsset: string | null; founding: boolean };
  mine: boolean;
}

export async function listComments(publicationId: string): Promise<CommunityComment[]> {
  const res = await communityFetch(`/api/community/publications/${publicationId}/comments`, {
    credentials: 'include',
  });
  return (await json<{ comments: CommunityComment[] }>(res)).comments;
}

export async function postComment(
  publicationId: string,
  body: string,
  parentId: string | null = null,
): Promise<CommunityComment> {
  const res = await communityFetch(`/api/community/publications/${publicationId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ body, parentId }),
  });
  return (await json<{ comment: CommunityComment }>(res)).comment;
}

export async function editComment(id: string, body: string): Promise<CommunityComment> {
  const res = await communityFetch(`/api/community/comments/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ body }),
  });
  return (await json<{ comment: CommunityComment }>(res)).comment;
}

export async function deleteComment(id: string): Promise<void> {
  const res = await communityFetch(`/api/community/comments/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await json(res);
}

/** Structured abuse/DMCA report (mirrors the public page's form). */
export async function sendReport(report: {
  handle: string;
  slug: string;
  category: 'copyright' | 'inappropriate' | 'spam' | 'other';
  reason: string;
  email?: string;
  /** Report one comment under the board rather than the board. */
  commentId?: string;
}): Promise<void> {
  const res = await communityFetch('/api/community/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(report),
  });
  await json(res);
}

/** Owner-only metadata edit (title/description/tags/license; slug is stable). */
export async function updatePublication(
  id: string,
  meta: {
    title?: string;
    description?: string;
    tags?: string[];
    license?: string;
    visibility?: 'public' | 'groups' | 'private';
    groupIds?: string[];
    people?: string[];
  },
): Promise<void> {
  const res = await communityFetch(`/api/community/publications/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(meta),
  });
  await json(res);
}

/** Owner-only: remove the publication from the community entirely. */
export async function deletePublication(id: string): Promise<void> {
  const res = await communityFetch(`/api/community/publications/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await json(res);
}

// ── groups (shared audiences) ────────────────────────────────────────────────

export interface CommunityGroup {
  id: string;
  name: string;
  role: 'owner' | 'member' | null;
  allowedDomain: string | null;
  members: number;
}

export async function listGroups(): Promise<{
  mine: CommunityGroup[];
  joinable: CommunityGroup[];
}> {
  const res = await communityFetch('/api/community/groups');
  return json(res);
}

export async function createGroup(meta: {
  name: string;
  allowedDomain?: string;
}): Promise<{ id: string }> {
  const res = await communityFetch('/api/community/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(meta),
  });
  return json(res);
}

export async function groupDetail(
  id: string,
): Promise<{ group: CommunityGroup; members: { username: string; role: string }[] }> {
  const res = await communityFetch(`/api/community/groups/${id}`);
  return json(res);
}

export async function updateGroup(
  id: string,
  meta: { name?: string; allowedDomain?: string | null },
): Promise<void> {
  const res = await communityFetch(`/api/community/groups/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(meta),
  });
  await json(res);
}

export async function deleteGroup(id: string): Promise<void> {
  const res = await communityFetch(`/api/community/groups/${id}`, { method: 'DELETE' });
  await json(res);
}

export async function inviteToGroup(id: string, username: string): Promise<void> {
  const res = await communityFetch(`/api/community/groups/${id}/invite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  await json(res);
}

export async function joinGroup(id: string): Promise<void> {
  const res = await communityFetch(`/api/community/groups/${id}/join`, { method: 'POST' });
  await json(res);
}

export async function leaveGroup(id: string): Promise<void> {
  const res = await communityFetch(`/api/community/groups/${id}/leave`, { method: 'POST' });
  await json(res);
}

export async function removeGroupMember(id: string, username: string): Promise<void> {
  const res = await communityFetch(
    `/api/community/groups/${id}/members/${encodeURIComponent(username)}`,
    { method: 'DELETE' },
  );
  await json(res);
}
