import Prism from 'prismjs';
import { resolveLanguage } from './codeLangs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-markdown';

/**
 * Prism-based fence highlighter — loaded lazily (this chunk carries Prism and
 * its grammars) and registered via lib/markdown's setCodeHighlighter while
 * the Code Snippets plugin is enabled.
 */

export { CODE_LANGUAGES } from './codeLangs';

export function highlightCode(code: string, lang: string): string | null {
  const key = resolveLanguage(lang);
  const grammar = Prism.languages[key];
  if (!grammar) return null;
  return Prism.highlight(code, grammar, key);
}

export interface CodeToken {
  text: string;
  type: string | null;
}

/** Flat token stream (for consumers that render their own colors — PDF). */
export function tokenizeCode(code: string, lang: string): CodeToken[] {
  const key = resolveLanguage(lang);
  const grammar = Prism.languages[key];
  if (!grammar) return [{ text: code, type: null }];
  const out: CodeToken[] = [];
  const walk = (tokens: (string | Prism.Token)[], parent: string | null): void => {
    for (const t of tokens) {
      if (typeof t === 'string') {
        out.push({ text: t, type: parent });
      } else if (Array.isArray(t.content)) {
        walk(t.content, t.type);
      } else if (typeof t.content === 'string') {
        out.push({ text: t.content, type: t.type });
      } else {
        walk([t.content], t.type);
      }
    }
  };
  walk(Prism.tokenize(code, grammar), null);
  return out;
}
