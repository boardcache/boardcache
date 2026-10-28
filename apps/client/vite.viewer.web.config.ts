import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viewerStubs } from './vite.viewer.shared';

/**
 * The hosted viewer: the share page (/s/<id>) and community previews on the
 * view host. An ES-module build with code splitting, so a board pays only
 * for what it shows: pdf.js arrives with the first PDF, KaTeX and its fonts
 * with the first formula, the EPUB reader with the first book. The offline
 * export keeps the single-file IIFE from vite.viewer.config.ts, which must
 * run from file://.
 *
 * Output: public/viewer/web/{viewer.js,viewer.css,chunks/*}; the main build
 * copies public/ into dist/. Chunk names are content-hashed and the deploy
 * keeps old ones around, so a page that loaded an older viewer.js still
 * finds the chunks it lazy-imports later.
 */
export default defineConfig({
  base: '/viewer/web/',
  publicDir: false,
  plugins: [react(), viewerStubs()],
  define: {
    'import.meta.env.VIEWER': 'true',
  },
  build: {
    outDir: 'public/viewer/web',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      input: 'src/viewer/viewer-main.tsx',
      output: {
        entryFileNames: 'viewer.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (info) =>
          info.names?.some((n) => /^viewer-main.*\.css$/.test(n))
            ? 'viewer.css'
            : 'chunks/[name]-[hash][extname]',
      },
    },
  },
});
