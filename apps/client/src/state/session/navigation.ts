/** Which screen is showing and the routed sub-state under it. */
import type { StateCreator } from 'zustand';
import { tally } from '../../lib/usageTally';
import type { SessionState } from '../sessionStore';
import type { CommunitySort, AppView } from './types';

export interface NavigationSlice {
  /** Top-level screen: the canvas, board library, or gallery index. */
  view: AppView;
  setView: (view: AppView) => void;
  /** Which plugin-contributed full-screen view is active (view === 'plugin'). */
  pluginView: string | null;
  setPluginView: (id: string | null) => void;
  /** Community sub-route: a profile (slug null) or a publication detail. */
  communityRoute: { handle: string; slug: string | null } | null;
  setCommunityRoute: (route: { handle: string; slug: string | null } | null) => void;
  /** Community browse state — every section is a route (/community/top,
   *  /community/tag/x, /community/group/y). */
  communityBrowse: { sort: CommunitySort; tag: string | null; group: string | null };
  setCommunityBrowse: (
    update: Partial<{ sort: CommunitySort; tag: string | null; group: string | null }>,
  ) => void;
  /** Library sidebar section: 'all', 'templates', or a folder id. Routed. */
  libraryFolder: string;
  setLibraryFolder: (folder: string) => void;
  /** Pending guest-link join (/guest/:slug) awaiting a display name. */
  guestJoin: string | null;
  setGuestJoin: (slug: string | null) => void;
  /** Page (Figma-style sheet) the canvas shows; null = the first page. */
  activePageId: string | null;
  setActivePageId: (id: string | null) => void;
}

export const createNavigationSlice: StateCreator<
  SessionState,
  [['zustand/subscribeWithSelector', never]],
  [],
  NavigationSlice
> = (set) => ({
  view: 'library',
  setView: (view) => {
    tally(`view.${view}`);
    set({ view });
  },
  pluginView: null,
  setPluginView: (pluginView) => set({ pluginView }),
  communityRoute: null,
  setCommunityRoute: (communityRoute) => set({ communityRoute }),
  communityBrowse: { sort: 'hot', tag: null, group: null },
  setCommunityBrowse: (update) =>
    set((s) => ({ communityBrowse: { ...s.communityBrowse, ...update } })),
  libraryFolder: 'home',
  setLibraryFolder: (libraryFolder) => set({ libraryFolder }),
  guestJoin: null,
  setGuestJoin: (guestJoin) => set({ guestJoin }),
  activePageId: null,
  setActivePageId: (activePageId) => set({ activePageId }),
});
