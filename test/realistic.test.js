const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findPhotos, fetchPhoto, safePhotoUrl } = require('../src/main/models/photos');
const { photoToGlb, friendly } = require('../src/main/models/sf3d');
const { ModelCache } = require('../src/main/models/cache');

const json = (o, ok = true, status = 200) => ({ ok, status, json: async () => o, text: async () => JSON.stringify(o) });

test('only public https photos are fetched, never your own network', () => {
  assert.ok(safePhotoUrl('https://upload.wikimedia.org/a.jpg'));
  for (const bad of ['http://example.com/a.jpg', 'https://127.0.0.1/a.jpg', 'https://192.168.1.5/a.jpg', 'https://localhost/a.jpg', 'https://printer.local/a.jpg', 'https://[::1]/a.jpg', 'file:///etc/passwd', 'javascript:1', 'https://intranet/a.jpg', '']) assert.equal(safePhotoUrl(bad), '', bad);
});

test('Commons photos are picked by title match and size, with credit', async () => {
  const pages = [
    { title: 'File:VEX Robotics Competition Robot.jpg', imageinfo: [{ mime: 'image/jpeg', width: 3000, height: 2000, thumburl: 'https://thumb.wikimedia.org/a/960px-a.jpg?x=1', descriptionurl: 'https://commons/x', extmetadata: { Artist: { value: '<b>Jane</b>' }, LicenseShortName: { value: 'CC BY 4.0' } } }] },
    { title: 'File:Logo.png', imageinfo: [{ mime: 'image/png', width: 3000, height: 2000, thumburl: 'https://thumb.wikimedia.org/b.png' }] },
    { title: 'File:VEX tiny.jpg', imageinfo: [{ mime: 'image/jpeg', width: 100, height: 80, thumburl: 'https://thumb.wikimedia.org/c.jpg' }] },
    { title: 'File:VEX diagram.gif', imageinfo: [{ mime: 'image/gif', width: 2000, height: 2000, thumburl: 'https://thumb.wikimedia.org/d.gif' }] }
  ];
  const f = async (u) => (String(u).includes('commons.wikimedia.org') ? json({ query: { pages } }) : json({ query: { pages: [] } }));
  const got = await findPhotos('VEX robot', { fetchImpl: f });
  assert.deepEqual(got, [{ url: 'https://thumb.wikimedia.org/a/960px-a.jpg', title: 'VEX Robotics Competition Robot', credit: 'Jane · CC BY 4.0 · Wikimedia Commons', page: 'https://commons/x' }]);
});

test('a photo is fetched only when it is a real image of a sensible size', async () => {
  const img = Buffer.alloc(5000, 1);
  const f = (type, buf = img) => async () => ({ ok: true, status: 200, headers: { get: () => type }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
  assert.equal((await fetchPhoto('https://x.example.com/a.jpg', { fetchImpl: f('image/jpeg') })).type, 'image/jpeg');
  assert.equal(await fetchPhoto('https://x.example.com/a.svg', { fetchImpl: f('image/svg+xml') }), null);
  assert.equal(await fetchPhoto('https://x.example.com/a.jpg', { fetchImpl: f('image/jpeg', Buffer.alloc(10)) }), null, 'too small to be a photo');
  assert.equal(await fetchPhoto('http://x.example.com/a.jpg', { fetchImpl: f('image/jpeg') }), null, 'not https');
});

// a pretend Hugging Face Space: upload, two queue calls, a GLB to download
function fakeSpace({ failSecond = null } = {}) {
  const calls = [];
  const events = [];
  const glb = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(100, 7)]);
  const stream = () => new ReadableStream({ start(c) { const enc = new TextEncoder(); for (const e of events.splice(0)) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } });
  let joins = 0;
  const f = async (url, init = {}) => {
    const u = String(url);
    calls.push(u.replace(/session_hash=\w+|upload_id=\w+/, '').replace('https://stabilityai-stable-fast-3d.hf.space', ''));
    if (u.includes('/upload')) return json(['/tmp/gradio/abc/photo.jpg']);
    if (u.includes('/queue/join')) { joins++; const body = JSON.parse(init.body); calls.push(`label:${body.data[0]}`); const id = `ev${joins}`; events.push(joins === 2 && failSecond ? { msg: 'process_completed', event_id: id, success: false, output: { error: failSecond } } : { msg: 'process_completed', event_id: id, success: true, output: { data: joins === 1 ? [{ value: 'Run' }, null, null, { value: { url: 'x' } }] : [null, null, null, null, { value: { url: 'https://stabilityai-stable-fast-3d.hf.space/file=/tmp/m.glb' } }] } }); return json({ event_id: id }); }
    if (u.includes('/queue/data')) return { ok: true, status: 200, body: stream() };
    if (u.endsWith('.glb')) return { ok: true, status: 200, arrayBuffer: async () => glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length) };
    return json({}, false, 404);
  };
  return { f, calls, glb };
}

test('a photo becomes a GLB through the two clicks the Space itself makes', async () => {
  const s = fakeSpace();
  const out = await photoToGlb({ bytes: Buffer.alloc(5000), type: 'image/jpeg' }, { fetchImpl: s.f });
  assert.equal(out.slice(0, 4).toString(), 'glTF');
  assert.ok(s.calls.includes('label:Remove Background'));
  assert.ok(s.calls.includes('label:Run'), 'the second click uses the label the Space gave back');
});

test('quota and busy errors are explained in plain words', async () => {
  const s = fakeSpace({ failSecond: 'You have exceeded your GPU quota' });
  await assert.rejects(photoToGlb({ bytes: Buffer.alloc(5000), type: 'image/jpeg' }, { fetchImpl: s.f }), /daily limit/);
  assert.match(friendly('queue is full'), /busy/);
  assert.match(friendly('boom'), /could not make a model/);
});

test('the cache keeps models by key, reads back only its own files, and trims the oldest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-cache-'));
  const c = new ModelCache(dir);
  const k = c.key('https://x/photo.jpg', 'sf3d-v1');
  assert.equal(c.get(k), null);
  const file = c.put(k, Buffer.from('glTF-data'));
  assert.equal(c.get(k).toString(), 'glTF-data');
  assert.equal(c.readInside(file).toString(), 'glTF-data');
  assert.equal(c.readInside('/etc/passwd'), null);
  assert.equal(c.readInside(path.join(dir, '..', 'x.glb')), null);
  c.put('old', Buffer.alloc(1000));
  fs.utimesSync(c.file('old'), new Date(2020, 1, 1), new Date(2020, 1, 1));
  c.trim(500);
  assert.equal(c.get('old'), null, 'the oldest went');
  assert.ok(c.get(k));
});
