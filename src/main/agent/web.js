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

async function fetchPage(url, fetchImpl = fetch) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs.');
  const res = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 Relay' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return stripHtml(await res.text()).slice(0, 8000);
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
