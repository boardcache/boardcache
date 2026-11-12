import type { SourceInfo } from '@boardcache/schema';
import { apiFetch } from './apiBase';
import { desktopClips } from '../platform';
import { clipFileName } from './clipName';
import { clientToCanvas } from '../canvas/canvasDom';
import {
  TEXT_DEFAULTS,
  createIframeItem,
  createLinkItem,
  createTextFromString,
} from '../import/createItems';
import { createVideoEmbed } from '../import/importVideos';
import { importMediaFiles } from '../import/importMedia';
import { parseVideoUrl } from '../media/videoEmbed';
import { addConnection, groupItems, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';

/**
 * Clip inbox client: pulls clips captured by external producers and turns
 * them into real items on the open board — item creation happens HERE
 * because board docs are E2E encrypted and the server can never write into
 * one. Two sources: the sync server's inbox (POST /api/clips, a sync-plan
 * feature) and, in the desktop app, the local inbox the clipper reaches on
 * this computer without any account (apps/desktop/clips.cjs).
 */

export interface Clip {
  id: string;
  /** `pending`: a producer's word that a clip is on its way (a screenshot
   *  being stitched); the real clip replaces it. Shown as a box, never imported. */
  kind: 'link' | 'text' | 'image' | 'embed' | 'video' | 'pending';
  url: string | null;
  title: string | null;
  body: string | null;
  imageMime: string | null;
  /** Optional target board chosen in the producer (via the board directory). */
  boardId: string | null;
  createdAt: string;
  /** Where it waits: the sync server (default) or this desktop app. */
  origin?: 'server' | 'desktop';
}

export async function fetchClips(): Promise<Clip[]> {
  try {
    const res = await apiFetch('/api/clips', { credentials: 'include' });
    if (!res.ok) return [];
    const data = (await res.json()) as { clips?: unknown };
    return Array.isArray(data.clips) ? (data.clips as Clip[]) : [];
  } catch {
    return []; // unreachable / non-JSON server — no inbox, no crash
  }
}

/** Clips the clipper sent to this desktop app (none outside the desktop app). */
export async function fetchDesktopClips(): Promise<Clip[]> {
  const local = desktopClips();
  if (!local) return [];
  try {
    return (await local.list()).map((c) => ({ ...c, origin: 'desktop' as const }));
  } catch {
    return [];
  }
}

export async function dismissClip(clip: Clip): Promise<void> {
  if (clip.origin === 'desktop') {
    await desktopClips()?.remove(clip.id);
    return;
  }
  await apiFetch(`/api/clips/${clip.id}`, { method: 'DELETE', credentials: 'include' });
}

/** A clip's image or video bytes, from wherever the clip waits. */
export async function clipMedia(clip: Clip): Promise<Blob | null> {
  if (clip.origin === 'desktop') {
    const m = await desktopClips()?.media(clip.id);
    if (!m) return null;
    return new Blob([m.bytes as Uint8Array<ArrayBuffer>], {
      type: m.mime && m.mime !== 'application/octet-stream' ? m.mime : '',
    });
  }
  const res = await apiFetch(`/api/clips/${clip.id}/image`, { credentials: 'include' });
  return res.ok ? res.blob() : null;
}

/** Formal capture provenance stamped on every clip import (schema v50). */
const clipSource = (clip: Clip): SourceInfo | null =>
  clip.url
    ? {
        url: clip.url,
        ...(clip.title ? { title: clip.title } : {}),
        capturedAt: clip.createdAt,
      }
    : null;

/** Import one clip as an item near the view center (or at `spot`, where
 *  its announcement's box was); returns success. */
export async function importClip(
  clip: Clip,
  offset = 0,
  spot: { x: number; y: number } | null = null,
): Promise<boolean> {
  if (clip.kind === 'pending') return false;
  const at =
    spot ??
    clientToCanvas(window.innerWidth / 2 + offset * 40, window.innerHeight / 2 + offset * 40);
  if (clip.kind === 'image' || clip.kind === 'video') {
    // Same bytes endpoint for both — the mime routes the importer (images
    // → image items, MP4s → video items with poster + controls).
    const blob = await clipMedia(clip);
    if (!blob) return false;
    const fallback = clip.kind === 'video' ? 'video/mp4' : 'image/png';
    const mime = blob.type || clip.imageMime || fallback;
    const ext = mime.split('/')[1]?.split('+')[0] ?? (clip.kind === 'video' ? 'mp4' : 'png');
    // A picture keeps the name its site gave it (the URL's file name); else
    // the title, which may already be a file name ("DeYDqKoMHKn.mp4"): one extension.
    const name = clipFileName(clip, ext);
    const ids = await importMediaFiles([new File([blob], name, { type: mime })], at);
    const src = clipSource(clip);
    if (src && ids.length) {
      updateItems(ids, 'Import clip', (d) => {
        d.source = src;
      });
    }
    // Text with the picture (a profile card from the clipper: name, bio,
    // counts, links): a card beside it, opening the page, grouped with it.
    const caption = clip.body?.trim();
    const picture = ids.length === 1 ? useDocumentStore.getState().doc.items[ids[0]!] : null;
    if (caption && picture) {
      const gap = 24;
      const textId = createTextFromString(
        {
          x: picture.x + picture.width + gap + TEXT_DEFAULTS.width / 2,
          y: picture.y + Math.min(picture.height, TEXT_DEFAULTS.height) / 2,
        },
        caption,
        'Import clip',
      );
      const url = clip.url;
      updateItems([textId], 'Import clip', (d) => {
        if (url) d.linkUrl = url;
        if (src) d.source = src;
      });
      groupItems([picture.id, textId], clip.title ?? undefined);
    }
    return true;
  }
  if (clip.kind === 'embed' && clip.url) {
    // The producer decided this page is worth seeing, not just linking
    // (e.g. a Wikipedia article) — a live webpage embed with a poster.
    const embedId = createIframeItem(at, clip.url);
    const embedSrc = clipSource(clip);
    if (embedSrc) {
      updateItems([embedId], 'Import clip', (d) => {
        d.source = embedSrc;
      });
    }
    return true;
  }
  if (clip.kind === 'link' && clip.url) {
    // Provider video pages become playable embeds, not buttons.
    const video = parseVideoUrl(clip.url);
    if (video) {
      const vid = createVideoEmbed(video, at, clip.title ?? undefined);
      const vidSrc = clipSource(clip);
      if (vidSrc) {
        updateItems([vid], 'Import clip', (d) => {
          d.source = vidSrc;
        });
      }
      return true;
    }
    const id = createLinkItem(at);
    const url = clip.url;
    const label =
      clip.title?.trim() ||
      (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, '');
        } catch {
          return url;
        }
      })();
    const src = clipSource(clip);
    updateItems([id], 'Import clip', (d) => {
      if (d.type !== 'link') return;
      d.url = url;
      d.label = label;
      if (src) d.source = src;
    });
    return true;
  }
  if (clip.kind === 'text' && clip.body) {
    const source =
      clip.url && clip.title
        ? `\n\n— [${clip.title}](${clip.url})`
        : clip.url
          ? `\n\n— <${clip.url}>`
          : '';
    const textId = createTextFromString(at, clip.body + source, 'Import clip');
    const textSrc = clipSource(clip);
    if (textSrc) {
      const quote = clip.body;
      updateItems([textId], 'Import clip', (d) => {
        d.source = { ...textSrc, quote };
      });
    }
    // The quoted page is already on the board (webpage embed, link button,
    // or attached URL) → wire the excerpt to it with a 'cites' line.
    if (clip.url) {
      const url = clip.url;
      const host = Object.values(useDocumentStore.getState().doc.items).find(
        (i) =>
          i.id !== textId &&
          ((i.type === 'iframe' && i.url === url) ||
            (i.type === 'link' && i.url === url) ||
            i.linkUrl === url ||
            // Same-page media clip (screenshot/video) — but never chain
            // quote cards to each other.
            (i.type !== 'text' && i.source?.url === url)),
      );
      if (host) addConnection({ kind: 'item', id: textId }, { kind: 'item', id: host.id }, 'cites');
    }
    return true;
  }
  return false;
}
