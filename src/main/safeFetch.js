// A web read that cannot be turned against your own network (server-side request forgery). Like OpenJarvis's RSS fetcher it:
//  1. only accepts public https addresses;
//  2. looks up the host's address itself and refuses it if ANY answer is private (loopback, 10.x, 192.168.x, 172.16-31.x, link-local such as 169.254.169.254, carrier-grade NAT, IPv6 local);
//  3. connects to the address it just verified (so a name that changes its answer between the check and the connection, "DNS rebinding", cannot redirect it), keeping the real name for TLS;
//  4. follows redirects by hand, and runs every step again for each new address; and caps time and size.
// The network pieces (lookup, request) are passed in so it can be tested.

const net = require('net');
const dns = require('dns');
const https = require('https');
const { isPublicHttps } = require('./connectors/extras');

function isPrivateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function isPrivateAddress(ip) {
  const v = net.isIP(String(ip));
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s); if (mapped) return isPrivateV4(mapped[1]);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
    if (mappedHex) { const n = (parseInt(mappedHex[1], 16) << 16) | parseInt(mappedHex[2], 16); return isPrivateV4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')); }
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || /^2001:db8/.test(s);
  }
  return true; // not an address at all: refuse
}

const defaultLookup = (host) => new Promise((resolve, reject) => dns.lookup(host, { all: true }, (e, list) => (e ? reject(e) : resolve(list))));

function once(request, options, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = request(options, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(); reject(new Error('response too large')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers || {}, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout?.(timeoutMs, () => { req.destroy(new Error('timed out')); });
    req.end();
  });
}

async function safeGet(url, { maxRedirects = 3, timeoutMs = 15000, maxBytes = 2000000, lookup = defaultLookup, request = https.request } = {}) {
  let current = String(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isPublicHttps(current)) throw new Error('That address is not allowed (only public https addresses).');
    const u = new URL(current);
    const answers = await lookup(u.hostname);
    if (!Array.isArray(answers) || !answers.length) throw new Error('That address could not be resolved.');
    if (answers.some((a) => isPrivateAddress(a.address))) throw new Error('That address is not allowed (it points to a private network).');
    const pick = answers[0];
    const res = await once(request, {
      host: u.hostname, port: u.port || 443, path: `${u.pathname}${u.search}`, method: 'GET', servername: u.hostname,
      headers: { Host: u.host, 'User-Agent': 'Relay', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      // connect to the address that was just checked, not to whatever the name says a moment later
      lookup: (host, opts, cb) => (opts && opts.all ? cb(null, [{ address: pick.address, family: pick.family || net.isIP(pick.address) }]) : cb(null, pick.address, pick.family || net.isIP(pick.address)))
    }, maxBytes, timeoutMs);
    if (res.status >= 300 && res.status < 400 && res.headers.location) { current = new URL(res.headers.location, current).toString(); continue; }
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return res.body;
  }
  throw new Error('too many redirects');
}

module.exports = { safeGet, isPrivateAddress };
