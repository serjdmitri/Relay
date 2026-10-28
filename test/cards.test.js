const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCard, buildCard, safeUrl } = require('../src/main/cards/card');
const { wikiLookup, commonsImage, imageData } = require('../src/main/cards/lookup');

test('a card is cut to size and its links are limited to http(s)', () => {
  const c = normalizeCard({ title: 'Eiffel Tower', subtitle: 'Paris', summary: 'x'.repeat(900), facts: [{ label: 'Height', value: '330 m' }, { label: '', value: 'no label' }, ...Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, value: 'v' }))], links: [{ label: 'Site', url: 'https://example.com/a' }, { label: 'Bad', url: 'javascript:alert(1)' }, { label: 'File', url: 'file:///etc/passwd' }, { label: 'Plain', url: 'http://example.org' }] });
  assert.equal(c.kind, 'entity');
  assert.equal(c.summary.length, 420);
  assert.equal(c.facts.length, 6);
  assert.deepEqual(c.links.map((l) => l.url), ['https://example.com/a', 'http://example.org/']);
  assert.equal(normalizeCard({ title: '' }), null);
  assert.equal(safeUrl('data:text/html,<b>'), '');
});

test('items make a list card, capped at six', () => {
  const c = normalizeCard({ title: 'Hotels in Boston', items: Array.from({ length: 9 }, (_, i) => ({ title: `Hotel ${i}`, subtitle: '4 stars', url: 'https://h.example/' + i })) });
  assert.equal(c.kind, 'list');
  assert.equal(c.items.length, 6);
  assert.equal(c.items[0].imageQuery, 'Hotel 0');
});

const wikiPage = { query: { pages: [{ title: 'Eiffel Tower', extract: 'The Eiffel Tower is a lattice tower in Paris.', fullurl: 'https://en.wikipedia.org/wiki/Eiffel_Tower', thumbnail: { source: 'https://upload.wikimedia.org/x/eiffel.jpg' } }] } };
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const fakeFetch = (routes) => async (url) => {
  for (const [k, v] of Object.entries(routes)) if (String(url).includes(k)) return typeof v === 'function' ? v(url) : v;
  return { ok: false, status: 404, json: async () => ({}), headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) };
};
const jsonRes = (o) => ({ ok: true, status: 200, json: async () => o });
const imgRes = (type = 'image/jpeg', buf = png) => ({ ok: true, status: 200, headers: { get: () => type }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });

test('Wikipedia gives a summary and a picture; disambiguation pages are skipped', async () => {
  const w = await wikiLookup('Eiffel Tower', { fetchImpl: fakeFetch({ 'en.wikipedia.org': jsonRes(wikiPage) }) });
  assert.equal(w.title, 'Eiffel Tower');
  assert.equal(w.image.url, 'https://upload.wikimedia.org/x/eiffel.jpg');
  const dis = { query: { pages: [{ title: 'Mercury', extract: 'Mercury may refer to:' }] } };
  assert.equal(await wikiLookup('Mercury', { fetchImpl: fakeFetch({ 'en.wikipedia.org': jsonRes(dis) }) }), null);
});

test('Commons gives a photo with its license, and only Wikimedia pictures are downloaded', async () => {
  const commons = { query: { pages: [{ imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://thumb.wikimedia.org/a.jpg', extmetadata: { Artist: { value: '<a href="x">Jane Doe</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] }] } };
  const c = await commonsImage('Boston skyline', { fetchImpl: fakeFetch({ 'commons.wikimedia.org': jsonRes(commons) }) });
  assert.equal(c.credit, 'Jane Doe · CC BY-SA 4.0 · Wikimedia Commons');
  assert.match(await imageData('https://upload.wikimedia.org/x.jpg', { fetchImpl: fakeFetch({ 'wikimedia.org': imgRes() }) }), /^data:image\/jpeg;base64,/);
  assert.equal(await imageData('https://evil.example/x.jpg', { fetchImpl: fakeFetch({ evil: imgRes() }) }), null);
  assert.equal(await imageData('https://upload.wikimedia.org/x.svg', { fetchImpl: fakeFetch({ 'wikimedia.org': imgRes('image/svg+xml') }) }), null);
});

test('an entity card gets its summary, a Wikipedia link and a picture; failures just leave it plain', async () => {
  const f = fakeFetch({ 'en.wikipedia.org': jsonRes(wikiPage), 'upload.wikimedia.org': imgRes() });
  const c = await buildCard({ title: 'Eiffel Tower', facts: [{ label: 'Height', value: '330 m' }] }, { fetchImpl: f });
  assert.match(c.summary, /lattice tower/);
  assert.deepEqual(c.links, [{ label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower' }, { label: 'Search the web', url: 'https://duckduckgo.com/?q=Eiffel%20Tower' }]);
  assert.match(c.image, /^data:image\/jpeg/);
  const none = await buildCard({ title: 'Eiffel Tower', summary: 'Mine.' }, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(none.image, null);
  assert.equal(none.summary, 'Mine.');
});

test('a list card looks up a small picture per item', async () => {
  const f = fakeFetch({ 'en.wikipedia.org': jsonRes(wikiPage), 'upload.wikimedia.org': imgRes() });
  const c = await buildCard({ title: 'Places', items: [{ title: 'Eiffel Tower' }, { title: 'Nothing' }] }, { fetchImpl: f });
  assert.equal(c.kind, 'list');
  assert.ok(c.items[0].image);
});

test('every result in a list opens something: its own link, else Wikipedia, else a web search', async () => {
  const noWiki = fakeFetch({ 'en.wikipedia.org': jsonRes({ query: { pages: [] } }) });
  const c = await buildCard({ title: 'Cafes in Boston', items: [{ title: 'Local Cafe', url: 'https://cafe.example/' }, { title: 'Other Cafe' }] }, { fetchImpl: noWiki });
  assert.equal(c.items[0].url, 'https://cafe.example/');
  assert.equal(c.items[1].url, 'https://duckduckgo.com/?q=Other%20Cafe%20Cafes%20in%20Boston');
  const wiki = await buildCard({ title: 'Places', items: [{ title: 'Eiffel Tower' }] }, { fetchImpl: fakeFetch({ 'en.wikipedia.org': jsonRes(wikiPage), 'upload.wikimedia.org': imgRes() }) });
  assert.equal(wiki.items[0].url, 'https://en.wikipedia.org/wiki/Eiffel_Tower');
  assert.ok(c.items.every((i) => /^https:/.test(i.url)));
});

test('list items keep a picture that was already fetched, and drop anything that is not an image data URL', async () => {
  const { normalizeCard } = require('../src/main/cards/card');
  const c = normalizeCard({ title: 't', items: [{ title: 'a', image_data: 'data:image/jpeg;base64,AAAA' }, { title: 'b', image_data: 'https://evil.example/x.png' }] });
  assert.equal(c.items[0].image, 'data:image/jpeg;base64,AAAA');
  assert.equal(c.items[1].image, null);
});
