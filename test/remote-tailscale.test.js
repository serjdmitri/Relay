const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStatus, status, serve } = require('../src/main/remote/tailscale');
const { lanAddresses, qrSvg } = require('../src/main/remote/service');

test('Tailscale status gives this Mac its https address', () => {
  const s = parseStatus({ BackendState: 'Running', Self: { DNSName: 'sergeys-mac.tail1234.ts.net.', TailscaleIPs: ['100.64.0.7'] }, CertDomains: ['sergeys-mac.tail1234.ts.net'] });
  assert.deepEqual(s, { running: true, name: 'sergeys-mac', ips: ['100.64.0.7'], https: 'https://sergeys-mac.tail1234.ts.net', certs: true });
  assert.equal(parseStatus({ BackendState: 'Stopped' }).running, false);
  assert.equal(parseStatus('not json').running, false);
});

test('status and serve work through the CLI, and say so when it is not installed', async () => {
  assert.deepEqual(await status({ find: () => null }), { installed: false });
  const calls = [];
  const exec = async (cli, args) => { calls.push(args.join(' ')); return { ok: true, out: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'm.t.ts.net.' } }), err: '' }; };
  assert.equal((await status({ find: () => '/x/tailscale', exec })).https, 'https://m.t.ts.net');
  assert.deepEqual(await serve(47900, { find: () => '/x/tailscale', exec }), { ok: true });
  assert.deepEqual(calls, ['status --json', 'serve --bg 47900']);
  assert.match((await serve(1, { find: () => null })).error, /not installed/);
  const bad = async () => ({ ok: false, out: '', err: 'HTTPS not enabled' });
  assert.match((await serve(1, { find: () => '/x', exec: bad })).error, /HTTPS not enabled/);
});

test('LAN addresses skip loopback and link-local, and the QR is an SVG', () => {
  const nets = { lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.1.20', internal: false }], en1: [{ family: 'IPv4', address: '169.254.3.3', internal: false }] };
  assert.deepEqual(lanAddresses(nets), ['192.168.1.20']);
  assert.match(qrSvg('http://192.168.1.20:47900/?code=123456'), /^<svg/);
});
