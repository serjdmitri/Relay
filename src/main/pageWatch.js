// "Tell me when this page changes." Relay re-reads a page you chose every so often, and when its text really changed it tells you (through the
// speak-up system, proactive.js), quoting what is new. Only public https pages (fetched by safeFetch), only pages you asked for.
//
// What is kept is a short list of fingerprints of the page's sentences, never the page itself, so nothing readable about it is stored. A change is
// only announced when it is still there on a second read a moment later, so a rotating banner or a half-loaded page is not a change.
//   settings: { pages: [{ id, url, label, everyMin, lastCheck, fp: [hash...], errors }] } (kept by the caller)

const crypto = require('crypto');

const MAX_WATCHES = 10;
const MAX_FP = 600;
const MIN_EVERY = 5;

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

// A web address from what was said ("example.com/news", "https://x.org/a"), or null. Always https, never an address with a login in it.
function normalizeUrl(s) {
  let t = String(s || '').trim().replace(/[.,!?;]+$/, '').replace(/^<|>$/g, '');
  if (!t || /\s/.test(t)) return null;
  if (!/^https?:\/\//i.test(t)) { if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t)) return null; t = 'https://' + t; }
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    u.protocol = 'https:'; u.hash = '';
    return u.toString();
  } catch { return null; }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// The readable text of a page, as separate sentences or lines (no script, no style, no tags).
function chunksOf(html) {
  const text = String(html || '')
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br|ul|ol|table)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => { if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 31 && n < 65536 ? String.fromCharCode(n) : ' '; } return ENT[e.toLowerCase()] ?? ' '; });
  const out = [];
  for (const line of text.split('\n')) {
    for (const part of line.split(/(?<=[.!?])\s+/)) {
      const c = part.replace(/\s+/g, ' ').trim();
      if (c.length >= 8) out.push(c.slice(0, 300));
    }
  }
  return [...new Set(out)].slice(0, 4000);
}

// What is new and what is gone between two readings (by fingerprint), with the new text quoted. fp: the old fingerprints.
function compare(oldFp, chunks) {
  const old = new Set(oldFp || []);
  const now = chunks.map((c) => ({ c, h: hash(c) }));
  const nowSet = new Set(now.map((x) => x.h));
  const added = now.filter((x) => !old.has(x.h));
  const removed = [...old].filter((h) => !nowSet.has(h)).length;
  return { added, removed, changed: added.length + removed > 0, fp: now.map((x) => x.h).slice(0, MAX_FP) };
}

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

class PageWatcher {
  // load(): the saved list; save(list); fetchPage(url) -> { status, body } (safeGet); onChange(event)
  constructor({ load = () => [], save = () => {}, fetchPage, onChange = () => {}, now = Date.now, sleep = sleepReal, settle = 20000 } = {}) {
    Object.assign(this, { load, save, fetchPage, onChange, now, sleep, settle });
    this.busy = false;
  }

  list() { return (this.load() || []).map((w) => ({ id: w.id, url: w.url, label: w.label, everyMin: w.everyMin })); }

  add(url, label = '', everyMin = 30) {
    const u = normalizeUrl(url);
    if (!u) return { ok: false, error: 'That does not look like a web address. Say it like example.com/news.' };
    const all = this.load() || [];
    if (all.some((w) => w.url === u)) return { ok: true, already: true, url: u };
    if (all.length >= MAX_WATCHES) return { ok: false, error: `I can watch ${MAX_WATCHES} pages. Stop watching one first.` };
    const host = new URL(u).hostname.replace(/^www\./, '');
    all.push({ id: hash(u + this.now()), url: u, label: String(label || host).slice(0, 60), everyMin: Math.max(MIN_EVERY, Math.round(everyMin)), lastCheck: 0, fp: null, errors: 0 });
    this.save(all);
    return { ok: true, url: u, label: all[all.length - 1].label };
  }

  // what: a web address, a word in the label or address, or 'all'. -> how many were removed
  remove(what) {
    const all = this.load() || [];
    const w = String(what || '').trim().toLowerCase();
    const u = normalizeUrl(what);
    const keep = all.filter((x) => !(w === 'all' || (u && x.url === u) || (w.length >= 3 && (x.label.toLowerCase().includes(w) || x.url.toLowerCase().includes(w)))));
    this.save(keep);
    return all.length - keep.length;
  }

  async read(url) {
    const r = await this.fetchPage(url);
    if (!r || r.status < 200 || r.status >= 300) throw new Error(`status ${r?.status}`);
    return chunksOf(r.body);
  }

  // Check every page that is due. Announces a change once, and only if it is still there on a second read.
  async checkDue() {
    if (this.busy) return [];
    this.busy = true;
    const told = [];
    try {
      const all = this.load() || [];
      let dirty = false;
      for (const w of all) {
        if (this.now() - (w.lastCheck || 0) < w.everyMin * 60000) continue;
        w.lastCheck = this.now(); dirty = true;
        try {
          const chunks = await this.read(w.url);
          w.errors = 0;
          if (!w.fp) { w.fp = chunks.map(hash).slice(0, MAX_FP); continue; } // the first reading only learns the page
          let c = compare(w.fp, chunks);
          if (!c.changed) continue;
          await this.sleep(this.settle);
          const again = await this.read(w.url);
          const c2 = compare(w.fp, again);
          const stable = compare(c.fp, again).changed === false; // the second read matches the first new one
          if (!c2.changed || !stable) continue;
          c = c2;
          w.fp = c.fp;
          const quote = c.added.slice(0, 2).map((x) => x.c.slice(0, 90)).join(' / ');
          const event = { type: 'page', id: `${w.id}:${c.fp.length ? c.fp[0] : '0'}${c.added.length}${c.removed}`, title: w.label, detail: quote, url: w.url, added: c.added.length, removed: c.removed };
          told.push(event);
          this.onChange(event);
        } catch { w.errors = (w.errors || 0) + 1; }
      }
      if (dirty) this.save(all);
    } finally { this.busy = false; }
    return told;
  }
}

// The words: "tell me when this page changes", "watch example.com/news", "stop watching example.com", "stop watching all pages", "what pages are you watching".
function parsePageWatchCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ');
  const l = n.toLowerCase();
  if (/^(?:what|which) pages (?:are you|am i) (?:watching|tracking|monitoring)$|^(?:list|show) (?:the )?(?:watched|tracked) pages$/.test(l)) return { type: 'page-list' };
  let m = /^(?:stop|quit) (?:watching|tracking|monitoring) (?:the )?(.+?)(?: page)?$/i.exec(n) || /^(?:unwatch|untrack) (.+)$/i.exec(n);
  if (m) { const what = m[1].trim(); return /^(?:all(?: the)?(?: pages)?|everything)$/i.test(what) ? { type: 'page-unwatch', what: 'all' } : /^(?:this|that|the current)$/i.test(what) ? { type: 'page-unwatch', what: 'this' } : { type: 'page-unwatch', what }; }
  m = /^(?:tell me|let me know|notify me|alert me|ping me) (?:when|if|whenever) (?:the )?(.+?) (?:page )?(?:changes|updates|is updated|gets updated|has changed|changed)$/i.exec(n)
    || /^(?:watch|track|monitor) (?:the )?(.+?)(?: page)? for changes$/i.exec(n)
    || /^(?:watch|track|monitor) (https:\/\/\S+)$/i.exec(n); // a bare "watch youtube.com" is not taken for this: it needs "for changes" or a full https address
  if (m) {
    const what = m[1].trim();
    if (/^(?:this|that|the current|current) (?:page|tab|site|website)$|^(?:this|it)$/i.test(what)) return { type: 'page-watch', target: 'this' };
    const url = normalizeUrl(what.replace(/\s+page$/i, ''));
    if (url) return { type: 'page-watch', target: url };
  }
  return null;
}

module.exports = { PageWatcher, parsePageWatchCommand, normalizeUrl, chunksOf, compare, MAX_WATCHES };
