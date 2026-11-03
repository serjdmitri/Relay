const test = require('node:test');
const assert = require('node:assert/strict');
const x = require('../src/main/connectors/extras');

const RSS = `<?xml version="1.0"?><rss><channel><title>Daily &amp; Co</title>
<item><title><![CDATA[First &quot;story&quot;]]></title><link>https://ex.com/1</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Second <b>story</b> &#8212; more</title><link>https://ex.com/2</link></item>
<item><title></title><link>https://ex.com/3</link></item></channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Blog</title><entry><title>Hello</title><link rel="alternate" href="https://a.example/x"/><updated>2026-11-01T00:00:00Z</updated></entry></feed>`;

test('RSS and Atom are read: titles decoded, tags stripped, links kept only when they are web links, empty items dropped', () => {
  const r = x.parseFeed(RSS);
  assert.equal(r.title, 'Daily & Co');
  assert.deepEqual(r.items.map((i) => i.title), ['First "story"', 'Second story — more']);
  assert.equal(r.items[0].link, 'https://ex.com/1'); assert.match(r.items[0].date, /Nov 2026/);
  const a = x.parseFeed(ATOM); assert.deepEqual([a.title, a.items[0].title, a.items[0].link], ['Atom Blog', 'Hello', 'https://a.example/x']);
  assert.equal(x.parseFeed('<rss><channel><item><title>t</title><link>javascript:alert(1)</link></item></channel></rss>').items[0].link, '');
  assert.deepEqual(x.parseFeed('not xml at all').items, []);
});

test('only public https addresses can be feeds: no http, no local or private names, no raw addresses, no logins in the address', () => {
  assert.equal(x.isPublicHttps('https://news.example.com/feed.xml'), true);
  for (const bad of ['http://news.example.com/feed', 'https://localhost/feed', 'https://127.0.0.1/feed', 'https://192.168.1.5/feed', 'https://[::1]/feed', 'https://router.local/feed', 'https://intranet/feed', 'https://user:pw@news.example.com/feed', 'file:///etc/passwd', 'nonsense']) assert.equal(x.isPublicHttps(bad), false, bad);
});

test('Hacker News stories come back with scores, tolerate a failed item, and the command speaks them', async () => {
  const json = async (u) => {
    if (/topstories/.test(u)) return [1, 2, 3];
    if (/item\/2/.test(u)) throw new Error('down');
    const id = Number(/item\/(\d+)/.exec(u)[1]); return { id, title: `Story ${id}`, score: id * 10, descendants: id, url: id === 1 ? 'https://x.example/1' : undefined };
  };
  const s = await x.hackerNews({ json }, 3);
  assert.deepEqual(s.map((i) => [i.title, i.url]), [['Story 1', 'https://x.example/1'], ['Story 3', 'https://news.ycombinator.com/item?id=3']]);
  const r = await x.runCommand({ type: 'hn' }, { json, store: {}, home: '/h' });
  assert.match(r.reply, /Top on Hacker News: 1\. Story 1 \(10 points, 1 comments\); 2\. Story 3/);
  assert.equal((await x.runCommand({ type: 'hn' }, { json: async () => { throw new Error('x'); }, store: {}, home: '/h' })).status, 'failed');
});

function store(init = {}) { const d = { ...init }; return { get: (k) => d[k], set: (k, v) => { d[k] = v; }, d }; }

test('news feeds: add (checked to be real feeds), list, read, remove, with limits', async () => {
  const st = store(); const text = async (u) => (/atom/.test(u) ? ATOM : /bad/.test(u) ? '<html>not a feed</html>' : RSS);
  const deps = { store: st, text, json: async () => [], home: '/h' };
  assert.match((await x.runCommand({ type: 'news' }, deps)).reply, /not added any news feeds/);
  assert.match((await x.runCommand({ type: 'feed-add', url: 'https://a.example/rss' }, deps)).reply, /Added Daily & Co \(2 recent items\)/);
  assert.equal((await x.runCommand({ type: 'feed-add', url: 'https://bad.example/rss' }, deps)).status, 'failed');
  assert.match((await x.runCommand({ type: 'feed-add', url: 'http://a.example/rss' }, deps)).reply, /public https/);
  assert.match((await x.runCommand({ type: 'feed-add', url: 'https://a.example/rss' }, deps)).reply, /already/);
  await x.runCommand({ type: 'feed-add', url: 'https://atom.example/feed' }, deps);
  const news = await x.runCommand({ type: 'news' }, deps);
  assert.match(news.reply, /Daily & Co: 1\. First "story"; 2\. Second story — more\. Atom Blog: 1\. Hello/);
  assert.match((await x.runCommand({ type: 'feed-list' }, deps)).reply, /2 feeds: a\.example, atom\.example/);
  await x.runCommand({ type: 'feed-remove', url: 'https://a.example/rss' }, deps); assert.deepEqual(st.d['settings.news.feeds'], ['https://atom.example/feed']);
  for (let i = 0; i < 8; i++) st.d['settings.news.feeds'] = [...st.d['settings.news.feeds'], `https://f${i}.example/rss`];
  assert.match((await x.runCommand({ type: 'feed-add', url: 'https://one-more.example/rss' }, deps)).reply, /up to 8/);
  const broken = await x.runCommand({ type: 'news' }, { ...deps, text: async () => { throw new Error('offline'); } });
  assert.equal(broken.status, 'failed');
});

test('GitHub notifications come through gh, and the problems people actually hit are explained', async () => {
  const ok = { run: async (cmd, args) => { assert.equal(cmd, 'gh'); assert.match(args.join(' '), /^api notifications\?per_page=12/); return JSON.stringify([{ repo: 'o/r', title: 'Fix bug', type: 'PullRequest', reason: 'review_requested' }]); } };
  assert.match((await x.runCommand({ type: 'github' }, { ...ok, store: {}, home: '/h' })).reply, /1 GitHub notification: o\/r: Fix bug \(review requested\)/);
  assert.match((await x.runCommand({ type: 'github' }, { run: async () => '[]', store: {}, home: '/h' })).reply, /no unread/);
  assert.match((await x.githubNotifications({ run: async () => { throw new Error('spawn gh ENOENT'); } })).error, /brew install gh/);
  assert.match((await x.githubNotifications({ run: async () => { throw new Error('To get started with GitHub CLI, please run: gh auth login'); } })).error, /not signed in/);
  assert.match((await x.githubNotifications({ run: async () => 'garbage' })).error, /could not read/);
});

function fakeFs(tree) { // tree: { '/h/Notes': { '.obsidian': {}, 'a.md': 5, sub: { 'b.md': 9 } } }
  const node = (p) => { let n = tree; for (const part of p.split('/').filter(Boolean)) { n = n && typeof n === 'object' ? n[part] : undefined; } return n; };
  const stat = (p) => { const n = node(p); if (n === undefined) throw new Error('ENOENT'); const isDir = typeof n === 'object'; return { isDirectory: () => isDir, size: isDir ? 0 : 100, mtimeMs: isDir ? 0 : n * 86400000 + 1e12 }; };
  return {
    statSync: stat, existsSync: (p) => node(p) !== undefined, readFileSync: (p) => `text of ${p}`,
    readdirSync: (p) => { const n = node(p); if (!n || typeof n !== 'object') throw new Error('ENOTDIR'); return Object.keys(n).map((k) => ({ name: k, isDirectory: () => typeof n[k] === 'object', isSymbolicLink: () => false })); }
  };
}
const HOME = '/h';
const TREE = { h: { Documents: { Notes: { '.obsidian': {}, 'a.md': 5, sub: { 'b.md': 9, 'c.txt': 1 } }, Other: { 'x.md': 1 } }, Desktop: {} } };

test('Obsidian: a vault is found, accepted only inside your home folder, and its recent notes are listed newest first', async () => {
  const fs = fakeFs(TREE), st = store();
  assert.deepEqual(x.findVaults({ fs, home: HOME }), ['/h/Documents/Notes']);
  const found = await x.runCommand({ type: 'obsidian-find' }, { fs, home: HOME, store: st });
  assert.match(found.reply, /Found your vault, Notes/); assert.equal(st.d['settings.obsidian.vault'], '/h/Documents/Notes');
  const recent = await x.runCommand({ type: 'obsidian-recent' }, { fs, home: HOME, store: st });
  assert.match(recent.reply, /^Your latest Obsidian notes: b \(/); assert.ok(recent.reply.indexOf('b (') < recent.reply.indexOf('a ('));
  assert.equal(x.recentNotes('/h/Documents/Notes', { fs }).some((n) => /c\.txt/.test(n.path)), false, 'only .md files');
  assert.match(x.vaultCheck('/etc', { fs, home: HOME }), /inside your home folder/); assert.match(x.vaultCheck('/h/Documents/Other', { fs, home: HOME }), /not an Obsidian vault/); assert.match(x.vaultCheck('relative', { fs, home: HOME }), /full path/);
  assert.match((await x.runCommand({ type: 'obsidian-use', path: '/h/Documents/Other' }, { fs, home: HOME, store: store() })).reply, /not an Obsidian vault/);
  assert.match((await x.runCommand({ type: 'obsidian-use', path: '~/Documents/Notes' }, { fs, home: HOME, store: st })).reply, /now Notes/);
  assert.match((await x.runCommand({ type: 'obsidian-recent' }, { fs, home: HOME, store: store() })).reply, /do not know your Obsidian vault/);
  const notes = x.loadNotes('/h/Documents/Notes', { fs });
  assert.deepEqual(notes.map((n) => n.id).sort(), ['obsidian:a.md', 'obsidian:sub/b.md']); assert.match(notes[0].text, /text of/);
});

test('what you say is understood, and similar everyday talk is left alone', () => {
  const ok = [
    ["what's on Hacker News", 'hn'], ['hacker news top stories', 'hn'], ['my news', 'news'], ['read me the headlines', 'news'], ["what's in the news", 'news'],
    ['add news feed https://a.example/rss', 'feed-add'], ['follow rss feed https://a.example/rss', 'feed-add'], ['remove news feed https://a.example/rss', 'feed-remove'], ['list my news feeds', 'feed-list'],
    ['my github notifications', 'github'], ['check my github notifications', 'github'], ['find my obsidian vault', 'obsidian-find'], ['use ~/Documents/Notes as my obsidian vault', 'obsidian-use'], ['my recent obsidian notes', 'obsidian-recent']
  ];
  for (const [t, type] of ok) assert.equal(x.parseExtrasCommand(t)?.type, type, t);
  assert.equal(x.parseExtrasCommand('use /Users/me/Notes as my obsidian vault').path, '/Users/me/Notes');
  for (const t of ['add https://example.com to my reading list', 'what is hacker news', 'tell me the news about the election', 'open obsidian', 'check my email', '']) assert.equal(x.parseExtrasCommand(t), null, t);
});
