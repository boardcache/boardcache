/**
 * Shared language registry for code items: the picker list and the alias
 * normalization used by BOTH highlight paths (static Prism + CodeMirror).
 * Deliberately dependency-free so either lazy chunk can import it.
 */

export const CODE_LANGUAGES = [
  ['', 'Plain text'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['jsx', 'JSX'],
  ['tsx', 'TSX'],
  ['python', 'Python'],
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['json', 'JSON'],
  ['bash', 'Shell'],
  ['sql', 'SQL'],
  ['rust', 'Rust'],
  ['go', 'Go'],
  ['java', 'Java'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['php', 'PHP'],
  ['ruby', 'Ruby'],
  ['swift', 'Swift'],
  ['kotlin', 'Kotlin'],
  ['yaml', 'YAML'],
  ['toml', 'TOML'],
  ['markdown', 'Markdown'],
] as const;

const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  'c++': 'cpp',
  cs: 'csharp',
  yml: 'yaml',
  md: 'markdown',
  golang: 'go',
  rs: 'rust',
};

/** Normalize any user/model-provided language id to a canonical one. */
export function resolveLanguage(lang: string): string {
  const key = lang.trim().toLowerCase();
  return ALIASES[key] ?? key;
}
