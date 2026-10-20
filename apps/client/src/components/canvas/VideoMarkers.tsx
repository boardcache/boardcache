import type { AudioItem, VideoItem } from '@boardcache/schema';
import { updateItems } from '../../state/commands';

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Chip row of a media item's time markers: click jumps, × removes (when
 *  allowed). Serves video AND audio (podcast chapters) — same shape. */
export function VideoMarkers({
  item,
  onSeek,
  removable = false,
}: {
  item: AudioItem | VideoItem;
  onSeek: (time: number) => void;
  removable?: boolean;
}) {
  if (item.markers.length === 0) return null;
  const remove = (index: number) =>
    updateItems([item.id], 'Remove marker', (it) => {
      if (it.type === 'video' || it.type === 'audio') {
        it.markers = it.markers.filter((_, i) => i !== index);
      }
    });
  return (
    <div
      className="video-markers"
      data-testid="video-markers"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {item.markers.map((m, i) => (
        <span className="video-marker-chip" key={`${m.time}-${i}`}>
          <button
            type="button"
            className="video-marker-jump"
            data-testid="video-marker-jump"
            title={`Jump to ${formatTime(m.time)}`}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(m.time);
            }}
          >
            <b>{formatTime(m.time)}</b>
            {m.label}
          </button>
          {removable && (
            <button
              type="button"
              className="video-marker-remove"
              aria-label={`Remove marker ${m.label}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(i);
              }}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
