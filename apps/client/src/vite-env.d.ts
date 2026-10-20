/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** True only in the standalone offline-viewer build (enables dead-code
   *  elimination of pdf.js etc.). Undefined in the main app build. */
  readonly VIEWER?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
