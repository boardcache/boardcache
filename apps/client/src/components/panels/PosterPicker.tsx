import { useEffect, useRef, useState } from 'react';
import { extractPosterFrames, setPosterFromBlob } from '../../lib/media/videoActions';
import type { PosterFrame } from '../../lib/media/videoActions';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Modal that pulls a handful of frames from the selected video and lets the
 * user pick one as the poster/preview image. Opened from the control bar or
 * the context menu via session state.
 */
export function PosterPicker() {
  const id = useSessionStore((s) => s.videoPosterPickerId);
  const item = useDocumentStore((s) => (id ? s.doc.items[id] : undefined));
  const [frames, setFrames] = useState<PosterFrame[] | null>(null);
  const framesRef = useRef<PosterFrame[]>([]);

  const isVideo = item?.type === 'video';

  useEffect(() => {
    if (!id || !isVideo || !item) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing before an async extract, not a render loop
    setFrames(null);
    void extractPosterFrames(item, 6).then((f) => {
      if (!alive) {
        f.forEach((x) => URL.revokeObjectURL(x.previewUrl));
        return;
      }
      framesRef.current = f;
      setFrames(f);
    });
    return () => {
      alive = false;
      framesRef.current.forEach((x) => URL.revokeObjectURL(x.previewUrl));
      framesRef.current = [];
    };
    // Re-extract only when a different video's picker opens (not on item edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id || !item || item.type !== 'video') return null;

  const close = () => useSessionStore.getState().setVideoPosterPickerId(null);

  return (
    <div className="poster-picker-overlay" data-testid="poster-picker" onClick={close}>
      <div className="poster-picker" onClick={(e) => e.stopPropagation()}>
        <header className="pp-head">
          <span>Choose poster frame</span>
          <button type="button" className="pp-close" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        {frames === null ? (
          <div className="pp-loading">Extracting frames</div>
        ) : frames.length === 0 ? (
          <div className="pp-loading">Couldn’t read frames from this video.</div>
        ) : (
          <div className="pp-frames">
            {frames.map((f) => (
              <button
                key={f.time}
                type="button"
                className="pp-frame"
                data-testid="poster-frame"
                onClick={async () => {
                  await setPosterFromBlob(item, f.blob);
                  close();
                }}
                title={`Use frame at ${f.time.toFixed(1)}s`}
              >
                <img src={f.previewUrl} alt="" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
