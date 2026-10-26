// Reference photos of the real thing, for turning into a 3D model. From Wikimedia Commons and Wikipedia (free, with credit), or a
// photo link the model found while researching. Only https photos of the public web are fetched, never an address inside your network.

const { UA, strip, wikiLookup } = require('../cards/lookup');

const MAX_PHOTO = 8 * 1024 * 1024;
const words = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 2);

// How many of a query's words a photo's title (or a page's text) must contain: all of a short one, most of a long one. "Spot robot" must
// not bring back "Spot-breasted Fantail" or a zebra named Spot: one shared word is not the same thing.
const needed = (n) => (n <= 2 ? n : Math.ceil(n * 0.67));

// https only, and not this machine or your own network (no IP addresses, no .local or .internal names, no localhost).
function safePhotoUrl(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== 'https:') return '';
    const h = x.hostname.toLowerCase();
    if (!h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h === 'localhost' || /\.(local|internal|lan|home|corp)$/.test(h)) return '';
    return x.href;
  } catch { return ''; }
}

// Commons photos for some words: the ones whose title matches best, jpeg or png, big enough to see detail.
async function findPhotos(query, { fetchImpl = fetch, n = 3 } = {}) {
  const out = [];
  const q = new URLSearchParams({ action: 'query', generator: 'search', gsrnamespace: '6', gsrsearch: String(query).slice(0, 100), gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '900', format: 'json', formatversion: '2', origin: '*' });
  try {
    const res = await fetchImpl(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const j = await res.json();
      const qw = words(query);
      const scored = [];
      for (const p of j.query?.pages || []) {
        const ii = p.imageinfo?.[0];
        if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime || '') || !ii.thumburl || (ii.width || 0) < 500 || (ii.height || 0) < 400) continue;
        const t = new Set(words(String(p.title).replace(/^File:/, '').replace(/\.\w+$/, '')));
        const hits = qw.filter((w) => t.has(w)).length;
        if (hits < Math.max(1, needed(qw.length))) continue;
        const m = ii.extmetadata || {};
        scored.push({ score: hits / qw.length - t.size * 0.01, photo: { url: ii.thumburl.split('?')[0], title: String(p.title).replace(/^File:/, '').replace(/\.\w+$/, ''), credit: [strip(m.Artist?.value).slice(0, 40), strip(m.LicenseShortName?.value), 'Wikimedia Commons'].filter(Boolean).join(' · '), page: ii.descriptionurl || '' } });
      }
      scored.sort((a, b) => b.score - a.score);
      out.push(...scored.slice(0, n).map((s) => s.photo));
    }
  } catch { /* no Commons photos */ }
  if (out.length < n) { // a Wikipedia page's main picture
    try {
      const w = await wikiLookup(query, { fetchImpl, width: 900 });
      const have = new Set(words(`${w?.title || ''} ${w?.summary || ''}`));
      const qw = words(query);
      if (w?.image?.url && qw.filter((x) => have.has(x)).length >= Math.max(1, needed(qw.length)) && !out.some((p) => p.url === w.image.url)) out.push({ url: w.image.url, title: w.title, credit: 'Wikipedia', page: w.url });
    } catch { /* none */ }
  }
  return out.slice(0, n);
}

// The photo's bytes and type (jpeg, png or webp, up to 8 MB), or null.
async function fetchPhoto(url, { fetchImpl = fetch } = {}) {
  const safe = safePhotoUrl(url);
  if (!safe) return null;
  const res = await fetchImpl(safe, { headers: { 'user-agent': UA, accept: 'image/*' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!res.ok) return null;
  const type = (res.headers?.get?.('content-type') || '').split(';')[0];
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > MAX_PHOTO || buf.length < 2000 ? null : { bytes: buf, type };
}

module.exports = { findPhotos, fetchPhoto, safePhotoUrl, MAX_PHOTO };
