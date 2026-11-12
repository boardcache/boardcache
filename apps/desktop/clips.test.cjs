const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { clipCors, createClipStore, validateClip } = require('./clips.cjs');

test('the clip routes answer CORS to extension origins only', () => {
  for (const origin of [
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    'moz-extension://3f1c2b9a-6e4d-4f0a-9c1e-2b7d8a5e6f10',
    'safari-web-extension://3F1C2B9A-6E4D-4F0A-9C1E-2B7D8A5E6F10',
  ]) {
    const headers = clipCors(origin);
    assert.ok(headers, origin);
    assert.equal(headers['access-control-allow-origin'], origin);
    assert.match(headers['access-control-allow-headers'], /authorization/);
    assert.equal(headers.vary, 'origin');
    assert.equal('access-control-allow-credentials' in headers, false);
  }
  for (const origin of [
    undefined,
    '',
    'https://example.com',
    'http://127.0.0.1:5173',
    'null',
    'chrome-extension://abc/evil',
    'extension://abcdefghijklmnop',
  ]) {
    assert.equal(clipCors(origin), null, String(origin));
  }
});

test('a clip must name a web page and a known kind', () => {
  assert.equal(validateClip({ kind: 'link', url: 'https://example.com/a' }).error, undefined);
  assert.ok(validateClip({ kind: 'link', url: 'file:///etc/passwd' }).error);
  assert.ok(validateClip({ kind: 'note', url: 'https://example.com/a' }).error);
});

test('a pending clip announces a screenshot; the real one names it; stale announcements are dropped', () => {
  const pending = validateClip({ kind: 'pending', url: 'https://example.com/a', boardId: 'b1' });
  assert.equal(pending.error, undefined);
  assert.equal(pending.clip.kind, 'pending');
  const real = validateClip({
    kind: 'image',
    image: { b64: Buffer.from('png').toString('base64'), mime: 'image/png' },
    url: 'https://example.com/a',
    replaces: 'c0ffee00-0000-4000-8000-000000000000',
  });
  assert.equal(real.replaces, 'c0ffee00-0000-4000-8000-000000000000');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-clips-'));
  const store = createClipStore(dir);
  const fresh = store.add(pending.clip, null).clip;
  const old = store.add(pending.clip, null).clip;
  fs.writeFileSync(
    path.join(dir, `${old.id}.json`),
    JSON.stringify({ ...old, createdAt: new Date(Date.now() - 10 * 60_000).toISOString() }),
  );
  const listed = store.list().map((c) => c.id);
  assert.deepEqual(listed, [fresh.id]);
  assert.ok(!fs.existsSync(path.join(dir, `${old.id}.json`)));
  fs.rmSync(dir, { recursive: true, force: true });
});
