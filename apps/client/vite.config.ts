/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    rollupOptions: {
      // The DOCX renderer runs in its own sandboxed page (see docx-frame.html).
      input: { main: 'index.html', docxFrame: 'docx-frame.html' },
    },
  },
  // Pre-bundle at server start: discovering lucide-react's huge module graph
  // mid-boot triggers a dep re-optimization page reload that flakes E2E runs.
  // katex is lazy-imported on first math sighting — pre-bundle it so that
  // first import doesn't trigger a dev-server re-optimize + page reload.
  optimizeDeps: { include: ['lucide-react', 'katex'] },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a newer build never reloads the page under the user's fingers;
      // the app shows an Update pill and reloads when tapped (lib/appUpdate).
      registerType: 'prompt',
      // Off in dev so the E2E suite (dev server) is unaffected.
      devOptions: { enabled: false },
      includeAssets: [
        'icon.svg',
        'icon-192.png',
        'icon-512.png',
        'apple-touch-icon.png',
        'logo.svg',
      ],
      manifest: {
        name: 'boardCache',
        short_name: 'boardCache',
        description: 'Offline-first reference boards and moodboards.',
        theme_color: '#f4f5f7',
        background_color: '#f4f5f7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell; SPA-fallback navigations to index.html, but
        // NEVER for the sync API — those must always hit the network.
        navigateFallback: 'index.html',
        // /u = community pages (server-rendered), incl. the preview iframe;
        // /site = the marketing site, /docs = the docs site: without these
        // the SW serves the app shell instead of the page (the app then 404s
        // on the foreign path, and only a hard refresh gets the real page).
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/u(\/|$)/,
          /^\/dmca$/,
          /^\/site(\/|$)/,
          /^\/docs(\/|$)/,
        ],
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // The offline-viewer bundle ships in /viewer for board exports; it's
        // not part of the app shell, so keep it out of the precache.
        // Neither are the heavyweight lazy-loaded converter/viewer libraries
        // (~5MB raw): first visits shouldn't download HEIC decoding, the code
        // editor, or PDF/office tooling the user may never touch. They're
        // runtime-cached (CacheFirst below) the first time a board needs them.
        globIgnores: [
          'viewer/**',
          // The share page belongs to the view host; the app host redirects
          // it there, and a precache fetch that follows a cross-origin
          // redirect fails and takes the whole worker install with it.
          'share.html',
          'assets/heic2any-*.js', // HEIC → JPEG decoder
          'assets/codeEditor-*.js', // CodeMirror + languages
          'assets/xlsx-*.js',
          'assets/pdf-*.js', // pdf.js viewer
          'assets/jspdf.es.min-*.js',
          'assets/svg2pdf.es.min-*.js',
          'assets/es-*.js', // pdf-lib
          'assets/src-*.js', // chart.js, epub.js
          'assets/index.es-*.js',
          'assets/html2canvas-*.js',
          'assets/docx-preview-*.js',
          // Semantic-search worker + transformers.js/onnxruntime (multi-MB,
          // opt-in feature) — runtime-cached on first use like the rest.
          'assets/embedWorker-*.js',
          'assets/*transformers*.js',
          'assets/ort.*.js',
          'assets/ort-*.js',
          // Graph View's 3D stack (three + 3d-force-graph) — opt-in, lazy.
          'assets/three*.js',
          'assets/*force-graph*.js',
          'assets/GraphViewOverlay-*.js',
        ],
        // Content-hashed chunks outside the precache: cache on first use so
        // they still work offline afterwards. CacheFirst is safe — a changed
        // file always has a new URL.
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.(?:js|css)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-chunks',
              expiration: { maxEntries: 80 },
            },
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    // The sandboxed DOCX renderer frame has an opaque origin ("null"): let it
    // fetch module scripts in development (production serves /assets with CORS).
    cors: { origin: [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, 'null'] },
    port: 5173,
    // Same-origin in dev: forward /api to the local sync server (dev/test
    // port 8788; production runs on 8787 so the two never clash on one box).
    proxy: {
      '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true, ws: true },
      // Community public pages are server-rendered by the sync server.
      // Anchored: a bare '/c' prefix would swallow /config.json.
      '^/u(/|$)': { target: 'http://127.0.0.1:8788', changeOrigin: true },
      // The share page is served by the sync server too (view host in production).
      '^/s/': { target: 'http://127.0.0.1:8788', changeOrigin: true },
      '^/dmca$': { target: 'http://127.0.0.1:8788', changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
