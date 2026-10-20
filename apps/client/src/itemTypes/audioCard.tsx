import { MusicNoteIcon } from '../components/icons';

/** Square album-art slot: a note when the track has no cover. */
export function AudioCard() {
  return (
    <span className="gallery-audio">
      <MusicNoteIcon size={36} />
    </span>
  );
}
