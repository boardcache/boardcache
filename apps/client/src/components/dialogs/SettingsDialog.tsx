import { useEffect, useRef, useState } from 'react';
import { updateBoardSettings } from '../../state/commands';
import type { Item } from '@boardcache/schema';
import type { ReactNode } from 'react';
import { putAsset } from '../../lib/board/assetStore';
import { apiFetch } from '../../lib/sync/apiBase';
import { directoryEnabled, setDirectoryEnabled } from '../../lib/sync/boardDirectory';
import {
  asrModelState,
  clipEnabled,
  clipModelState,
  localWhisperEnabled,
  onSemanticState,
  rerankerEnabled,
  rerankerState,
  semanticEnabled,
  semanticState,
  setClipEnabled,
  setLocalWhisperEnabled,
  setRerankerEnabled,
  setSemanticEnabled,
} from '../../lib/search/semanticIndex';
import { useDocumentStore } from '../../state/documentStore';
import { resolveTheme, useSessionStore } from '../../state/sessionStore';
import type { ThemePreference } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';
import { allPlugins, isPluginEnabled, usePluginPrefs, listedPlugins } from '../../plugins/registry';
import { UiDialog } from '../ui/Dialog';
import {
  allThemeFamilies,
  exportThemeJson,
  importThemeJson,
  removeCustomTheme,
  themeSwatch,
} from '../../lib/themes';
import { downloadBlob } from '../../lib/export/download';
import { BackupBody } from './BackupDialog';
import { ImportBody } from './ImportDialog';
import { ProfilePanel } from '../account/ProfilePanel';
import { PlanPanel } from '../account/PlanPanel';
import { UiSelect } from '../ui/Select';
import { LIBRARY_VIEWS, loadLibraryView, saveLibraryView } from '../../lib/libraryPrefs';
import { desktopAgent } from '../../lib/platform';
import { UI_ZOOM_STEPS, setUiZoom, uiZoomAvailable, useUiZoom } from '../../lib/uiZoom';
import { ClipperPairingSection } from './ClipperPairing';
import type { AgentInfo } from '../../lib/platform';
import type { LibraryView } from '../../lib/libraryPrefs';
import { TEXT_ALIGNS, TEXT_FONTS, TEXT_SIZES } from '../../lib/text/textOptions';
import { pendingUsageTally, setUsageTallyEnabled, usageTallyEnabled } from '../../lib/usageTally';
import { boardFontFamilies } from '../../lib/media/fontRegistry';
import {
  AlignCenterXIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowLeftIcon,
  CheckIcon,
  CloseIcon,
  CloudIcon,
  DownloadIcon,
  ExportIcon,
  GearIcon,
  GridIcon,
  ImageIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  PuzzleIcon,
  SunIcon,
  SunMoonIcon,
  TypeIcon,
} from '../icons';

type Category =
  | 'general'
  | 'appearance'
  | 'canvas'
  | 'text'
  | 'plugins'
  | 'sync'
  | 'export'
  | 'import';

const CATEGORIES: { id: Category; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <GearIcon /> },
  { id: 'appearance', label: 'Appearance', icon: <SunMoonIcon /> },
  { id: 'canvas', label: 'Canvas', icon: <GridIcon /> },
  { id: 'text', label: 'Text', icon: <TypeIcon /> },
  { id: 'plugins', label: 'Plugins', icon: <PuzzleIcon /> },
  { id: 'sync', label: 'Sync', icon: <CloudIcon /> },
  { id: 'export', label: 'Export', icon: <ExportIcon /> },
  { id: 'import', label: 'Import', icon: <DownloadIcon /> },
];

/** Desktop only: the size of the whole interface (text and controls
 *  together), one setting for every window. The web app leaves this to the
 *  browser's own zoom, so the section does not appear there. */
function InterfaceSizeSection() {
  const zoom = useUiZoom();
  return (
    <section className="settings-section" data-testid="settings-interface">
      <h3>Interface size</h3>
      <div className="settings-row">
        <span>Size</span>
        <div className="seg" role="radiogroup" aria-label="Interface size">
          {UI_ZOOM_STEPS.map((step) => {
            const pct = Math.round(step * 100);
            const active = Math.abs(step - zoom) < 0.005;
            return (
              <button
                key={step}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? 'active' : ''}
                data-testid={`settings-ui-zoom-${pct}`}
                onClick={() => void setUiZoom(step)}
              >
                {pct}%
              </button>
            );
          })}
        </div>
      </div>
      <p className="settings-hint">
        Text and controls scale together, in every window on this computer. From the library,
        Cmd/Ctrl and + or − step the size and Cmd/Ctrl 0 resets it; on a board those keys zoom the
        canvas, so use View → Larger Interface there.
      </p>
    </section>
  );
}

/** App settings: a dialog with a category sidebar (replaces the old
 *  Settings dropdown menu). */
export function SettingsDialog() {
  const open = useSessionStore((s) => s.settingsOpen);
  return open ? <SettingsBody /> : null;
}

function SettingsBody() {
  const close = () => useSessionStore.getState().setSettingsOpen(false);
  // The Canvas category edits the OPEN BOARD's document (grid, background) —
  // on the index there is no open board, so it hides and the rest (theme,
  // text defaults, plugins, sync/profile/plan) stay available.
  const onIndex = useSessionStore((s) => s.view === 'library');
  const categories = onIndex ? CATEGORIES.filter((c) => c.id !== 'canvas') : CATEGORIES;
  // Section lives in the store so /settings/:section routes drive it.
  const stored = useSessionStore((s) => s.settingsSection);
  const valid = new Set(categories.map((c) => c.id as string));
  const cat = (valid.has(stored) ? stored : 'general') as Category;
  const setCat = (next: Category) => useSessionStore.getState().setSettingsSection(next);

  const theme = useSessionStore((s) => s.theme);
  const themeId = useSessionStore((s) => s.themeId);
  // Imported themes live in localStorage; bump to re-read after import/remove.
  const [customsRev, setCustomsRev] = useState(0);
  const themeFileRef = useRef<HTMLInputElement>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  void customsRev;
  const gridVisible = useDocumentStore((s) => s.doc.settings.gridVisible);
  const boardThemeId = useDocumentStore((s) => s.doc.settings.themeId);
  const autoHideChrome = useSessionStore((s) => s.autoHideChrome);
  const [libraryView, setLibraryView] = useState<LibraryView>(loadLibraryView);
  // Desktop only: where the stdio MCP launcher lives, for the Claude Code command.
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  useEffect(() => {
    void desktopAgent()
      ?.info()
      .then(setAgentInfo)
      .catch(() => undefined);
  }, []);
  const claudeCommand = agentInfo
    ? `claude mcp add boardcache -- node "${agentInfo.launcherPath}"`
    : '';
  const [usageOn, setUsageOn] = useState(usageTallyEnabled);
  const [sem, setSem] = useState(() => ({ ...semanticState(), enabled: semanticEnabled() }));
  const [rr, setRr] = useState(() => ({ ...rerankerState(), enabled: rerankerEnabled() }));
  const [cl, setCl] = useState(() => ({ ...clipModelState(), enabled: clipEnabled() }));
  const [asr, setAsr] = useState(() => ({ ...asrModelState(), enabled: localWhisperEnabled() }));
  useEffect(
    () =>
      onSemanticState(() => {
        setSem({ ...semanticState(), enabled: semanticEnabled() });
        setRr({ ...rerankerState(), enabled: rerankerEnabled() });
        setCl({ ...clipModelState(), enabled: clipEnabled() });
        setAsr({ ...asrModelState(), enabled: localWhisperEnabled() });
      }),
    [],
  );
  const gridType = useDocumentStore((s) => s.doc.settings.gridType);
  const gridOpacity = useDocumentStore((s) => s.doc.settings.gridOpacity);
  const background = useDocumentStore((s) => s.doc.settings.background);
  const coverItem = useDocumentStore((s) =>
    s.doc.settings.coverItemId ? (s.doc.items[s.doc.settings.coverItemId] ?? null) : null,
  );
  const bgImage = useDocumentStore((s) => s.doc.settings.backgroundImage);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const syncAccount = useSyncStore((s) => s.account);
  const textDefaults = useSessionStore((s) => s.textDefaults);
  const zoomSpeed = useSessionStore((s) => s.zoomSpeed);
  const lodThreshold = useSessionStore((s) => s.lodThreshold);

  const themeOption = (value: ThemePreference, label: string, icon: ReactNode) => (
    <button
      type="button"
      className={`settings-option${theme === value ? ' active' : ''}`}
      onClick={() => useSessionStore.getState().setTheme(value)}
      data-testid={`settings-theme-${value}`}
    >
      {icon}
      <span>{label}</span>
      {theme === value && (
        <span className="settings-check">
          <CheckIcon size={14} />
        </span>
      )}
    </button>
  );

  return (
    <UiDialog title="Settings" onClose={close} className="settings-sheet" testId="settings-dialog">
      <div className="settings-body">
        <nav className="settings-nav">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`settings-nav-item${cat === c.id ? ' active' : ''}`}
              onClick={() => setCat(c.id)}
              data-testid={`settings-cat-${c.id}`}
            >
              {c.icon}
              <span>{c.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-pane">
          {cat === 'general' && (
            <>
              <section className="settings-section">
                <h3>Library</h3>
                <label className="settings-row">
                  <span>Default view</span>
                  <UiSelect
                    value={libraryView}
                    ariaLabel="Default library view"
                    testId="settings-library-view"
                    options={LIBRARY_VIEWS.map((o) => ({ value: o.value, label: o.label }))}
                    onChange={(v) => {
                      setLibraryView(v as LibraryView);
                      saveLibraryView(v as LibraryView);
                    }}
                  />
                </label>
                <p className="settings-hint">
                  How boards are listed on this device. The view switcher above the boards changes
                  the same setting.
                </p>
              </section>
              {agentInfo && (
                <section className="settings-section" data-testid="settings-agents">
                  <h3>Agents</h3>
                  <p className="settings-hint">
                    Outside AI agents (Claude Code and any MCP client) can read and edit boards
                    through this app while it runs. Each client gets its own command; for Claude
                    Code, run this once in a terminal:
                  </p>
                  <div className="settings-command">
                    <code data-testid="settings-agent-command">{claudeCommand}</code>
                    <button
                      type="button"
                      className="settings-copy"
                      data-testid="settings-agent-copy"
                      onClick={() => void navigator.clipboard.writeText(claudeCommand)}
                    >
                      Copy
                    </button>
                  </div>
                  <p className="settings-hint">
                    Other MCP clients launch the same file as a stdio server:{' '}
                    <code>node "{agentInfo.launcherPath}"</code>.
                  </p>
                  {agentInfo.http && agentInfo.url && (
                    <>
                      <p className="settings-hint">
                        Clients that connect by URL instead of launching a program use the HTTP
                        transport. Both values keep working across launches of this app:
                      </p>
                      <div className="settings-command">
                        <code data-testid="settings-agent-url">{agentInfo.url}</code>
                        <button
                          type="button"
                          className="settings-copy"
                          onClick={() => void navigator.clipboard.writeText(agentInfo.url ?? '')}
                        >
                          Copy
                        </button>
                      </div>
                      <div className="settings-command">
                        <code data-testid="settings-agent-token">
                          Authorization: Bearer {agentInfo.token}
                        </code>
                        <button
                          type="button"
                          className="settings-copy"
                          onClick={() =>
                            void navigator.clipboard.writeText(`Bearer ${agentInfo.token}`)
                          }
                        >
                          Copy
                        </button>
                      </div>
                    </>
                  )}
                  <div className="settings-command settings-command-actions">
                    <button
                      type="button"
                      className="settings-copy"
                      data-testid="settings-agent-regenerate"
                      onClick={() =>
                        void desktopAgent()
                          ?.regenerate()
                          .then(setAgentInfo)
                          .catch(() => undefined)
                      }
                    >
                      Regenerate token
                    </button>
                    <span className="settings-hint">
                      Cuts off every connected client until it is given the new token.
                    </span>
                  </div>
                  <p className="settings-hint">
                    Everything stays on this computer: the endpoint listens on localhost only, the
                    token lives in a file only your user can read, locked boards stay closed to
                    agents, and every change an agent makes is one undo step.
                  </p>
                </section>
              )}
              <ClipperPairingSection />
              <section className="settings-section">
                <h3>Canvas chrome</h3>
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={autoHideChrome}
                    onChange={(e) => useSessionStore.getState().setAutoHideChrome(e.target.checked)}
                    data-testid="settings-auto-hide-chrome"
                  />
                  <span>Auto-hide controls</span>
                </label>
                <p className="settings-hint">
                  Click an empty spot on the canvas to fade all controls away for a clean look at
                  the board; click again — or select an item — to bring them back.
                </p>
              </section>
              <section className="settings-section">
                <h3>Help improve boardCache</h3>
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={usageOn}
                    onChange={(e) => {
                      setUsageTallyEnabled(e.target.checked);
                      setUsageOn(e.target.checked);
                    }}
                    data-testid="settings-usage-tally"
                  />
                  <span>Send anonymous feature counts</span>
                </label>
                <p className="settings-hint">
                  Off by default. When on, the app keeps a tally of which features you use (an image
                  added, a dossier exported, the gallery opened) and sends the counts to boardCache
                  once a day. Never board content, names, text or prompts; keyed by a random id that
                  is not your account.
                </p>
                {usageOn && (
                  <p className="settings-hint" data-testid="settings-usage-pending">
                    {(() => {
                      const t = Object.entries(pendingUsageTally());
                      return t.length
                        ? `Waiting to send: ${t.map(([k, v]) => `${k} ×${v}`).join(', ')}.`
                        : 'Nothing waiting to send yet.';
                    })()}
                  </p>
                )}
              </section>
              <section className="settings-section">
                <h3>Search intelligence</h3>
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={sem.enabled}
                    onChange={(e) => void setSemanticEnabled(e.target.checked)}
                    data-testid="settings-semantic"
                  />
                  <span>
                    On-device semantic model
                    {sem.enabled && sem.state === 'loading' ? ` — downloading ${sem.pct}%` : ''}
                    {sem.enabled && sem.state === 'error' ? ' — failed to load' : ''}
                  </span>
                </label>
                <p className="settings-hint">
                  Matches by meaning, not just keywords — it powers search, Suggest Connections,
                  More Like This, Board Insights, tag suggestions, and Organize by Topic. A one-time
                  ~25 MB download that runs entirely on this device (per device, works offline;
                  nothing is ever uploaded).
                </p>
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={rr.enabled}
                    onChange={(e) => void setRerankerEnabled(e.target.checked)}
                    data-testid="settings-reranker"
                  />
                  <span>
                    Precision reranker
                    {rr.enabled && rr.state === 'loading' ? ` — downloading ${rr.pct}%` : ''}
                    {rr.enabled && rr.state === 'error' ? ' — failed to load' : ''}
                  </span>
                </label>
                <p className="settings-hint">
                  A second on-device model (~23 MB) that re-reads the top search results against
                  your exact query for sharper ranking. Works with or without the semantic model.
                </p>
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={cl.enabled}
                    onChange={(e) => void setClipEnabled(e.target.checked)}
                    data-testid="settings-clip"
                  />
                  <span>
                    Image search (CLIP)
                    {cl.enabled && cl.state === 'loading' ? ` — downloading ${cl.pct}%` : ''}
                    {cl.enabled && cl.state === 'error' ? ' — failed to load' : ''}
                  </span>
                </label>
                <p className="settings-hint">
                  Finds images by what's IN them — "the red truck at night" matches the photo
                  itself, no OCR or description needed. The largest of the local models (~90 MB,
                  one-time); like the others it runs entirely on this device.
                </p>
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={asr.enabled}
                    onChange={(e) => void setLocalWhisperEnabled(e.target.checked)}
                    data-testid="settings-whisper"
                  />
                  <span>
                    Local transcription (Whisper)
                    {asr.enabled && asr.state === 'loading' ? ` — downloading ${asr.pct}%` : ''}
                    {asr.enabled && asr.state === 'error' ? ' — failed to load' : ''}
                  </span>
                </label>
                <p className="settings-hint">
                  Audio and video transcription that never uploads a second of audio — the
                  Transcribe button uses this model (~60 MB, one-time) instead of a server. Slower
                  than cloud APIs on long recordings, but free, offline, and private.
                </p>
              </section>
            </>
          )}
          {cat === 'appearance' && (
            <>
              {uiZoomAvailable() && <InterfaceSizeSection />}
              <section className="settings-section">
                <h3>Mode</h3>
                <div className="settings-options">
                  {themeOption('system', 'System', <MonitorIcon />)}
                  {themeOption('light', 'Light', <SunIcon />)}
                  {themeOption('dark', 'Dark', <MoonIcon />)}
                </div>
                <p className="settings-hint">
                  System follows your OS preference (currently {resolveTheme('system')}).
                </p>
              </section>
              <section className="settings-section">
                <h3>Color theme</h3>
                <div className="theme-family-grid">
                  {allThemeFamilies().map((f) => {
                    const mode = resolveTheme(theme);
                    const [bg, panel, accent] = themeSwatch(f.id, mode);
                    const custom = f.id.startsWith('custom-');
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`theme-family${themeId === f.id ? ' active' : ''}`}
                        data-testid={`settings-family-${f.id}`}
                        onClick={() => useSessionStore.getState().setThemeId(f.id)}
                      >
                        <span className="theme-family-swatch" style={{ background: bg }}>
                          <span style={{ background: panel }} />
                          <span style={{ background: accent }} />
                        </span>
                        <span className="theme-family-name">{f.name}</span>
                        {custom && (
                          <span
                            role="button"
                            tabIndex={0}
                            className="theme-family-remove"
                            title="Remove this theme"
                            data-testid={`theme-remove-${f.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCustomTheme(f.id);
                              if (themeId === f.id) {
                                useSessionStore.getState().setThemeId('default');
                              }
                              setCustomsRev((r) => r + 1);
                            }}
                          >
                            <CloseIcon size={12} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="theme-import-row">
                  <button
                    type="button"
                    className="cmty-ghost-btn"
                    data-testid="theme-import"
                    onClick={() => themeFileRef.current?.click()}
                  >
                    Import theme
                  </button>
                  <button
                    type="button"
                    className="cmty-ghost-btn"
                    data-testid="theme-export"
                    onClick={() =>
                      downloadBlob(
                        new Blob([exportThemeJson(themeId)], { type: 'application/json' }),
                        'boardcache-theme.json',
                      )
                    }
                  >
                    Export current
                  </button>
                  <input
                    ref={themeFileRef}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    data-testid="theme-import-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      void file.text().then(
                        (text) => {
                          try {
                            const fam = importThemeJson(text);
                            useSessionStore.getState().setThemeId(fam.id);
                            setCustomsRev((r) => r + 1);
                            setThemeError(null);
                          } catch (err) {
                            setThemeError(
                              err instanceof Error
                                ? err.message
                                : 'Could not read that theme file.',
                            );
                          }
                        },
                        () => setThemeError('Could not read that file.'),
                      );
                    }}
                  />
                </div>
                {themeError && <p className="sync-error">{themeError}</p>}
                <p className="settings-hint">
                  Every color theme has its own light and dark variant — the mode above picks which
                  one you see. Export the current theme to get an editable JSON you can tweak and
                  import back.
                </p>
              </section>
            </>
          )}

          {cat === 'canvas' && (
            <>
              <section className="settings-section">
                <h3>Board theme</h3>
                <label className="settings-row">
                  <span>Theme</span>
                  <UiSelect
                    value={boardThemeId ?? '__default__'}
                    ariaLabel="Board theme override"
                    testId="settings-board-theme"
                    options={[
                      { value: '__default__', label: 'App default' },
                      ...allThemeFamilies().map((f) => ({ value: f.id, label: f.name })),
                    ]}
                    onChange={(v) =>
                      updateBoardSettings({ themeId: v === '__default__' ? undefined : v })
                    }
                  />
                </label>
                <p className="settings-hint">
                  Overrides the app theme while THIS board is open — it travels with the board.
                  Light/dark mode still follows this device's setting.
                </p>
              </section>
              <section className="settings-section">
                <h3>Grid</h3>
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={gridVisible}
                    onChange={(e) => updateBoardSettings({ gridVisible: e.target.checked })}
                    data-testid="settings-grid-visible"
                  />
                  <span>Show grid</span>
                </label>
                <label className="settings-row">
                  <span>Pattern</span>
                  <UiSelect
                    value={gridType}
                    ariaLabel="Grid pattern"
                    testId="settings-grid-type"
                    options={[
                      { value: 'square', label: 'Squares' },
                      { value: 'dots', label: 'Dots' },
                      { value: 'diagonal', label: 'Diagonal lines' },
                      { value: 'isometric', label: 'Isometric' },
                      { value: 'checker', label: 'Checkerboard' },
                    ]}
                    onChange={(v) => updateBoardSettings({ gridType: v as typeof gridType })}
                  />
                </label>
                <label className="settings-row settings-slider">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={gridOpacity}
                    disabled={!gridVisible}
                    onChange={(e) => updateBoardSettings({ gridOpacity: Number(e.target.value) })}
                    data-testid="settings-grid-opacity"
                  />
                  <span className="settings-value">{Math.round(gridOpacity * 100)}%</span>
                </label>
              </section>
              <section className="settings-section">
                <h3>Zoom</h3>
                <label className="settings-row settings-slider">
                  <span>Scroll sensitivity</span>
                  <input
                    type="range"
                    min={0.25}
                    max={3}
                    step={0.05}
                    value={zoomSpeed}
                    onChange={(e) =>
                      useSessionStore.getState().setZoomSpeed(Number(e.target.value))
                    }
                    data-testid="settings-zoom-speed"
                  />
                  <span className="settings-value">{Math.round(zoomSpeed * 100)}%</span>
                </label>
                <p className="settings-hint">
                  How fast Cmd/Ctrl-scroll (and zoom-scroll mode) zooms. Shift always zooms at a
                  quarter of this speed for fine control.
                </p>
                <label className="settings-row settings-slider">
                  <span>Low-detail below</span>
                  <input
                    type="range"
                    min={0.05}
                    max={0.4}
                    step={0.01}
                    value={lodThreshold}
                    onChange={(e) =>
                      useSessionStore.getState().setLodThreshold(Number(e.target.value))
                    }
                    data-testid="settings-lod-threshold"
                  />
                  <span className="settings-value">{Math.round(lodThreshold * 100)}%</span>
                </label>
                <p className="settings-hint">
                  Zoomed out past this, items draw as fast lightweight sprites instead of live
                  content. Lower = stay sharp longer; higher = smoother on huge boards.
                </p>
              </section>
              <section className="settings-section">
                <h3>Background</h3>
                <div className="settings-row settings-bg-row">
                  <button
                    type="button"
                    className={`settings-option${background === 'default' ? ' active' : ''}`}
                    onClick={() => updateBoardSettings({ background: 'default' })}
                  >
                    <SunMoonIcon />
                    <span>Default (follows theme)</span>
                    {background === 'default' && (
                      <span className="settings-check">
                        <CheckIcon size={14} />
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`settings-option${background !== 'default' ? ' active' : ''}`}
                    onClick={() => {
                      close();
                      useSessionStore.getState().setCanvasBgOpen(true);
                    }}
                    data-testid="settings-choose-color"
                  >
                    <PaletteIcon />
                    <span>
                      {background === 'default' ? 'Choose color' : `Choose color (${background})`}
                    </span>
                    {background !== 'default' && (
                      <span className="settings-swatch" style={{ background }} />
                    )}
                  </button>
                </div>
                <div className="settings-row settings-bg-image" data-testid="settings-bg-image-row">
                  <button
                    type="button"
                    className="settings-option"
                    onClick={() => bgImageInputRef.current?.click()}
                    data-testid="settings-bg-image-pick"
                  >
                    <ImageIcon />
                    <span>{bgImage ? 'Replace background image' : 'Background image'}</span>
                  </button>
                  <input
                    ref={bgImageInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    data-testid="settings-bg-image-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      void putAsset(file).then((assetId) =>
                        updateBoardSettings({
                          backgroundImage: { assetId, mode: 'cover', opacity: 1 },
                        }),
                      );
                    }}
                  />
                </div>
                {bgImage && (
                  <>
                    <label className="settings-row">
                      <span>Fit</span>
                      <UiSelect
                        value={bgImage.mode}
                        ariaLabel="Background image fit"
                        testId="settings-bg-image-mode"
                        options={[
                          { value: 'cover', label: 'Cover' },
                          { value: 'contain', label: 'Contain' },
                          { value: 'tile', label: 'Tile' },
                          { value: 'center', label: 'Center' },
                        ]}
                        onChange={(v) =>
                          updateBoardSettings({
                            backgroundImage: { ...bgImage, mode: v as typeof bgImage.mode },
                          })
                        }
                      />
                    </label>
                    <label className="settings-row settings-slider">
                      <span>Image opacity</span>
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={bgImage.opacity}
                        data-testid="settings-bg-image-opacity"
                        onChange={(e) =>
                          updateBoardSettings({
                            backgroundImage: { ...bgImage, opacity: Number(e.target.value) },
                          })
                        }
                      />
                      <span className="settings-value">{Math.round(bgImage.opacity * 100)}%</span>
                    </label>
                    <div className="settings-row">
                      <button
                        type="button"
                        className="settings-option"
                        data-testid="settings-bg-image-remove"
                        onClick={() => updateBoardSettings({ backgroundImage: null })}
                      >
                        <CloseIcon />
                        <span>Remove background image</span>
                      </button>
                    </div>
                  </>
                )}
              </section>
              <section className="settings-section" data-testid="settings-cover">
                <h3>Preview image</h3>
                {coverItem ? (
                  <>
                    <p className="settings-hint">
                      The library card and the community listing show this item. Without a cover
                      they show the whole board.
                    </p>
                    <div
                      className="settings-row settings-cover-row"
                      data-testid="settings-cover-row"
                    >
                      <CoverPreview item={coverItem} />
                      <span className="settings-cover-label">{coverLabel(coverItem)}</span>
                    </div>
                    <div className="settings-row">
                      <button
                        type="button"
                        className="settings-option"
                        data-testid="settings-cover-remove"
                        onClick={() => updateBoardSettings({ coverItemId: null })}
                      >
                        <CloseIcon />
                        <span>Remove cover (show the whole board)</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="settings-hint" data-testid="settings-cover-none">
                    The preview shows the whole board. To feature one item instead, right-click it
                    and choose Set as Cover.
                  </p>
                )}
              </section>
            </>
          )}

          {cat === 'text' && (
            <section className="settings-section">
              <h3>New text boxes</h3>
              <p className="settings-hint">
                Defaults for text added to the canvas — existing boxes keep their own styling.
              </p>
              <label className="settings-row">
                <span className="settings-label">Font</span>
                <UiSelect
                  value={textDefaults.fontFamily}
                  ariaLabel="Default font"
                  testId="settings-text-font"
                  options={(() => {
                    const boardFonts = boardFontFamilies(useDocumentStore.getState().doc).filter(
                      (fam) => !TEXT_FONTS.some((t) => t.value === fam),
                    );
                    const options = [
                      ...TEXT_FONTS.map((f) => ({ value: f.value, label: f.label })),
                      // Fonts living ON the open board (Google Fonts imports,
                      // uploaded font files) are first-class default options.
                      ...boardFonts.map((fam) => ({ value: fam, label: `${fam} — board font` })),
                    ];
                    // A default set elsewhere (another device, a board font
                    // from a board that isn't open) still shows by name —
                    // never a blank control.
                    const current = textDefaults.fontFamily;
                    if (current && !options.some((o) => o.value === current)) {
                      options.push({
                        value: current,
                        label: `${current.split(',')[0]!.replace(/["']/g, '').trim()} — not on this board`,
                      });
                    }
                    return options;
                  })()}
                  onChange={(v) => useSessionStore.getState().setTextDefaults({ fontFamily: v })}
                />
              </label>
              <label className="settings-row">
                <span className="settings-label">Size</span>
                <UiSelect
                  value={String(textDefaults.fontSize)}
                  ariaLabel="Default font size"
                  testId="settings-text-size"
                  options={TEXT_SIZES.map((sz) => ({ value: String(sz.value), label: sz.label }))}
                  onChange={(v) =>
                    useSessionStore.getState().setTextDefaults({ fontSize: Number(v) })
                  }
                />
              </label>
              <div className="settings-row">
                <span className="settings-label">Alignment</span>
                <div className="settings-align">
                  {TEXT_ALIGNS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={`settings-align-btn${textDefaults.align === a ? ' active' : ''}`}
                      onClick={() => useSessionStore.getState().setTextDefaults({ align: a })}
                      aria-label={`Align ${a}`}
                      aria-pressed={textDefaults.align === a}
                      data-testid={`settings-text-align-${a}`}
                    >
                      {a === 'left' ? (
                        <AlignLeftIcon />
                      ) : a === 'center' ? (
                        <AlignCenterXIcon />
                      ) : (
                        <AlignRightIcon />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <p
                className="settings-text-sample"
                style={{
                  fontFamily: textDefaults.fontFamily,
                  fontSize: textDefaults.fontSize,
                  textAlign: textDefaults.align,
                }}
                data-testid="settings-text-sample"
              >
                The quick brown fox jumps over the lazy dog.
              </p>
            </section>
          )}

          {cat === 'plugins' && (
            <section className="settings-section">
              <h3>Plugins</h3>
              <PluginsPanel />
            </section>
          )}

          {cat === 'sync' && (
            <section className="settings-section">
              <h3>Board sync</h3>
              <div className="settings-card" data-testid="sync-account-card">
                <h4>Account</h4>
                <p className="settings-hint">
                  {syncAccount
                    ? `Signed in as ${syncAccount.username}. Boards opted into ☁ Sync are end-to-end encrypted.`
                    : 'Optional: sign in to back up and sync boards across devices, end-to-end encrypted.'}
                </p>
                <button
                  type="button"
                  className="settings-option"
                  onClick={() => {
                    close();
                    useSessionStore.getState().setSyncDialogOpen(true);
                  }}
                >
                  <CloudIcon />
                  <span>
                    {syncAccount ? `Signed in as ${syncAccount.username}` : 'Sign in to sync'}
                  </span>
                </button>
              </div>
              {syncAccount && <PlanPanel />}
              {syncAccount && <ProfilePanel />}
              {syncAccount && <ApiTokensPanel />}
            </section>
          )}
          {cat === 'export' && (
            <section className="settings-section">
              <h3>Back up boards</h3>
              <BackupBody />
            </section>
          )}

          {cat === 'import' && (
            <section className="settings-section">
              <h3>Import boards</h3>
              <ImportBody
                onClose={close}
                onDone={() => window.dispatchEvent(new CustomEvent('boardcache:library-refresh'))}
              />
            </section>
          )}
        </div>
      </div>
    </UiDialog>
  );
}

/**
 * Personal access tokens for the external clip API (browser extension,
 * scripts). Created tokens display exactly once — the server stores hashes.
 * Clipping through the server is part of sync, so an account without a
 * sync plan sees why instead of a Create button that would be refused.
 */
function ApiTokensPanel() {
  const ent = useSyncStore((s) => s.entitlements);
  const needsPlan = !!ent?.enforced && ent.limits.syncBytes === 0;
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<
    { id: string; name: string; createdAt: string; lastUsedAt: string | null }[]
  >([]);
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const [name, setName] = useState('');

  const refresh = () =>
    void apiFetch('/api/tokens', { credentials: 'include' })
      .then(async (r) => (r.ok ? ((await r.json()) as { tokens: typeof tokens }).tokens : []))
      .then(setTokens);
  useEffect(refresh, []);

  const createToken = async () => {
    const res = await apiFetch('/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: name.trim() || 'API token' }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Could not create a token (${res.status}).`);
      return;
    }
    setError(null);
    const data = (await res.json()) as { id: string; token: string };
    setFresh(data);
    setName('');
    refresh();
  };

  const [shareNames, setShareNames] = useState(directoryEnabled);

  return (
    <div className="settings-tokens settings-card" data-testid="settings-tokens">
      <h4>API tokens</h4>
      <p className="settings-hint">
        Let the browser clipper and scripts send clips to your inbox through your account (POST
        /api/clips), so they reach your boards on every device. Tokens are shown once, so copy them
        right away.
      </p>
      {needsPlan && (
        <p className="sync-note" data-testid="tokens-plan-note">
          Clipping through your account needs a Personal or Team plan. The desktop app takes clips
          for free on the same computer: pair the clipper in Settings → General.
        </p>
      )}
      {error && (
        <p className="sync-note sync-warn" role="alert" data-testid="tokens-error">
          {error}
        </p>
      )}
      {!needsPlan && (
        <label className="settings-row">
          <input
            type="checkbox"
            checked={shareNames}
            data-testid="share-board-names"
            onChange={(e) => {
              setShareNames(e.target.checked);
              setDirectoryEnabled(e.target.checked);
            }}
          />
          <span>
            Share board <em>names</em> with the server so the clipper can offer a board picker
            (contents stay encrypted; locked boards excluded)
          </span>
        </label>
      )}
      {!needsPlan && (
        <div className="tokens-create">
          <input
            type="text"
            value={name}
            placeholder="Token name (e.g. Chrome clipper)"
            data-testid="token-name"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="sync-primary"
            data-testid="token-create"
            onClick={() => void createToken()}
          >
            Create
          </button>
        </div>
      )}
      {fresh && (
        <div className="tokens-fresh" data-testid="token-fresh">
          <code>{fresh.token}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(fresh.token);
            }}
          >
            Copy
          </button>
        </div>
      )}
      {tokens.map((t) => (
        <div className="tokens-row" key={t.id} data-testid="token-row">
          <span className="tokens-name">{t.name}</span>
          <span className="tokens-meta">
            {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'never used'}
          </span>
          <button
            type="button"
            className="tokens-revoke"
            data-testid="token-revoke"
            onClick={() => {
              void apiFetch(`/api/tokens/${t.id}`, {
                method: 'DELETE',
                credentials: 'include',
              }).then(refresh);
            }}
          >
            Revoke
          </button>
        </div>
      ))}
    </div>
  );
}

function PluginsPanel() {
  const overrides = usePluginPrefs((s) => s.enabled);
  const setEnabled = usePluginPrefs((s) => s.setEnabled);
  const [open, setOpen] = useState<string | null>(null);

  const active = open ? allPlugins().find((p) => p.manifest.id === open) : null;
  if (active?.SettingsPanel) {
    return (
      <div className="plugin-settings-page" data-testid={`plugin-settings-page-${open}`}>
        <button
          type="button"
          className="plugin-back"
          onClick={() => setOpen(null)}
          data-testid="plugin-settings-back"
        >
          <ArrowLeftIcon size={14} />
          All plugins
        </button>
        <h4>{active.manifest.name}</h4>
        <active.SettingsPanel />
      </div>
    );
  }

  return (
    <div className="plugins-list">
      <p className="settings-hint">
        Optional features. Disabled plugins disappear from menus without affecting board content.
      </p>
      {listedPlugins().map((p) => {
        const on = isPluginEnabled(p, overrides);
        return (
          <div className="plugin-row" key={p.manifest.id}>
            <input
              type="checkbox"
              checked={on}
              aria-label={`Enable ${p.manifest.name}`}
              data-testid={`plugin-toggle-${p.manifest.id}`}
              onChange={(e) => setEnabled(p.manifest.id, e.target.checked)}
            />
            <span className="plugin-row-text">
              <strong>{p.manifest.name}</strong>
              <span className="plugin-row-desc">{p.manifest.description}</span>
            </span>
            {p.SettingsPanel && (
              <button
                type="button"
                className="plugin-row-settings"
                disabled={!on}
                title={on ? `${p.manifest.name} settings` : 'Enable the plugin first'}
                data-testid={`plugin-settings-${p.manifest.id}`}
                onClick={() => setOpen(p.manifest.id)}
              >
                Settings
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** What the cover item is, for the settings row: its own name or title, else its kind. */
function coverLabel(item: Item): string {
  const named = item as { name?: string | null; title?: string | null };
  const text = (named.name ?? named.title ?? '').trim();
  return text ? `${text} (${item.type})` : item.type;
}

/** The cover item drawn upright at thumbnail size (the board's own renderer). */
function CoverPreview({ item }: { item: Item }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const scale = Math.min(1, 240 / Math.max(1, item.width), 160 / Math.max(1, item.height));
    // The board renderer is heavy and sits in the thumbnail module: loaded
    // here on demand, never on the dialog's import path.
    void import('../../lib/media/thumbnail')
      .then(({ renderItemCanvas }) => renderItemCanvas(item, scale))
      .then((canvas) => alive && setSrc(canvas.toDataURL('image/png')))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [item]);
  return (
    <span className="settings-cover-preview" data-testid="settings-cover-preview">
      {src ? <img src={src} alt="" /> : null}
    </span>
  );
}
