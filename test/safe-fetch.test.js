const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { safeGet, isPrivateAddress } = require('../src/main/safeFetch');

// A fake https.request: replies are looked up by host; every call is recorded, including the address the connection was told to use.
function fakeNet(replies, answers) {
  const log = [], looked = [];
  const lookup = async (host) => { looked.push(host); if (!(host in answers)) throw new Error('ENOTFOUND'); return answers[host]; };
  const request = (options, cb) => {
    const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = (e) => { if (e) req.emit('error', e); };
    req.end = () => {
      const r = replies[options.host]; let pinned = null; options.lookup(options.host, {}, (e, a) => { pinned = a; });
      log.push({ host: options.host, path: options.path, servername: options.servername, hostHeader: options.headers.Host, pinned });
      const res = new EventEmitter(); res.statusCode = r.status; res.headers = r.headers || {};
      cb(res); for (const chunk of r.chunks || [r.body || '']) res.emit('data', Buffer.from(chunk)); res.emit('end');
    };
    return req;
  };
  return { lookup, request, log, looked };
}

test('private, loopback, link-local and other local addresses are recognised, in IPv4 and IPv6, including IPv4 hidden inside IPv6', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '172.31.255.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', 'not-an-ip']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '172.15.0.1', '100.63.0.1', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:93.184.216.34']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('a public feed is fetched, connecting to the verified address while keeping the real name for TLS and the Host header', async () => {
  const n = fakeNet({ 'feeds.example': { status: 200, body: '<rss>Test Feed</rss>' } }, { 'feeds.example': [{ address: '93.184.216.34', family: 4 }] });
  const xml = await safeGet('https://feeds.example/feed.xml?x=1', n);
  assert.match(xml, /Test Feed/);
  assert.deepEqual(n.looked, ['feeds.example'], 'the address was resolved once, by us');
  assert.deepEqual(n.log[0], { host: 'feeds.example', path: '/feed.xml?x=1', servername: 'feeds.example', hostHeader: 'feeds.example', pinned: '93.184.216.34' });
});

test('a name that resolves to a private address is refused, even if another answer is public (rebinding tricks)', async () => {
  const n = fakeNet({ 'evil.example': { status: 200, body: 'x' } }, { 'evil.example': [{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.10', family: 4 }] });
  await assert.rejects(safeGet('https://evil.example/feed', n), /private network/); assert.equal(n.log.length, 0, 'no connection was made');
  for (const bad of ['http://feeds.example/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://user:pw@feeds.example/x']) await assert.rejects(safeGet(bad, fakeNet({}, {})), /not allowed/, bad);
});

test('a redirect to a private address is stopped at the redirect (the target is checked again), and a normal redirect is followed', async () => {
  const hostile = fakeNet({ 'example.com': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } } }, { 'example.com': [{ address: '93.184.216.34', family: 4 }] });
  await assert.rejects(safeGet('https://example.com/feed.xml', hostile), /not allowed/); assert.equal(hostile.log.length, 1, 'only the first request was made');
  const viaName = fakeNet({ 'example.com': { status: 301, headers: { location: 'https://internal.example.com/feed' } }, 'internal.example.com': { status: 200, body: 'secret' } }, { 'example.com': [{ address: '93.184.216.34', family: 4 }], 'internal.example.com': [{ address: '10.0.0.7', family: 4 }] });
  await assert.rejects(safeGet('https://example.com/a', viaName), /private network/); assert.deepEqual(viaName.log.map((l) => l.host), ['example.com']);
  const fine = fakeNet({ 'a.example': { status: 301, headers: { location: '/new' } }, }, { 'a.example': [{ address: '93.184.216.34', family: 4 }] });
  fine.log.length = 0; let calls = 0; const orig = fine.request; fine.request = (o, cb) => { calls++; return orig(o, cb); };
  const loop = fakeNet({ 'a.example': { status: 302, headers: { location: '/again' } } }, { 'a.example': [{ address: '93.184.216.34', family: 4 }] });
  await assert.rejects(safeGet('https://a.example/start', { ...loop, maxRedirects: 3 }), /too many redirects/); assert.equal(loop.log.length, 4);
});

test('errors, oversized answers and empty lookups are reported, not swallowed', async () => {
  const ok = { 'a.example': [{ address: '93.184.216.34', family: 4 }] };
  await assert.rejects(safeGet('https://a.example/x', fakeNet({ 'a.example': { status: 404, body: 'no' } }, ok)), /HTTP 404/);
  await assert.rejects(safeGet('https://a.example/x', { ...fakeNet({ 'a.example': { status: 200, chunks: ['a'.repeat(600), 'b'.repeat(600)] } }, ok), maxBytes: 1000 }), /too large/);
  await assert.rejects(safeGet('https://nowhere.example/x', fakeNet({}, {})), /ENOTFOUND/);
  await assert.rejects(safeGet('https://a.example/x', { lookup: async () => [], request: () => { throw new Error('should not connect'); } }), /could not be resolved/);
});
