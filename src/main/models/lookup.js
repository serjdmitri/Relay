// Real 3D models from Wikimedia Commons (free, with licenses, no key): STL files found with "filetype:3d". Coverage is patchy (mostly
// things people made for 3D printing), so Relay falls back to building a simple model from shapes when nothing fits.

const { UA, strip } = require('../cards/lookup');

const MAX_BYTES = 30 * 1024 * 1024; // up to about 600,000 triangles
const MIN_BYTES = 20 * 1024;

const words = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 2 && !['the', 'and', 'for', 'model', 'models', 'stl', 'file', 'with', 'from', 'show', 'make'].includes(w));

// The best STL for some words, or null. A title has to contain at least one of the words, and what matches more wins; a size
// between 100 KB and 15 MB is preferred (big enough to look like something, small enough to load fast).
// pickModels gives the best few, for "another model" options; pickModel is the best one.
function pickModels(pages, query, n = 4) {
  const q = words(query);
  if (!q.length) return null;
  const scored = [];
  for (const p of pages || []) {
    const ii = p.imageinfo?.[0];
    if (!ii || !/\.stl$/i.test(p.title || '') || !ii.size || ii.size > MAX_BYTES || ii.size < MIN_BYTES || !/^https:\/\/upload\.wikimedia\.org\//.test(ii.url || '')) continue;
    const t = new Set(words(p.title.replace(/^File:/, '').replace(/\.stl$/i, '')));
    const hits = q.filter((w) => t.has(w) || [...t].some((x) => x.startsWith(w) || w.startsWith(x) && x.length > 3)).length;
    if (!hits) continue;
    const ideal = ii.size >= 100 * 1024 && ii.size <= 15 * 1024 * 1024 ? 1 : 0;
    scored.push({ p, ii, score: hits * 10 + ideal * 3 - (t.size - hits) * 0.3 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((best) => {
    const m = best.ii.extmetadata || {};
    const who = strip(m.Artist?.value).slice(0, 40);
    const lic = strip(m.LicenseShortName?.value);
    return { title: best.p.title.replace(/^File:/, '').replace(/\.stl$/i, ''), url: best.ii.url, size: best.ii.size, credit: [who, lic, 'Wikimedia Commons'].filter(Boolean).join(' · '), page: best.ii.descriptionurl || '' };
  });
}

function pickModel(pages, query) {
  return pickModels(pages, query, 1)[0] || null;
}

async function findStls(query, { fetchImpl = fetch, n = 4 } = {}) {
  const q = new URLSearchParams({ action: 'query', generator: 'search', gsrnamespace: '6', gsrsearch: `${String(query).slice(0, 80)} filetype:3d`, gsrlimit: '15', prop: 'imageinfo', iiprop: 'url|size|extmetadata|mime', format: 'json', formatversion: '2', origin: '*' });
  const res = await fetchImpl(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return pickModels(j.query?.pages, query, n);
}

async function findStl(query, opts = {}) {
  return (await findStls(query, { ...opts, n: 1 }))[0] || null;
}

// The file's bytes (a Buffer), only from Wikimedia's own servers and never over the size limit.
async function downloadStl(url, { fetchImpl = fetch } = {}) {
  if (!/^https:\/\/upload\.wikimedia\.org\//.test(String(url))) throw new Error('Not a Wikimedia file.');
  const res = await fetchImpl(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = +(res.headers?.get?.('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('That model is too large.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('That model is too large.');
  return buf;
}

module.exports = { findStl, findStls, downloadStl, pickModel, pickModels, words, MAX_BYTES };
