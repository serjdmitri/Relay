const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RemoteService } = require('../src/main/remote/service');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

async function make(settings) {
  const data = { settings: { remote: settings }, remoteDevices: [] };
  const store = { data, get: (k) => (k === 'settings.remote' ? data.settings.remote : k === 'remoteDevices' ? data.remoteDevices : null), set: (k, v) => { if (k.startsWith('settings.remote.')) data.settings.remote[k.split('.')[2]] = v; }, save() {} };
  const asked = [];
  const ask = { remoteAsk: async (t) => { asked.push(t); return 'id1'; }, cancelAll() {}, remoteSnapshot: () => ({ state: 'idle', tasks: [], agents: [] }), remoteRecent: () => [], onStatus: null, onResult: null };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
  fs.writeFileSync(path.join(root, 'index.html'), 'phone page');
  let changed = 0;
  const svc = new RemoteService({ store, ask, broadcast: () => { changed++; }, root });
  return { svc, ask, asked, data, root, changed: () => changed };
}

test('it starts and stops with the setting, and nothing listens while it is off', async () => {
  const port = await freePort();
  const { svc } = await make({ enabled: false, lan: false, port });
  await svc.sync();
  assert.equal(svc.server, null);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
  svc.store.set('settings.remote.enabled', true);
  await svc.sync();
  assert.ok(svc.server);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'phone page');
  svc.store.set('settings.remote.enabled', false);
  await svc.sync();
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
});

test('"only through Tailscale" listens on this Mac only', async () => {
  const port = await freePort();
  const { svc } = await make({ enabled: true, lan: false, port });
  await svc.sync();
  assert.equal(svc.server.host, '127.0.0.1');
  svc.stop();
  svc.store.set('settings.remote.lan', true);
  await svc.sync();
  assert.equal(svc.server.host, '0.0.0.0');
  svc.stop();
});

test('pairing gives a code, addresses and a QR, and a paired phone can ask', async () => {
  const port = await freePort();
  const { svc, asked } = await make({ enabled: true, lan: true, port });
  await svc.sync();
  const p = svc.pair();
  assert.match(p.code, /^\d{6}$/);
  assert.ok(p.urls.every((u) => u.endsWith(`:${port}`)));
  if (p.urls.length) assert.match(p.qr, /^<svg/);
  const paired = await fetch(`http://127.0.0.1:${port}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify({ code: p.code, name: 'Test phone' }) });
  const { token } = await paired.json();
  const r = await fetch(`http://127.0.0.1:${port}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-remote': '1', authorization: `Bearer ${token}` }, body: JSON.stringify({ text: 'open notes' }) });
  assert.equal((await r.json()).id, 'id1');
  assert.deepEqual(asked, ['open notes']);
  assert.deepEqual(svc.info().devices.map((d) => d.name), ['Test phone']);
  svc.stop();
});

test('a port that is already taken is reported, not thrown', async () => {
  const port = await freePort();
  const blocker = net.createServer().listen(port, '0.0.0.0');
  await new Promise((r) => blocker.once('listening', r));
  const { svc } = await make({ enabled: true, lan: true, port });
  await svc.sync();
  assert.equal(svc.server, null);
  assert.match(svc.info().error, /already in use/);
  blocker.close();
});
