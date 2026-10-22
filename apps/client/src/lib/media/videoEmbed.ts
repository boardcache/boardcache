import type { VideoEmbed } from '@boardcache/schema';

/**
 * YouTube / Vimeo URL handling. Pure functions (unit-tested) so the canvas
 * and lightbox agree on how a provider URL maps to an embed, an iframe src,
 * and a thumbnail.
 */

const YT_HOST = /(?:youtube(?:-nocookie)?\.com|youtu\.be)/i;
const VIMEO_HOST = /vimeo\.com/i;

/** Parse a watch/share URL into a VideoEmbed, or null if not a known provider. */
export function parseVideoUrl(input: string): VideoEmbed | null {
  const url = input.trim();
  if (!url) return null;

  if (YT_HOST.test(url)) {
    const id =
      url.match(/[?&]v=([\w-]{11})/)?.[1] ??
      url.match(/youtu\.be\/([\w-]{11})/)?.[1] ??
      url.match(/\/(?:embed|shorts|v|live)\/([\w-]{11})/)?.[1];
    if (id) return { provider: 'youtube', videoId: id, url };
  }

  if (VIMEO_HOST.test(url)) {
    const id = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
    if (id) return { provider: 'vimeo', videoId: id, url };
  }

  return null;
}

export function isVideoUrl(input: string): boolean {
  return parseVideoUrl(input) !== null;
}

/** Privacy-friendly iframe src for inline/lightbox playback. */
export function embedIframeSrc(embed: VideoEmbed, opts: { autoplay?: boolean } = {}): string {
  const autoplay = opts.autoplay ? 1 : 0;
  if (embed.provider === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(embed.videoId)}?autoplay=${autoplay}&rel=0&modestbranding=1`;
  }
  return `https://player.vimeo.com/video/${encodeURIComponent(embed.videoId)}?autoplay=${autoplay}&byline=0&portrait=0`;
}

/**
 * A poster URL for the canvas facade. YouTube serves predictable thumbnails;
 * Vimeo requires an API call, so embeds there fall back to a placeholder.
 */
export function embedThumbnailUrl(embed: VideoEmbed): string | null {
  if (embed.provider === 'youtube') {
    return `https://i.ytimg.com/vi/${encodeURIComponent(embed.videoId)}/hqdefault.jpg`;
  }
  return null;
}

/**
 * Fetch a provider video's real title via oEmbed (used as the default label).
 * Best-effort: returns null if offline or the request is blocked.
 */
export async function fetchEmbedTitle(embed: VideoEmbed): Promise<string | null> {
  const api =
    embed.provider === 'youtube'
      ? `https://www.youtube.com/oembed?url=${encodeURIComponent(embed.url)}&format=json`
      : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(embed.url)}`;
  try {
    const res = await fetch(api);
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown };
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    return title || null;
  } catch {
    return null;
  }
}
