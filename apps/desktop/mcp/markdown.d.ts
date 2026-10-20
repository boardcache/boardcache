/** esbuild bundles .md files as text (see the `mcp` script). */
declare module '*.md' {
  const text: string;
  export default text;
}
