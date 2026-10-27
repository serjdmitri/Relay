const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RemoteServer } = require('../src/main/remote/server');
const { Pairing, Devices } = require('../src/main/remote/auth');

async function make() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-remote-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<title>Relay</title>');
  const asked = [];
  let list = [];
  const control = { ask: async (t, d) => { asked.push([t, d.name]); return 'req1'; }, stop() { asked.push('stop'); }, snapshot: () => ({ state: 'idle', label: '', tasks: [], agents: [] }), recent: () => [{ text: 'hi', reply: 'hello', status: 'done', ts: 1 }] };
  const pairing = new Pairing({ code: () => '424242' });
  const devices = new Devices({ list: () => list, save: (l) => { list = l; } });
  const s = new RemoteServer({ control, pairing, devices, root, host: '127.0.0.1', port: 0 });
  await s.start();
  const base = `http://127.0.0.1:${s.port}`;
  const post = (p, body, token) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-remote': '1', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  return { s, base, post, asked, pairing };
}

test('the phone page is served without pairing, everything else is not', async () => {
  const { s, base } = await make();
  assert.match(await (await fetch(base + '/')).text(), /<title>Relay/);
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await fetch(base + '/nope')).status, 404);
  s.stop();
});

test('pairing hands out a token once, and the token works for the API', async () => {
  const { s, base, post, asked, pairing } = await make();
  assert.equal((await post('/api/pair', { code: '424242', name: 'iPhone' })).status, 403, 'no pairing started');
  pairing.start();
  assert.equal((await post('/api/pair', { code: '000000', name: 'iPhone' })).status, 403);
  const ok = await post('/api/pair', { code: '424242', name: "Sergey's iPhone" });
  assert.equal(ok.status, 200);
  const { token } = await ok.json();
  assert.equal((await post('/api/pair', { code: '424242' })).status, 403, 'the code was used up');
  const st = await (await fetch(base + '/api/state', { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(st.state, 'idle');
  assert.equal(st.device, "Sergey's iPhone");
  assert.equal(st.recent[0].reply, 'hello');
  assert.equal((await post('/api/ask', { text: 'open notes' }, token)).status, 200);
  assert.equal((await post('/api/ask', { text: '   ' }, token)).status, 400);
  await post('/api/stop', {}, token);
  assert.deepEqual(asked, [['open notes', "Sergey's iPhone"], 'stop']);
  assert.equal((await post('/api/ask', { text: 'x' }, 'wrongtoken')).status, 401);
  s.stop();
});

test('a request from another website (no custom header) is refused', async () => {
  const { s, base } = await make();
  const r = await fetch(base + '/api/pair', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 400);
  s.stop();
});

test('events stream the current status and what is broadcast', async () => {
  const { s, base, post, pairing } = await make();
  pairing.start();
  const { token } = await (await post('/api/pair', { code: '424242', name: 'p' })).json();
  const res = await fetch(base + '/api/events', { headers: { authorization: `Bearer ${token}` } });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let seen = '';
  const read = async (needle) => { while (!seen.includes(needle)) { const { value, done } = await reader.read(); if (done) break; seen += dec.decode(value); } };
  await read('"type":"status"');
  s.broadcast({ type: 'result', id: 'req1', reply: 'Done.', status: 'done' });
  await read('"type":"result"');
  assert.match(seen, /"reply":"Done\."/);
  await reader.cancel();
  s.stop();
});

test('an ask that waits answers in the same call, for an iPhone Shortcut', async () => {
  const { s, base, post, pairing } = await make();
  // a stand-in Mac that answers a moment after it is asked, using the id the server gave it
  s.control.ask = async (t, d, id) => { setTimeout(() => s.broadcast({ type: 'result', id, reply: `Done: ${t}`, status: 'done' }), 50); return id; };
  pairing.start();
  const { token } = await (await post('/api/pair', { code: '424242', name: 'Siri Shortcut' })).json();
  const r = await post('/api/ask', { text: 'open notes', wait: true }, token);
  const j = await r.json();
  assert.equal(j.reply, 'Done: open notes');
  assert.equal(j.status, 'done');
  // and a Mac that never answers gives a polite message instead of hanging forever
  s.waitMs = 80;
  s.control.ask = async (t, d, id) => id;
  const slow = await (await post('/api/ask', { text: 'x', wait: true }, token)).json();
  assert.equal(slow.status, 'working');
  assert.match(slow.reply, /Still working/);
  assert.equal(s.waiters.size, 0);
  s.stop();
});

test('the holograms on the Mac are listed and their models served, only to a paired phone; the viewer libraries are served by name only', async () => {
  const { tinyGlb } = require('./helpers/glb');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-remote-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<title>Relay</title>');
  let list = [];
  const control = { ask: async () => 'r', stop() {}, snapshot: () => ({ state: 'idle', label: '', tasks: [], agents: [] }), recent: () => [], holos: () => [{ id: 'holo-1234-abcd', title: 'Skull', pinned: false, designed: false }], holoModel: async (id) => (id === 'holo-1234-abcd' ? { bytes: tinyGlb(), mm: true, title: 'Skull & bones' } : null) };
  const pairing = new Pairing({ code: () => '424242' });
  const devices = new Devices({ list: () => list, save: (l) => { list = l; } });
  const s = new RemoteServer({ control, pairing, devices, root, vendor: path.join(__dirname, '../src/renderer/vendor/three'), host: '127.0.0.1', port: 0 });
  await s.start();
  const base = `http://127.0.0.1:${s.port}`;
  try {
    assert.equal((await fetch(`${base}/api/holos`)).status, 401);
    assert.equal((await fetch(`${base}/api/holos/holo-1234-abcd/model`)).status, 401);
    pairing.start();
    const { token } = await (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify({ code: '424242', name: 'iPhone' }) })).json();
    const auth = { authorization: `Bearer ${token}` };
    assert.deepEqual((await (await fetch(`${base}/api/holos`, { headers: auth })).json()).holos.map((h) => h.title), ['Skull']);
    const m = await fetch(`${base}/api/holos/holo-1234-abcd/model`, { headers: auth });
    assert.equal(m.status, 200);
    assert.equal(m.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(m.headers.get('x-relay-mm'), '1');
    assert.equal(decodeURIComponent(m.headers.get('x-relay-title')), 'Skull & bones');
    assert.equal(Buffer.from(await m.arrayBuffer()).slice(0, 4).toString(), 'glTF');
    assert.equal((await fetch(`${base}/api/holos/holo-9999-gone/model`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/api/holos/..%2F..%2Fetc/model`, { headers: auth })).status, 404, 'an id that is not an id');
    assert.equal((await fetch(`${base}/vendor/three.module.min.js`)).status, 200);
    assert.equal((await fetch(`${base}/vendor/STLLoader.js`)).status, 404, 'only the libraries the viewer uses');
    assert.equal((await fetch(`${base}/vendor/../../main/store.js`)).status, 404);
  } finally { s.stop(); }
});

test('a paired phone can read and change the shapes of a designed hologram and tell Relay what to change; nobody else, and nothing off the list', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-remote-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<title>Relay</title>');
  let list = [];
  const got = { cad: null, ask: null };
  const spec = { shapes: [{ id: 's1', name: 'Cube', type: 'box', size: [20, 20, 20], pos: [0, 10, 0], rot: [0, 0, 0], hole: false, color: '#8ec7e6' }] };
  const control = { ask: async () => 'r', stop() {}, snapshot: () => ({ state: 'idle', label: '', tasks: [], agents: [] }), recent: () => [],
    holoCad: async (id) => (id === 'holo-1234-abcd' ? spec : null), setHoloCad: async (id, cad) => { if (id !== 'holo-1234-abcd') return false; got.cad = cad; return true; }, holoAsk: async (id, text) => { if (id !== 'holo-1234-abcd') return null; got.ask = text; return 'req-1'; } };
  const pairing = new Pairing({ code: () => '424242' });
  const devices = new Devices({ list: () => list, save: (l) => { list = l; } });
  const s = new RemoteServer({ control, pairing, devices, root, host: '127.0.0.1', port: 0 });
  await s.start();
  const base = `http://127.0.0.1:${s.port}`;
  try {
    assert.equal((await fetch(`${base}/api/holos/holo-1234-abcd/cad`)).status, 401);
    assert.equal((await fetch(`${base}/api/holos/holo-1234-abcd/ask`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-remote': '1' }, body: '{}' })).status, 401);
    pairing.start();
    const { token } = await (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify({ code: '424242', name: 'iPhone' }) })).json();
    const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-relay-remote': '1' };
    assert.deepEqual((await (await fetch(`${base}/api/holos/holo-1234-abcd/cad`, { headers: h })).json()).cad, spec);
    assert.equal((await fetch(`${base}/api/holos/holo-9999-gone/cad`, { headers: h })).status, 404);
    const changed = { shapes: [{ ...spec.shapes[0], size: [30, 20, 20] }] };
    assert.equal((await fetch(`${base}/api/holos/holo-1234-abcd/cad`, { method: 'POST', headers: h, body: JSON.stringify({ cad: changed }) })).status, 200);
    assert.deepEqual(got.cad, changed);
    assert.equal((await fetch(`${base}/api/holos/holo-1234-abcd/cad`, { method: 'POST', headers: h, body: JSON.stringify({}) })).status, 400);
    assert.equal((await fetch(`${base}/api/holos/holo-1234-abcd/ask`, { method: 'POST', headers: h, body: JSON.stringify({ text: ' make the hole bigger ' }) })).status, 200);
    assert.equal(got.ask, 'make the hole bigger');
    assert.equal((await fetch(`${base}/api/holos/holo-1234-abcd/ask`, { method: 'POST', headers: h, body: JSON.stringify({ text: '  ' }) })).status, 400);
    assert.equal((await fetch(`${base}/api/holos/holo-9999-gone/ask`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'hi' }) })).status, 404);
  } finally { s.stop(); }
});
