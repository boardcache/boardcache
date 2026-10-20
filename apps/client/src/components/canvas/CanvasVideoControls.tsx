import { useEffect, useState } from 'react';
import { canvasToScreen } from '../../lib/canvas/coords';
import { effectiveBounds } from '../../lib/canvas/gestures';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { getVideo } from '../../lib/media/videoRegistry';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { VideoControlBar } from './VideoControlBar';

/**
 * Shows the custom video control bar in screen space just below the selected
 * file-backed video, so the controls stay a constant size at any zoom and sit
 * "below the video" as it pans/moves.
 */
export function CanvasVideoControls() {
  const selection = useSessionStore((s) => s.selection);
  const lightboxOpen = useSessionStore((s) => s.lightboxId !== null);
  const id = selection.length === 1 && !lightboxOpen ? selection[0]! : null;
  const item = useDocumentStore((s) => (id ? s.doc.items[id] : undefined));
  const override = useSessionStore((s) => (id ? s.gesture?.overrides[id] : undefined));
  const viewport = useDocumentStore((s) => s.doc.viewport);

  // Resolve the on-canvas <video> element (registered on mount, possibly a
  // frame after selection); retry briefly until it's available.
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const isFileVideo = item?.type === 'video' && !item.embed;
  useEffect(() => {
    if (!id || !isFileVideo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resolving an external DOM element, not a render loop
      setEl(null);
      return;
    }
    let raf = 0;
    let tries = 0;
    const find = () => {
      const found = getVideo(id);
      setEl(found);
      if (!found && tries++ < 60) raf = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [id, isFileVideo]);

  if (!id || !item || item.type !== 'video' || item.embed) return null;

  const aabb = rotatedRectAABB(effectiveBounds(item, override));
  const anchor = canvasToScreen({ x: aabb.x + aabb.width / 2, y: aabb.y + aabb.height }, viewport);
  // Match the control bar (and its timeline) to the video's on-screen width.
  const screenWidth = aabb.width * viewport.scale;

  return (
    <div
      className="canvas-video-controls"
      style={{ left: anchor.x, top: anchor.y + 10, width: screenWidth }}
    >
      <VideoControlBar item={item} el={el} />
    </div>
  );
}
