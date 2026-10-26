// Pictures and short facts for answer cards, from Wikipedia and Wikimedia Commons (free, no key, with licenses). Relay downloads
// the picture itself and hands the card a data: URL, so the card never contacts the web and nothing about you goes with the request.

const UA = 'Relay/0.15 (https://github.com/serjdmitri/Relay; a voice assistant for Mac)';
const MAX_IMAGE = 2.5 * 1024 * 1024;

const strip = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();

async function getJson(fetchImpl, url, timeoutMs = 6000) {
  const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// The best Wikipedia page for some words: { title, summary, url, image: { url } | null }, or null. Disambiguation pages are skipped.
async function wikiLookup(query, { fetchImpl = fetch, width = 800 } = {}) {
  const q = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: String(query).slice(0, 120), gsrlimit: '1', prop: 'pageimages|extracts|info', piprop: 'thumbnail', pithumbsize: String(width), exintro: '1', explaintext: '1', exsentences: '3', inprop: 'url', format: 'json', formatversion: '2', origin: '*' });
  const j = await getJson(fetchImpl, `https://en.wikipedia.org/w/api.php?${q}`);
  const p = (j.query?.pages || [])[0];
  if (!p || /may (?:also )?refer to/i.test(p.extract || '')) return null;
  // the summary loses its pronunciation notes, "(EYE-fəl; French: …)"
  return { title: p.title, summary: String(p.extract || '').replace(/\s*\((?:[^()]*;[^()]*|[^()]*(?:pronounced|IPA)[^()]*)\)/g, '').trim(), url: p.fullurl || '', image: p.thumbnail?.source ? { url: p.thumbnail.source, credit: 'Wikipedia' } : null };
}

// A photo from Commons for some words, with who took it and under what license: { url, credit } or null.
async function commonsImage(query, { fetchImpl = fetch, width = 800 } = {}) {
  const q = new URLSearchParams({ action: 'query', generator: 'search', gsrnamespace: '6', gsrsearch: String(query).slice(0, 120), gsrlimit: '4', prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: String(width), format: 'json', formatversion: '2', origin: '*' });
  const j = await getJson(fetchImpl, `https://commons.wikimedia.org/w/api.php?${q}`);
  for (const p of j.query?.pages || []) {
    const ii = p.imageinfo?.[0];
    if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime || '') || !ii.thumburl) continue;
    const m = ii.extmetadata || {};
    const who = strip(m.Artist?.value).slice(0, 40);
    const lic = strip(m.LicenseShortName?.value);
    return { url: ii.thumburl, credit: [who, lic, 'Wikimedia Commons'].filter(Boolean).join(' · ') };
  }
  return null;
}

// The picture as a data: URL (jpeg, png or webp, up to 2.5 MB), or null.
async function imageData(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//.test(String(url))) return null; // only pictures from Wikimedia's own servers
  const res = await fetchImpl(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  const type = (res.headers?.get?.('content-type') || '').split(';')[0];
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE) return null;
  return `data:${type};base64,${buf.toString('base64')}`;
}

module.exports = { wikiLookup, commonsImage, imageData, strip, UA };
