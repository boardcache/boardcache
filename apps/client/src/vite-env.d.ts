/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** True only in the standalone offline-viewer build (enables dead-code
   *  elimination of pdf.js etc.). Undefined in the main app build. */
  readonly VIEWER?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The app-served ONNX runtime directory, `/assets/ort/<version>/` (vite.config.ts, ortRuntime). */
declare const __ORT_DIR__: string;
