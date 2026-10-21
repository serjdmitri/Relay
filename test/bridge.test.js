const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { FirefoxBridge } = require('../src/main/firefoxBridge');

const connect = (port, origin) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
  ws.on('open', () => resolve(ws));
  ws.on('error', reject);
  ws.on('unexpected-response', (_, res) => reject(new Error('rejected ' + res.statusCode)));
});

test('bridge accepts the extension origin only and round-trips calls', async () => {
  const bridge = new FirefoxBridge({ port: 47999 });
  bridge.start();
  try {
    await assert.rejects(() => connect(47999, 'https://evil.example'), /rejected 401|rejected 403/);
    await assert.rejects(() => bridge.call('tabs.list', {}), /not connected/);

    const ws = await connect(47999, 'moz-extension://abc-123');
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      ws.send(JSON.stringify({ id: m.id, result: [{ id: 1, title: m.method }] }));
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(bridge.isConnected(), true);
    assert.deepEqual(await bridge.call('tabs.list', {}), [{ id: 1, title: 'tabs.list' }]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(bridge.isConnected(), false);
  } finally {
    bridge.stop();
  }
});

test('pending calls reject on disconnect and on error replies', async () => {
  const bridge = new FirefoxBridge({ port: 47998 });
  bridge.start();
  try {
    const ws = await connect(47998, 'moz-extension://x');
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.method === 'bad') ws.send(JSON.stringify({ id: m.id, error: 'no such tab' })); else ws.close(); });
    await new Promise((r) => setTimeout(r, 50));
    await assert.rejects(() => bridge.call('bad', {}), /no such tab/);
    await assert.rejects(() => bridge.call('x', {}), /disconnected/);
  } finally {
    bridge.stop();
  }
});
