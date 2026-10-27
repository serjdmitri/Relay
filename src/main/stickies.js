// Sticky notes: small notes on the screen, like the Stickies app. You (or Jarvis, "make a sticky saying buy milk") make them; they stay where you put them,
// across restarts, until you remove them. This file is the notes themselves and the spoken commands; stickyPanel.js draws them. No Electron here.

const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'];
const MAX_STICKIES = 24;
const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (s, n) => String(s || '').replace(/\r/g, '').trim().slice(0, n);

class Stickies {
  // storage: { get(key), set(key, value) } over the store; the list is kept under 'stickies', and 'stickiesHidden' says whether they are put away.
  constructor({ storage, now = Date.now, id = () => Math.random().toString(36).slice(2, 10) }) {
    Object.assign(this, { storage, now, newId: id });
    this.onChange = () => {};
  }

  get items() { return this.storage.get('stickies') || []; }
  get hidden() { return !!this.storage.get('stickiesHidden'); }
  save(list) { this.storage.set('stickies', list); this.onChange(); }

  add(text, { color } = {}) {
    const t = cut(text, 1200);
    if (!t) return null;
    const list = this.items;
    const s = { id: this.newId(), text: t, color: COLORS.includes(color) ? color : COLORS[list.length % COLORS.length], x: null, y: null, createdAt: this.now() };
    this.storage.set('stickiesHidden', false); // making one shows them
    this.save([...list, s].slice(-MAX_STICKIES));
    return s;
  }

  get(id) { return this.items.find((s) => s.id === id) || null; }
  setText(id, text) { this.save(this.items.map((s) => (s.id === id ? { ...s, text: cut(text, 1200) } : s))); }
  move(id, x, y) { if (Number.isFinite(x) && Number.isFinite(y)) this.save(this.items.map((s) => (s.id === id ? { ...s, x: Math.round(x), y: Math.round(y) } : s))); }
  remove(id) { const s = this.get(id); if (s) this.save(this.items.filter((x) => x.id !== id)); return s; }

  // Matches by words in the note (every word must be in it), newest first.
  find(query) {
    const words = clean(query).split(' ').filter((w) => w.length > 1 && !['the', 'my', 'about', 'sticky', 'note', 'stickies', 'with', 'that', 'says'].includes(w));
    if (!words.length) return [];
    return [...this.items].reverse().filter((s) => { const hay = clean(s.text); return words.every((w) => hay.includes(w)); });
  }

  append(id, more) { const s = this.get(id); if (!s) return null; this.setText(id, `${s.text}\n${cut(more, 600)}`); return this.get(id); }
  clear() { const was = this.items; this.save([]); return was; }
  restore(list) { this.save([...this.items, ...list].slice(-MAX_STICKIES)); }
  setHidden(on) { this.storage.set('stickiesHidden', !!on); this.onChange(); }
}

const STICKY = '(?:sticky(?: note)?|sticky notes?|post[- ]?it(?: note)?|stickie)';

// Returns { type: 'sticky-add' | 'sticky-show' | 'sticky-hide' | 'sticky-remove' | 'sticky-clear' | 'sticky-append' | 'sticky-list', ... } or null.
function parseStickyCommand(text) {
  const raw = String(text || '').trim().replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/[.!?]+$/, '');
  const n = clean(raw);
  let m;
  if ((m = raw.match(new RegExp(`^(?:make|create|add|put(?: up)?|stick|write|leave|post|take|start|jot down)(?: me)?(?: up)?(?: a| another| a new| one)?(?: new)? ${STICKY}(?: (?:saying|that says|that say|with|that reads|to say|reading|about|called|for me|:)[:,]?)? ?(.*)$`, 'i'))) && m[1].trim()) return { type: 'sticky-add', text: m[1].trim().replace(/^for /i, '') };
  if ((m = raw.match(new RegExp(`^${STICKY}[:,]? (.+)$`, 'i'))) && !/^(?:notes?|list)$/i.test(m[1])) return { type: 'sticky-add', text: m[1].trim() };
  if ((m = raw.match(new RegExp(`^(?:add|append|put) (.+?) (?:to|on|onto) (?:my |the )?(.+?) ${STICKY}$`, 'i')))) return { type: 'sticky-append', text: m[1].trim(), query: m[2].trim() };
  if (new RegExp(`^(?:show|bring back|bring up|open|unhide|put (?:back|up))(?: me)?(?: all)?(?: of)?(?: my| the)? ${STICKY.replace('sticky notes?|', '')}s?$`).test(n) || /^(?:show|bring back|unhide) (?:my |the )?(?:stickies|sticky notes|post its)$/.test(n)) return { type: 'sticky-show' };
  if (/^(?:hide|put away|dismiss|tuck away|minimi[sz]e)(?: all)?(?: of)?(?: my| the)? (?:stickies|sticky notes?|post its?)$/.test(n)) return { type: 'sticky-hide' };
  if (/^(?:clear|delete|remove|get rid of|throw away|dump)(?: all)?(?: of)?(?: my| the)? (?:stickies|sticky notes|post its)$/.test(n) || /^(?:clear|delete|remove) all (?:my )?sticky notes?$/.test(n)) return { type: 'sticky-clear' };
  if ((m = n.match(/^(?:what|which|list)(?: are)?(?: all)?(?: of)? (?:my |the )?(?:stickies|sticky notes)(?: do i have| i have| say)?$/)) || /^(?:what|read)(?: do| does)?(?: my| the)? (?:stickies|sticky notes) say$/.test(n) || /^read (?:me )?(?:my|the) (?:stickies|sticky notes)$/.test(n)) return { type: 'sticky-list' };
  if ((m = n.match(new RegExp(`^(?:remove|delete|take down|take off|get rid of|throw away|clear) (?:my |the )?(.+?) ${STICKY.replace(/\\\\/g, '')}$`)))) {
    const q = m[1].replace(/^(?:one|note) (?:about|with|that says) /, '').trim();
    if (q && !/^(?:all|every|all my|all the)$/.test(q)) return { type: 'sticky-remove', query: q };
  }
  if ((m = n.match(new RegExp(`^(?:remove|delete|take down|get rid of) (?:the |my )?${STICKY.replace(/\\\\/g, '')} (?:about|with|that says|saying) (.+)$`)))) return { type: 'sticky-remove', query: m[1].trim() };
  return null;
}

const W = 236; // a sticky's window; the paper inside is about 220 wide (the rest is its shadow)
const H = 200;
const GAP = 8;

// Where the nth sticky without a place of its own goes: a column down the right side, then the next column to the left. wa: the display's work area.
function slot(n, wa) {
  const rows = Math.max(1, Math.floor((wa.height - 80) / (H + GAP)));
  const col = Math.floor(n / rows), row = n % rows;
  return { x: wa.x + wa.width - W - 14 - col * (W + GAP), y: wa.y + 46 + row * (H + GAP) };
}

module.exports = { slot, W, H, Stickies, parseStickyCommand, COLORS, MAX_STICKIES };
