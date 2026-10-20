import { closeBoard, openBoard, openBoardNoFlush } from './board/boardLibrary';
import { openTeamBoard } from './sync/collab';
import { useCollabStore } from '../state/collabStore';
import { useDocumentStore } from '../state/documentStore';
import { useSessionStore } from '../state/sessionStore';
import type { AppView } from '../state/sessionStore';
import { pluginViewById } from '../plugins/registry';
import { markRouterReady } from './routerReady';

/**
 * Minimal URL router (History API, no dependency). Routes:
 *   /                    → board library (the default landing view)
 *   /templates           → the library's My Templates section
 *   /folder/:id          → the library filtered to one folder
 *   /community           → the in-app Community browse screen (Hot)
 *   /community/:sort     → a browse section (top/new/popular/favorites/following)
 *   /community/tag/:tag  → the feed filtered to one tag
 *   /community/group/:id → one group's shared boards
 *   /b/:id               → that board's canvas
 *   /b/:id/gallery       → that board's gallery
 *   /b/:id/i/:itemId     → that board with the item open in the lightbox
 *   /b/:id/gallery/i/:x  → same, over the gallery
 *   /t/:id[…]            → a team board (members), same suffixes as /b
 * The view + open board + lightbox are the source of truth; this module keeps
 * the URL in sync both ways. Navigating between items in an open lightbox
 * REPLACES the history entry (arrows don't spam history); opening/closing
 * pushes. nginx already serves index.html for unknown paths (SPA).
 */

let applying = false;

function pathFor(
  view: AppView,
  id: string,
  lightboxId: string | null,
  prefix: '/b' | '/t' = '/b',
): string {
  // The account dialog has its own routes: /signup and /signin.
  if (useSessionStore.getState().syncDialogOpen) {
    return useSessionStore.getState().syncDialogMode === 'register' ? '/signup' : '/signin';
  }
  // Settings is an overlay with its own route (one per section); closing it
  // falls back to whatever the underlying view's path is.
  if (useSessionStore.getState().settingsOpen) {
    return `/settings/${useSessionStore.getState().settingsSection}`;
  }
  if (view === 'community') {
    const r = useSessionStore.getState().communityRoute;
    if (r) {
      const base = `/community/u/${encodeURIComponent(r.handle)}`;
      return r.slug ? `${base}/${encodeURIComponent(r.slug)}` : base;
    }
    // Browse state: group and tag are scopes; a non-default sort is a section.
    const b = useSessionStore.getState().communityBrowse;
    if (b.group) return `/community/group/${encodeURIComponent(b.group)}`;
    if (b.tag) return `/community/tag/${encodeURIComponent(b.tag)}`;
    if (b.sort !== 'hot') return `/community/${b.sort}`;
    return '/community';
  }
  if (view === 'library') {
    const f = useSessionStore.getState().libraryFolder;
    if (f === 'templates') return '/templates';
    if (f === 'all') return '/all';
    if (f !== 'home') return `/folder/${encodeURIComponent(f)}`;
    return '/';
  }
  const pv = useSessionStore.getState().pluginView;
  const sub =
    view === 'plugin' && pv
      ? (pluginViewById(pv)?.subPath?.() ?? []).map(encodeURIComponent).join('/')
      : '';
  const base =
    view === 'gallery'
      ? `${prefix}/${id}/gallery`
      : view === 'plugin' && pv
        ? `${prefix}/${id}/${pv}${sub ? `/${sub}` : ''}`
        : view === 'canvas'
          ? `${prefix}/${id}`
          : '/';
  if (base !== '/' && lightboxId) return `${base}/i/${encodeURIComponent(lightboxId)}`;
  return base;
}

/** Drive the app's view/board from a URL path (initial load + back/forward). */
/** Navigate to an app path from outside the history (a universal link, a shell). */
export function openPath(pathWithSearch: string): void {
  history.pushState(null, '', pathWithSearch);
  void applyPath(pathWithSearch.split('?')[0] ?? '/');
}

async function applyPath(path: string, initial = false): Promise<void> {
  applying = true;
  try {
    // /b/:id and /t/:id (team, members) share one shape:
    // [/gallery | /<pluginView>[/<sub-path>]][/i/:item]. The optional
    // segment is never the item marker "i", an unregistered segment is a 404
    // (not silently the canvas), and only plugin views take a sub-path.
    let match = path.match(
      /^\/(b|t)\/([^/]+?)(?:\/(gallery|(?!i(?:\/|$))[a-z][a-z0-9-]*)((?:\/(?!i(?:\/|$))[^/]+)*))?(?:\/i\/([^/]+))?\/?$/,
    );
    if (match?.[3] && match[3] !== 'gallery' && !pluginViewById(match[3])) match = null;
    if (match?.[3] === 'gallery' && match[4]) match = null;
    const session = useSessionStore.getState();
    // Settings overlay route: /settings[/:section] opens the dialog over the
    // library (or whatever is already open); any other path closes it.
    const account = path.match(/^\/(signup|signin)\/?$/);
    if (account) {
      if (initial) session.setView('library');
      if (account[1] === 'signup') {
        // ?plan=personal|team|free&type=monthly|yearly preselects the form.
        // Only these literal values are honoured; nothing else from the URL
        // reaches the form, no price or id rides in it (the server's Stripe
        // prices decide what is charged), and nothing is submitted by itself.
        // The query is scrubbed from the address bar once read.
        const q = new URLSearchParams(location.search);
        const plan = q.get('plan');
        const type = q.get('type');
        if (plan === 'free' || plan === 'personal' || plan === 'team') {
          session.setSignupPreset({
            plan,
            period: type === 'monthly' ? 'month' : 'yearly',
          });
        }
      }
      session.setSyncDialogOpen(true, account[1] === 'signup' ? 'register' : 'login');
      history.replaceState(null, '', `/${account[1]}`);
      return;
    }
    if (session.syncDialogOpen) session.setSyncDialogOpen(false);
    const settings = path.match(/^\/settings(?:\/([a-z]+))?\/?$/);
    if (settings) {
      if (initial) session.setView('library');
      const section = settings[1] ?? 'appearance';
      session.setSettingsSection(section);
      session.setSettingsOpen(true);
      // Canonical URL (bare /settings → /settings/appearance): state changes
      // made while applying are suppressed from the URL sync, so write it here.
      history.replaceState(null, '', `/settings/${section}`);
      return;
    }
    if (session.settingsOpen) session.setSettingsOpen(false);
    // Guest route: /guest/:slug (anonymous); members' /t/:id parses below.
    const guest = path.match(/^\/guest\/([^/]+)\/?$/);
    if (guest) {
      // The gate component collects a display name, then joins.
      session.setGuestJoin(decodeURIComponent(guest[1]!));
      session.setView('library');
      return;
    }
    // Library sections: /templates and /folder/:id land on the library with
    // that sidebar section active (mirrors '/' semantics for open boards).
    const lib = path.match(/^\/(?:(templates|all)|folder\/([^/]+))\/?$/);
    if (lib) {
      const v = useSessionStore.getState().view;
      if (!initial && (v === 'canvas' || v === 'gallery' || v === 'plugin')) await closeBoard();
      session.setLibraryFolder(lib[1] ?? decodeURIComponent(lib[2]!));
      session.setView('library');
      return;
    }
    const comm = path.match(
      /^\/community(?:\/(?:u\/([^/]+)(?:\/([^/]+))?|(hot|top|new|popular|favorites|following)|tag\/([^/]+)|group\/([^/]+)))?\/?$/,
    );
    if (comm) {
      // No Community here (switched off, or the server has none) → land home.
      const { communityAvailable } = await import('./sync/community');
      if (!(await communityAvailable())) {
        session.setView('library');
        history.replaceState(null, '', '/');
        return;
      }
      // Back/forward from an open board closes it first (mirrors '/').
      const v = useSessionStore.getState().view;
      if (!initial && (v === 'canvas' || v === 'gallery' || v === 'plugin')) await closeBoard();
      useSessionStore.getState().setCommunityRoute(
        comm[1]
          ? {
              handle: decodeURIComponent(comm[1]),
              slug: comm[2] ? decodeURIComponent(comm[2]) : null,
            }
          : null,
      );
      const sort = comm[3] === 'hot' || comm[3] === undefined ? 'hot' : comm[3];
      useSessionStore.getState().setCommunityBrowse({
        sort: sort as 'hot' | 'top' | 'new' | 'popular' | 'favorites' | 'following',
        tag: comm[4] ? decodeURIComponent(comm[4]) : null,
        group: comm[5] ? decodeURIComponent(comm[5]) : null,
      });
      useSessionStore.getState().setView('community');
      return;
    }
    if (!match) {
      // A path that matches no route at all → the 404 screen (URL kept so
      // the user can see/fix it). Only "/" is the index.
      if (!/^\/?$/.test(path)) {
        const v = useSessionStore.getState().view;
        if (!initial && (v === 'canvas' || v === 'gallery' || v === 'plugin')) await closeBoard();
        session.setView('notfound');
        return;
      }
      // Back/forward to the index closes the open board; on first load there's
      // nothing open yet, so just show the index. Community isn't a board —
      // closeBoard would flush a doc that isn't open.
      if (initial || useSessionStore.getState().view === 'community') {
        session.setView('library');
      } else {
        await closeBoard();
      }
      // '/' is Home — back/forward from /all, /templates or /folder/:id
      // must reset the sidebar selection too.
      session.setLibraryFolder('home');
      return;
    }
    const id = decodeURIComponent(match[2]!);
    if (match[1] === 't') {
      // A team board is the room's doc, never a local record.
      if (useCollabStore.getState().boardId !== id) {
        const ok = await openTeamBoard(id);
        if (!ok) {
          session.setView('library');
          history.replaceState(null, '', '/');
          return;
        }
      }
    } else if (useDocumentStore.getState().doc.id !== id) {
      // On first load the current doc is the throwaway default — don't persist it.
      const ok = initial ? await openBoardNoFlush(id) : await openBoard(id);
      if (!ok) {
        // Unknown board (e.g. a synced board not pulled yet) → home.
        if (initial) session.setView('library');
        else await closeBoard();
        history.replaceState(null, '', '/');
        return;
      }
    }
    if (match[3] === 'gallery') session.setView('gallery');
    else if (match[3] && pluginViewById(match[3])) {
      session.setPluginView(match[3]);
      session.setView('plugin');
      const segments = (match[4] ?? '').split('/').filter(Boolean).map(decodeURIComponent);
      pluginViewById(match[3])?.applySubPath?.(segments);
    } else session.setView('canvas');
    // Item deep link: open (or close, on back) the lightbox to match the URL.
    const itemId = match[5] ? decodeURIComponent(match[5]) : null;
    const current = useSessionStore.getState();
    if (itemId && useDocumentStore.getState().doc.items[itemId]) {
      if (current.lightboxId !== itemId) current.setLightbox(itemId);
    } else if (!itemId && current.lightboxId) {
      current.setLightbox(null);
    }
  } finally {
    applying = false;
  }
}

let scheduled = false;
let started = false;

/** Plugin views call this when the state behind their sub-path changes. */
export function syncUrl(): void {
  if (started) scheduleUrlSync();
}

/** Reflect the current view/board into the URL (collapsed to one push per tick). */
function scheduleUrlSync(): void {
  if (applying || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (applying) return;
    const session = useSessionStore.getState();
    const collab = useCollabStore.getState();
    // Team boards take the same gallery / plugin / item suffixes under
    // /t/:id; guests never leave /guest/:slug.
    const path =
      collab.status !== 'off' && collab.boardId && session.view !== 'library'
        ? collab.role === 'guest' && session.guestJoin
          ? `/guest/${encodeURIComponent(session.guestJoin)}`
          : pathFor(session.view, encodeURIComponent(collab.boardId), session.lightboxId, '/t')
        : pathFor(session.view, useDocumentStore.getState().doc.id, session.lightboxId);
    if (location.pathname === path) return;
    // Stepping between lightbox items rewrites in place; open/close pushes.
    const bothItems = location.pathname.includes('/i/') && path.includes('/i/');
    if (bothItems) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
  });
}

export function initRouter(): void {
  if (started) return;
  started = true;
  void applyPath(location.pathname, true).finally(markRouterReady);
  window.addEventListener('popstate', () => void applyPath(location.pathname));
  useSessionStore.subscribe((s) => s.view, scheduleUrlSync);
  useSessionStore.subscribe((s) => s.pluginView, scheduleUrlSync);
  useSessionStore.subscribe((s) => s.communityRoute, scheduleUrlSync);
  useSessionStore.subscribe((s) => s.communityBrowse, scheduleUrlSync);
  useSessionStore.subscribe((s) => s.libraryFolder, scheduleUrlSync);
  useSessionStore.subscribe((s) => s.settingsOpen, scheduleUrlSync);
  useSessionStore.subscribe((s) => s.syncDialogOpen, scheduleUrlSync);
  useSessionStore.subscribe((s) => s.syncDialogMode, scheduleUrlSync);
  useSessionStore.subscribe((s) => s.settingsSection, scheduleUrlSync);
  useSessionStore.subscribe((s) => s.lightboxId, scheduleUrlSync);
  useDocumentStore.subscribe((s) => s.doc.id, scheduleUrlSync);
}
