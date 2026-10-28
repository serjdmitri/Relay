// Answer cards: a picture, the key facts and links, shown next to the answer. The model fills the words in (show_card);
// Relay finds the picture. Everything is cut to size and links are limited to http(s), because the text comes from a model.

const { wikiLookup, commonsImage, imageData } = require('./lookup');

const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
// A web search for something, in the user's own browser (DuckDuckGo: no account, no tracking).
const searchUrl = (q) => `https://duckduckgo.com/?q=${encodeURIComponent(String(q).slice(0, 150))}`;
const safeUrl = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };

// What the page may show. kind: 'entity' (one thing, with a big picture) or 'list' (a few options, each with a small picture).
function normalizeCard(raw = {}) {
  const kind = raw.kind === 'list' || (Array.isArray(raw.items) && raw.items.length && raw.kind !== 'entity') ? 'list' : 'entity';
  const title = cut(raw.title, 90);
  if (!title) return null;
  const facts = (Array.isArray(raw.facts) ? raw.facts : []).map((f) => ({ label: cut(f?.label, 28), value: cut(f?.value, 90) })).filter((f) => f.label && f.value).slice(0, 6);
  const links = (Array.isArray(raw.links) ? raw.links : []).map((l) => ({ label: cut(l?.label || l?.url, 36), url: safeUrl(l?.url) })).filter((l) => l.url).slice(0, 4);
  const items = (Array.isArray(raw.items) ? raw.items : []).map((i) => ({ title: cut(i?.title, 70), subtitle: cut(i?.subtitle, 70), note: cut(i?.note, 120), url: safeUrl(i?.url), imageQuery: cut(i?.image_query ?? i?.title, 80), image: typeof i?.image_data === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(i.image_data) ? i.image_data : null })).filter((i) => i.title).slice(0, 6);
  return { kind, title, subtitle: cut(raw.subtitle, 100), summary: cut(raw.summary, 420), facts, links, items, imageQuery: cut(raw.image_query || raw.title, 80), image: null, credit: '' };
}

// The card with its pictures found (and the summary filled from Wikipedia when the model left it out). Never throws: a card
// without a picture is still a card.
async function buildCard(raw, { fetchImpl = fetch } = {}) {
  const card = normalizeCard(raw);
  if (!card) return null;
  const guard = (p) => p.catch(() => null);
  if (card.kind === 'entity') {
    const wiki = await guard(wikiLookup(card.imageQuery, { fetchImpl }));
    if (wiki && !card.summary) card.summary = cut(wiki.summary, 420);
    if (wiki?.url && !card.links.some((l) => /wikipedia\.org/.test(l.url))) card.links.unshift({ label: 'Wikipedia', url: wiki.url });
    card.links = card.links.slice(0, 3);
    card.links.push({ label: 'Search the web', url: searchUrl(card.title) }); // always something to follow up on
    let img = wiki?.image || null;
    if (!img) img = await guard(commonsImage(card.imageQuery, { fetchImpl }));
    if (img) { card.image = await guard(imageData(img.url, { fetchImpl })); card.credit = card.image ? img.credit : ''; }
  } else {
    await Promise.all(card.items.map(async (it) => {
      if (it.image || !it.imageQuery) return;
      const wiki = await guard(wikiLookup(it.imageQuery, { fetchImpl, width: 240 }));
      if (wiki?.image) it.image = await guard(imageData(wiki.image.url, { fetchImpl }));
      // every result opens something: the link the model gave, else its Wikipedia page, else a web search for it
      if (!it.url) it.url = wiki?.url || searchUrl(`${it.title} ${card.title}`);
    }));
    for (const it of card.items) if (!it.url) it.url = searchUrl(`${it.title} ${card.title}`);
  }
  return card;
}

module.exports = { normalizeCard, buildCard, safeUrl, searchUrl, cut };
