import type { AudioEmbed } from '@boardcache/schema';

/**
 * Spotify / SoundCloud audio embeds — the audio analogue of videoEmbed.ts.
 * Items store the original page URL; the iframe src is derived per provider.
 */
export function parseAudioUrl(input: string): AudioEmbed | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'open.spotify.com') {
    // /track/{id}, /album/{id}, /playlist/{id}, /episode/{id}, /show/{id}
    // (optionally prefixed with /intl-xx/).
    const m = /^(?:\/intl-[a-z-]+)?\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/.exec(
      url.pathname,
    );
    if (m) return { provider: 'spotify', url: `https://open.spotify.com/${m[1]}/${m[2]}` };
    return null;
  }
  if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
    // A track or set page: /{artist}/{slug}(…); short links (on.soundcloud.com)
    // resolve inside the widget too.
    if (host === 'on.soundcloud.com' || /^\/[^/]+\/[^/]+/.test(url.pathname)) {
      return { provider: 'soundcloud', url: url.href };
    }
    return null;
  }
  return null;
}

/** The provider's player iframe URL. */
export function audioEmbedIframeSrc(embed: AudioEmbed): string {
  if (embed.provider === 'spotify') {
    const u = new URL(embed.url);
    return `https://open.spotify.com/embed${u.pathname}`;
  }
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(embed.url)}&color=%23ff5500&auto_play=false&show_teaser=false`;
}

/** A sensible default item size per provider/kind. */
export function audioEmbedSize(embed: AudioEmbed): { width: number; height: number } {
  if (embed.provider === 'spotify') {
    const kind = new URL(embed.url).pathname.split('/')[1];
    // Tracks/episodes use the compact player (152px); sets get the full one,
    // which Spotify draws at exactly 352px — a taller box only adds black.
    return kind === 'track' || kind === 'episode'
      ? { width: 420, height: 152 }
      : { width: 420, height: 352 };
  }
  return { width: 460, height: 166 };
}

/** Best-effort title + artwork URL via the provider's oEmbed endpoint. */
export async function fetchAudioEmbedMeta(
  embed: AudioEmbed,
): Promise<{ title: string | null; thumbnailUrl: string | null }> {
  const api =
    embed.provider === 'spotify'
      ? `https://open.spotify.com/oembed?url=${encodeURIComponent(embed.url)}`
      : `https://soundcloud.com/oembed?url=${encodeURIComponent(embed.url)}&format=json`;
  try {
    const res = await fetch(api);
    if (!res.ok) return { title: null, thumbnailUrl: null };
    const data = (await res.json()) as { title?: unknown; thumbnail_url?: unknown };
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const thumb = typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null;
    return { title: title || null, thumbnailUrl: thumb };
  } catch {
    return { title: null, thumbnailUrl: null };
  }
}
