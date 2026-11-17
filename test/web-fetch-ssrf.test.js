// Found by the full audit: fetch_page read any http(s) address, including this Mac, the home network and cloud metadata, and followed any redirect there.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchPage } = require('../src/main/agent/web');
const { isPrivateAddress } = require('../src/main/safeFetch');

const page = (body, status = 200, location = '') => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => (k === 'location' ? location || null : null) }, text: async () => body });
const dnsOf = (map) => async (host) => (map[host] || []).map((address) => ({ address }));

test('a page on this Mac or the home network is refused before any request is made', async () => {
  const asked = [];
  const f = async (u) => { asked.push(u); return page('<p>secret</p>'); };
  for (const url of ['http://127.0.0.1:47900/api/state', 'http://localhost/', 'http://192.168.1.1/admin', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://router.home/'])
    await assert.rejects(fetchPage(url, f, { lookup: dnsOf({ localhost: ['127.0.0.1'], 'router.home': ['10.0.0.1'] }) }), /this Mac or your own network/, url);
  assert.deepEqual(asked, []);
});

test('a public page is read, and a redirect to a private address is refused at that hop', async () => {
  const lookup = dnsOf({ 'example.com': ['93.184.216.34'], 'evil.example': ['93.184.216.35'], 'inside.example': ['192.168.0.5'] });
  assert.equal(await fetchPage('https://example.com/', async () => page('<h1>Hello</h1> world'), { lookup }), 'Hello world');
  const asked = [];
  const f = async (u) => { asked.push(u); return u.startsWith('https://evil.example') ? page('', 302, 'http://inside.example/admin') : page('<p>secret</p>'); };
  await assert.rejects(fetchPage('https://evil.example/go', f, { lookup }), /own network/);
  assert.deepEqual(asked, ['https://evil.example/go'], 'the private page itself was never requested');
  assert.equal(await fetchPage('https://evil.example/a', async (u) => (u.endsWith('/a') ? page('', 301, '/b') : page('moved here')), { lookup }), 'moved here', 'relative redirects still work');
});

test('IPv6 forms that carry an IPv4 address inside count as private', () => {
  for (const ip of ['64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2001:0:4136:e378::1', '::1', 'fe80::1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['2606:4700::1111', '93.184.216.34']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('read_file follows the real path: a link inside a dropped folder cannot lead out of it', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { readDropped } = require('../src/main/agent/files');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-drop-'));
  try {
    const dropped = path.join(root, 'project'); const outside = path.join(root, 'secret.txt');
    fs.mkdirSync(dropped); fs.writeFileSync(outside, 'PRIVATE KEY'); fs.writeFileSync(path.join(dropped, 'readme.txt'), 'hello');
    fs.symlinkSync(outside, path.join(dropped, 'notes.txt'));
    assert.match((await readDropped(path.join(dropped, 'readme.txt'), [dropped])).text, /hello/);
    await assert.rejects(readDropped(path.join(dropped, 'notes.txt'), [dropped]), /not given to Relay/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
