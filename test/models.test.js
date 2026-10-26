const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeParts } = require('../src/main/models/shapes');
const { pickModel, words, downloadStl } = require('../src/main/models/lookup');

test('shapes are checked and tidied, unknown ones dropped, sizes filled in', () => {
  const parts = normalizeParts([
    { shape: 'Sphere', size: 2, color: '#f00', position: [1, 2, 3], label: 'Sun', glow: true },
    { shape: 'box', size: [1, 2], rotation: [0, 45, 0], color: 'red' },
    { shape: 'dodecahedron', size: 1 },
    { shape: 'ring', size: [1, 2], orbit: { radius: 5, speed: 30 } },
    { shape: 'cylinder', size: ['x', -3, 1e9], opacity: 5 },
    null
  ]);
  assert.equal(parts.length, 4);
  assert.deepEqual(parts[0], { shape: 'sphere', size: [2], position: [1, 2, 3], rotation: [0, 0, 0], color: '#ff0000', opacity: 1, glow: true, label: 'Sun' });
  assert.deepEqual(parts[1].size, [1, 2, 2], 'a missing size repeats the last one');
  assert.equal(parts[1].color, '#9fb4c0', 'an unknown colour gets a neutral one');
  assert.deepEqual(parts[2].orbit, { radius: 5, speed: 30, center: [0, 0, 0], tilt: 0 });
  assert.equal(parts[3].opacity, 1);
  assert.ok(parts[3].size.every((x) => x > 0 && x <= 10000));
  assert.equal(normalizeParts('nonsense').length, 0);
  assert.equal(normalizeParts(Array.from({ length: 200 }, () => ({ shape: 'sphere', size: 1 }))).length, 80);
});

const page = (title, size, extra = {}) => ({ title: `File:${title}`, imageinfo: [{ size, url: `https://upload.wikimedia.org/x/${encodeURIComponent(title)}`, descriptionurl: 'https://commons.wikimedia.org/wiki/File:x', extmetadata: { Artist: { value: '<b>Jane</b>' }, LicenseShortName: { value: 'CC BY 4.0' } }, ...extra }] });

test('the best STL is the one whose title matches, at a sensible size', () => {
  const pages = [page('Unrelated logo.stl', 500000), page('Human skull.stl', 50 * 1024 * 1024), page('Skull small.stl', 8000), page('Human skull scan.stl', 3000000), page('Skull.png', 90000)];
  const m = pickModel(pages, 'human skull');
  assert.equal(m.title, 'Human skull scan');
  assert.equal(m.credit, 'Jane · CC BY 4.0 · Wikimedia Commons');
  assert.equal(pickModel(pages, 'volcano'), null);
  assert.equal(pickModel([], 'skull'), null);
  assert.equal(pickModel([page('Skull.stl', 90000, { url: 'https://evil.example/skull.stl' })], 'skull'), null, 'only Wikimedia files');
  assert.deepEqual(words('Show me the 3D model of a skull'), ['skull']);
});

test('only Wikimedia files are downloaded, and big ones are refused', async () => {
  await assert.rejects(downloadStl('https://evil.example/x.stl'), /Not a Wikimedia file/);
  const big = async () => ({ ok: true, status: 200, headers: { get: () => String(99 * 1024 * 1024) }, arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(downloadStl('https://upload.wikimedia.org/a.stl', { fetchImpl: big }), /too large/);
  const ok = async () => ({ ok: true, status: 200, headers: { get: () => '4' }, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer });
  assert.equal((await downloadStl('https://upload.wikimedia.org/a.stl', { fetchImpl: ok })).length, 4);
});
