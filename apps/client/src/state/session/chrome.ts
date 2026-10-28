/** Theme and the per-device visibility of chrome, panels and canvas layers. */
import type { StateCreator } from 'zustand';
import type { SessionState } from '../sessionStore';
import type { ThemePreference } from './types';
import { loadFlag, loadThemePreference, THEME_KEY, MINIMAP_KEY, LAYERS_KEY } from './persist';

export interface ChromeSlice {
  /** Appearance: clicking blank canvas fades the chrome out/in (per-device). */
  autoHideChrome: boolean;
  setAutoHideChrome: (on: boolean) => void;
  /** Ephemeral: chrome currently faded out (only while autoHideChrome). */
  chromeHidden: boolean;
  setChromeHidden: (hidden: boolean) => void;
  /** Which top-left menubar menu is open (hover-through between menus). */
  menubarOpen: string | null;
  setMenubarOpen: (id: string | null) => void;
  /** Show/hide connector lines on the canvas (View menu; per device). */
  connectionsVisible: boolean;
  /** View → Show Evidence Strength: the 1–5 badges on rated items. */
  weightsVisible: boolean;
  setWeightsVisible: (visible: boolean) => void;
  setConnectionsVisible: (visible: boolean) => void;
  /** Show/hide item comment chips on the canvas (View menu; per device). */
  commentsVisible: boolean;
  setCommentsVisible: (visible: boolean) => void;
  /** Minimap popup visibility (persisted preference). */
  minimapOpen: boolean;
  setMinimapOpen: (open: boolean) => void;
  /** Layers panel visibility (persisted preference). */
  layersOpen: boolean;
  setLayersOpen: (open: boolean) => void;
  /** Pages switcher panel (corner cluster). */
  pagesOpen: boolean;
  setPagesOpen: (open: boolean) => void;
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  /** Color-theme family id (lib/themes.ts); light/dark is a separate axis. */
  themeId: string;
  setThemeId: (id: string) => void;
}

export const createChromeSlice: StateCreator<
  SessionState,
  [['zustand/subscribeWithSelector', never]],
  [],
  ChromeSlice
> = (set) => ({
  autoHideChrome: (() => {
    try {
      return localStorage.getItem('boardcache:autoHideChrome') === 'on';
    } catch {
      return false;
    }
  })(),
  setAutoHideChrome: (on) => {
    try {
      localStorage.setItem('boardcache:autoHideChrome', on ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    set({ autoHideChrome: on, chromeHidden: false });
  },
  chromeHidden: false,
  setChromeHidden: (chromeHidden) => set({ chromeHidden }),
  menubarOpen: null,
  setMenubarOpen: (menubarOpen) => set({ menubarOpen }),
  connectionsVisible: (() => {
    // try/catch like every other read here — also keeps this module
    // importable where storage doesn't exist (node unit tests).
    try {
      return localStorage.getItem('boardcache:connectionsVisible') !== 'off';
    } catch {
      return true;
    }
  })(),
  setConnectionsVisible: (connectionsVisible) => {
    try {
      localStorage.setItem('boardcache:connectionsVisible', connectionsVisible ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    set({ connectionsVisible });
  },
  // Evidence weights stay off the canvas until asked for: the badges read
  // as noise on a board that is not being weighed (View menu toggles them).
  weightsVisible: (() => {
    try {
      return localStorage.getItem('boardcache:weightsVisible') === 'on';
    } catch {
      return false;
    }
  })(),
  setWeightsVisible: (weightsVisible) => {
    try {
      localStorage.setItem('boardcache:weightsVisible', weightsVisible ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    set({ weightsVisible });
  },
  commentsVisible: (() => {
    try {
      return localStorage.getItem('boardcache:commentsVisible') !== 'off';
    } catch {
      return true;
    }
  })(),
  setCommentsVisible: (commentsVisible) => {
    try {
      localStorage.setItem('boardcache:commentsVisible', commentsVisible ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    set({ commentsVisible });
  },
  minimapOpen: loadFlag(MINIMAP_KEY, false),
  setMinimapOpen: (minimapOpen) => {
    try {
      localStorage.setItem(MINIMAP_KEY, minimapOpen ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    set({ minimapOpen });
  },
  layersOpen: loadFlag(LAYERS_KEY, false),
  setLayersOpen: (layersOpen) => {
    try {
      localStorage.setItem(LAYERS_KEY, layersOpen ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    set({ layersOpen });
  },
  pagesOpen: false,
  setPagesOpen: (pagesOpen) => set({ pagesOpen }),
  theme: loadThemePreference(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
    set({ theme });
  },
  themeId: (() => {
    try {
      return localStorage.getItem('boardcache:themeId') ?? 'default';
    } catch {
      return 'default';
    }
  })(),
  setThemeId: (themeId) => {
    try {
      localStorage.setItem('boardcache:themeId', themeId);
    } catch {
      /* storage unavailable */
    }
    set({ themeId });
  },
});
