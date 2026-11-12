const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVault } = require('./vault.cjs');

const HASH = 'a'.repeat(64);

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-vault-'));
  const vault = createVault({
    settingsFile: path.join(dir, 'vault.json'),
    onChange: () => undefined,
    log: () => undefined,
  });
  vault.setRoot(path.join(dir, 'Boards'), false);
  return { dir, vault };
}

test('a board folder takes readable media files, hidden copies and ciphertext, nothing else', () => {
  const { vault } = make();
  const ok = vault.write('Trip', [
    { file: 'manifest.json', bytes: new TextEncoder().encode('{"boardId":"b1","assets":{}}') },
    { file: 'images/Beach day.jpg', bytes: new Uint8Array([1, 2, 3]) },
    { file: `.boardcache/assets/${HASH}`, bytes: new Uint8Array([4]) },
    { file: `assets/${HASH}`, bytes: new Uint8Array([5]) },
  ]);
  assert.equal(ok.error, undefined);
  for (const bad of [
    'images/../x.jpg',
    'images/sub/x.jpg',
    'images/.hidden.jpg',
    'notes/x.txt',
    'images/con.jpg',
  ]) {
    const res = vault.write('Trip', [{ file: bad, bytes: new Uint8Array([1]) }]);
    assert.match(res.error, /Not a board file/, bad);
  }
  assert.deepEqual(Array.from(vault.read('Trip', 'images/Beach day.jpg').bytes), [1, 2, 3]);
  vault.stop();
});

test('arrange moves files within the folder and list reports the readable ones', () => {
  const { vault } = make();
  vault.write('Trip', [
    { file: 'manifest.json', bytes: new TextEncoder().encode('{"boardId":"b1","assets":{}}') },
    { file: `.boardcache/assets/${HASH}`, bytes: new Uint8Array([7, 7]) },
  ]);
  const moved = vault.arrange('Trip', [
    { from: `.boardcache/assets/${HASH}`, to: 'videos/clip.mp4' },
    { from: `assets/${'b'.repeat(64)}`, to: 'images/gone.png' },
  ]);
  assert.equal(moved.moved, 1);
  assert.deepEqual(moved.missing, [`assets/${'b'.repeat(64)}`]);
  // Moving again is a no-op: the source is gone and the target is there.
  const again = vault.arrange('Trip', [
    { from: `.boardcache/assets/${HASH}`, to: 'videos/clip.mp4' },
  ]);
  assert.deepEqual(again, { moved: 0, missing: [] });
  const listed = vault.list('Trip');
  assert.deepEqual(
    listed.files.map((f) => [f.file, f.bytes]),
    [['videos/clip.mp4', 2]],
  );
  assert.equal(typeof listed.files[0].mtime, 'number');
  // Outside the folder, or a bad target: refused.
  assert.match(vault.arrange('../x', []).error, /Not inside/);
  assert.match(
    vault.arrange('Trip', [{ from: 'videos/clip.mp4', to: 'videos/../clip.mp4' }]).error,
    /Not a board file/,
  );
  vault.stop();
});

test('Spotlight exclusion is offered only for a root on a separate macOS volume', () => {
  const { vault } = make();
  assert.deepEqual(vault.spotlight('darwin'), { offered: false, volume: null, excluded: false });
  assert.deepEqual(vault.spotlight('win32'), { offered: false, volume: null, excluded: false });
  assert.match(vault.excludeFromSpotlight('darwin').error, /not on a separate volume/);
  vault.stop();
});
