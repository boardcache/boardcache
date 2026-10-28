import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const STUB = fileURLToPath(new URL('./src/lib/search/semanticIndex.viewer.ts', import.meta.url));

/**
 * Module swap for the hosted (code-split) viewer build. A read-only board
 * never embeds text or images on-device, so the semantic index
 * (transformers.js, the models, the embedding worker) is replaced by an
 * inert copy with the same surface. Import specifiers are relative
 * ('../search/semanticIndex'), so this resolves them itself; the stub ends in
 * '.viewer' and never matches.
 *
 * The single-file (IIFE) build cannot take this swap: with the module
 * replaced, rolldown reports the build as code-splitting and refuses the
 * format. That build keeps the real module and drops the worker it emits
 * afterwards (vite.viewer.config.ts), since nothing in a viewer ever starts it.
 */
export function viewerStubs(): Plugin {
  return {
    name: 'boardcache:viewer-stubs',
    enforce: 'pre',
    resolveId(source) {
      return /(^|\/)semanticIndex$/.test(source) ? STUB : null;
    },
  };
}
