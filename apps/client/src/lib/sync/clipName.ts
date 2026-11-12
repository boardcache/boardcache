/**
 * The name a clipped picture lands with. A page's title ("Facebook") says
 * where it came from, not what it is: when the picture's own URL ends in a
 * file name, that name wins, so a photo keeps the name its site gave it.
 */

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic|heif)$/i;

/** The file name at the end of an image URL's path, or null when the URL
 *  has none (a page, a CDN route without an extension, a data URL). */
export function imageFileNameFromUrl(url: string | null | undefined): string | null {
  if (!url || !/^https?:/i.test(url)) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const last = path.split('/').filter(Boolean).pop() ?? '';
  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    name = last;
  }
  name = name.trim();
  if (!IMAGE_EXT.test(name) || name.length < 5) return null;
  return name.slice(-120);
}

/** The file name for a clip's bytes: the image URL's own name for a picture,
 *  else the title (one extension, matching the bytes). */
export function clipFileName(
  clip: { kind: string; url: string | null; title: string | null },
  ext: string,
): string {
  const own = clip.kind === 'image' ? imageFileNameFromUrl(clip.url) : null;
  const stem = (own ?? clip.title ?? 'clip').slice(0, 80);
  if (own) return own;
  return stem.toLowerCase().endsWith(`.${ext}`) ? stem : `${stem}.${ext}`;
}
