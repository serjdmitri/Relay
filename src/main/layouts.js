// Window layouts: "save this as my study layout" remembers where every open window is; "set up my study layout" puts them back (opening the apps that
// are not running). Pure helpers plus a small class that talks to the Mac through the same helpers the tools use.

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const NAME = '([a-z0-9][a-z0-9 ]{0,30}?)';
const strip = (s) => clean(s).replace(/^(?:my|the|a|an) /, '').replace(/ (?:layout|setup|set up|window set|windows|workspace|arrangement)$/, '').replace(/^(?:my|the) /, '').trim();

// Returns { type: 'layout-save' | 'layout-restore' | 'layout-list' | 'layout-forget', name } or null. n is normalised text.
function parseLayoutCommand(text) {
  const n = clean(text).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '');
  let m;
  if (/^(?:what|which|list|show)(?: are| is)?(?: all)?(?: of)? (?:my )?(?:saved )?(?:window )?(?:layouts?|workspaces?|window sets?)(?: do i have| i have| i saved)?$/.test(n)) return { type: 'layout-list' };
  if ((m = n.match(new RegExp(`^(?:save|remember|store|keep|record) (?:this|these|my|the current|my current|the way my windows are|where my windows are)(?: window)?(?: layout| setup| arrangement| windows| workspace)? (?:as|for|called|named) (?:my |the )?${NAME}(?: layout| setup| arrangement| workspace)?$`))) ||
      (m = n.match(new RegExp(`^(?:save|remember|store|keep|record) (?:this as )?(?:my |the )?${NAME} (?:layout|setup|workspace|window set)$`)))) {
    const name = strip(m[1]);
    if (name && !/^(?:this|that|it|window|layout)$/.test(name)) return { type: 'layout-save', name };
  }
  if ((m = n.match(new RegExp(`^(?:set up|setup|restore|load|bring back|bring up|open|switch to|go to|apply|arrange my windows for|put my windows (?:back )?in|use) (?:my |the )?${NAME}(?: layout| setup| workspace| window set| windows)$`))) ||
      (m = n.match(new RegExp(`^(?:set up|arrange|lay out) (?:my )?windows (?:for|like|in) (?:my |the )?${NAME}(?: layout| setup)?$`)))) {
    const name = strip(m[1]);
    if (name) return { type: 'layout-restore', name };
  }
  if ((m = n.match(new RegExp(`^(?:forget|delete|remove|drop) (?:my |the )?${NAME}(?: layout| setup| workspace| window set)$`)))) {
    const name = strip(m[1]);
    if (name) return { type: 'layout-forget', name };
  }
  return null;
}

// A window frame that is no longer on any screen (an external display was unplugged) is brought onto the nearest one; a window bigger than its
// screen is shrunk to fit. displays: [{ workArea: { x, y, width, height } }].
function fitFrame(f, displays) {
  if (!displays.length) return f;
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  const has = (d) => cx >= d.workArea.x && cx < d.workArea.x + d.workArea.width && cy >= d.workArea.y && cy < d.workArea.y + d.workArea.height;
  let d = displays.find(has);
  if (!d) {
    let best = Infinity;
    for (const k of displays) {
      const dx = Math.max(k.workArea.x - cx, 0, cx - (k.workArea.x + k.workArea.width));
      const dy = Math.max(k.workArea.y - cy, 0, cy - (k.workArea.y + k.workArea.height));
      if (dx * dx + dy * dy < best) { best = dx * dx + dy * dy; d = k; }
    }
  }
  const a = d.workArea;
  const w = Math.min(f.w, a.width), h = Math.min(f.h, a.height);
  const x = Math.min(Math.max(f.x, a.x), a.x + a.width - w), y = Math.min(Math.max(f.y, a.y), a.y + a.height - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

// Apps that are always around and not part of a layout.
const SKIP = new Set(['Relay', 'Electron', 'relay-glass', 'relay-speech', 'Finder-hidden']);

class Layouts {
  // store: has get(key) and data; mac: windowList(), setWindowFrame(app, rect), openApp(app), listApps(); displays(): [{ workArea }]
  constructor({ store, mac, displays = () => [], sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    Object.assign(this, { store, mac, displays, sleep });
  }

  get items() { return this.store.get('layouts') || []; }
  save(list) { this.store.data.layouts = list; this.store.save(); }
  find(name) {
    const want = clean(name);
    return this.items.find((l) => clean(l.name) === want) || this.items.find((l) => clean(l.name).includes(want) || want.includes(clean(l.name)));
  }

  async remember(name) {
    const wins = (await this.mac.windowList()).filter((w) => !SKIP.has(w.app));
    if (!wins.length) return { ok: false, reply: 'I do not see any open windows to remember.' };
    const entry = { name: String(name).trim().slice(0, 30), savedAt: Date.now(), windows: wins.map((w) => ({ app: w.app, x: w.x, y: w.y, w: w.w, h: w.h })) };
    const replacing = !!this.find(name) && clean(this.find(name).name) === clean(name);
    this.save([...this.items.filter((l) => clean(l.name) !== clean(name)), entry]);
    return { ok: true, reply: `${replacing ? 'Updated' : 'Saved'} your ${entry.name} layout: ${wins.length} ${wins.length === 1 ? 'window' : 'windows'} (${wins.slice(0, 4).map((w) => w.app).join(', ')}${wins.length > 4 ? ', …' : ''}).` };
  }

  // Puts the windows back, opening apps that are not running. Returns { reply, undo } where undo puts the windows back where they were.
  async restore(name) {
    const layout = this.find(name);
    if (!layout) return { ok: false, reply: this.items.length ? `I do not have a layout called ${name}. You have: ${this.items.map((l) => l.name).join(', ')}.` : `I do not have a layout called ${name} yet. Arrange your windows and say “save this as my ${name} layout”.` };
    const before = await this.mac.windowList().catch(() => []);
    const running = new Set((await this.mac.listApps().catch(() => [])).map((a) => a.toLowerCase()));
    const screens = this.displays();
    const opened = [], moved = [], failed = [];
    for (const w of layout.windows) {
      try {
        if (!running.has(w.app.toLowerCase())) { await this.mac.openApp(w.app); opened.push(w.app); await this.sleep(1200); }
        await this.mac.setWindowFrame(w.app, fitFrame(w, screens));
        moved.push(w.app);
      } catch (e) { failed.push(w.app); }
    }
    const reply = moved.length
      ? `Set up your ${layout.name} layout: ${moved.length} ${moved.length === 1 ? 'window' : 'windows'}${opened.length ? `, opened ${opened.join(', ')}` : ''}.${failed.length ? ` Could not place ${failed.join(', ')}.` : ''}`
      : `I could not place any windows for your ${layout.name} layout.${failed.length ? ` (${failed.join(', ')})` : ''}`;
    const undo = before.length ? async () => {
      for (const b of before) await this.mac.setWindowFrame(b.app, { x: b.x, y: b.y, w: b.w, h: b.h }).catch(() => {});
      return 'Put the windows back where they were.';
    } : undefined;
    return { ok: moved.length > 0, reply, undo };
  }

  list() {
    const L = this.items;
    return L.length ? `You have ${L.length} ${L.length === 1 ? 'layout' : 'layouts'}: ${L.map((l) => `${l.name} (${l.windows.length} ${l.windows.length === 1 ? 'window' : 'windows'})`).join(', ')}.` : 'You have no saved layouts yet. Arrange your windows and say “save this as my study layout”.';
  }

  forget(name) {
    const l = this.find(name);
    if (!l) return `I do not have a layout called ${name}.`;
    this.save(this.items.filter((x) => x !== l));
    return `Forgot your ${l.name} layout.`;
  }
}

module.exports = { Layouts, parseLayoutCommand, fitFrame };
