import { flattenPageGray, parseNote } from '../../lib/integrations/supernote';
import type { SnNotebook } from '../../lib/integrations/supernote';

/**
 * Decoding a 1404x1872 page is pure CPU (5 RLE layers composited per
 * pixel) — on the main thread it freezes the dialog solid. This worker
 * holds the parsed note and flattens pages on demand; the grayscale
 * buffers transfer back without copying.
 */

interface LoadMsg {
  type: 'load';
  buffer: ArrayBuffer;
}
interface FlattenMsg {
  type: 'flatten';
  id: number;
  index: number;
}

let note: SnNotebook | null = null;

self.onmessage = (e: MessageEvent<LoadMsg | FlattenMsg>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    try {
      note = parseNote(msg.buffer);
      self.postMessage({ type: 'loaded' });
    } catch (err) {
      self.postMessage({
        type: 'error',
        error: err instanceof Error ? err.message : 'parse failed',
      });
    }
    return;
  }
  if (msg.type === 'flatten') {
    void (async () => {
      try {
        const { gray, width, height } = await flattenPageGray(note!, msg.index);
        (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(
          { type: 'flat', id: msg.id, gray, width, height },
          [gray.buffer],
        );
      } catch (err) {
        self.postMessage({
          type: 'flat-error',
          id: msg.id,
          error: err instanceof Error ? err.message : 'flatten failed',
        });
      }
    })();
  }
};
