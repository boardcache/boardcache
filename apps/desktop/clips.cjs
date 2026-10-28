/**
 * Local clip inbox for the desktop app: what the browser clipper sends to
 * this computer instead of to a sync server. Each clip is a small JSON file
 * (plus a media file for images and videos) in one folder under userData,
 * so clips wait safely until the app adds them to a board, across restarts.
 *
 * The checks mirror the sync server's clip API: the
 * same kinds, web addresses only, the same size limits, and a media type
 * that can only ever be image, video or audio.
 */
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const KINDS = ['link', 'text', 'image', 'embed', 'video'];
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;
const MAX_CLIPS = 200;
const MEDIA_MIME = /^(image|video|audio)\/[a-z0-9.+-]+$/;
const ID = /^[0-9a-f-]{36}$/;

/** A trimmed string of at most `max` characters, or null. */
function str(value, max) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

/** A web address or nothing; false when it is something else. */
function webUrl(raw) {
  const value = str(raw, 2000);
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? value : false;
  } catch {
    return false;
  }
}

/**
 * Check a clip as the clipper sends it ({ kind, url, title, text, image:
 * { b64, mime }, boardId }). Returns { clip, media } or { error }.
 */
function validateClip(body) {
  const b = body && typeof body === 'object' ? body : {};
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return { error: 'kind must be link | text | image | embed | video.' };
  const url = webUrl(b.url);
  if (url === false) return { error: 'url must be http(s).' };
  const title = str(b.title, 500);
  const text = str(b.text, MAX_TEXT_CHARS);
  let media = null;
  let mediaMime = null;
  if (kind === 'image' || kind === 'video') {
    if (typeof b.image?.b64 !== 'string') return { error: `${kind} clips need image.b64.` };
    media = Buffer.from(b.image.b64, 'base64');
    if (media.length === 0 || media.length > MAX_MEDIA_BYTES)
      return { error: 'Media is empty or over 64 MB.' };
    const declared = String(b.image.mime ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    mediaMime = MEDIA_MIME.test(declared) ? declared : 'application/octet-stream';
  }
  if ((kind === 'link' || kind === 'embed') && !url) return { error: `${kind} clips need url.` };
  if (kind === 'text' && !text) return { error: 'text clips need text.' };
  return {
    clip: {
      kind,
      url,
      title,
      body: text,
      imageMime: mediaMime,
      boardId: str(b.boardId, 64),
    },
    media,
  };
}

/** The folder-backed inbox: add, list, read media, remove. */
function createClipStore(dir) {
  const ensure = () => fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const metaPath = (id) => path.join(dir, `${id}.json`);
  const mediaPath = (id) => path.join(dir, `${id}.bin`);

  function list() {
    let names;
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
      return [];
    }
    const clips = [];
    for (const name of names) {
      try {
        clips.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
      } catch {
        /* a half-written or foreign file: skip it */
      }
    }
    return clips.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  function add(clip, media) {
    ensure();
    if (list().length >= MAX_CLIPS)
      return { error: 'The clip inbox is full. Add or dismiss some clips in the app first.' };
    const id = nodeCrypto.randomUUID();
    const record = { id, ...clip, createdAt: new Date().toISOString() };
    if (media) fs.writeFileSync(mediaPath(id), media, { mode: 0o600 });
    // The metadata last: a clip is listed only once its media is complete.
    fs.writeFileSync(metaPath(id), JSON.stringify(record), { mode: 0o600 });
    return { clip: record };
  }

  function media(id) {
    if (!ID.test(String(id))) return null;
    try {
      const record = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
      return { bytes: fs.readFileSync(mediaPath(id)), mime: record.imageMime };
    } catch {
      return null;
    }
  }

  function remove(id) {
    if (!ID.test(String(id))) return;
    for (const p of [metaPath(id), mediaPath(id)]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* already gone */
      }
    }
  }

  return { list, add, media, remove };
}

module.exports = { createClipStore, validateClip, MAX_MEDIA_BYTES };
