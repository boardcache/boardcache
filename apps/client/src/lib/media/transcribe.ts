import { create } from 'zustand';
import { apiFetch } from '../sync/apiBase';
import { getAssetBlob } from '../board/assetStore';
import { asrTranscribe, localWhisperEnabled } from '../search/semanticIndex';
import { useAIStore } from '../../state/aiStore';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Speech-to-text through the AI provider seam (user decision: server-proxied
 * option A). Manual per item — never automatic; the transcript is stored ON
 * the item, so it syncs encrypted with the board and feeds search everywhere.
 * The audio track is decoded and downsampled client-side to 16kHz mono WAV
 * before upload, then transcribed by the user's OpenAI key or hosted AI
 * (credits, charged per audio minute).
 */

const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 20 * 60; // ≈23MB of WAV — under provider upload caps

interface TranscribeModel {
  providerId: 'local' | 'openai' | 'hosted';
  model: string;
}

/** Local Whisper (opted in) wins — free, offline, private; then BYO OpenAI
 *  key; hosted (when the server offers transcribe) last. */
function transcribeModel(): TranscribeModel | null {
  if (localWhisperEnabled()) return { providerId: 'local', model: 'whisper-base' };
  const { providers, hosted } = useAIStore.getState();
  const key = providers.openai?.apiKey.trim();
  if (key) return { providerId: 'openai', model: 'whisper-1' };
  if (hosted?.enabled && hosted.credits !== null && hosted.ops.transcribe) {
    return { providerId: 'hosted', model: hosted.ops.transcribe.model };
  }
  return null;
}

export function transcribeAvailable(): boolean {
  return transcribeModel() !== null;
}

interface TranscribeState {
  running: Record<string, true>;
  start: (id: string) => void;
  finish: (id: string) => void;
}

export const useTranscribeStore = create<TranscribeState>((set) => ({
  running: {},
  start: (id) => set((s) => ({ running: { ...s.running, [id]: true } })),
  finish: (id) =>
    set((s) => {
      const running = { ...s.running };
      delete running[id];
      return { running };
    }),
}));

/** Decode any audio/video asset's audio track → 16kHz mono 16-bit WAV. */
async function assetToWav(
  assetId: string,
): Promise<{ wav: ArrayBuffer; seconds: number; mono: Float32Array }> {
  const blob = await getAssetBlob(assetId);
  if (!blob) throw new Error('The media file is unavailable.');
  const probe = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error('Could not decode an audio track from this file.');
  } finally {
    void probe.close();
  }
  if (decoded.duration > MAX_SECONDS) {
    throw new Error(
      `This file is ${Math.round(decoded.duration / 60)} minutes long — transcription currently caps at ${MAX_SECONDS / 60} minutes.`,
    );
  }
  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const off = new OfflineAudioContext(1, Math.max(1, frames), SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);

  // Minimal PCM16 WAV container.
  const buf = new ArrayBuffer(44 + mono.length * 2);
  const view = new DataView(buf);
  const writeStr = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + mono.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, mono.length * 2, true);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return { wav: buf, seconds: decoded.duration, mono };
}

const toB64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(bin);
};

/** Transcribe one audio/video item; stores the text on the item. */
export async function transcribeItem(itemId: string): Promise<string> {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (!item || (item.type !== 'audio' && item.type !== 'video')) {
    throw new Error('Only audio and video items can be transcribed.');
  }
  if (!item.assetId) throw new Error('Provider embeds can’t be transcribed — only local files.');
  const model = transcribeModel();
  if (!model) {
    throw new Error(
      'Transcription needs an OpenAI key (AI Providers) or hosted AI with transcription enabled.',
    );
  }
  const { running, start, finish } = useTranscribeStore.getState();
  if (running[itemId]) throw new Error('A transcription is already running for this item.');
  start(itemId);
  try {
    const { wav, mono } = await assetToWav(item.assetId);
    if (model.providerId === 'local') {
      // Fully on-device: the audio never leaves this machine. (No timed
      // segments from the local pipeline — flat text only.)
      const text = await asrTranscribe(mono);
      updateItems([itemId], 'Transcribe', (d) => {
        if (d.type === 'audio' || d.type === 'video') {
          d.transcript = text || null;
          d.transcriptSegments = null;
        }
      });
      return text;
    }
    const key = useAIStore.getState().providers.openai?.apiKey.trim() ?? '';
    const res = await apiFetch('/api/ai/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        providerId: model.providerId,
        ...(model.providerId === 'openai' ? { apiKey: key } : {}),
        model: model.model,
        audioB64: toB64(wav),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Transcription failed (${res.status}).`);
    }
    const { text, segments } = (await res.json()) as {
      text: string;
      segments?: { t0: number; t1: number; text: string }[];
    };
    const cleaned = text.trim();
    const timed =
      Array.isArray(segments) && segments.length > 0
        ? segments.map((seg) => ({ t0: seg.t0, t1: seg.t1, text: seg.text }))
        : null;
    updateItems([itemId], 'Transcribe', (d) => {
      if (d.type === 'audio' || d.type === 'video') {
        d.transcript = cleaned || null;
        d.transcriptSegments = cleaned ? timed : null;
      }
    });
    return cleaned;
  } finally {
    finish(itemId);
  }
}
