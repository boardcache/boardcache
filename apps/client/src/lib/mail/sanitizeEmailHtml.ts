import DOMPurify from 'dompurify';

/**
 * HTML mail is rendered inside a sandboxed iframe (no scripts, an opaque
 * origin) whose document carries its own Content Security Policy, so even
 * the markup that gets through the sanitiser cannot run, submit, navigate
 * the app or fetch from the network. Remote pictures stay blocked until
 * the reader asks for them (tracking pixels are pictures too); inline
 * cid: parts are swapped for their bytes at render time.
 */

/** The sanitiser's URL rule, with cid: added for inline parts. */
const ALLOWED_URI = /^(?:(?:https?|mailto|tel|cid|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** The largest HTML body kept on an item; longer ones keep the text alone. */
export const MAX_EMAIL_HTML = 600_000;

export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      'script',
      'iframe',
      'frame',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'link',
      'meta',
      'base',
      'svg',
      'math',
      'video',
      'audio',
    ],
    FORBID_ATTR: ['srcset', 'ping', 'formaction', 'poster', 'autofocus'],
    ALLOWED_URI_REGEXP: ALLOWED_URI,
  });
}

/** Swap cid: references for the given URLs (an attachment's bytes). */
function resolveCids(html: string, cid: Record<string, string>): string {
  const look = (id: string) => cid[id] ?? cid[decodeURIComponent(id)] ?? null;
  return html
    .replace(/(src|href)=(["'])cid:([^"']+)\2/gi, (m, attr: string, q: string, id: string) => {
      const url = look(id);
      return url ? `${attr}=${q}${url}${q}` : `${attr}=${q}${q}`;
    })
    .replace(/url\((["']?)cid:([^"')]+)\1\)/gi, (m, q: string, id: string) => {
      const url = look(id);
      return url ? `url(${q}${url}${q})` : 'none';
    });
}

/**
 * The document the reader's frame shows: the sanitised body under a policy
 * that allows inline styles and data: pictures, and remote pictures only
 * when asked. Links open in a new tab (the frame may open popups, nothing
 * else).
 */
export function emailFrameDocument(
  html: string,
  opts: { remoteImages?: boolean; cid?: Record<string, string> } = {},
): string {
  const img = opts.remoteImages ? 'data: https: http:' : 'data:';
  const csp = [
    "default-src 'none'",
    `img-src ${img}`,
    "style-src 'unsafe-inline'",
    "font-src 'none'",
    "form-action 'none'",
  ].join('; ');
  // Sanitised here too, so the frame is safe whatever reached the item
  // (a peer's raw write on a team board, an older import).
  const body = resolveCids(sanitizeEmailHtml(html), opts.cid ?? {});
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<base target="_blank">' +
    '<style>html{background:#fff}body{margin:14px;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1b1f24;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>' +
    `</head><body>${body}</body></html>`
  );
}
