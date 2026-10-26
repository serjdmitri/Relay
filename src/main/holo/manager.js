// The holograms: each one is its own borderless, fully transparent window with a model made of light. You can drag one across the
// screen by its base, pin it so it stays (even after a new request, and after a restart), step through other models for the same
// thing, and drop one on another to combine them. The window itself is injected, so all of this can be tested.

const crypto = require('crypto');
const { mergeTarget, cycle, toSaved, cleanSaved } = require('./logic');

const W = 460;
const H = 540;
const MAX_HOLOS = 6;
const MAX_ITEMS = 4;

class HoloManager {
  // createWindow(): a window-like object; cursor(): { x, y }; area(): the work area to place new ones in; download(url) -> Buffer;
  // saved(): the stored list; save(list): store it.
  constructor({ createWindow, cursor, area, download, saved, save, setTimer = setInterval, clearTimer = clearInterval }) {
    this.createWindow = createWindow;
    this.cursor = cursor;
    this.area = area;
    this.download = download;
    this.saved = saved;
    this.save = save;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.holos = new Map();
    this.byWindow = new Map(); // webContents id -> hologram id
    this.dragging = null;
    this.onChange = () => {};
  }

  latest() {
    return [...this.holos.values()].at(-1) || null;
  }

  get(id) {
    return this.holos.get(id) || null;
  }

  forSender(wcId) {
    return this.holos.get(this.byWindow.get(wcId));
  }

  position(n) {
    const wa = this.area();
    return { x: wa.x + wa.width - W - 24 - (n % 4) * 46, y: wa.y + Math.max(0, Math.round((wa.height - H) / 2)) + (n % 4) * 34 };
  }

  // item: { kind: 'stl', title, credit, url, bytes } or { kind: 'shapes', title, credit, parts }.
  async show({ title, items, options = null, pinned = false, x, y, scale = 1, solid = false, id = crypto.randomUUID() }) {
    if (this.holos.size >= MAX_HOLOS) this.close([...this.holos.values()].find((h) => !h.pinned)?.id || this.holos.keys().next().value);
    const win = this.createWindow({ width: W, height: H });
    const pos = x === undefined ? this.position(this.holos.size) : { x, y };
    win.setBounds({ ...pos, width: W, height: H });
    const h = { id, win, title, items, options, pinned, scale, solid, x: pos.x, y: pos.y };
    this.holos.set(id, h);
    this.byWindow.set(win.webContents.id, id);
    await win.ready;
    this.push(h, 'init');
    win.showInactive();
    this.onChange();
    return id;
  }

  payload(h) {
    return { id: h.id, title: h.title, items: h.items, options: h.options && h.options.list.length > 1 ? { index: h.options.index, count: h.options.list.length } : null, pinned: h.pinned, scale: h.scale, solid: h.solid };
  }

  push(h, kind = 'items') {
    if (!h.win.isDestroyed()) h.win.webContents.send('holo:state', kind, this.payload(h));
  }

  // Another model next to the ones already there ("add a heart to it").
  async add(id, item) {
    const h = this.holos.get(id);
    if (!h) return false;
    if (h.items.length >= MAX_ITEMS) return false;
    h.items.push(item);
    h.title = [...new Set(h.items.map((i) => i.title))].join(' + ').slice(0, 70);
    h.options = null;
    this.push(h);
    this.persist();
    return true;
  }

  // The next or the previous of the models found for the same thing.
  async step(id, dir) {
    const h = this.holos.get(id);
    if (!h?.options || h.options.list.length < 2 || h.items.length !== 1) return;
    const index = cycle(h.options.index, h.options.list.length, dir);
    const c = h.options.list[index];
    if (!h.win.isDestroyed()) h.win.webContents.send('holo:state', 'error', 'Loading…');
    try {
      const item = c.kind === 'stl' ? { kind: 'stl', title: c.title, credit: c.credit, url: c.url, bytes: await this.download(c.url) } : { kind: 'shapes', title: c.title, credit: c.credit, parts: c.parts };
      h.options.index = index;
      h.items = [item];
      this.push(h);
      this.persist();
    } catch {
      if (!h.win.isDestroyed()) h.win.webContents.send('holo:state', 'error', 'Could not load that one.');
    }
  }

  // Drop one on another: everything of the first joins the second, and the first goes.
  merge(srcId, dstId) {
    const s = this.holos.get(srcId);
    const d = this.holos.get(dstId);
    if (!s || !d || s === d) return false;
    const room = MAX_ITEMS - d.items.length;
    if (room <= 0) return false;
    d.items.push(...s.items.slice(0, room));
    d.title = [...new Set(d.items.map((i) => i.title))].join(' + ').slice(0, 70);
    d.options = null;
    d.pinned = d.pinned || s.pinned;
    this.close(srcId);
    this.push(d);
    d.win.webContents.send('holo:state', 'pinned', d.pinned);
    this.persist();
    return true;
  }

  // ----- moving by the base -----
  startDrag(h) {
    this.stopDrag();
    const c = this.cursor();
    const b = h.win.getBounds();
    this.dragging = { id: h.id, ax: c.x - b.x, ay: c.y - b.y, target: null, started: Date.now() };
    this.dragging.timer = this.setTimer(() => this.tickDrag(), 10);
  }

  tickDrag() {
    const d = this.dragging;
    const h = d && this.holos.get(d.id);
    if (!h || h.win.isDestroyed() || Date.now() - d.started > 30000) return this.stopDrag(); // a drag that never ended is let go
    const c = this.cursor();
    h.win.setPosition(Math.round(c.x - d.ax), Math.round(c.y - d.ay), false);
    const others = [...this.holos.values()].filter((o) => o !== h && !o.win.isDestroyed()).map((o) => ({ id: o.id, bounds: o.win.getBounds() }));
    const target = mergeTarget(h.win.getBounds(), others);
    if (target !== d.target) {
      if (d.target) this.holos.get(d.target)?.win.webContents.send('holo:state', 'merge-hint', false);
      if (target) this.holos.get(target)?.win.webContents.send('holo:state', 'merge-hint', true);
      d.target = target;
    }
  }

  stopDrag() {
    const d = this.dragging;
    if (!d) return;
    this.clearTimer(d.timer);
    this.dragging = null;
    const h = this.holos.get(d.id);
    if (d.target) {
      this.holos.get(d.target)?.win.webContents.send('holo:state', 'merge-hint', false);
      this.merge(d.id, d.target);
    } else if (h && !h.win.isDestroyed()) {
      const b = h.win.getBounds();
      h.x = b.x;
      h.y = b.y;
      this.persist();
    }
  }

  // ----- the rest -----
  pin(id, on) {
    const h = this.holos.get(id);
    if (h) { h.pinned = !!on; this.persist(); this.onChange(); }
  }

  setScale(id, v) {
    const h = this.holos.get(id);
    if (h) { h.scale = v; this.persist(); }
  }

  setSolid(id, on) {
    const h = this.holos.get(id);
    if (h) { h.solid = !!on; this.persist(); }
  }

  close(id) {
    const h = this.holos.get(id);
    if (!h) return;
    if (this.dragging?.id === id) this.stopDrag();
    this.holos.delete(id);
    this.byWindow.delete(h.win.webContents.id);
    if (!h.win.isDestroyed()) h.win.close();
    this.persist();
    this.onChange();
  }

  // A new request or Esc takes away what is not pinned.
  hideUnpinned() {
    for (const h of [...this.holos.values()]) if (!h.pinned) this.close(h.id);
  }

  closeAll() {
    for (const h of [...this.holos.values()]) this.close(h.id);
  }

  persist() {
    const list = [...this.holos.values()].filter((h) => h.pinned).map((h) => {
      if (!h.win.isDestroyed() && !this.dragging) { const b = h.win.getBounds(); h.x = b.x; h.y = b.y; }
      return toSaved(h);
    });
    this.save(list);
  }

  // At launch: the pinned ones come back where they were. Models are fetched again from their links.
  async restore() {
    for (const s of cleanSaved(this.saved())) {
      try {
        const items = await Promise.all(s.items.map(async (i) => (i.kind === 'stl' ? { ...i, bytes: await this.download(i.url) } : i)));
        await this.show({ id: s.id, title: s.title, items, pinned: true, x: s.x, y: s.y, scale: s.scale, solid: s.solid });
      } catch { /* a model that cannot be fetched is skipped */ }
    }
  }
}

module.exports = { HoloManager, W, H };
