import './style.css';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { z } from 'zod';
import { CodeIcon } from '../../components/icons';
import { UiSelect } from '../../components/ui/Select';
import { SettingsField, SettingsGroup } from '../../components/ui/SettingsForm';
import { UiDialog } from '../../components/ui/Dialog';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createCodeItem } from '../../lib/import/createItems';
import { setCodeHighlighter } from '../../lib/text/markdown';
import { CODE_LANGUAGES } from '../../lib/text/codeHighlight';
import type { CodeEditorHandle } from '../../lib/text/codeEditor';
import { platform } from '../../lib/platform';
import { hasSyncServer } from '../../lib/sync/apiBase';
import { registerPlugin } from '../registry';
import { getPluginSettings, usePluginSettings } from '../settingsStore';

/**
 * Code Snippets plugin: live code boxes on the canvas. Snippets are dedicated
 * CODE items (schema v25) edited in place with CodeMirror — see
 * components/items/CodeContent. The plugin contributes the insert dialog, the
 * lazily-loaded Prism fence highlighter for markdown text items, and the
 * font/theme styling (plugin settings, synced encrypted) that both share.
 */

export const CODE_FONTS = [
  {
    id: 'system',
    label: 'System mono',
    stack: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    webFont: null,
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
    webFont: 'JetBrains Mono',
  },
  {
    id: 'fira',
    label: 'Fira Code',
    stack: "'Fira Code', ui-monospace, Menlo, Consolas, monospace",
    webFont: 'Fira Code',
  },
  {
    id: 'source',
    label: 'Source Code Pro',
    stack: "'Source Code Pro', ui-monospace, Menlo, Consolas, monospace",
    webFont: 'Source Code Pro',
  },
  {
    id: 'plex',
    label: 'IBM Plex Mono',
    stack: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
    webFont: 'IBM Plex Mono',
  },
] as const;

interface CodeTheme {
  id: string;
  label: string;
  vars: Record<string, string>;
}

export const CODE_THEMES: CodeTheme[] = [
  {
    id: 'github-light',
    label: 'GitHub Light',
    vars: {
      '--code-bg': '#f6f8fa',
      '--code-fg': '#1f2328',
      '--code-comment': '#6e7781',
      '--code-keyword': '#cf222e',
      '--code-string': '#0a3069',
      '--code-number': '#0550ae',
      '--code-function': '#8250df',
      '--code-type': '#953800',
      '--code-variable': '#0550ae',
      '--code-punct': '#57606a',
    },
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    vars: {
      '--code-bg': '#282c34',
      '--code-fg': '#abb2bf',
      '--code-comment': '#5c6370',
      '--code-keyword': '#c678dd',
      '--code-string': '#98c379',
      '--code-number': '#d19a66',
      '--code-function': '#61afef',
      '--code-type': '#e5c07b',
      '--code-variable': '#e06c75',
      '--code-punct': '#7f848e',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    vars: {
      '--code-bg': '#282a36',
      '--code-fg': '#f8f8f2',
      '--code-comment': '#6272a4',
      '--code-keyword': '#ff79c6',
      '--code-string': '#f1fa8c',
      '--code-number': '#bd93f9',
      '--code-function': '#50fa7b',
      '--code-type': '#8be9fd',
      '--code-variable': '#ffb86c',
      '--code-punct': '#a8abbe',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    vars: {
      '--code-bg': '#2e3440',
      '--code-fg': '#d8dee9',
      '--code-comment': '#616e88',
      '--code-keyword': '#81a1c1',
      '--code-string': '#a3be8c',
      '--code-number': '#b48ead',
      '--code-function': '#88c0d0',
      '--code-type': '#8fbcbb',
      '--code-variable': '#d08770',
      '--code-punct': '#81a1c1',
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    vars: {
      '--code-bg': '#fdf6e3',
      '--code-fg': '#657b83',
      '--code-comment': '#93a1a1',
      '--code-keyword': '#859900',
      '--code-string': '#2aa198',
      '--code-number': '#d33682',
      '--code-function': '#268bd2',
      '--code-type': '#b58900',
      '--code-variable': '#cb4b16',
      '--code-punct': '#839496',
    },
  },
];

interface CodeSettings {
  font?: string;
  theme?: string;
  fontSize?: number;
}

function currentFont() {
  const id = getPluginSettings<CodeSettings>('code-snippets')?.font ?? 'system';
  return CODE_FONTS.find((f) => f.id === id) ?? CODE_FONTS[0];
}

function currentDefaultFontSize(): number {
  const n = getPluginSettings<CodeSettings>('code-snippets')?.fontSize;
  return typeof n === 'number' && n >= 8 && n <= 40 ? n : 13;
}

function currentTheme(): CodeTheme {
  const id = getPluginSettings<CodeSettings>('code-snippets')?.theme ?? 'github-light';
  return CODE_THEMES.find((t) => t.id === id) ?? CODE_THEMES[0]!;
}

// --- dialog -----------------------------------------------------------------------

interface CodeDialogState {
  open: boolean;
  toggle: (open: boolean) => void;
}

export const useCodeDialog = create<CodeDialogState>((set) => ({
  open: false,
  toggle: (open) => set({ open }),
}));

const LANG_PREF = 'boardcache:codeLang';

/** Insert a live code item (CodeMirror-edited, statically highlighted). */
function insertSnippet(code: string, language: string): string {
  const at = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const lang = language === 'plaintext' ? '' : language;
  return createCodeItem(at, code.replace(/\n+$/, ''), lang, currentDefaultFontSize());
}

function CodeDialog() {
  const open = useCodeDialog((s) => s.open);
  return open ? <CodeDialogBody /> : null;
}

function CodeDialogBody() {
  const close = () => useCodeDialog.getState().toggle(false);
  // The live value stays in a ref (CodeMirror owns it); state only tracks
  // emptiness for the Insert button.
  const codeRef = useRef('');
  const [hasCode, setHasCode] = useState(false);
  const [language, setLanguage] = useState(() => localStorage.getItem(LANG_PREF) ?? 'javascript');
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditorHandle | null>(null);

  const insert = () => {
    if (!codeRef.current.trim()) return;
    localStorage.setItem(LANG_PREF, language);
    insertSnippet(codeRef.current, language);
    close();
  };

  // A real CodeMirror editor in the dialog — highlights as you type, and
  // remounts (keeping the text) when the language changes.
  useEffect(() => {
    let alive = true;
    void import('../../lib/text/codeEditor').then((mod) => {
      if (!alive || !hostRef.current) return;
      editorRef.current?.destroy();
      editorRef.current = mod.createCodeEditor(hostRef.current, {
        doc: codeRef.current,
        language: language === 'plaintext' ? '' : language,
        onChange: (value) => {
          codeRef.current = value;
          setHasCode(value.trim().length > 0);
        },
        onEscape: () => useCodeDialog.getState().toggle(false),
      });
      editorRef.current.view.focus();
    });
    return () => {
      alive = false;
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [language]);

  return (
    <UiDialog
      title="Add Code Snippet"
      onClose={close}
      className="aimedia-sheet code-sheet"
      testId="code-dialog"
    >
      <div className="aimedia-body">
        <div ref={hostRef} className="code-dialog-editor" data-testid="code-input" />
        <label className="aimedia-field">
          <span>Language</span>
          <select
            value={language}
            data-testid="code-language"
            onChange={(e) => setLanguage(e.target.value)}
          >
            {CODE_LANGUAGES.map(([id, label]) => (
              <option key={id || 'plaintext'} value={id || 'plaintext'}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="aimedia-actions">
          <button
            type="button"
            className="sync-primary"
            disabled={!hasCode}
            data-testid="code-insert"
            onClick={insert}
          >
            Add to Canvas
          </button>
        </div>
      </div>
    </UiDialog>
  );
}

// --- styling + highlighter lifecycle (active only while the plugin is enabled) -----

const STYLE_ID = 'code-snippets-style';
const loadedWebFonts = new Set<string>();

async function ensureWebFont(family: string): Promise<void> {
  if (loadedWebFonts.has(family) || !hasSyncServer()) return;
  loadedWebFonts.add(family);
  try {
    const res = await platform.fontCss(family);
    if (!res.ok) return;
    const css = await res.text();
    const tag = document.createElement('style');
    tag.setAttribute('data-code-font', family);
    tag.textContent = css;
    document.head.appendChild(tag);
  } catch {
    /* offline / no server — the fallback stack still applies */
  }
}

function applyCodeStyle(): void {
  const font = currentFont();
  const theme = currentTheme();
  if (font.webFont) void ensureWebFont(font.webFont);
  const vars = Object.entries(theme.vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement('style');
    tag.id = STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = `:root { ${vars} --code-font: ${font.stack}; }`;
}

function removeCodeStyle(): void {
  document.getElementById(STYLE_ID)?.remove();
}

function CodePluginComponent() {
  usePluginSettings((s) => s.settings['code-snippets']);

  // Theme + font follow the settings live.
  useEffect(() => {
    applyCodeStyle();
  });

  // Highlighter: lazy Prism chunk, registered while enabled.
  useEffect(() => {
    let alive = true;
    (window as unknown as { Prism?: unknown }).Prism = { manual: true };
    void import('../../lib/text/codeHighlight').then((mod) => {
      if (alive) setCodeHighlighter(mod.highlightCode);
    });
    return () => {
      alive = false;
      setCodeHighlighter(null);
      removeCodeStyle();
    };
  }, []);

  return <CodeDialog />;
}

// --- registration -------------------------------------------------------------------

const codeToolSchema = z.object({
  code: z.string().min(1).describe('The source code'),
  language: z
    .string()
    .optional()
    .describe('Language for highlighting (javascript, python, sql, …); omit for plain text'),
});

registerPlugin({
  manifest: {
    id: 'code-snippets',
    order: 100,
    name: 'Code Snippets',
    description:
      'Live code boxes on the canvas — edit with real-time syntax highlighting (CodeMirror), pick a language per snippet, and a code font + color theme in settings. Markdown code fences get highlighted too.',
  },
  addMenu: [
    {
      label: 'Add Code Snippet',
      category: 'documents',
      icon: <CodeIcon />,
      onSelect: () => useCodeDialog.getState().toggle(true),
    },
  ],
  Component: CodePluginComponent,
  SettingsPanel: CodeSettingsPanel,
  tools: [
    {
      name: 'add_code_snippet',
      description:
        'Add a live code snippet box to the board (a dedicated code item with language-aware highlighting, editable in place).',
      parameters: codeToolSchema,
      access: 'write',
      execute: (args) => {
        const id = insertSnippet(args.code, args.language ?? 'plaintext');
        return { id };
      },
    },
  ],
});

function CodeSettingsPanel() {
  const settings =
    (usePluginSettings((s) => s.settings['code-snippets']) as CodeSettings | undefined) ?? {};
  const save = (patch: CodeSettings) =>
    usePluginSettings.getState().set('code-snippets', { ...settings, ...patch });
  const theme = currentTheme();

  return (
    <div className="plugin-settings-fields">
      <p className="settings-hint">
        Applies to every code block on the canvas (fenced blocks in text items included).
      </p>
      <SettingsGroup title="Appearance">
        <SettingsField label="Code font">
          <UiSelect
            value={settings.font ?? 'system'}
            ariaLabel="Code font"
            testId="code-font"
            options={CODE_FONTS.map((f) => ({ value: f.id, label: f.label }))}
            onChange={(font) => save({ font })}
          />
        </SettingsField>
        <SettingsField label="Color theme">
          <UiSelect
            value={settings.theme ?? 'github-light'}
            ariaLabel="Color theme"
            testId="code-theme"
            options={CODE_THEMES.map((t) => ({ value: t.id, label: t.label }))}
            onChange={(theme) => save({ theme })}
          />
        </SettingsField>
        <SettingsField label="Default font size">
          <UiSelect
            value={String(currentDefaultFontSize())}
            ariaLabel="Default font size"
            testId="code-default-size"
            options={[10, 11, 12, 13, 14, 15, 16, 18, 20, 24].map((n) => ({
              value: String(n),
              label: `${n}px`,
            }))}
            onChange={(v) => save({ fontSize: Number(v) })}
          />
        </SettingsField>
      </SettingsGroup>
      <div
        className="code-theme-preview md-rendered"
        data-testid="code-preview"
        style={{ '--code-font': currentFont().stack, ...theme.vars } as React.CSSProperties}
      >
        <pre>
          <code>
            <span className="token comment">{'// preview'}</span>
            {'\n'}
            <span className="token keyword">const</span>{' '}
            <span className="token function">greet</span>{' '}
            <span className="token punctuation">=</span>{' '}
            <span className="token punctuation">(</span>name
            <span className="token punctuation">)</span>{' '}
            <span className="token operator">{'=>'}</span>{' '}
            <span className="token template-string">
              <span className="token string">{'`hi ${name}`'}</span>
            </span>
            <span className="token punctuation">;</span>
          </code>
        </pre>
      </div>
    </div>
  );
}
