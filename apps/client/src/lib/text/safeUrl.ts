/**
 * URLs that may become an iframe source, a link target or an opened window.
 * Only http(s) qualifies: anything else (javascript:, data:, blob:, file:,
 * custom schemes) is refused, because user content travels across team
 * boards and community clones and an iframe or link is a script vector.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Plain-text extraction from untrusted HTML without ever creating live nodes. */
export function textFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body?.textContent ?? '';
}
