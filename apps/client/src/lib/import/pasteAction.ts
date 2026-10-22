import type { Point } from '../canvas/coords';
import { hasClipboardItems, pasteItems } from './clipboard';
import { createTextFromString } from './createItems';
import { smartCreateFromText } from './smartPaste';
import { createAudioEmbed } from './importAudio';
import { createVideoEmbed } from './importVideos';
import { parseAudioUrl } from '../media/audioEmbed';
import { hasMediaFiles, importMediaFiles } from './importMedia';
import { parseVideoUrl } from '../media/videoEmbed';

/**
 * Pasting from a menu click (not the native `paste` event) can't read the
 * synchronous clipboardData, so it goes through the async Clipboard API.
 * Precedence matches the `paste` event: internal items → OS image → OS text.
 */
export async function pasteFromAnywhere(target: Point): Promise<boolean> {
  if (hasClipboardItems()) {
    pasteItems(target);
    return true;
  }
  return pasteFromSystem(target);
}

/** Read the OS clipboard (image first, then text) and place an item. */
export async function pasteFromSystem(target: Point): Promise<boolean> {
  if (navigator.clipboard?.read) {
    try {
      const clipItems = await navigator.clipboard.read();
      for (const ci of clipItems) {
        const imageType = ci.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await ci.getType(imageType);
          const ext = imageType.split('/')[1] ?? 'png';
          // Unique name — a constant "pasted" made every capture a dupe.
          const stamp = crypto.randomUUID().slice(0, 8);
          const file = new File([blob], `${stamp}.${ext}`, { type: imageType });
          if (hasMediaFiles([file])) {
            await importMediaFiles([file], target);
            return true;
          }
        }
      }
      for (const ci of clipItems) {
        if (ci.types.includes('text/plain')) {
          const text = await (await ci.getType('text/plain')).text();
          if (placeText(text, target)) return true;
        }
      }
    } catch {
      // Permission/focus denied for read() → fall through to readText().
    }
  }
  if (navigator.clipboard?.readText) {
    try {
      if (placeText(await navigator.clipboard.readText(), target)) return true;
    } catch {
      // No clipboard access at all.
    }
  }
  return false;
}

/** A trimmed string becomes a video embed (if a known URL) or a text item. */
function placeText(raw: string, target: Point): boolean {
  const text = raw.trim();
  if (!text) return false;
  const embed = parseVideoUrl(text);
  const audioEmbed = parseAudioUrl(text);
  if (embed) createVideoEmbed(embed, target);
  else if (audioEmbed) createAudioEmbed(audioEmbed, target);
  else if (!smartCreateFromText(text, target)) createTextFromString(target, text);
  return true;
}

// --- Paste availability: menus can only gray out / hide Paste if they know
// whether the OS clipboard holds something. We can't read it synchronously
// during render, so we probe on focus and cache the result. ----------------

let osHasContent = false;
let probing = false;

/** True if a menu click would have something to paste right now. */
export function canPasteNow(): boolean {
  return hasClipboardItems() || osHasContent;
}

/** Whether the clipboard may be read without a prompt. A probe must never
 *  ask: asked on every focus, the prompt gets dismissed until the browser
 *  blocks it for good. Without the permissions API, or without a grant, the
 *  answer is "assume something may be there". */
async function clipboardReadGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({
      name: 'clipboard-read' as PermissionName,
    });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

async function probeClipboard(): Promise<void> {
  if (probing || !document.hasFocus()) return;
  probing = true;
  try {
    if (!(await clipboardReadGranted())) {
      osHasContent = true;
    } else if (navigator.clipboard?.read) {
      const clipItems = await navigator.clipboard.read();
      osHasContent = clipItems.some((ci) =>
        ci.types.some((t) => t.startsWith('image/') || t === 'text/plain'),
      );
    } else if (navigator.clipboard?.readText) {
      osHasContent = (await navigator.clipboard.readText()).trim().length > 0;
    }
  } catch {
    // Can't inspect the clipboard (permission/focus) → assume something may be
    // there so a working Paste is never hidden.
    osHasContent = true;
  } finally {
    probing = false;
  }
}

/** Keep paste availability fresh: re-check whenever the window regains focus. */
export function startClipboardWatch(): () => void {
  void probeClipboard();
  const onFocus = () => void probeClipboard();
  window.addEventListener('focus', onFocus);
  return () => window.removeEventListener('focus', onFocus);
}
