const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RemoteServer } = require('../src/main/remote/server');
const { Pairing, Devices } = require('../src/main/remote/auth');

async function make() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-lid-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<title>Relay</title>');
  fs.writeFileSync(path.join(root, 'lid.html'), '<title>From your Mac</title>');
  let list = [];
  const control = { ask: async () => 'r', stop() {}, snapshot: () => ({ state: 'idle', label: '', tasks: [], agents: [] }), recent: () => [] };
  const pairing = new Pairing({ code: () => '424242' });
  const devices = new Devices({ list: () => list, save: (l) => { list = l; } });
  const s = new RemoteServer({ control, pairing, devices, root, host: '127.0.0.1', port: 0 });
  await s.start();
  const base = `http://127.0.0.1:${s.port}`;
  pairing.start();
  const { token } = await (await fetch(base + '/api/pair', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify({ code: '424242', name: 'iPhone' }) })).json();
  const get = (p, t = token) => fetch(base + p, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  return { s, base, token, get };
}

const PDF = { kind: 'file', name: 'Report.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4 hello') };

test('with no phone listening nothing is kept or sent', async () => {
  const { s } = await make();
  try {
    assert.deepEqual(s.lidStatus(), { paired: 1, connected: 0 });
    assert.deepEqual(s.deliverLid(PDF), { ok: false, reason: 'phone-offline' });
    assert.deepEqual(s.lid.list(), []);
  } finally { s.stop(); }
});

test('a lid flick reaches the phone on the event stream, and the phone fetches the bytes', async () => {
  const { s, get, token } = await make();
  try {
    const res = await get('/api/events');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let seen = '';
    const read = async (needle) => { while (!seen.includes(needle)) { const { value, done } = await reader.read(); if (done) break; seen += dec.decode(value); } };
    await read('"type":"status"');
    assert.deepEqual(s.lidStatus(), { paired: 1, connected: 1 });
    const r = s.deliverLid(PDF);
    assert.equal(r.ok, true);
    await read('"type":"lid"');
    assert.match(seen, /"name":"Report\.pdf"/);
    assert.match(seen, /"mime":"application\/pdf"/);
    assert.doesNotMatch(seen, /hello/, 'the bytes are not on the stream');

    const list = await (await get('/api/lid')).json();
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].id, r.id);
    const file = await get(`/api/lid/${r.id}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('x-relay-mime'), 'application/pdf');
    assert.equal(decodeURIComponent(file.headers.get('x-relay-name')), 'Report.pdf');
    assert.equal(file.headers.get('content-type'), 'application/octet-stream');
    assert.equal(file.headers.get('content-disposition'), 'attachment');
    assert.equal(await file.text(), '%PDF-1.4 hello');
    await reader.cancel();
  } finally { s.stop(); }
});

test('only a paired phone can list or fetch, and an unknown thing is gone', async () => {
  const { s, get, base } = await make();
  try {
    const stream = await get('/api/events');
    const reader = stream.body.getReader(); await reader.read();
    const r = s.deliverLid(PDF);
    assert.equal((await get('/api/lid', null)).status, 401);
    assert.equal((await get(`/api/lid/${r.id}`, 'wrongtoken')).status, 401);
    assert.equal((await fetch(`${base}/api/lid/${r.id}`)).status, 401);
    assert.equal((await get('/api/lid/00000000-0000-0000-0000-000000000000')).status, 404);
    assert.equal((await get('/api/lid/..%2F..%2Fetc')).status, 404);
    await reader.cancel();
  } finally { s.stop(); }
});

test('the lid page is served, and a web page or script from the Mac is only offered as text', async () => {
  const { s, get, base } = await make();
  try {
    assert.match(await (await fetch(base + '/lid.html')).text(), /From your Mac/);
    const stream = await get('/api/events');
    const reader = stream.body.getReader(); await reader.read();
    const r = s.deliverLid({ kind: 'file', name: 'x.html', mime: 'text/html', bytes: Buffer.from('<script>alert(1)</script>') });
    assert.equal((await get(`/api/lid/${r.id}`)).headers.get('x-relay-mime'), 'text/plain');
    assert.deepEqual(s.deliverLid({ kind: 'file', name: 'empty', mime: 'text/plain', bytes: Buffer.alloc(0) }), { ok: false, reason: 'nothing' });
    await reader.cancel();
  } finally { s.stop(); }
});

test('the service reports no phones listening, and refuses to send, while Relay Remote is off', () => {
  const { RemoteService } = require('../src/main/remote/service');
  const store = { get: (k) => (k === 'remoteDevices' ? [{ id: 'd1', hash: 'h', name: 'iPhone' }] : null), data: {}, save() {} };
  const svc = new RemoteService({ store, ask: {}, broadcast() {} });
  assert.deepEqual(svc.lidStatus(), { paired: 1, connected: 0 });
  assert.deepEqual(svc.deliverLid(PDF), { ok: false, reason: 'remote-off' });
});

test('the helper is built, shipped and signed, and the real phone folder has the lid page', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('scripts/build-speech.sh'), /relay-lid\.swift -o build\/relay-lid/);
  assert.match(read('scripts/pack-mac.sh'), /native\/relay-lid"/);
  assert.match(read('scripts/make-dmg.sh'), /native\/relay-lid"/);
  const res = JSON.parse(read('package.json')).build.extraResources.find((r) => r.from === 'native/build/relay-lid');
  assert.equal(res.to, 'native/relay-lid');
  for (const f of ['lid.html', 'lid.js']) assert.ok(fs.existsSync(path.join(__dirname, '../src/remote', f)), f);
  assert.match(read('src/remote/lid.html'), /<script src="\/lid\.js">/);
  assert.match(read('src/remote/looks.css'), /\.lid-card/);
});
