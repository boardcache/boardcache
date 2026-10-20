/**
 * Color-theme families (VS Code-style): each family ships a light AND a dark
 * variant as overrides of the ~21 chrome tokens the stylesheet defines on
 * :root[data-theme]. The mode (light/dark/system) stays a separate axis —
 * `data-theme` keeps driving every existing rule and JS branch (logo,
 * thumbnails, LOD keys), so any family works with pre-rendered assets.
 *
 * The Default family has no overrides: it IS the stylesheet.
 */

type ThemeTokens = Record<string, string>;

/** World-space size of the corkboard's cork tile (the 512px texture is
 *  rendered at half size: a finer grain under the cards). The CSS
 *  background-size for [data-theme-id='corkboard'] must match. */
export const CORK_TILE_PX = 256;
export interface ThemeFamily {
  id: string;
  name: string;
  light: ThemeTokens;
  dark: ThemeTokens;
  /** Personality beyond tokens: red-yarn connectors + item pushpins
   *  (the detective corkboard look). */
  flags?: { yarn?: boolean; pushpins?: boolean };
}

/** Every token a family may override — cleared on switch so families never bleed. */
const TOKEN_NAMES = [
  '--bg-app',
  '--bg-index',
  '--header-bg',
  '--bg-canvas',
  '--panel-grad',
  '--panel-solid',
  '--panel-hover',
  '--menu-hover',
  '--sync-ok',
  '--text-primary',
  '--text-secondary',
  '--menu-border',
  '--menu-border-strong',
  '--menu-divider',
  '--grid-line',
  '--accent',
  '--accent-fg',
  '--side-bg',
  '--shadow-pill',
  '--shadow-panel',
  // Default colors STAMPED ONTO newly created text cards (not live CSS):
  // themes with strong canvas colors (cork) want paper notes, not the
  // light/dark fallback chips.
  '--new-text-bg',
  '--new-text-ink',
];

const THEME_FAMILIES: ThemeFamily[] = [
  { id: 'default', name: 'boardCache', light: {}, dark: {} },
  {
    id: 'corkboard',
    name: 'Corkboard',
    flags: { yarn: true, pushpins: true },
    // The detective wall: cork + paper by day, the evidence room at night.
    light: {
      '--bg-app': '#efe4d2',
      '--bg-index': '#e7d9c2',
      '--header-bg': '#f6efe1',
      '--bg-canvas': '#bf9162',
      '--panel-grad': 'linear-gradient(180deg, #fdf9ef 0%, #f4ecda 100%)',
      '--panel-solid': '#faf5e8',
      '--text-primary': '#33291c',
      '--text-secondary': '#7d6f59',
      '--menu-border': 'rgba(51, 41, 28, 0.18)',
      '--menu-border-strong': 'rgba(51, 41, 28, 0.3)',
      '--menu-divider': 'linear-gradient(100deg, #e7d9c2 1%, #efe4d2 56%)',
      '--grid-line': 'rgba(80, 60, 30, 0.05)',
      '--accent': '#b3272d',
      '--accent-fg': '#ffffff',
      '--side-bg': '#eadcc5',
      '--new-text-bg': '#fbf6ea',
      '--new-text-ink': '#2c2418',
    },
    dark: {
      '--bg-app': '#241c12',
      '--bg-index': '#241c12',
      '--header-bg': '#1d1610',
      '--bg-canvas': '#503f2f',
      '--panel-grad': 'linear-gradient(180deg, #3a2e1d 0%, #2e2517 100%)',
      '--panel-solid': '#332918',
      '--panel-hover': 'rgba(240, 228, 205, 0.07)',
      '--menu-hover': 'rgba(240, 228, 205, 0.07)',
      '--text-primary': '#efe4cd',
      '--text-secondary': '#a89877',
      '--menu-border': 'rgba(239, 228, 205, 0.16)',
      '--menu-border-strong': 'rgba(239, 228, 205, 0.26)',
      '--menu-divider': 'linear-gradient(100deg, #3a2e1d 1%, #2e2517 56%)',
      '--grid-line': 'rgba(239, 228, 205, 0.05)',
      '--accent': '#e0483f',
      '--accent-fg': '#241c12',
      '--side-bg': '#2a2115',
      '--shadow-pill': '0 1px 4px rgba(0, 0, 0, 0.35)',
      '--shadow-panel': '0 8px 28px rgba(0, 0, 0, 0.55)',
      // Dark mode means dark cards: every theme pairs a light-mode and a
      // dark-mode card. (Bright paper in the dark room glared — aged folder
      // stock keeps the detective look without lighting up the wall.)
      '--new-text-bg': '#352a19',
      '--new-text-ink': '#efe4cd',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    light: {
      '--bg-app': '#eceff4',
      '--bg-index': '#e2e7ef',
      '--header-bg': '#f4f6fa',
      '--bg-canvas': '#f6f8fb',
      '--panel-grad': 'linear-gradient(180deg, #ffffff 0%, #f4f6fa 100%)',
      '--panel-solid': '#fbfcfe',
      '--text-primary': '#2e3440',
      '--text-secondary': '#6b7386',
      '--menu-border': 'rgba(76, 86, 106, 0.14)',
      '--menu-border-strong': 'rgba(76, 86, 106, 0.24)',
      '--menu-divider': 'linear-gradient(100deg, #e5e9f0 1%, #eceff4 56%)',
      '--grid-line': 'rgba(46, 52, 64, 0.14)',
      '--accent': '#5e81ac',
      '--accent-fg': '#ffffff',
      '--side-bg': '#e7ebf2',
    },
    dark: {
      '--bg-app': '#2e3440',
      '--bg-index': '#2e3440',
      '--header-bg': '#2e3440',
      '--bg-canvas': '#353b49',
      '--panel-grad': 'linear-gradient(180deg, #434c5e 0%, #3b4252 100%)',
      '--panel-solid': '#3b4252',
      '--panel-hover': 'rgba(236, 239, 244, 0.07)',
      '--menu-hover': 'rgba(236, 239, 244, 0.07)',
      '--text-primary': '#e5e9f0',
      '--text-secondary': '#93a0b8',
      '--menu-border': 'rgba(216, 222, 233, 0.14)',
      '--menu-border-strong': 'rgba(216, 222, 233, 0.24)',
      '--menu-divider': 'linear-gradient(100deg, #434c5e 1%, #3b4252 56%)',
      '--grid-line': 'rgba(216, 222, 233, 0.12)',
      '--accent': '#88c0d0',
      '--accent-fg': '#1c2430',
      '--side-bg': '#323846',
      '--shadow-pill': '0 1px 4px rgba(0, 0, 0, 0.25)',
      '--shadow-panel': '0 8px 28px rgba(0, 0, 0, 0.45)',
    },
  },
  {
    id: 'solarized',
    name: 'Solarized',
    light: {
      '--bg-app': '#fdf6e3',
      '--bg-index': '#f3ecd7',
      '--header-bg': '#fbf3dd',
      '--bg-canvas': '#fdf6e3',
      '--panel-grad': 'linear-gradient(180deg, #fefaf0 0%, #f9f2dc 100%)',
      '--panel-solid': '#fdf9ec',
      '--panel-hover': 'rgba(101, 123, 131, 0.08)',
      '--menu-hover': 'rgba(101, 123, 131, 0.08)',
      '--text-primary': '#073642',
      '--text-secondary': '#8d9c9c',
      '--menu-border': 'rgba(101, 123, 131, 0.18)',
      '--menu-border-strong': 'rgba(101, 123, 131, 0.3)',
      '--menu-divider': 'linear-gradient(100deg, #f0e9d2 1%, #f7f0da 56%)',
      '--grid-line': 'rgba(101, 123, 131, 0.2)',
      '--accent': '#268bd2',
      '--accent-fg': '#ffffff',
      '--side-bg': '#f6efd9',
    },
    dark: {
      '--bg-app': '#002b36',
      '--bg-index': '#002b36',
      '--header-bg': '#002b36',
      '--bg-canvas': '#04313d',
      '--panel-grad': 'linear-gradient(180deg, #0a3e4c 0%, #073642 100%)',
      '--panel-solid': '#073642',
      '--panel-hover': 'rgba(238, 232, 213, 0.06)',
      '--menu-hover': 'rgba(238, 232, 213, 0.06)',
      '--text-primary': '#eee8d5',
      '--text-secondary': '#7d98a1',
      '--menu-border': 'rgba(131, 148, 150, 0.18)',
      '--menu-border-strong': 'rgba(131, 148, 150, 0.28)',
      '--menu-divider': 'linear-gradient(100deg, #0a3e4c 1%, #073642 56%)',
      '--grid-line': 'rgba(238, 232, 213, 0.1)',
      '--accent': '#2aa198',
      '--accent-fg': '#002b36',
      '--side-bg': '#04333f',
      '--shadow-pill': '0 1px 4px rgba(0, 0, 0, 0.3)',
      '--shadow-panel': '0 8px 28px rgba(0, 0, 0, 0.5)',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: {
      '--bg-app': '#f3f6f2',
      '--bg-index': '#e7ede5',
      '--header-bg': '#fbfdfa',
      '--bg-canvas': '#fafcf8',
      '--panel-grad': 'linear-gradient(180deg, #ffffff 0%, #f4f8f3 100%)',
      '--panel-solid': '#fcfdfb',
      '--text-primary': '#1a241c',
      '--text-secondary': '#7d8a80',
      '--menu-border': 'rgba(90, 120, 100, 0.16)',
      '--menu-border-strong': 'rgba(90, 120, 100, 0.28)',
      '--menu-divider': 'linear-gradient(100deg, #e9efe7 1%, #f1f5ef 56%)',
      '--grid-line': 'rgba(30, 50, 38, 0.14)',
      '--accent': '#2f7d4f',
      '--accent-fg': '#ffffff',
      '--side-bg': '#eef2ec',
    },
    dark: {
      '--bg-app': '#141a16',
      '--bg-index': '#141a16',
      '--header-bg': '#141a16',
      '--bg-canvas': '#1a211c',
      '--panel-grad': 'linear-gradient(180deg, #27322b 0%, #212a24 100%)',
      '--panel-solid': '#212a24',
      '--panel-hover': 'rgba(230, 236, 231, 0.06)',
      '--menu-hover': 'rgba(230, 236, 231, 0.06)',
      '--text-primary': '#e6ece7',
      '--text-secondary': '#8a9a8f',
      '--menu-border': 'rgba(170, 200, 180, 0.14)',
      '--menu-border-strong': 'rgba(170, 200, 180, 0.24)',
      '--menu-divider': 'linear-gradient(100deg, #27322b 1%, #212a24 56%)',
      '--grid-line': 'rgba(220, 235, 225, 0.12)',
      '--accent': '#6fce93',
      '--accent-fg': '#10231a',
      '--side-bg': '#182019',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    light: {
      '--bg-app': '#f7f7fb',
      '--bg-index': '#ebebf3',
      '--header-bg': '#ffffff',
      '--bg-canvas': '#fafaff',
      '--panel-grad': 'linear-gradient(180deg, #ffffff 0%, #f4f4fa 100%)',
      '--panel-solid': '#ffffff',
      '--text-primary': '#1f1f2e',
      '--text-secondary': '#6272a4',
      '--menu-border': 'rgba(98, 114, 164, 0.18)',
      '--menu-border-strong': 'rgba(98, 114, 164, 0.3)',
      '--menu-divider': 'linear-gradient(100deg, #ececf4 1%, #f3f3f9 56%)',
      '--grid-line': 'rgba(40, 42, 54, 0.14)',
      '--accent': '#644ac9',
      '--accent-fg': '#ffffff',
      '--side-bg': '#f0f0f7',
    },
    dark: {
      '--bg-app': '#282a36',
      '--bg-index': '#282a36',
      '--header-bg': '#282a36',
      '--bg-canvas': '#2d303e',
      '--panel-grad': 'linear-gradient(180deg, #3c3f51 0%, #343746 100%)',
      '--panel-solid': '#343746',
      '--panel-hover': 'rgba(248, 248, 242, 0.06)',
      '--menu-hover': 'rgba(248, 248, 242, 0.06)',
      '--text-primary': '#f8f8f2',
      '--text-secondary': '#8992bd',
      '--menu-border': 'rgba(98, 114, 164, 0.28)',
      '--menu-border-strong': 'rgba(98, 114, 164, 0.45)',
      '--menu-divider': 'linear-gradient(100deg, #3c3f51 1%, #343746 56%)',
      '--grid-line': 'rgba(248, 248, 242, 0.1)',
      '--accent': '#bd93f9',
      '--accent-fg': '#21222c',
      '--side-bg': '#2b2d3a',
      '--shadow-pill': '0 1px 4px rgba(0, 0, 0, 0.3)',
      '--shadow-panel': '0 8px 28px rgba(0, 0, 0, 0.5)',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    light: {
      '--bg-app': '#faf9f0',
      '--bg-index': '#eeede0',
      '--header-bg': '#ffffff',
      '--bg-canvas': '#fcfbf4',
      '--panel-grad': 'linear-gradient(180deg, #ffffff 0%, #f6f5ea 100%)',
      '--panel-solid': '#fffef8',
      '--text-primary': '#272822',
      '--text-secondary': '#8a8874',
      '--menu-border': 'rgba(117, 113, 94, 0.2)',
      '--menu-border-strong': 'rgba(117, 113, 94, 0.32)',
      '--menu-divider': 'linear-gradient(100deg, #efeee1 1%, #f5f4e9 56%)',
      '--grid-line': 'rgba(39, 40, 34, 0.14)',
      '--accent': '#d12963',
      '--accent-fg': '#ffffff',
      '--side-bg': '#f2f1e6',
    },
    dark: {
      '--bg-app': '#272822',
      '--bg-index': '#272822',
      '--header-bg': '#272822',
      '--bg-canvas': '#2c2d25',
      '--panel-grad': 'linear-gradient(180deg, #3a3b33 0%, #32332c 100%)',
      '--panel-solid': '#32332c',
      '--panel-hover': 'rgba(248, 248, 242, 0.06)',
      '--menu-hover': 'rgba(248, 248, 242, 0.06)',
      '--text-primary': '#f8f8f2',
      '--text-secondary': '#a19f8b',
      '--menu-border': 'rgba(245, 245, 225, 0.14)',
      '--menu-border-strong': 'rgba(245, 245, 225, 0.24)',
      '--menu-divider': 'linear-gradient(100deg, #3a3b33 1%, #32332c 56%)',
      '--grid-line': 'rgba(248, 248, 242, 0.1)',
      '--accent': '#a6e22e',
      '--accent-fg': '#1e1f1a',
      '--side-bg': '#2b2c24',
      '--shadow-pill': '0 1px 4px rgba(0, 0, 0, 0.3)',
      '--shadow-panel': '0 8px 28px rgba(0, 0, 0, 0.5)',
    },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    // Latte / Mocha, mauve accent.
    light: {
      '--bg-app': '#eff1f5',
      '--bg-index': '#e6e9ef',
      '--header-bg': '#f4f6fa',
      '--bg-canvas': '#f3f5f9',
      '--panel-grad': 'linear-gradient(180deg, #ffffff 0%, #f0f2f7 100%)',
      '--panel-solid': '#fafbfe',
      '--text-primary': '#4c4f69',
      '--text-secondary': '#6c6f85',
      '--menu-border': 'rgba(76, 79, 105, 0.14)',
      '--menu-border-strong': 'rgba(76, 79, 105, 0.24)',
      '--menu-divider': 'linear-gradient(100deg, #dce0e8 1%, #eff1f5 56%)',
      '--grid-line': 'rgba(76, 79, 105, 0.13)',
      '--accent': '#8839ef',
      '--accent-fg': '#ffffff',
      '--side-bg': '#e9ecf3',
    },
    dark: {
      '--bg-app': '#1e1e2e',
      '--bg-index': '#1e1e2e',
      '--header-bg': '#181825',
      '--bg-canvas': '#232335',
      '--panel-grad': 'linear-gradient(180deg, #313244 0%, #292a3c 100%)',
      '--panel-solid': '#2b2c3e',
      '--panel-hover': 'rgba(205, 214, 244, 0.07)',
      '--menu-hover': 'rgba(205, 214, 244, 0.07)',
      '--text-primary': '#cdd6f4',
      '--text-secondary': '#a6adc8',
      '--menu-border': 'rgba(205, 214, 244, 0.13)',
      '--menu-border-strong': 'rgba(205, 214, 244, 0.22)',
      '--menu-divider': 'linear-gradient(100deg, #313244 1%, #292a3c 56%)',
      '--grid-line': 'rgba(205, 214, 244, 0.11)',
      '--accent': '#cba6f7',
      '--accent-fg': '#1e1e2e',
      '--side-bg': '#20202f',
      '--shadow-pill': '0 1px 4px rgba(0, 0, 0, 0.3)',
      '--shadow-panel': '0 8px 28px rgba(0, 0, 0, 0.5)',
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    // Warm retro; orange accent.
    light: {
      '--bg-app': '#fbf1c7',
      '--bg-index': '#f2e5bc',
      '--header-bg': '#f9efc4',
      '--bg-canvas': '#faf0c5',
      '--panel-grad': 'linear-gradient(180deg, #fdf6d8 0%, #f4e8bf 100%)',
      '--panel-solid': '#f9f0ca',
      '--text-primary': '#3c3836',
      '--text-secondary': '#7c6f64',
      '--menu-border': 'rgba(60, 56, 54, 0.16)',
      '--menu-border-strong': 'rgba(60, 56, 54, 0.28)',
      '--menu-divider': 'linear-gradient(100deg, #ebdbb2 1%, #fbf1c7 56%)',
      '--grid-line': 'rgba(60, 56, 54, 0.14)',
      '--accent': '#d65d0e',
      '--accent-fg': '#ffffff',
      '--side-bg': '#f0e4b8',
    },
    dark: {
      '--bg-app': '#282828',
      '--bg-index': '#282828',
      '--header-bg': '#1d2021',
      '--bg-canvas': '#2e2c2a',
      '--panel-grad': 'linear-gradient(180deg, #3c3836 0%, #32302f 100%)',
      '--panel-solid': '#353230',
      '--panel-hover': 'rgba(235, 219, 178, 0.07)',
      '--menu-hover': 'rgba(235, 219, 178, 0.07)',
      '--text-primary': '#ebdbb2',
      '--text-secondary': '#a89984',
      '--menu-border': 'rgba(235, 219, 178, 0.13)',
      '--menu-border-strong': 'rgba(235, 219, 178, 0.22)',
      '--menu-divider': 'linear-gradient(100deg, #3c3836 1%, #32302f 56%)',
      '--grid-line': 'rgba(235, 219, 178, 0.11)',
      '--accent': '#fe8019',
      '--accent-fg': '#282828',
      '--side-bg': '#2b2928',
      '--shadow-pill': '0 1px 4px rgba(0, 0, 0, 0.3)',
      '--shadow-panel': '0 8px 28px rgba(0, 0, 0, 0.5)',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    // Day / Night; blue accent.
    light: {
      '--bg-app': '#e1e2e7',
      '--bg-index': '#d5d6db',
      '--header-bg': '#e6e7ec',
      '--bg-canvas': '#e4e5ea',
      '--panel-grad': 'linear-gradient(180deg, #f2f3f7 0%, #e2e3e9 100%)',
      '--panel-solid': '#eceef3',
      '--text-primary': '#343b58',
      '--text-secondary': '#6172b0',
      '--menu-border': 'rgba(52, 59, 88, 0.15)',
      '--menu-border-strong': 'rgba(52, 59, 88, 0.26)',
      '--menu-divider': 'linear-gradient(100deg, #d0d1d9 1%, #e1e2e7 56%)',
      '--grid-line': 'rgba(52, 59, 88, 0.13)',
      '--accent': '#2e7de9',
      '--accent-fg': '#ffffff',
      '--side-bg': '#d9dae1',
    },
    dark: {
      '--bg-app': '#1a1b26',
      '--bg-index': '#1a1b26',
      '--header-bg': '#16161e',
      '--bg-canvas': '#1f2130',
      '--panel-grad': 'linear-gradient(180deg, #24283b 0%, #1e2233 100%)',
      '--panel-solid': '#212537',
      '--panel-hover': 'rgba(192, 202, 245, 0.07)',
      '--menu-hover': 'rgba(192, 202, 245, 0.07)',
      '--text-primary': '#c0caf5',
      '--text-secondary': '#7982a9',
      '--menu-border': 'rgba(192, 202, 245, 0.13)',
      '--menu-border-strong': 'rgba(192, 202, 245, 0.22)',
      '--menu-divider': 'linear-gradient(100deg, #24283b 1%, #1e2233 56%)',
      '--grid-line': 'rgba(192, 202, 245, 0.1)',
      '--accent': '#7aa2f7',
      '--accent-fg': '#16161e',
      '--side-bg': '#1c1d2a',
      '--shadow-pill': '0 1px 4px rgba(0, 0, 0, 0.35)',
      '--shadow-panel': '0 8px 28px rgba(0, 0, 0, 0.55)',
    },
  },
  {
    id: 'one',
    name: 'One',
    // Atom One Light / One Dark; blue accent.
    light: {
      '--bg-app': '#fafafa',
      '--bg-index': '#efeff0',
      '--header-bg': '#fcfcfc',
      '--bg-canvas': '#f7f7f8',
      '--panel-grad': 'linear-gradient(180deg, #ffffff 0%, #f2f2f3 100%)',
      '--panel-solid': '#fbfbfc',
      '--text-primary': '#383a42',
      '--text-secondary': '#696c77',
      '--menu-border': 'rgba(56, 58, 66, 0.14)',
      '--menu-border-strong': 'rgba(56, 58, 66, 0.24)',
      '--menu-divider': 'linear-gradient(100deg, #eaeaeb 1%, #fafafa 56%)',
      '--grid-line': 'rgba(56, 58, 66, 0.12)',
      '--accent': '#4078f2',
      '--accent-fg': '#ffffff',
      '--side-bg': '#f1f1f2',
    },
    dark: {
      '--bg-app': '#282c34',
      '--bg-index': '#282c34',
      '--header-bg': '#21252b',
      '--bg-canvas': '#2d323b',
      '--panel-grad': 'linear-gradient(180deg, #333842 0%, #2c313a 100%)',
      '--panel-solid': '#2f343e',
      '--panel-hover': 'rgba(171, 178, 191, 0.07)',
      '--menu-hover': 'rgba(171, 178, 191, 0.07)',
      '--text-primary': '#abb2bf',
      '--text-secondary': '#7f848e',
      '--menu-border': 'rgba(171, 178, 191, 0.13)',
      '--menu-border-strong': 'rgba(171, 178, 191, 0.22)',
      '--menu-divider': 'linear-gradient(100deg, #333842 1%, #2c313a 56%)',
      '--grid-line': 'rgba(171, 178, 191, 0.1)',
      '--accent': '#61afef',
      '--accent-fg': '#21252b',
      '--side-bg': '#24282f',
      '--shadow-pill': '0 1px 4px rgba(0, 0, 0, 0.3)',
      '--shadow-panel': '0 8px 28px rgba(0, 0, 0, 0.5)',
    },
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    // Dawn / Moon; rose accent.
    light: {
      '--bg-app': '#faf4ed',
      '--bg-index': '#f2e9e1',
      '--header-bg': '#fffaf3',
      '--bg-canvas': '#f8f2ea',
      '--panel-grad': 'linear-gradient(180deg, #fffaf3 0%, #f4ebe2 100%)',
      '--panel-solid': '#fcf6ef',
      '--text-primary': '#575279',
      '--text-secondary': '#797593',
      '--menu-border': 'rgba(87, 82, 121, 0.14)',
      '--menu-border-strong': 'rgba(87, 82, 121, 0.24)',
      '--menu-divider': 'linear-gradient(100deg, #f2e9e1 1%, #faf4ed 56%)',
      '--grid-line': 'rgba(87, 82, 121, 0.12)',
      '--accent': '#d7827e',
      '--accent-fg': '#ffffff',
      '--side-bg': '#f4ece3',
    },
    dark: {
      '--bg-app': '#232136',
      '--bg-index': '#232136',
      '--header-bg': '#1f1d2e',
      '--bg-canvas': '#28263c',
      '--panel-grad': 'linear-gradient(180deg, #2a273f 0%, #252338 100%)',
      '--panel-solid': '#2a273f',
      '--panel-hover': 'rgba(224, 222, 244, 0.07)',
      '--menu-hover': 'rgba(224, 222, 244, 0.07)',
      '--text-primary': '#e0def4',
      '--text-secondary': '#908caa',
      '--menu-border': 'rgba(224, 222, 244, 0.13)',
      '--menu-border-strong': 'rgba(224, 222, 244, 0.22)',
      '--menu-divider': 'linear-gradient(100deg, #393552 1%, #2a273f 56%)',
      '--grid-line': 'rgba(224, 222, 244, 0.1)',
      '--accent': '#ea9a97',
      '--accent-fg': '#232136',
      '--side-bg': '#252239',
      '--shadow-pill': '0 1px 4px rgba(0, 0, 0, 0.3)',
      '--shadow-panel': '0 8px 28px rgba(0, 0, 0, 0.5)',
    },
  },
];

// ── user-defined themes ──────────────────────────────────────────────────────

const CUSTOM_KEY = 'boardcache:customThemes';

export function loadCustomThemes(): ThemeFamily[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (f): f is ThemeFamily =>
        typeof f === 'object' && f !== null && typeof (f as ThemeFamily).id === 'string',
    );
  } catch {
    return [];
  }
}

const customThemeListeners = new Set<() => void>();

/** Settings sync subscribes so imported/removed themes push to the account. */
export function onCustomThemesChanged(cb: () => void): () => void {
  customThemeListeners.add(cb);
  return () => customThemeListeners.delete(cb);
}

const saveCustomThemes = (list: ThemeFamily[]): void => {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  customThemeListeners.forEach((l) => l());
};

/** Replace the whole custom-theme list (applying a pulled sync blob). */
export function replaceCustomThemes(list: ThemeFamily[]): void {
  saveCustomThemes(list.filter((f) => typeof f?.id === 'string'));
}

/** Only known tokens, string values, no url()/braces — values land in
 *  style.setProperty, but there's no reason to store junk. */
const cleanTokens = (t: unknown): ThemeTokens =>
  Object.fromEntries(
    Object.entries((t ?? {}) as Record<string, unknown>)
      .filter(
        ([k, v]) =>
          TOKEN_NAMES.includes(k) &&
          typeof v === 'string' &&
          v.length < 300 &&
          !/url\s*\(|[;{}<>]/i.test(v),
      )
      .map(([k, v]) => [k, (v as string).trim()]),
  );

/** Parse + store a user theme JSON: { name, light: {tokens}, dark: {tokens} }. */
export function importThemeJson(text: string): ThemeFamily {
  const obj = JSON.parse(text) as { name?: unknown; light?: unknown; dark?: unknown };
  const light = cleanTokens(obj.light);
  const dark = cleanTokens(obj.dark);
  if (Object.keys(light).length === 0 && Object.keys(dark).length === 0) {
    throw new Error('No recognized theme tokens found — see the exported JSON for the format.');
  }
  const family: ThemeFamily = {
    id: `custom-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
    name: (typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim()
      : 'Custom theme'
    ).slice(0, 40),
    light,
    dark,
  };
  saveCustomThemes([...loadCustomThemes(), family]);
  return family;
}

export function removeCustomTheme(id: string): void {
  saveCustomThemes(loadCustomThemes().filter((f) => f.id !== id));
}

/**
 * Concrete colors for an 'auto'-styled text card in the ACTIVE family at a
 * given mode — canvas painters (thumbnails, exports, LOD) can't resolve CSS
 * vars, and they render both mode variants regardless of the live page mode.
 */
export function textCardDefaults(dark: boolean): { background: string; color: string } {
  try {
    const id = document.documentElement.dataset.themeId ?? 'default';
    const tokens = themeFamily(id)[dark ? 'dark' : 'light'];
    const bg = tokens['--new-text-bg'];
    const ink = tokens['--new-text-ink'];
    if (bg && ink) return { background: bg, color: ink };
  } catch {
    /* no DOM (tests) */
  }
  return dark
    ? { background: '#2b2b30', color: '#f0f0f1' }
    : { background: '#ffffff', color: '#16181d' };
}

/** Builtins + the user's imported themes. */
export const allThemeFamilies = (): ThemeFamily[] => [...THEME_FAMILIES, ...loadCustomThemes()];

const themeFamily = (id: string): ThemeFamily =>
  allThemeFamilies().find((f) => f.id === id) ?? THEME_FAMILIES[0]!;

/**
 * The active family as authorable JSON: the stylesheet's defaults for each
 * mode with the family's overrides merged in — a complete starting point
 * for a custom theme. Reads defaults by temporarily clearing the inline
 * overrides and flipping data-theme.
 */
export function exportThemeJson(id: string): string {
  const root = document.documentElement;
  const fam = themeFamily(id);
  const savedMode = root.dataset.theme;
  const inline = new Map(TOKEN_NAMES.map((n) => [n, root.style.getPropertyValue(n)]));
  for (const n of TOKEN_NAMES) root.style.removeProperty(n);
  const readDefaults = (mode: 'light' | 'dark'): ThemeTokens => {
    root.dataset.theme = mode;
    const cs = getComputedStyle(root);
    return Object.fromEntries(TOKEN_NAMES.map((n) => [n, cs.getPropertyValue(n).trim()]));
  };
  const light = { ...readDefaults('light'), ...fam.light };
  const dark = { ...readDefaults('dark'), ...fam.dark };
  root.dataset.theme = savedMode;
  for (const [n, v] of inline) if (v) root.style.setProperty(n, v);
  return JSON.stringify({ name: `${fam.name} copy`, light, dark }, null, 2);
}

/** First-paint handoff: index.html's inline script re-applies this without
 *  importing the registry (same key). */
const BOOT_KEY = 'boardcache:themeBoot';

/** Apply a family's overrides for the resolved mode. Clears every known
 *  token first so switching families never leaves stale values behind. */
export function applyThemeTokens(
  id: string,
  mode: 'light' | 'dark',
  opts: { persistBoot?: boolean } = {},
): void {
  const root = document.documentElement;
  for (const name of TOKEN_NAMES) root.style.removeProperty(name);
  const fam = themeFamily(id);
  const tokens = fam[mode];
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  root.dataset.themeId = fam.id;
  // Board-theme overrides skip the first-paint cache — booting into the
  // library should flash the GLOBAL family, not the last board's.
  if (opts.persistBoot === false) return;
  try {
    if (fam.id === 'default') localStorage.removeItem(BOOT_KEY);
    else localStorage.setItem(BOOT_KEY, JSON.stringify({ light: fam.light, dark: fam.dark }));
  } catch {
    /* storage unavailable */
  }
}

/** The active family's personality flags ('' themes and customs have none). */
export function themeFlags(id: string): NonNullable<ThemeFamily['flags']> {
  return themeFamily(id).flags ?? {};
}

/** Picker swatches: the family's key surfaces in the given mode, with the
 *  stylesheet defaults standing in where a family doesn't override. */
export function themeSwatch(id: string, mode: 'light' | 'dark'): [string, string, string] {
  const fallback: Record<'light' | 'dark', [string, string, string]> = {
    light: ['#f5f5f5', '#ffffff', '#2a2f37'],
    dark: ['#161618', '#26262a', '#e6e8ec'],
  };
  const t = themeFamily(id)[mode];
  const [bg, panel, accent] = fallback[mode];
  return [t['--bg-app'] ?? bg, t['--panel-solid'] ?? panel, t['--accent'] ?? accent];
}
