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
