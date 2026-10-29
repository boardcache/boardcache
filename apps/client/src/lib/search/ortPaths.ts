/**
 * Where the ONNX runtime behind transformers.js finds its wasm loader and
 * binary. Left alone, transformers.js points both at a CDN and imports the
 * loader as a blob script, which the content security policy forbids
 * (script-src 'self'). The build ships the files beside the app instead,
 * under a versioned /assets path (vite.config.ts, ortRuntime), and the
 * worker hands the runtime these addresses before the first model loads.
 */
export interface OrtWasmPaths {
  mjs: string;
  wasm: string;
}

/** transformers.js keeps Safari off the asyncify build; so does this. */
export const isSafari = (userAgent: string): boolean =>
  /^((?!chrome|android).)*safari/i.test(userAgent);

export function ortWasmPaths(dir: string, origin: string, userAgent: string): OrtWasmPaths {
  const name = isSafari(userAgent) ? 'ort-wasm-simd-threaded' : 'ort-wasm-simd-threaded.asyncify';
  const base = new URL(dir, origin).href;
  // The loader is a module script shipped under .js: every host serves that
  // with a script type, which is not true of .mjs.
  return { mjs: `${base}${name}.js`, wasm: `${base}${name}.wasm` };
}
