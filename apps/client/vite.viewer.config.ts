import { copyFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);

/**
 * Standalone offline-viewer bundle. Built as a classic IIFE script (NOT an ES
 * module) so an exported board runs straight from the filesystem (file://),
 * where module scripts and fetch() are blocked. `import.meta.env.VIEWER` is
 * pinned true for the paths that can never work there. pdf.js IS bundled: a
 * published board served over http(s) gets the real reader (the offline
 * export falls back to the native frame at runtime), and its worker is
 * copied beside viewer.js — see lib/media/pdfDoc.ts.
 *
 * Output lands in public/viewer/{viewer.js,viewer.css} so the running app can
 * pull it into an export zip; the main build then copies it into dist/. The
 * HOSTED viewer (share pages, community previews) is the code-split module
 * build in vite.viewer.web.config.ts, written to public/viewer/web/.
 */
export default defineConfig({
  base: './',
  // Don't copy the app's public/ into the viewer output (outDir is inside it).
  publicDir: false,
  plugins: [
    react(),
    {
      name: 'copy-pdf-worker',
      closeBundle() {
        copyFileSync(
          require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),
          'public/viewer/pdf.worker.min.mjs',
        );
        // The semantic index's embedding worker comes out of a single-file
        // build with its model runtime inlined (tens of MB). No viewer ever
        // starts it, and the export packs only viewer.js/viewer.css, so it
        // goes. (The hosted build swaps the module out instead; see
        // vite.viewer.shared.ts for why this build cannot.)
        for (const f of readdirSync('public/viewer/assets', { withFileTypes: true })) {
          if (/^embedWorker-|^ort-/.test(f.name)) rmSync(`public/viewer/assets/${f.name}`);
        }
      },
    },
  ],
  define: {
    'import.meta.env.VIEWER': 'true',
    // Lib builds don't auto-replace these the way an app build does; React and
    // friends read process.env.NODE_ENV at runtime, which is undefined on file://.
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
  },
  build: {
    outDir: 'public/viewer',
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'es2020',
    lib: {
      entry: 'src/viewer/viewer-main.tsx',
      formats: ['iife'],
      name: 'BoardcacheViewer',
      fileName: () => 'viewer.js',
    },
    rollupOptions: {
      output: {
        // rolldown-vite: inlineDynamicImports is ignored; this is the option
        // that actually forces the single-file IIFE bundle.
        codeSplitting: false,
        inlineDynamicImports: true,
        assetFileNames: 'viewer.[ext]',
      },
    },
  },
});
