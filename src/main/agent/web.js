// Lightweight web access for "answer from the web" requests. Best effort: no API key needed.

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const defaultLookup = (host) => new Promise((resolve, reject) => require('dns').lookup(host, { all: true }, (e, list) => (e ? reject(e) : resolve(list))));

// A page the model asked for must not be on this Mac or your own network (the router, other devices, Relay's own local servers, 169.254.169.254):
// what comes back goes into the model's context. Found by the audit: any http(s) address and any redirect was followed.
async function publicAddress(url, lookup) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs.');
  const { isPrivateAddress } = require('../safeFetch');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const answers = require('net').isIP(host) ? [{ address: host }] : await lookup(host).catch(() => { throw new Error('That address could not be found.'); });
  if (!answers?.length || answers.some((a) => isPrivateAddress(a.address))) throw new Error('That page is on this Mac or your own network, so Relay will not read it this way.');
}

async function fetchPage(url, fetchImpl = fetch, { lookup = defaultLookup, maxRedirects = 5 } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs.');
  let current = String(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await publicAddress(current, lookup);
    const res = await fetchImpl(current, { headers: { 'user-agent': 'Mozilla/5.0 Relay' }, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers?.get?.('location')) { current = new URL(res.headers.get('location'), current).toString(); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return stripHtml(await res.text()).slice(0, 8000);
  }
  throw new Error('That page redirected too many times.');
}

async function search(query, fetchImpl = fetch) {
  const res = await fetchImpl('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
    headers: { 'user-agent': 'Mozilla/5.0 Relay' }
  });
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
  const html = await res.text();
  const results = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && results.length < 6) {
    let href = m[1];
    const u = href.match(/uddg=([^&]+)/);
    if (u) href = decodeURIComponent(u[1]);
    results.push(`${stripHtml(m[2])}\n${href}\n${stripHtml(m[3])}`);
  }
  return results.length ? results.join('\n\n') : 'No results found.';
}

module.exports = { fetchPage, search, stripHtml };
