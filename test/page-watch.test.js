const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { PageWatcher, parsePageWatchCommand, normalizeUrl, chunksOf, compare } = require('../src/main/pageWatch');
const { Alerts, scoreEvent, textFor } = require('../src/main/proactive');

const page = (...sentences) => `<html><head><style>p{color:red}</style><script>var x="Not part of the page.";</script></head><body>${sentences.map((s) => `<p>${s}</p>`).join('')}</body></html>`;

function rig(bodies, { settle = 0 } = {}) {
  let list = [], clock = 1e9, i = 0; const events = [], seen = [];
  const w = new PageWatcher({ load: () => list, save: (v) => { list = v; }, fetchPage: async (u) => { seen.push(u); const b = typeof bodies === 'function' ? bodies(i++) : bodies[Math.min(i++, bodies.length - 1)]; if (b instanceof Error) throw b; return { status: 200, body: b }; }, onChange: (e) => events.push(e), now: () => clock, sleep: async () => {}, settle });
  return { w, events, seen, advance: (min) => { clock += min * 60000; }, get list() { return list; } };
}

test('web addresses are cleaned up: always https, no logins, no stray words', () => {
  assert.equal(normalizeUrl('example.com/news'), 'https://example.com/news');
  assert.equal(normalizeUrl('http://example.com/a#top'), 'https://example.com/a');
  assert.equal(normalizeUrl('https://user:pw@example.com'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('the lights'), null);
  assert.equal(normalizeUrl('ftp://example.com'), null);
});

test('the text of a page leaves out scripts and styles and splits into sentences', () => {
  const c = chunksOf(page('The new phone costs $999 today.', 'Free shipping on every order.'));
  assert.deepEqual(c, ['The new phone costs $999 today.', 'Free shipping on every order.']);
  assert.deepEqual(chunksOf('<p>hi &amp; ok</p><p>Fish &amp; chips &#33; today</p>'), ['Fish & chips !'], 'entities are decoded, scraps too short to mean anything are dropped');
});

test('the first reading only learns the page; a real change is told once, with what is new', async () => {
  const r = rig([page('The new phone costs $999 today.', 'Free shipping on every order.'), page('The new phone costs $999 today.', 'Free shipping on every order.'),
    page('The new phone costs $899 today.', 'Free shipping on every order.')]);
  assert.equal(r.w.add('example.com/phone').ok, true);
  assert.deepEqual(await r.w.checkDue(), []); assert.deepEqual(r.events, [], 'first look: nothing to compare');
  r.advance(10); assert.deepEqual(await r.w.checkDue(), [], 'due again only after its interval');
  r.advance(30); assert.deepEqual(await r.w.checkDue(), []); assert.deepEqual(r.events, [], 'same page: silent');
  r.advance(30); const told = await r.w.checkDue();
  assert.equal(told.length, 1); assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, 'page'); assert.match(r.events[0].detail, /\$899/); assert.equal(r.events[0].url, 'https://example.com/phone');
  r.advance(30); await r.w.checkDue(); assert.equal(r.events.length, 1, 'the new page is now the baseline: told once');
});

test('a change that is gone on the second read (a rotating banner) is not announced; errors never announce', async () => {
  const base = page('A steady sentence about the page.', 'Another steady sentence here.');
  const r = rig([base, page('A steady sentence about the page.', 'A rotating banner for today only.'), base]);
  r.w.add('example.com');
  await r.w.checkDue(); r.advance(60); await r.w.checkDue();
  assert.deepEqual(r.events, []);
  const bad = rig([base, new Error('offline'), base]);
  bad.w.add('example.com'); await bad.w.checkDue(); bad.advance(60); await bad.w.checkDue();
  assert.deepEqual(bad.events, []); assert.equal(bad.list[0].errors, 1);
});

test('what is kept is fingerprints, not the page; at most ten pages; stopping removes them', async () => {
  const r = rig([page('Secret looking sentence that must not be stored.')]);
  r.w.add('example.com'); await r.w.checkDue();
  assert.ok(!JSON.stringify(r.list).includes('Secret looking'));
  for (let i = 0; i < 9; i++) assert.equal(r.w.add(`site${i}.com`).ok, true);
  assert.equal(r.w.add('one-too-many.com').ok, false);
  assert.equal(r.w.add('example.com').already, true);
  assert.equal(r.w.remove('site3'), 1); assert.equal(r.w.remove('https://example.com'), 1); assert.equal(r.w.remove('all'), 8);
  assert.equal(r.w.list().length, 0);
});

test('the words people use', () => {
  const p = parsePageWatchCommand;
  assert.deepEqual(p('tell me when this page changes'), { type: 'page-watch', target: 'this' });
  assert.deepEqual(p('Jarvis, let me know when example.com/news updates.'), { type: 'page-watch', target: 'https://example.com/news' });
  assert.deepEqual(p('watch https://example.com/sale'), { type: 'page-watch', target: 'https://example.com/sale' });
  assert.deepEqual(p('monitor example.com for changes'), { type: 'page-watch', target: 'https://example.com/' });
  assert.deepEqual(p('stop watching example.com'), { type: 'page-unwatch', what: 'example.com' });
  assert.deepEqual(p('stop watching all pages'), { type: 'page-unwatch', what: 'all' });
  assert.deepEqual(p('what pages are you watching'), { type: 'page-list' });
  for (const no of ['watch youtube.com', 'watch the lights', 'watch a movie', 'tell me when it rains', 'stop watching tv']) assert.equal(p(no)?.type === 'page-watch', false, no);
});

test('a page change is told even without the experimental switch, once, and quietly unless speak-up mode wants it spoken', () => {
  const e = { type: 'page', id: 'a1', title: 'example.com', detail: 'The new phone costs $899 today.' };
  assert.equal(scoreEvent(e), 0.7); assert.match(textFor(e), /example\.com changed: The new phone/);
  const a = new Alerts({ now: () => 1000 });
  assert.equal(a.decide(e, { mode: 'silent-urgent' }).how, 'pill');
  assert.equal(a.decide(e, { mode: 'silent-urgent' }).how, 'drop', 'the same change is not told twice');
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(main, /event\.type !== 'page' && !flagsMod\.isOn/);
  assert.match(main, /pageWatcher\.checkDue\(\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/main/askController.js'), 'utf8'), /parsePageWatchCommand\(effective\)/);
});
