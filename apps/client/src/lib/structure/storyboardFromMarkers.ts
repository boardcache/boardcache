import { newId } from '@boardcache/schema';
import { framesAtTimes } from '../media/videoActions';
import { importImageFiles } from '../import/importImages';
import { createStoryboardItem } from '../import/createItems';
import { updateStoryboard } from './storyboardAttach';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Turn a video's time markers into a storyboard: one panel per marker, each
 * framed with the frame captured AT that marker (offscreen — playback is
 * untouched). Panel durations come from the gaps between markers.
 */
export async function storyboardFromMarkers(videoId: string): Promise<string> {
  const doc = useDocumentStore.getState().doc;
  const video = doc.items[videoId];
  if (!video || video.type !== 'video') throw new Error('Not a video item.');
  if (!video.assetId) throw new Error('Provider embeds have no frames to capture.');
  if (video.markers.length === 0) throw new Error('Add markers to the video first.');

  const markers = [...video.markers].sort((a, b) => a.time - b.time);
  const blobs = await framesAtTimes(
    video,
    markers.map((m) => m.time),
  );
  if (blobs.length !== markers.length) throw new Error('Could not capture the marker frames.');

  // Frames land as real image items (one undo step), parked under the video.
  const files = blobs.map(
    (b, i) =>
      new File([b], `${markers[i]!.label || `marker-${i + 1}`}.jpg`, { type: 'image/jpeg' }),
  );
  const imageIds = await importImageFiles(files, {
    x: video.x + video.width / 2,
    y: video.y + video.height + 200,
  });

  // The board sits to the right of the video, panels pre-framed.
  const sbId = createStoryboardItem(
    { x: video.x + video.width + 420, y: video.y + video.height / 2 },
    {
      title: `${video.name ?? 'Video'} — storyboard`,
      columns: Math.min(3, Math.max(1, markers.length)),
      panels: markers.map((m, i) => ({
        id: newId(),
        label: m.label || `Shot ${String(i + 1).padStart(2, '0')}`,
        scene: '',
        action: '',
        move: '',
        lens: '',
        duration: i < markers.length - 1 ? Math.round(markers[i + 1]!.time - m.time) : null,
        itemIds: imageIds[i] ? [imageIds[i]!] : [],
        freeArrange: false,
      })),
    },
  );
  // One reflow pulls every captured frame into its panel box.
  updateStoryboard(sbId, 'Frame in storyboard', () => {});
  return sbId;
}
