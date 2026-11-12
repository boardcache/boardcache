import { newId } from '@boardcache/schema';
import type { Point } from '../canvas/coords';
import { hasClipboardItems, internalClipboardCurrent, pasteItems } from './clipboard';
import { createTextFromString } from './createItems';
import { smartCreateFromText } from './smartPaste';
import { createAudioEmbed } from './importAudio';
import { createVideoEmbed } from './importVideos';
import { parseAudioUrl } from '../media/audioEmbed';
import { hasMediaFiles, importMediaFiles } from './importMedia';
import { parseVideoUrl } from '../media/videoEmbed';
import { desktopClipboard } from '../platform';
import { showNotice } from '../notices';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Pasting from a menu click (not the native `paste` event) can't read the
 * synchronous clipboardData, so it goes through the async Clipboard API.
 * Precedence matches the `paste` event: OS files → copied items, while they
 * are the newest thing copied → OS text.
 */
export async function pasteFromAnywhere(target: Point): Promise<boolean> {
  return pasteFromSystem(target);
}

/** What the OS clipboard holds, or null when it cannot be read at all. */
interface OsClipboard {
  files: File[];
  text: string;
}

/** The web Clipboard API's view: PNG images and plain text, with a grant. */
async function readWebClipboard(): Promise<OsClipboard | null> {
  const out: OsClipboard = { files: [], text: '' };
  let readable = false;
  if (navigator.clipboard?.read) {
    try {
      for (const ci of await navigator.clipboard.read()) {
        readable = true;
        const imageType = ci.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          try {
            const blob = await ci.getType(imageType);
            const ext = imageType.split('/')[1] ?? 'png';
            // Unique name — a constant "pasted" made every capture a dupe.
            out.files.push(
              new File([blob], `${crypto.randomUUID().slice(0, 8)}.${ext}`, { type: imageType }),
            );
          } catch {
            /* a type the API will not hand over (JPEG on some platforms) */
          }
        }
        if (!out.text && ci.types.includes('text/plain')) {
          out.text = await (await ci.getType('text/plain')).text();
        }
      }
      readable = true;
    } catch {
      // Permission/focus denied for read() → readText() may still work.
    }
  }
  if (!readable && navigator.clipboard?.readText) {
    try {
      out.text = await navigator.clipboard.readText();
      readable = true;
    } catch {
      /* no clipboard access at all */
    }
  }
  return readable ? out : null;
}

/** The desktop shell reads the clipboard natively: any image format, and
 *  files copied in a file manager, with no prompt. */
async function readDesktopClipboardFiles(): Promise<File[]> {
  const bridge = desktopClipboard();
  if (!bridge) return [];
  try {
    const { files } = await bridge.files();
    return files.map(
      (f) =>
        new File([f.bytes as BlobPart], f.name || `${crypto.randomUUID().slice(0, 8)}.png`, {
          type: f.mime,
        }),
    );
  } catch {
    return [];
  }
}

/** Read the OS clipboard (files first, then text) and place what it holds. */
export async function pasteFromSystem(target: Point): Promise<boolean> {
  const pending = showPasting(target);
  try {
    const web = await readWebClipboard();
    let files = web?.files ?? [];
    if (!files.some((f) => hasMediaFiles([f]))) files = await readDesktopClipboardFiles();
    if (hasMediaFiles(files)) {
      pending.remove();
      await importMediaFiles(files, target);
      return true;
    }
    if (web === null && !desktopClipboard()) {
      // Nothing readable: the copied items, if any, are the best guess.
      if (hasClipboardItems()) {
        pending.remove();
        await pasteItems(target);
        return true;
      }
      showNotice('The clipboard could not be read. Press Ctrl+V on the board instead.', {
        id: 'paste',
      });
      return false;
    }
    const text = web?.text ?? '';
    if (internalClipboardCurrent(text)) {
      pending.remove();
      await pasteItems(target);
      return true;
    }
    pending.remove();
    if (placeText(text, target)) return true;
    showNotice('Nothing on the clipboard to paste.', { id: 'paste' });
    return false;
  } finally {
    pending.remove();
  }
}

/** A placeholder on the board while the clipboard is read, so a slow paste
 *  is seen to be under way. It appears only when the read takes a moment. */
const PASTING_SIZE = { width: 280, height: 190 };
function showPasting(at: Point): { remove(): void } {
  const id = newId();
  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    useSessionStore.getState().addPendingImport({
      id,
      x: at.x - PASTING_SIZE.width / 2,
      y: at.y - PASTING_SIZE.height / 2,
      width: PASTING_SIZE.width,
      height: PASTING_SIZE.height,
      label: 'Pasting',
      name: 'Reading the clipboard',
    });
  }, 150);
  return {
    remove() {
      clearTimeout(timer);
      if (shown) useSessionStore.getState().removePendingImport(id);
      shown = false;
    },
  };
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
