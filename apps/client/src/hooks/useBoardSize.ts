import { useEffect, useState } from 'react';
import { estimateBoardBytes } from '../lib/board/boardSize';
import { useDocumentStore } from '../state/documentStore';

/**
 * Live estimate of the current board's on-disk size (document + assets).
 * Recomputed shortly after the document settles, so a 60fps drag doesn't sum
 * asset bytes on every frame.
 */
export function useBoardSize(): number | null {
  const [bytes, setBytes] = useState<number | null>(null);
  const items = useDocumentStore((s) => s.doc.items);
  const docId = useDocumentStore((s) => s.doc.id);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void estimateBoardBytes(useDocumentStore.getState().doc).then((b) => {
        if (alive) setBytes(b);
      });
    }, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [items, docId]);

  return bytes;
}
