import type { AudioItem } from '@boardcache/schema';
import { newId } from '@boardcache/schema';
import { putAsset } from '../board/assetStore';
import { extractAudioArtwork } from '../media/audioArtwork';
import type { Point } from '../canvas/coords';
import { addItems, topZIndex, updateItems } from '../../state/commands';
import { openSpotNear, reserveNext } from '../canvas/placeSpot';
import type { ReservedBox } from '../canvas/placeSpot';
import type { AudioEmbed } from '@boardcache/schema';
import { audioEmbedSize, fetchAudioEmbedMeta } from '../media/audioEmbed';
import { useSessionStore } from '../../state/sessionStore';
import { useDocumentStore } from '../../state/documentStore';

/** Default audio card size, in canvas units. */
const AUDIO_SIZE = { width: 360, height: 136 };

/** Drop the file extension for a friendly default title. */
function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') || name;
}

async function importOneAudio(file: File, at: Point): Promise<string | null> {
  try {
    const assetId = await putAsset(file);
    // Pull embedded cover artwork (ID3/FLAC/MP4) into its own asset, if any.
    let coverAssetId: string | null = null;
    try {
      const art = await extractAudioArtwork(file);
      if (art) coverAssetId = await putAsset(art);
    } catch {
      /* artwork is optional */
    }
    const { doc } = useDocumentStore.getState();
    const { width, height } = AUDIO_SIZE;
    const item: AudioItem = {
      id: newId(),
      type: 'audio',
      x: at.x - width / 2,
      y: at.y - height / 2,
      width,
      height,
      rotation: 0,
      zIndex: topZIndex(doc) + 1,
      locked: false,
      opacity: 1,
      groupId: null,
      name: file.name || undefined,
      assetId,
      embed: null,
      title: baseName(file.name || 'Audio'),
      artist: null,
      album: null,
      coverAssetId,
      volume: 1,
      muted: false,
      loop: false,
      playbackRate: 1,
      transcript: null,
      transcriptSegments: null,
      markers: [],
    };
    addItems([item], 'Add audio');
    return item.id;
  } catch (err) {
    console.error(`boardCache: could not import audio "${file.name}"`, err);
    return null;
  }
}

/** Import local audio files: store each blob and place a player card. */
export async function importAudioFiles(files: File[], dropPoint: Point): Promise<string[]> {
  const audioFiles = files.filter((f) => f.type.startsWith('audio/'));
  if (audioFiles.length === 0) return [];
  const ids: string[] = [];
  const reserved: ReservedBox[] = [];
  for (const file of audioFiles) {
    const spot = reserveNext(reserved, dropPoint, AUDIO_SIZE.width, AUDIO_SIZE.height);
    const id = await importOneAudio(file, spot);
    if (id) ids.push(id);
  }
  return ids;
}

/** Place a Spotify/SoundCloud embed player at a canvas point. */
export function createAudioEmbed(embed: AudioEmbed, at: { x: number; y: number }): string {
  const { doc } = useDocumentStore.getState();
  const { width, height } = audioEmbedSize(embed);
  at = openSpotNear(at, width, height);
  const item: AudioItem = {
    id: newId(),
    type: 'audio',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    rotation: 0,
    zIndex: topZIndex(doc) + 1,
    locked: false,
    opacity: 1,
    groupId: null,
    assetId: null,
    embed,
    title: null,
    artist: null,
    album: null,
    coverAssetId: null,
    volume: 1,
    muted: false,
    loop: false,
    playbackRate: 1,
    transcript: null,
    transcriptSegments: null,
    markers: [],
  };
  addItems([item], 'Add audio embed');
  useSessionStore.getState().setSelection([item.id]);
  // Best-effort: pull the real title AND the artwork (used as the facade,
  // gallery thumbnail, and export tile) from the provider's oEmbed.
  void (async () => {
    const meta = await fetchAudioEmbedMeta(embed);
    let coverAssetId: string | null = null;
    if (meta.thumbnailUrl) {
      try {
        const res = await fetch(meta.thumbnailUrl);
        if (res.ok) {
          const blob = await res.blob();
          if (blob.type.startsWith('image/')) coverAssetId = await putAsset(blob);
        }
      } catch {
        /* artwork is cosmetic */
      }
    }
    if (meta.title || coverAssetId) {
      updateItems([item.id], 'Set audio title', (it) => {
        if (it.type !== 'audio') return;
        if (meta.title && !it.title) it.title = meta.title;
        if (coverAssetId && !it.coverAssetId) it.coverAssetId = coverAssetId;
      });
    }
  })();
  return item.id;
}
