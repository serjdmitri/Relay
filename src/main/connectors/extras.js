// Three small read-only connectors (idea from OpenJarvis, which has Hacker News, RSS, Obsidian and GitHub-notification connectors):
//  - news: Hacker News top stories and the RSS/Atom feeds you add (https only, never a local or private address);
//  - GitHub notifications: through the `gh` command line tool you are already signed in to (Relay never sees a token);
//  - Obsidian: find your vault, list recent notes, and load notes for searching (inside your home folder only).
// Everything here reads; nothing posts, sends or writes. Pure logic with the network, the command line and the disk passed in, so it can be tested.

const path = require('path');

const MAX_FEEDS = 8;
const clean = (s, n = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// ---- RSS / Atom ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 8 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENT[e.toLowerCase()] ?? m;
});
const text = (s) => clean(decode(decode(s)).replace(/<[^>]+>/g, ' '), 300);
const tag = (block, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block); return m ? m[1] : ''; };

// xml -> { title, items: [{ title, link, date }] } (at most 30 items)
function parseFeed(xml) {
  const x = String(xml || '').slice(0, 2000000);
  const first = x.search(/<(?:item|entry)[\s>]/i);
  const feedTitle = text(tag(first > 0 ? x.slice(0, first) : x, 'title'));
  const blocks = x.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  const items = blocks.slice(0, 30).map((b) => {
    let link = text(tag(b, 'link'));
    if (!link) { const alt = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(b) || /<link[^>]*href=["']([^"']+)["']/i.exec(b); link = alt ? decode(alt[1]) : ''; }
    return { title: text(tag(b, 'title')), link: /^https?:\/\//i.test(link) ? link : '', date: text(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')) };
  }).filter((i) => i.title);
  return { title: feedTitle, items };
}

// Only public https addresses: never localhost, a private network, or a name that is only meaningful on one.
function isPublicHttps(u) {
  let url; try { url = new URL(String(u)); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const h = url.hostname.toLowerCase();
  if (!h.includes('.') || /\.(?:local|internal|lan|home|localhost|corp)$/.test(h) || h === 'localhost') return false;
  if (/^\[/.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return false; // raw addresses (including private ones) are not accepted at all
  return String(u).length <= 300;
}

async function hackerNews({ json }, n = 8) {
  const ids = (await json('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, n);
  const items = await Promise.all(ids.map((id) => json(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)));
  return items.filter((i) => i && i.title).map((i) => ({ title: clean(i.title), url: i.url || `https://news.ycombinator.com/item?id=${i.id}`, score: i.score || 0, comments: i.descendants || 0 }));
}

async function feedHeadlines(feeds, { text: get }, perFeed = 4) {
  const out = [];
  for (const f of feeds.slice(0, MAX_FEEDS)) {
    try { const p = parseFeed(await get(f)); if (p.items.length) out.push({ source: p.title || new URL(f).hostname, items: p.items.slice(0, perFeed) }); } catch { out.push({ source: new URL(f).hostname, items: [], failed: true }); }
  }
  return out;
}

// ---- GitHub notifications, through `gh` ----
async function githubNotifications({ run }, n = 12) {
  let out;
  try { out = await run('gh', ['api', `notifications?per_page=${n}`, '--jq', '[.[] | {repo: .repository.full_name, title: .subject.title, type: .subject.type, reason: .reason}]']); }
  catch (e) {
    const m = String(e?.message || e);
    if (/ENOENT|not found/i.test(m)) return { error: 'The GitHub command line tool (gh) is not installed. Install it with "brew install gh" and sign in with "gh auth login".' };
    if (/auth|login|401|403/i.test(m)) return { error: 'The GitHub command line tool is not signed in. Run "gh auth login" in Terminal, then ask again.' };
    return { error: `I could not read your GitHub notifications (${clean(m, 80)}).` };
  }
  try { const list = JSON.parse(out); return { items: Array.isArray(list) ? list.map((x) => ({ repo: clean(x.repo, 80), title: clean(x.title, 120), type: clean(x.type, 30), reason: clean(x.reason, 30) })) : [] }; } catch { return { error: 'GitHub returned something I could not read.' }; }
}

// ---- Obsidian ----
// fs: { readdirSync(dir, { withFileTypes }), statSync(p), readFileSync(p, 'utf8'), existsSync(p) }
function findVaults({ fs, home }) {
  const roots = [path.join(home, 'Documents'), path.join(home, 'Desktop'), path.join(home, 'Obsidian'), path.join(home, 'Library/Mobile Documents/iCloud~md~obsidian/Documents'), home];
  const found = [];
  const isVault = (d) => { try { return fs.statSync(path.join(d, '.obsidian')).isDirectory(); } catch { return false; } };
  for (const r of roots) {
    if (isVault(r) && r !== home) found.push(r);
    let kids = []; try { kids = fs.readdirSync(r, { withFileTypes: true }); } catch { continue; }
    for (const k of kids) if (k.isDirectory() && !k.name.startsWith('.') && !/^(?:Library|node_modules|Applications)$/.test(k.name)) { const d = path.join(r, k.name); if (isVault(d)) found.push(d); }
  }
  return [...new Set(found)].slice(0, 5);
}

// The vault must be inside your home folder and really be a vault.
function vaultCheck(vault, { fs, home }) {
  const v = path.resolve(String(vault || ''));
  if (!path.isAbsolute(String(vault || ''))) return 'Give the full path of the vault folder.';
  if (v !== home && !v.startsWith(home + path.sep)) return 'The vault has to be inside your home folder.';
  try { if (!fs.statSync(path.join(v, '.obsidian')).isDirectory()) throw new Error(); } catch { return 'That folder is not an Obsidian vault (it has no .obsidian folder).'; }
  return null;
}

function walkNotes(vault, { fs }, { max = 1500, maxDepth = 6 } = {}) {
  const out = [];
  const go = (dir, depth) => {
    if (out.length >= max || depth > maxDepth) return;
    let kids = []; try { kids = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const k of kids) {
      if (out.length >= max) return;
      if (k.name.startsWith('.') || k.isSymbolicLink?.()) continue;
      const p = path.join(dir, k.name);
      if (k.isDirectory()) go(p, depth + 1);
      else if (/\.md$/i.test(k.name)) { try { const st = fs.statSync(p); if (st.size <= 400000) out.push({ path: p, rel: path.relative(vault, p), mtime: st.mtimeMs }); } catch { /* gone */ } }
    }
  };
  go(vault, 0);
  return out;
}
const recentNotes = (vault, deps, n = 8) => walkNotes(vault, deps).sort((a, b) => b.mtime - a.mtime).slice(0, n);
// For searching: [{ id, title, text, mtime }]
function loadNotes(vault, deps) {
  return walkNotes(vault, deps).map((f) => { let t = ''; try { t = deps.fs.readFileSync(f.path, 'utf8').slice(0, 20000); } catch { /* unreadable */ } return { id: `obsidian:${f.rel}`, title: path.basename(f.rel, path.extname(f.rel)), text: t, mtime: f.mtime }; });
}

// ---- what you can say ----
function parseExtrasCommand(raw) {
  const n = String(raw || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  const l = n.toLowerCase();
  if (/^(?:(?:what(?:'s| is)|whats) (?:on|new on|the top (?:stories )?on)|(?:show me|read me|give me)(?: the)?(?: top)?(?: stories)?(?: (?:on|from))?) ?(?:hacker ?news|hn)(?: front page| top stories| stories)?$|^(?:hacker ?news|hn)(?: top)?(?: stories| headlines)?$/.test(l)) return { type: 'hn' };
  if (/^(?:what(?:'s| is)|whats) in (?:the|my) news$|^(?:my )?news(?: headlines| feeds?)?$|^(?:read|show|check|give me)(?: me)?(?: my| the)? (?:news|headlines|news feeds?|rss feeds?)$/.test(l)) return { type: 'news' };
  let m = /^(?:add|subscribe to|follow)(?: an?)?(?: news| rss| atom)?(?: feed| source)?:? (https?:\/\/\S+)$/i.exec(n);
  if (m && /feed|rss|atom|source/i.test(n.split(m[1])[0])) return { type: 'feed-add', url: m[1] };
  m = /^(?:remove|delete|unsubscribe from|stop following)(?: the)?(?: news| rss| atom)?(?: feed| source)?:? (https?:\/\/\S+)$/i.exec(n);
  if (m) return { type: 'feed-remove', url: m[1] };
  if (/^(?:list|show|which|what)(?: are)?(?: me)?(?: my| the)? (?:news |rss )?(?:feeds|sources)(?: do i follow| am i following)?$/.test(l)) return { type: 'feed-list' };
  if (/^(?:my |check my |read my |what(?:'s| is) in my |any )?github notifications?(?: please)?$|^(?:check|read|show)(?: me)?(?: my)? github(?: inbox| notifications?)$/.test(l)) return { type: 'github' };
  if (/^(?:find|detect|look for|locate) my obsidian(?: vaults?)?$/.test(l)) return { type: 'obsidian-find' };
  m = /^(?:use|set)\s+(\/\S.*?|~\/\S.*?)\s+(?:as|for)\s+my obsidian(?: vault)?$/i.exec(n) || /^set my obsidian vault to\s+(\/\S.*|~\/\S.*)$/i.exec(n);
  if (m) return { type: 'obsidian-use', path: m[1].trim() };
  if (/^(?:my |show my |what are my )?(?:recent|latest|newest) obsidian notes$|^(?:recent|latest) notes in (?:my )?obsidian$/.test(l)) return { type: 'obsidian-recent' };
  return null;
}

const when = (ms) => { const d = Math.round((Date.now() - ms) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };

// deps: { store, json, text, run, fs, home }. Returns { status, reply, actions }.
async function runCommand(c, deps) {
  const { store, home } = deps, done = (reply, actions = 1) => ({ status: 'done', reply, actions }), fail = (reply) => ({ status: 'failed', reply });
  const feeds = () => (Array.isArray(store.get('settings.news.feeds')) ? store.get('settings.news.feeds') : []);
  if (c.type === 'hn') {
    try { const s = await hackerNews(deps, 6); return s.length ? done(`Top on Hacker News: ${s.map((x, i) => `${i + 1}. ${x.title} (${x.score} points, ${x.comments} comments)`).join('; ')}.`) : fail('Hacker News returned nothing.'); } catch { return fail('I could not reach Hacker News.'); }
  }
  if (c.type === 'news') {
    const list = feeds(); if (!list.length) return done('You have not added any news feeds yet. Say "add news feed" followed by the address of the feed, or ask "what\'s on Hacker News".', 0);
    const groups = await feedHeadlines(list, deps);
    const ok = groups.filter((g) => g.items.length);
    return ok.length ? done(ok.map((g) => `${g.source}: ${g.items.map((i, k) => `${k + 1}. ${i.title}`).join('; ')}`).join('. ') + (groups.some((g) => g.failed) ? `. ${groups.filter((g) => g.failed).length} feed(s) could not be read.` : '.')) : fail('None of your feeds could be read right now.');
  }
  if (c.type === 'feed-add') {
    if (!isPublicHttps(c.url)) return fail('Only public https addresses can be feeds (not a local or private address).');
    const list = feeds(); if (list.includes(c.url)) return done('That feed is already in your list.', 0); if (list.length >= MAX_FEEDS) return fail(`You can follow up to ${MAX_FEEDS} feeds. Remove one first.`);
    let p; try { p = parseFeed(await deps.text(c.url)); } catch { return fail('I could not read that address.'); }
    if (!p.items.length) return fail('That address did not look like an RSS or Atom feed, so I did not add it.');
    store.set('settings.news.feeds', [...list, c.url]); return done(`Added ${p.title || new URL(c.url).hostname} (${p.items.length} recent items). Say "my news" to hear the headlines.`);
  }
  if (c.type === 'feed-remove') { const list = feeds(); if (!list.includes(c.url)) return fail('That feed is not in your list.'); store.set('settings.news.feeds', list.filter((u) => u !== c.url)); return done('Removed it from your news feeds.'); }
  if (c.type === 'feed-list') { const l = feeds(); return done(l.length ? `You follow ${l.length} feed${l.length === 1 ? '' : 's'}: ${l.map((u) => new URL(u).hostname).join(', ')}.` : 'You have no news feeds yet.', 0); }
  if (c.type === 'github') {
    const r = await githubNotifications(deps); if (r.error) return fail(r.error);
    return done(r.items.length ? `You have ${r.items.length} GitHub notification${r.items.length === 1 ? '' : 's'}: ${r.items.slice(0, 6).map((x) => `${x.repo}: ${x.title} (${x.reason.replace(/_/g, ' ')})`).join('; ')}.` : 'You have no unread GitHub notifications.');
  }
  if (c.type === 'obsidian-find') {
    const v = findVaults(deps); if (!v.length) return fail('I did not find an Obsidian vault in Documents, Desktop, iCloud or your home folder. Tell me where it is: "use /Users/you/Notes as my Obsidian vault".');
    if (v.length === 1) { store.set('settings.obsidian.vault', v[0]); return done(`Found your vault, ${path.basename(v[0])}, and set it as your Obsidian vault.`); }
    return done(`I found ${v.length} vaults: ${v.map((d) => path.basename(d)).join(', ')}. Tell me which: "use ${v[0]} as my Obsidian vault".`, 0);
  }
  if (c.type === 'obsidian-use') {
    const p = c.path.startsWith('~/') ? path.join(home, c.path.slice(2)) : c.path, why = vaultCheck(p, deps); if (why) return fail(why);
    store.set('settings.obsidian.vault', path.resolve(p)); return done(`Your Obsidian vault is now ${path.basename(p)}.`);
  }
  if (c.type === 'obsidian-recent') {
    const vault = store.get('settings.obsidian.vault'); if (!vault || vaultCheck(vault, deps)) return fail('I do not know your Obsidian vault yet. Say "find my Obsidian vault".');
    const r = recentNotes(vault, deps, 6); return r.length ? done(`Your latest Obsidian notes: ${r.map((n) => `${path.basename(n.rel, '.md')} (${when(n.mtime)})`).join('; ')}.`) : fail('I found no notes in that vault.');
  }
  return fail('I did not understand that.');
}

module.exports = { parseFeed, isPublicHttps, hackerNews, feedHeadlines, githubNotifications, findVaults, vaultCheck, walkNotes, recentNotes, loadNotes, parseExtrasCommand, runCommand, MAX_FEEDS };
