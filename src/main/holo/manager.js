// The holograms: each one is a borderless, fully transparent window as big as the display it is on, with a model made of light drawn
// at one spot of it (so nothing is cut off at an edge, and a piece can be carried anywhere). You can drag one across the screen by its
// name, pin it so it stays (even after a new request, and after a restart), step through other models for the same thing, and drop one
// on another to combine them. The window itself is injected, so all of this can be tested.

const crypto = require('crypto');
const { mergeTarget, cycle, toSaved, cleanSaved, cleanAnnotations } = require('./logic');

const R = 150; // half the size, in pixels, of the square a hologram takes up at normal size (for telling when one is over another)
const MAX_HOLOS = 6;
const MAX_ITEMS = 4;

class HoloManager {
  // createWindow(): a window-like object; cursor(): { x, y }; area(): the work area to place new ones in; download(url) -> Buffer;
  // saved(): the stored list; save(list): store it.
  constructor({ createWindow, cursor, area, displayFor = null, getUi = () => ({ controls: 'menu', spin: true, spinDelay: 10 }), download, fit = async () => null, putFile = () => '', generate = async () => { throw new Error('No generator.'); }, readFile = () => null, library = null, saved, save, setTimer = setInterval, clearTimer = clearInterval }) {
    this.createWindow = createWindow;
    this.cursor = cursor;
    this.area = area;
    this.getUi = getUi; // the look: where the controls are, and whether and when a hologram slowly turns
    this.displayFor = displayFor || (() => area()); // (point) -> the bounds of the display the point is on
    this.download = download;
    this.fit = fit; // (base, item, hint) -> how the item joins the base: { anchor, scale, rotate } or null
    this.putFile = putFile; // bytes -> a file in the model cache (so a pinned hologram can come back)
    this.generate = generate; // a photo candidate -> a real-looking model (a GLB item)
    this.readFile = readFile; // a saved GLB's file -> its bytes
    this.library = library; // every hologram that has been on screen, and the saved scenes (library.js)
    this.thumbTimers = new Map();
    this.saved = saved;
    this.save = save;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.holos = new Map();
    this.buttonDown = false;
    this.dragTimer = null;
    this.handMode = false; // hands are in use: the controls are drawn bigger
    this.byWindow = new Map(); // webContents id -> hologram id
    this.dragging = null;
    this.onChange = () => {};
    this.onAsk = async () => {};
    this.onAnnotate = async () => {}; // (hologram, { item, p, n }): a spot was picked for a note
    this.onFiles = async () => {}; // (hologram, paths): files were dropped on it // (hologram, { region, part }): the user asks Relay about it
  }

  // The designed (editable) hologram: the one titled so, else the latest. { h, index } or null.
  cadTarget(title = '') {
    const t = String(title || '').toLowerCase().trim();
    const all = [...this.holos.values()].filter((h) => h.items.some((i) => i.kind === 'cad'));
    const h = (t && all.find((x) => x.title.toLowerCase().includes(t))) || all.at(-1);
    return h ? { h, index: h.items.findIndex((i) => i.kind === 'cad') } : null;
  }

  // The shapes of a designed model changed (by hand in the hologram, or by voice).
  setCad(h, index, cad, { push = false } = {}) {
    const it = h.items[index];
    if (!it || it.kind !== 'cad') return false;
    h.items[index] = { ...it, cad };
    h.options = null;
    if (push) this.push(h);
    this.persist();
    return true;
  }

  // A model of a combined hologram was put where the person wants it (dragged onto a surface): kept, and saved with a pinned one.
  setPlacement(h, index, free) {
    const it = h.items[index];
    if (!it || !free) return false;
    h.items[index] = { ...it, placement: { free } };
    this.persist();
    return true;
  }

  // Asks a hologram's page to save itself as an STL (the same as its save button); resolves with where it went.
  requestSave(h, opts = {}) {
    return new Promise((resolve) => {
      h.pendingSave = resolve;
      h.win.webContents.send('holo:state', 'save', opts);
      const t = setTimeout(() => { if (h.pendingSave === resolve) { h.pendingSave = null; resolve({ ok: false, error: 'Saving took too long.' }); } }, 20000);
      t.unref?.();
    });
  }

  // The model as a GLB (for the phone page): { bytes, mm } or null.
  requestGlb(h) {
    return new Promise((resolve) => {
      h.pendingGlb = resolve;
      h.win.webContents.send('holo:state', 'export-glb');
      const t = setTimeout(() => { if (h.pendingGlb === resolve) { h.pendingGlb = null; resolve(null); } }, 20000);
      t.unref?.();
    });
  }

  // Asks the page to show the model at life size. mm: how long its longest side really is, when the model itself does not know (a designed
  // model knows). Resolves with { ok, mm } or { ok: false, reason }.
  requestRealSize(h, mm = 0) {
    return new Promise((resolve) => {
      h.pendingReal = resolve;
      h.win.webContents.send('holo:state', 'real-size', { mm: +mm || 0 });
      const t = setTimeout(() => { if (h.pendingReal === resolve) { h.pendingReal = null; resolve({ ok: false, reason: 'It took too long.' }); } }, 8000);
      t.unref?.();
    });
  }

  finishRealSize(h, r) {
    if (h?.pendingReal) { const f = h.pendingReal; h.pendingReal = null; f(r && typeof r === 'object' ? r : { ok: false, reason: 'No answer.' }); }
  }

  finishGlb(h, r) {
    if (h?.pendingGlb) { const f = h.pendingGlb; h.pendingGlb = null; f(r && r.bytes ? { bytes: Buffer.from(r.bytes), mm: !!r.mm } : null); }
  }

  finishSave(h, result) {
    if (h?.pendingSave) { const r = h.pendingSave; h.pendingSave = null; r(result); }
  }

  ui() {
    const u = this.getUi() || {};
    return { controls: ['menu', 'side', 'bar'].includes(u.controls) ? u.controls : 'menu', spin: u.spin !== false, spinDelay: Math.min(120, Math.max(0, Number(u.spinDelay) || 10)), dragFormat: ['stl', '3mf', 'step'].includes(u.dragFormat) ? u.dragFormat : 'stl', pointsPerInch: Math.min(400, Math.max(50, Number(u.pointsPerInch) || 125)) };
  }

  // Settings changed: every hologram takes the new look at once.
  refreshUi() {
    const j = JSON.stringify(this.ui());
    if (j === this.lastUi) return;
    this.lastUi = j;
    for (const h of this.holos.values()) if (!h.win.isDestroyed()) h.win.webContents.send('holo:state', 'ui', this.ui());
  }

  // ----- files dragged onto a hologram -----
  // A window that lets clicks through is never offered a drag by macOS. So while the mouse button is held (a drag may be in progress) and the
  // pointer is over a hologram, that hologram's window takes drags; when the button is let go it goes back to letting clicks through.
  mouseButton(down) {
    this.buttonDown = !!down;
    if (down) {
      if (!this.dragTimer) this.dragTimer = this.setTimer(() => this.watchDrag(), 70);
      this.watchDrag();
    } else {
      if (this.dragTimer) { this.clearTimer(this.dragTimer); this.dragTimer = null; }
      setTimeout(() => this.restoreDrop(), 250); // let a drop that is happening finish first
    }
  }

  watchDrag() {
    if (this.dragging) return; // the person is moving a hologram: not a file
    const c = this.cursor();
    const near = this.holoNear(c, 20);
    for (const h of this.holos.values()) {
      if (h.win.isDestroyed()) continue;
      const accept = h === near;
      if (accept !== !!h.accepting) { h.accepting = accept; h.win.setIgnoreMouseEvents(!accept && !h.hit, { forward: true }); }
    }
  }

  restoreDrop() {
    if (this.buttonDown) return;
    for (const h of this.holos.values()) if (h.accepting && !h.win.isDestroyed()) { h.accepting = false; h.win.setIgnoreMouseEvents(!h.hit, { forward: true }); }
  }

  hasUnpinned() {
    return [...this.holos.values()].some((h) => !h.pinned);
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

  // Where a new hologram's middle goes: the right of the screen, each next one a little lower and further in.
  position(n) {
    const wa = this.area();
    return { x: wa.x + wa.width - 250 - (n % 4) * 46, y: wa.y + Math.round(wa.height / 2) + (n % 4) * 34 };
  }

  rect(h) {
    const r = R * (h.scale || 1);
    return { x: h.x - r, y: h.y - r, width: r * 2, height: r * 2 };
  }

  // The window covers the display the hologram's middle is on; carried to another display, it moves there.
  place(h) {
    if (h.win.isDestroyed()) return;
    const d = this.displayFor({ x: h.x, y: h.y });
    if (!h.disp || d.x !== h.disp.x || d.y !== h.disp.y || d.width !== h.disp.width || d.height !== h.disp.height) {
      h.disp = { x: d.x, y: d.y, width: d.width, height: d.height };
      h.win.setBounds(h.disp);
    }
  }

  local(h) {
    return { x: Math.round(h.x - (h.disp?.x || 0)), y: Math.round(h.y - (h.disp?.y || 0)) };
  }

  // item: { kind: 'stl', title, credit, url, bytes } or { kind: 'shapes', title, credit, parts }.
  async show({ title, items, options = null, pinned = false, x, y, scale = 1, solid = false, annotations = [], id = crypto.randomUUID() }) {
    if (this.holos.size >= MAX_HOLOS) this.close([...this.holos.values()].find((h) => !h.pinned)?.id || this.holos.keys().next().value);
    const pos = x === undefined ? this.position(this.holos.size) : { x, y };
    const d = this.displayFor(pos);
    const win = this.createWindow({ width: d.width, height: d.height });
    const h = { id, win, title, items, options, pinned, scale, solid, x: pos.x, y: pos.y, disp: null, annotations: cleanAnnotations(annotations) };
    this.place(h);
    this.holos.set(id, h);
    this.byWindow.set(win.webContents.id, id);
    await win.ready;
    this.push(h, 'init');
    win.showInactive();
    this.syncLibrary(h);
    this.onChange();
    return id;
  }

  payload(h) {
    return { id: h.id, title: h.title, items: h.items, options: h.options && h.options.list.length > 1 ? { index: h.options.index, count: h.options.list.length } : null, pinned: h.pinned, scale: h.scale, solid: h.solid, annotations: h.annotations || [], pos: this.local(h), handMode: this.handMode, ui: this.ui() };
  }

  push(h, kind = 'items') {
    if (!h.win.isDestroyed()) h.win.webContents.send('holo:state', kind, this.payload(h));
  }

  // Another model next to the ones already there ("add a heart to it").
  async add(id, item, hint = '', from = [1, 0.35]) {
    const h = this.holos.get(id);
    if (!h) return false;
    if (h.items.length >= MAX_ITEMS) return false;
    item = { ...item, placement: await this.placement(h, item, h.items.length, hint), from }; // flies in from the side it was dropped from (the right, if not said)
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
      let item;
      if (c.kind === 'stl') item = { kind: 'stl', title: c.title, credit: c.credit, url: c.url, bytes: await this.download(c.url) };
      else if (c.kind === 'photo') { if (!c.item) c.item = await this.generate(c); item = c.item; } // made once, then kept for next time round
      else item = { kind: 'shapes', title: c.title, credit: c.credit, parts: c.parts };
      h.options.index = index;
      h.items = [item];
      this.push(h);
      this.persist();
    } catch (e) {
      if (!h.win.isDestroyed()) h.win.webContents.send('holo:state', 'error', e?.message && /free 3D service/.test(e.message) ? e.message : 'Could not load that one.');
    }
  }

  // Drop one on another: everything of the first joins the second, and the first goes.
  // Where an incoming model goes, decided by the model (or a simple rule): see fit.js.
  async placement(h, item, index, hint) {
    const unit = { w: 2, h: 2, d: 2 };
    const base = { title: h.items[0]?.title || h.title, size: h.sizes?.[0] || unit };
    try { return (await this.fit(base, { title: item.title, size: item.size || unit }, hint)) || null; } catch { return null; }
  }

  async merge(srcId, dstId, hint = '') {
    const s = this.holos.get(srcId);
    const d = this.holos.get(dstId);
    if (!s || !d || s === d) return false;
    const room = MAX_ITEMS - d.items.length;
    if (room <= 0) return false;
    // the direction the dropped one came from, on the screen, so it can fly in from there
    const dx = s.x - d.x;
    const dy = s.y - d.y;
    const len = Math.hypot(dx, dy) || 1;
    const from = [dx / len, dy / len];
    if (!d.win.isDestroyed()) d.win.webContents.send('holo:state', 'merge-hint', 'fit');
    const incoming = [];
    for (const [i, it] of s.items.slice(0, room).entries()) incoming.push({ ...it, size: s.sizes?.[i], placement: await this.placement(d, { ...it, size: s.sizes?.[i] }, d.items.length + i, hint), from });
    for (const it of incoming) delete it.size;
    if (!this.holos.has(dstId)) return false;
    d.items.push(...incoming);
    d.title = [...new Set(d.items.map((i) => i.title))].join(' + ').slice(0, 70);
    d.options = null;
    d.pinned = d.pinned || s.pinned;
    this.close(srcId);
    this.push(d);
    if (!d.win.isDestroyed()) { d.win.webContents.send('holo:state', 'merge-hint', false); d.win.webContents.send('holo:state', 'pinned', d.pinned); }
    this.persist();
    return true;
  }

  // ----- moving by the name -----
  startDrag(h) {
    this.stopDrag();
    const c = this.cursor();
    this.dragging = { id: h.id, ax: c.x - h.x, ay: c.y - h.y, target: null, started: Date.now() };
    this.dragging.timer = this.setTimer(() => this.tickDrag(), 10);
  }

  tickDrag() {
    const d = this.dragging;
    const h = d && this.holos.get(d.id);
    if (!h || h.win.isDestroyed() || Date.now() - d.started > 30000) return this.stopDrag(); // a drag that never ended is let go
    const c = this.cursor();
    h.x = Math.round(c.x - d.ax);
    h.y = Math.round(c.y - d.ay);
    this.place(h);
    if (!h.win.isDestroyed()) h.win.webContents.send('holo:state', 'pos', this.local(h));
    const others = [...this.holos.values()].filter((o) => o !== h && !o.win.isDestroyed()).map((o) => ({ id: o.id, bounds: this.rect(o) }));
    this.hint(d, mergeTarget(this.rect(h), others));
  }

  // Tells the hologram that would take the dropped one that it will (and the one that no longer would).
  hint(d, target) {
    if (target === d.target) return;
    if (d.target) this.holos.get(d.target)?.win.webContents.send('holo:state', 'merge-hint', false);
    if (target) this.holos.get(target)?.win.webContents.send('holo:state', 'merge-hint', true);
    d.target = target;
  }

  stopDrag() {
    const d = this.dragging;
    if (!d) return;
    this.clearTimer(d.timer);
    this.dragging = null;
    const h = this.holos.get(d.id);
    if (d.target) {
      this.merge(d.id, d.target).catch(() => {});
    } else if (h && !h.win.isDestroyed()) {
      this.persist();
    }
  }

  // The hologram (other than one) that a point of the screen is over, if any.
  holoAt(point, except) {
    for (const o of this.holos.values()) {
      if (o === except || o.win.isDestroyed()) continue;
      const r = this.rect(o);
      if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) return o;
    }
    return null;
  }

  // The hologram nearest to a point of the screen, if the point is on it or within slack pixels of it (a hand pointing at a model).
  holoNear(point, slack = 200) {
    let best = null;
    for (const o of this.holos.values()) {
      if (o.win.isDestroyed()) continue;
      const dist = Math.hypot(point.x - o.x, point.y - o.y);
      if (dist <= R * (o.scale || 1) + slack && (!best || dist < best.dist)) best = { o, dist };
    }
    return best ? best.o : null;
  }

  // A piece is being carried (point in the window's own pixels): the hologram it is over shows that it will take it.
  pieceMove(h, point, outside) {
    const g = { x: point.x + (h.disp?.x || 0), y: point.y + (h.disp?.y || 0) };
    const over = this.holoAt(g, h);
    this.hint(this.pieceHint || (this.pieceHint = { target: null }), over?.id || null);
    return { over: !!over, take: !!over || !!outside };
  }

  pieceEnd() {
    if (this.pieceHint?.target) this.holos.get(this.pieceHint.target)?.win.webContents.send('holo:state', 'merge-hint', false);
    this.pieceHint = null;
  }

  // ----- the rest -----
  pin(id, on) {
    const h = this.holos.get(id);
    if (h) { h.pinned = !!on; this.persist(); this.onChange(); }
  }

  setSizes(id, sizes) {
    const h = this.holos.get(id);
    if (h && Array.isArray(sizes)) h.sizes = sizes;
  }

  // A piece let go outside its hologram becomes a hologram of its own right there, or joins the hologram it was let go over. The hologram
  // it came from keeps the rest (the page has already taken the piece out and stays pulled apart), or goes when nothing is left.
  async extract(h, { item, name, part, rest, x = 0, y = 0 }) {
    const src = h.items[item];
    if (!src || !part) return null;
    const bytes = Buffer.from(part);
    const piece = { kind: 'glb', title: `${name} of ${src.title}`.slice(0, 60), credit: src.credit, bytes, file: this.putFile(bytes) };
    const at = { x: x + (h.disp?.x || 0), y: y + (h.disp?.y || 0) };
    this.pieceEnd();
    const target = this.holoAt(at, h);
    if (rest) { const rb = Buffer.from(rest); h.items[item] = { kind: 'glb', title: src.title, credit: src.credit, bytes: rb, file: this.putFile(rb), ...(src.placement ? { placement: src.placement } : {}) }; }
    else h.items.splice(item, 1);
    h.options = null;
    h.title = [...new Set(h.items.map((i) => i.title))].join(' + ').slice(0, 70);
    let id = null;
    if (target && target.items.length < MAX_ITEMS) {
      const len = Math.hypot(at.x - target.x, at.y - target.y) || 1;
      await this.add(target.id, piece, '', [(at.x - target.x) / len, (at.y - target.y) / len]);
      id = target.id;
    } else {
      id = await this.show({ title: piece.title, items: [piece], x: Math.round(at.x), y: Math.round(at.y) });
    }
    if (!h.items.length) this.close(h.id); else this.persist();
    return id;
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
    const list = [...this.holos.values()].filter((h) => h.pinned).map((h) => toSaved(h));
    this.save(list);
    this.syncLibrary();
  }

  // ----- the library and scenes -----
  // Keeps the library in step with what is on screen, and (a moment later, once the model has drawn) takes a small picture of what is new or changed.
  syncLibrary(only = null) {
    if (!this.library) return;
    const hs = [...this.holos.values()];
    const before = new Map(this.library.entries.map((e) => [e.id, JSON.stringify(e.saved)]));
    this.library.sync(hs.map((h) => ({ id: h.id, saved: toSaved(h), pinned: h.pinned })));
    for (const h of only ? [only] : hs) {
      const e = this.library.get(h.id);
      if (e && (!e.thumb || before.get(h.id) !== JSON.stringify(e.saved))) this.scheduleThumb(h);
    }
  }

  scheduleThumb(h, wait = 2600) {
    clearTimeout(this.thumbTimers.get(h.id));
    const t = setTimeout(() => { this.thumbTimers.delete(h.id); this.captureThumb(h).catch(() => {}); }, wait);
    t.unref?.();
    this.thumbTimers.set(h.id, t);
  }

  // A small picture of the hologram (its window is see-through, so it is the model on black).
  async captureThumb(h) {
    if (!this.library || h.win.isDestroyed() || typeof h.win.webContents.capturePage !== 'function') return false;
    const l = this.local(h);
    const r = Math.round(R * (h.scale || 1) * 1.15);
    const img = await h.win.webContents.capturePage({ x: Math.max(0, l.x - r), y: Math.max(0, l.y - r), width: r * 2, height: r * 2 });
    if (!img || img.isEmpty()) return false;
    const small = img.resize({ width: 132 });
    return this.library.setThumb(h.id, `data:image/jpeg;base64,${small.toJPEG(60).toString('base64')}`);
  }

  // What is on screen now, in the form that is stored.
  snapshot() {
    return [...this.holos.values()].map((h) => ({ saved: toSaved(h), pinned: h.pinned }));
  }

  saveScene(name) {
    if (!this.library) return { ok: false, reason: 'Scenes are not available.' };
    return this.library.saveScene(name, this.snapshot());
  }

  // Replaces what is on screen with a saved scene. Returns { ok, shown, name } or { ok: false, reason }.
  async openScene(name) {
    const sc = this.library?.findScene(name);
    if (!sc) return { ok: false, reason: this.library?.scenes.length ? `I do not have a scene called ${name}. You have: ${this.library.scenes.map((s) => s.name).join(', ')}.` : `I do not have a scene called ${name} yet. Arrange some holograms and say “save this scene as ${name}”.` };
    this.closeAll();
    let shown = 0;
    for (const s of cleanSaved(sc.holos, { anyPinned: true })) {
      try { await this.restoreSaved(s, { pinned: !!s.pinned, id: crypto.randomUUID() }); shown++; } catch { /* a model that cannot be fetched is skipped */ }
    }
    return shown ? { ok: true, shown, name: sc.name, total: sc.holos.length } : { ok: false, reason: `None of the holograms in the ${sc.name} scene could be loaded.` };
  }

  // A hologram from the library, brought back (or the one already on screen).
  async openFromLibrary(id) {
    if (this.holos.has(id)) return id;
    const e = this.library?.get(id);
    if (!e) return null;
    const [s] = cleanSaved([{ ...e.saved, pinned: true }]);
    if (!s) return null;
    try { return await this.restoreSaved(s, { pinned: !!e.saved.pinned, id: e.id }); } catch { return null; }
  }

  setAnnotations(h, list) {
    h.annotations = cleanAnnotations(list);
    this.persist();
    return h.annotations;
  }

  // Shows one saved hologram: its models are fetched again from their links or the model cache.
  async restoreSaved(s, { pinned = true, id = s.id } = {}) {
    const items = await Promise.all(s.items.map(async (i) => {
      if (i.kind === 'stl') return { ...i, bytes: await this.download(i.url) };
      if (i.kind === 'glb') { const bytes = this.readFile(i.file); if (!bytes) throw new Error('model file is gone'); return { ...i, bytes }; }
      return i;
    }));
    const old = !s.center; // saved by an earlier version: x and y were a window's corner, not the middle of the model
    return this.show({ id, title: s.title, items, pinned, x: s.x + (old ? 230 : 0), y: s.y + (old ? 200 : 0), scale: s.scale, solid: s.solid, annotations: s.annotations });
  }

  // At launch: the pinned ones come back where they were. Models are fetched again from their links.
  async restore() {
    for (const s of cleanSaved(this.saved())) {
      try { await this.restoreSaved(s, { pinned: true, id: s.id }); } catch { /* a model that cannot be fetched is skipped */ }
    }
  }
}

module.exports = { HoloManager, R };
