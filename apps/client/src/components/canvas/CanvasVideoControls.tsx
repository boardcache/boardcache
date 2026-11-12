import { useEffect, useState } from 'react';
import { canvasToScreen } from '../../lib/canvas/coords';
import { effectiveBounds } from '../../lib/canvas/gestures';
import { rotatedRectAABB } from '../../lib/canvas/geometry';
import { activateEmbed, embedSeekTo } from '../../lib/media/embedPlayers';
import { getVideo } from '../../lib/media/videoRegistry';
import { useCanvasReadOnly } from '../../lib/canvas/readOnly';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { VideoControlBar } from './VideoControlBar';
import { VideoMarkers } from './VideoMarkers';

/**
 * Shows the custom video control bar in screen space just below the selected
 * file-backed video, so the controls stay a constant size at any zoom and sit
 * "below the video" as it pans/moves. The video's time markers follow in a
 * bar of their own under the controls; a provider embed, which plays in its
 * own window, gets just that markers bar (a chip seeks the player).
 */
/** The button row's natural width; a narrower bar wraps it onto two rows. */
const BAR_MIN_W = 680;

export function CanvasVideoControls() {
  const selection = useSessionStore((s) => s.selection);
  const lightboxOpen = useSessionStore((s) => s.lightboxId !== null);
  const id = selection.length === 1 && !lightboxOpen ? selection[0]! : null;
  const item = useDocumentStore((s) => (id ? s.doc.items[id] : undefined));
  const override = useSessionStore((s) => (id ? s.gesture?.overrides[id] : undefined));
  const viewport = useDocumentStore((s) => s.doc.viewport);
  const readOnly = useCanvasReadOnly();

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

  if (!id || !item || item.type !== 'video') return null;
  if (item.embed && item.markers.length === 0) return null;

  const aabb = rotatedRectAABB(effectiveBounds(item, override));
  const anchor = canvasToScreen({ x: aabb.x + aabb.width / 2, y: aabb.y + aabb.height }, viewport);
  // Match the control bar (and its timeline) to the video's on-screen width,
  // but never narrower than the button row wants (it wraps on a phone) nor
  // wider than the window, and keep the whole bar on screen.
  const margin = 8;
  const maxWidth = window.innerWidth - margin * 2;
  const width = Math.min(
    Math.max(aabb.width * viewport.scale, Math.min(BAR_MIN_W, maxWidth)),
    maxWidth,
  );
  const left = Math.min(
    Math.max(anchor.x, width / 2 + margin),
    window.innerWidth - width / 2 - margin,
  );

  const embed = item.embed;
  return (
    <div className="canvas-video-controls" style={{ left, top: anchor.y + 10, width }}>
      {!embed && <VideoControlBar item={item} el={el} />}
      <VideoMarkers
        item={item}
        bar
        removable={!readOnly}
        onSeek={(t) => {
          if (embed) {
            activateEmbed(item.id, embed);
            embedSeekTo(item.id, t);
          } else if (el) el.currentTime = t;
        }}
      />
    </div>
  );
}
