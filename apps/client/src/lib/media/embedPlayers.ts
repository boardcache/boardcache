import type { AudioEmbed, VideoEmbed } from '@boardcache/schema';
import { audioEmbedIframeSrc } from './audioEmbed';
import { recallPosition, rememberPosition } from './playbackMemory';
import { embedIframeSrc } from './videoEmbed';

/**
 * Persistent provider (YouTube/Vimeo) players. Once activated, a player's
 * iframe lives in the floating EmbedPlayerLayer and is only *repositioned* —
 * over the canvas item, or over the lightbox stage — never remounted, so
 * playback continues uninterrupted across views. Play state and time are
 * tracked through each provider's postMessage API, which also powers seeking
 * (markers) and "continue where you left off" pop-outs.
 */
export interface ActiveEmbedPlayer {
  itemId: string;
  /** Video embeds get postMessage time/state tracking; audio embeds
   *  (Spotify/SoundCloud) are presentation-only — the provider player owns
   *  its own transport. */
  kind: 'video' | 'audio';
  embed: VideoEmbed | null;
  provider: string;
  src: string;
  /** Last time (seconds) reported by the provider (video only). */
  time: number;
  playing: boolean;
  iframe: HTMLIFrameElement | null;
}

const active = new Map<string, ActiveEmbedPlayer>();
const listeners = new Set<() => void>();
let snapshot: ActiveEmbedPlayer[] = [];

function emit(): void {
  snapshot = [...active.values()];
  for (const l of listeners) l();
}

export function subscribeEmbedPlayers(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function embedPlayersSnapshot(): ActiveEmbedPlayer[] {
  return snapshot;
}

export function activateEmbed(itemId: string, embed: VideoEmbed): void {
  if (active.has(itemId)) return;
  // Seed from the device memory so pop-outs and the start param resume there.
  const remembered = recallPosition(`${itemId}:embed`) ?? 0;
  active.set(itemId, {
    itemId,
    kind: 'video',
    embed,
    provider: embed.provider,
    src: embedPlayerSrc(embed, itemId),
    time: remembered,
    playing: true,
    iframe: null,
  });
  emit();
}

/** Activate a persistent Spotify/SoundCloud player for an audio-embed item. */
export function activateAudioEmbed(itemId: string, embed: AudioEmbed): void {
  if (active.has(itemId)) return;
  active.set(itemId, {
    itemId,
    kind: 'audio',
    embed: null,
    provider: embed.provider,
    src: audioEmbedIframeSrc(embed),
    time: 0,
    playing: false,
    iframe: null,
  });
  emit();
}

export function deactivateEmbed(itemId: string): void {
  const entry = active.get(itemId);
  if (!entry) return;
  if (entry.kind === 'video') rememberPosition(`${itemId}:embed`, entry.time);
  active.delete(itemId);
  emit();
}

/** Drop players whose items are gone; `null` clears everything. */
export function pruneEmbedPlayers(liveIds: Set<string> | null): void {
  let changed = false;
  for (const [id, entry] of [...active.entries()]) {
    if (!liveIds || !liveIds.has(id)) {
      if (entry.kind === 'video') rememberPosition(`${id}:embed`, entry.time);
      active.delete(id);
      changed = true;
    }
  }
  if (changed) emit();
}

/** The iframe src for a player (provider URL + the messaging API enabled). */
function embedPlayerSrc(embed: VideoEmbed, itemId?: string): string {
  const base = embedIframeSrc(embed, { autoplay: true });
  const t = itemId ? Math.floor(recallPosition(`${itemId}:embed`) ?? 0) : 0;
  if (embed.provider === 'youtube') {
    const start = t > 0 ? `&start=${t}` : '';
    return `${base}&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}${start}`;
  }
  return t > 0 ? `${base}#t=${t}s` : base; // Vimeo speaks postMessage by default
}

/** Layer ref hook: wire up messaging when the iframe mounts. */
export function attachEmbedIframe(itemId: string, iframe: HTMLIFrameElement | null): void {
  const entry = active.get(itemId);
  if (!entry) return;
  entry.iframe = iframe;
  if (entry.kind !== 'video' || !entry.embed) return; // audio: no messaging
  if (iframe && entry.embed.provider === 'youtube') {
    // Ask the widget to stream state (infoDelivery) to us.
    const listen = () =>
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: itemId, channel: 'widget' }),
        '*',
      );
    iframe.addEventListener('load', listen);
    listen();
  }
  if (iframe && entry.embed.provider === 'vimeo') {
    const listen = () => {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ method: 'addEventListener', value: 'playProgress' }),
        '*',
      );
      iframe.contentWindow?.postMessage(
        JSON.stringify({ method: 'addEventListener', value: 'pause' }),
        '*',
      );
      iframe.contentWindow?.postMessage(
        JSON.stringify({ method: 'addEventListener', value: 'play' }),
        '*',
      );
    };
    iframe.addEventListener('load', listen);
    listen();
  }
}

function command(entry: ActiveEmbedPlayer, payload: unknown): void {
  entry.iframe?.contentWindow?.postMessage(JSON.stringify(payload), '*');
}

export function embedPause(itemId: string): void {
  const e = active.get(itemId);
  if (!e || e.kind !== 'video' || !e.embed) return;
  if (e.embed.provider === 'youtube')
    command(e, { event: 'command', func: 'pauseVideo', args: [], id: itemId, channel: 'widget' });
  else command(e, { method: 'pause' });
}

export function embedSeekTo(itemId: string, seconds: number): void {
  const e = active.get(itemId);
  if (!e || e.kind !== 'video' || !e.embed) return;
  if (e.embed.provider === 'youtube')
    command(e, {
      event: 'command',
      func: 'seekTo',
      args: [seconds, true],
      id: itemId,
      channel: 'widget',
    });
  else command(e, { method: 'setCurrentTime', value: seconds });
  e.time = seconds;
}

/** Last known playback position, in seconds. */
export function embedTime(itemId: string): number {
  return active.get(itemId)?.time ?? 0;
}

// One window listener demuxes provider messages back to their players.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (ev: MessageEvent) => {
    if (active.size === 0 || typeof ev.data !== 'string') return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      return;
    }
    for (const entry of active.values()) {
      if (!entry.iframe || entry.iframe.contentWindow !== ev.source) continue;
      if (entry.kind !== 'video' || !entry.embed) break;
      if (entry.embed.provider === 'youtube') {
        const info = (data as { info?: { currentTime?: number; playerState?: number } }).info;
        if (info) {
          if (typeof info.currentTime === 'number') entry.time = info.currentTime;
          if (typeof info.playerState === 'number') entry.playing = info.playerState === 1;
        }
      } else {
        const event = data.event as string | undefined;
        const payload = data.data as { seconds?: number } | undefined;
        if (event === 'playProgress' && typeof payload?.seconds === 'number') {
          entry.time = payload.seconds;
          entry.playing = true;
        } else if (event === 'pause') entry.playing = false;
        else if (event === 'play') entry.playing = true;
      }
      break;
    }
  });
}
