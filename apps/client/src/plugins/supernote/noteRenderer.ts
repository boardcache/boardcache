import { flattenPageGray, parseNote } from '../../lib/integrations/supernote';
import type { SnNotebook } from '../../lib/integrations/supernote';

/**
 * Off-main-thread page rendering for the import dialog: pages flatten in a
 * Web Worker so the UI (progress bar, shimmer placeholders) keeps painting
 * while a big note decodes. Falls back to main-thread decoding when workers
 * are unavailable.
 */

export interface FlatPage {
  gray: Uint8Array;
  width: number;
  height: number;
}

export class NoteRenderer {
  readonly note: SnNotebook;
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (p: FlatPage) => void; reject: (e: Error) => void }
  >();

  constructor(buffer: ArrayBuffer) {
    // Parse on the main thread too: metadata (page count, sizes) is a cheap
    // scan, and this copy stays usable as the no-worker fallback.
    this.note = parseNote(buffer);
    try {
      this.worker = new Worker(new URL('./noteWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<Record<string, unknown>>) => this.onMessage(e.data);
      this.worker.onerror = () => this.degrade();
      this.ready = new Promise((resolve) => {
        this.onLoaded = resolve;
      });
      // Structured clone (not transfer): the main-thread copy must survive.
      this.worker.postMessage({ type: 'load', buffer });
    } catch {
      this.worker = null;
    }
  }

  private onLoaded: (() => void) | null = null;

  private onMessage(msg: Record<string, unknown>): void {
    if (msg['type'] === 'loaded') this.onLoaded?.();
    else if (msg['type'] === 'error') this.degrade();
    else if (msg['type'] === 'flat' || msg['type'] === 'flat-error') {
      const entry = this.pending.get(msg['id'] as number);
      if (!entry) return;
      this.pending.delete(msg['id'] as number);
      if (msg['type'] === 'flat') {
        entry.resolve({
          gray: msg['gray'] as Uint8Array,
          width: msg['width'] as number,
          height: msg['height'] as number,
        });
      } else {
        entry.reject(new Error(String(msg['error'] ?? 'flatten failed')));
      }
    }
  }

  /** Worker died or failed to parse — finish outstanding work on-main. */
  private degrade(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, entry] of this.pending) entry.reject(new Error('worker unavailable'));
    this.pending.clear();
    this.onLoaded?.();
  }

  async flatten(index: number): Promise<FlatPage> {
    if (this.worker) {
      await this.ready;
      if (this.worker) {
        const id = this.nextId++;
        try {
          return await new Promise<FlatPage>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker!.postMessage({ type: 'flatten', id, index });
          });
        } catch {
          /* fall through to main-thread */
        }
      }
    }
    // Fallback: decode on-main, yielding to the paint loop first.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return flattenPageGray(this.note, index);
  }

  /** Full-resolution canvas of the page, composited off-thread. */
  async renderPage(index: number): Promise<HTMLCanvasElement> {
    const { gray, width, height } = await this.flatten(index);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    const px = img.data;
    for (let i = 0; i < gray.length; i++) {
      const v = gray[i]!;
      px[i * 4] = v;
      px[i * 4 + 1] = v;
      px[i * 4 + 2] = v;
      px[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
