import type { Extension } from '@codemirror/state';
import { LanguageSupport, StreamLanguage, type Language } from '@codemirror/language';
import { resolveLanguage } from './codeLangs';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { php } from '@codemirror/lang-php';
import { yaml } from '@codemirror/lang-yaml';
import { markdown } from '@codemirror/lang-markdown';
import { go } from '@codemirror/lang-go';
import { xml } from '@codemirror/lang-xml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { csharp, kotlin } from '@codemirror/legacy-modes/mode/clike';

/**
 * The CodeMirror languages code items and Markdown fences are parsed with.
 * One table for the editor (codeEditor.ts), the live Markdown editor's
 * fences (liveMarkdown.ts) and the static highlighter (codeHighlight.ts),
 * so a language reads the same wherever it appears.
 */

/** The language named by a code item's or a fence's language id, as a
 *  Language; null when it names none we carry. */
export function codeLanguageFor(info: string, doc = ''): Language | null {
  const ext = codeLanguageExtension(info, doc);
  if (Array.isArray(ext)) return null;
  return ext instanceof LanguageSupport ? ext.language : (ext as Language);
}

/** The editor extension for a language (its support, with completions where
 *  the package has them); an empty list for plain text. */
export function codeLanguageExtension(language: string, doc: string): Extension {
  switch (resolveLanguage(language)) {
    case 'markup':
      return html();
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'jsx':
      return javascript({ jsx: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'python':
      return python();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'json':
      return json();
    case 'sql':
      return sql();
    case 'rust':
      return rust();
    case 'c':
    case 'cpp':
      return cpp();
    case 'java':
      return java();
    case 'php':
      // lang-php defaults to mixed HTML+PHP and only tokenizes after an
      // opening <?php tag — plain snippets would render unstyled.
      return php({ plain: !/^\s*<\?/.test(doc) });
    case 'yaml':
      return yaml();
    case 'markdown':
      return markdown();
    case 'go':
      return go();
    case 'xml':
      return xml();
    case 'bash':
      return StreamLanguage.define(shell);
    case 'ruby':
      return StreamLanguage.define(ruby);
    case 'swift':
      return StreamLanguage.define(swift);
    case 'toml':
      return StreamLanguage.define(toml);
    case 'csharp':
      return StreamLanguage.define(csharp);
    case 'kotlin':
      return StreamLanguage.define(kotlin);
    default:
      return [];
  }
}
