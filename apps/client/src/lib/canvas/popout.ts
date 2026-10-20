import { escapeHtml } from './popoutHtml';
import { itemType } from '../../itemTypes';
export { escapeHtml } from './popoutHtml';
import type { CanvasDocument, Item } from '@boardcache/schema';
import { mediaMeta } from '../mediaItems';

/**
 * "Pop Out" — open the item being viewed in its own browser window sized to
 * the item's aspect ratio. Each call opens an independent window (unique
 * name), so any number can be open at once; blob URLs are minted per-window.
 */

/** Pure window-size math: scale base dims to a comfortable size within max. */
export function fitPopout(
  baseW: number,
  baseH: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  let w = Math.max(1, baseW);
  let h = Math.max(1, baseH);
  const longest = Math.max(w, h);
  // Bring tiny items up to a usable size; leave large ones to be clamped.
  const target = Math.min(900, Math.max(longest, 480));
  const up = target / longest;
  w *= up;
  h *= up;
  const fit = Math.min(1, maxW / w, maxH / h);
  w *= fit;
  h *= fit;
  return { width: Math.round(w), height: Math.round(h) };
}

function baseDims(item: Item): [number, number] {
  if (item.type === 'image') return [item.naturalWidth, item.naturalHeight];
  if (item.type === 'video') {
    return item.embed ? [1280, 720] : [item.naturalWidth, item.naturalHeight];
  }
  return [Math.max(1, item.width), Math.max(1, item.height)];
}

function popoutSize(item: Item): { width: number; height: number } {
  const [bw, bh] = baseDims(item);
  const maxW = Math.max(480, (window.screen?.availWidth ?? 1280) * 0.9);
  const maxH = Math.max(360, (window.screen?.availHeight ?? 800) * 0.9);
  return fitPopout(bw, bh, maxW, maxH);
}

function popoutTitle(doc: CanvasDocument, item: Item): string {
  if (item.type === 'palette') return item.name ?? 'Palette';
  if (item.type === 'swatch' && item.groupId) {
    return doc.groups[item.groupId]?.name ?? 'Color Swatch';
  }
  return mediaMeta(item).title;
}

/** Build the popup body for an item (creating per-window blob URLs for media). */
async function buildBody(win: Window, item: Item, doc: CanvasDocument): Promise<string> {
  // The popup's own URL factory scopes the blob URL to that window, so each
  // pop-out is independent; fall back to the opener's URL if unavailable.
  const winUrl = (win as Window & typeof globalThis).URL ?? URL;
  const mintUrl = (blob: Blob) => winUrl.createObjectURL(blob);
  const build = itemType(item).popout;
  if (build) return build(item, { win, doc, mintUrl });
  const meta = mediaMeta(item);
  const url = 'url' in item ? item.url : null;
  return `<div class="generic"><div class="gtype">${escapeHtml(meta.typeLabel)}</div><div class="gtitle">${escapeHtml(meta.title)}</div>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(url)}</a>` : ''}</div>`;
}

const STYLES = `
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:#0c0c0e;color:#ececec;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;overflow:hidden}
img,video,iframe{display:block;width:100%;height:100vh;border:0}
.pdf{width:100vw;height:100vh}
img,video{object-fit:contain;background:#0c0c0e}
.pad{width:100%;height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.text{max-width:min(820px,100%);max-height:100vh;overflow:auto;padding:32px;font-size:20px;line-height:1.5;word-break:break-word}
.md-rendered>:first-child{margin-top:0}.md-rendered>:last-child{margin-bottom:0}
.md-rendered h1{font-size:1.8em;margin:.6em 0 .3em}.md-rendered h2{font-size:1.5em;margin:.6em 0 .3em}.md-rendered h3{font-size:1.25em;margin:.6em 0 .3em}.md-rendered h4{font-size:1.1em;margin:.6em 0 .3em}
.md-rendered p{margin:.4em 0}.md-rendered ul,.md-rendered ol{margin:.4em 0;padding-left:1.5em}.md-rendered code{background:rgba(127,127,127,.18);padding:.1em .3em;border-radius:4px;font-size:.9em}
.md-rendered pre{background:rgba(127,127,127,.14);padding:.7em .9em;border-radius:6px;overflow:auto}.md-rendered pre code{background:none;padding:0}
.md-rendered blockquote{margin:.4em 0;padding-left:.8em;border-left:3px solid rgba(127,127,127,.5);opacity:.85}.md-rendered a{color:inherit;text-decoration:underline}
.md-rendered .task-item{list-style:none;margin-left:-1.25em}
.md-rendered .task-check{display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;margin-right:.5em;vertical-align:-.15em;border:1.6px solid currentColor;border-radius:3px;opacity:.7;box-sizing:border-box}
.md-rendered .task-item[data-state=done] .task-check{opacity:1}
.md-rendered .task-item[data-state=done] .task-check::after{content:'✓';color:currentColor;font-size:.78em;line-height:1}
.md-rendered .task-item[data-state=doing] .task-check{opacity:1;background:linear-gradient(135deg,currentColor 0 50%,transparent 50% 100%)}
.tlpop{max-width:640px;width:100%;padding:32px}
.tlpop h1{font-size:1.5em;margin:0 0 .8em}
.tlpop .tlrow{position:relative;display:flex;gap:14px;padding:0 0 22px;margin-left:6px;border-left:2px solid rgba(127,127,127,.35)}
.tlpop .tlrow:last-child{border-left-color:transparent}
.tlpop .tldot{flex:none;width:14px;height:14px;border-radius:50%;margin:2px 0 0 -8px;border:2px solid rgba(127,127,127,.2)}
.tlpop .tldate{display:block;font-size:.8em;opacity:.6;margin-bottom:2px}
.tlpop .tllabel{font-weight:700}
.tlpop .tldesc{margin:.35em 0 0;font-size:.92em;opacity:.85;white-space:pre-wrap}
.pollpop{max-width:640px;width:100%;padding:32px}
.pollpop h1{font-size:1.6em;margin:0 0 .6em}
.pollpop .pclosed{opacity:.6;margin:0 0 1em}
.pollpop .prow{position:relative;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;margin:8px 0;border:1px solid rgba(127,127,127,.35);border-radius:10px;overflow:hidden}
.pollpop .pfill{position:absolute;inset:0 auto 0 0;background:rgba(96,140,255,.25)}
.pollpop .plabel,.pollpop .pcount{position:relative}
.pollpop .ptotal{opacity:.6}
.rcp{max-width:820px;max-height:100vh;overflow:auto;padding:32px;font-size:16px;line-height:1.55}
.rcp .rchero{width:100%;height:280px;object-fit:cover;border-radius:12px;margin-bottom:18px}
.rcp h1{margin:.2em 0 .1em;font-size:2em}
.rcp .rcby{opacity:.6;margin:0 0 .6em}
.rcp .rcdesc{opacity:.85}
.rcp .rchips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 18px}
.rcp .rchip{padding:4px 12px;border-radius:999px;background:rgba(127,127,127,.18);font-size:13px}
.rcp .rccols{display:grid;grid-template-columns:minmax(200px,1fr) 2fr;gap:28px}
@media (max-width:640px){.rcp .rccols{grid-template-columns:1fr}}
.rcp h2{font-size:1.1em;margin:.2em 0 .5em}
.rcp ul,.rcp ol{margin:0;padding-left:1.3em}
.rcp li{margin:.35em 0}
.rcp .rchead{list-style:none;margin-left:-1.3em;font-weight:700;margin-top:.8em}
.timepop{display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px}
.timepop .tlabel{font-size:20px;opacity:.85}
.timepop .tdigits{font-family:ui-monospace,monospace;font-weight:700;font-size:clamp(40px,12vw,120px);letter-spacing:.03em}
.timepop .tsub{font-size:16px;opacity:.6}
.swatch{position:relative;width:100%;height:100vh}
.swatch .badge{position:absolute;left:14px;bottom:14px;background:rgba(0,0,0,.5);padding:6px 10px;border-radius:6px;font-size:13px}
.palette{display:flex;width:100%;height:100vh}
.palette .pcell{flex:1;display:flex;align-items:flex-end;justify-content:center;padding:10px}
.palette .pcell span{font-size:12px;font-weight:600;background:rgba(0,0,0,.35);padding:3px 7px;border-radius:5px}
.generic{display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center;padding:24px}
.gtype{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9aa4ae}
.gtitle{font-size:24px;font-weight:600}
.generic a{color:inherit}
.msg{color:#9aa4ae}
.fontspec{width:min(880px,100%);max-height:100vh;overflow:auto;padding:32px}
.fontspec h1{font-size:15px;letter-spacing:.07em;text-transform:uppercase;color:#9aa4ae;margin:0 0 18px}
.frow{display:flex;align-items:baseline;gap:16px;border-bottom:1px solid rgba(127,127,127,.25);padding:10px 0;white-space:nowrap;overflow:hidden}
.fsz{flex:none;width:44px;font-size:11px;color:#9aa4ae}
.fglyphs{font-size:20px;line-height:1.6;word-break:break-all}
.rss{width:min(680px,100%);height:100vh;display:flex;flex-direction:column;padding:24px}
.rss h1{font-size:17px;margin:0 0 14px}
.rlist{flex:1;overflow-y:auto;display:flex;flex-direction:column}
.rrow{display:flex;gap:12px;padding:12px 4px;border-bottom:1px solid rgba(127,127,127,.25);color:inherit;text-decoration:none;align-items:flex-start}
.rrow:hover{background:rgba(127,127,127,.12)}
.rthumb{flex:none;width:64px;height:64px;object-fit:cover;border-radius:6px}
.rtext{display:flex;flex-direction:column;gap:4px;min-width:0}
.rtitle{font-size:14px;font-weight:600;line-height:1.35}
.rex{font-size:12.5px;color:#9aa4ae;line-height:1.4}
`;

function docHtml(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLES}</style></head><body>${body}</body></html>`;
}

/** Open the item in its own independent popup window. */
export async function popOutItem(item: Item, doc: CanvasDocument): Promise<void> {
  const { width, height } = popoutSize(item);
  const name = `boardcache-popout-${item.id}-${Date.now()}`;
  const win = window.open(
    '',
    name,
    `width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no`,
  );
  if (!win) {
    window.alert('Pop-out was blocked by the browser. Please allow popups for this site.');
    return;
  }
  // Immediate skeleton so the (synchronously opened) window isn't blank while
  // the media blob loads.
  win.document.write(
    '<!doctype html><title>Loading</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0c0c0e;color:#888;font-family:sans-serif">Loading</body>',
  );
  win.document.close();

  const title = popoutTitle(doc, item);
  try {
    const body = await buildBody(win, item, doc);
    if (win.closed) return;
    win.document.open();
    win.document.write(docHtml(title, body));
    win.document.close();
  } catch (err) {
    console.error('boardCache: pop-out failed', err);
    try {
      win.document.body.innerHTML =
        '<div style="color:#9aa4ae;font-family:sans-serif;padding:24px">Could not load this item.</div>';
    } catch {
      /* window gone */
    }
  }
}
