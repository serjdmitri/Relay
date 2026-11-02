const { screen } = require('electron');
const { CardPanel: CardWindow } = require('./panel');

// Each card owns its window and controls; the latest-card accessors preserve existing callers.
class CardPanel {
  constructor(options) { this.options = options; this.entries = []; this.serial = 0; }
  live() { return this.entries.filter(e => e.card && e.win && !e.win.isDestroyed()); }
  get latest() { return this.live().at(-1); }
  get win() { return this.latest?.win; }
  get card() { return this.latest?.card; }
  get visible() { return this.live().length > 0; }
  forSender(sender) { return this.live().find(e => e.win.webContents === sender); }
  async show(card) {
    if (this.live().length + this.entries.filter(e => e.pending).length >= 8) throw new Error('Eight menus are open. Close a menu before opening another.');
    const e = new CardWindow(this.options);
    e.motionKey = `card:${++this.serial}`;
    e.key = JSON.stringify([card.kind, card.location || card.title || 'Menu']);
    e.pinned = false; e.pending = true;
    e.onDismiss = c => { this.onDismiss?.(c); };
    e.onFile = p => this.onFile?.(p); e.onHolo = id => this.onHolo?.(id);
    this.entries = this.entries.filter(e => e.pending || (e.card && !e.win.isDestroyed()));
    this.entries.push(e);
    try { await e.show(card); e.pending = false; } catch (error) { e.win?.destroy(); this.entries = this.entries.filter(x => x !== e); throw error; }
    const saved = this.options.getLayouts?.()[e.key];
    if (saved && ['x','y','width','height'].every(k => Number.isFinite(saved[k]))) {
      const wa = screen.getDisplayMatching(saved).workArea;
      const width = Math.max(320, Math.min(saved.width, wa.width)); const height = Math.max(220, Math.min(saved.height, wa.height));
      e.win.setBounds({ width, height, x: Math.max(wa.x, Math.min(saved.x, wa.x + wa.width - width)), y: Math.max(wa.y, Math.min(saved.y, wa.y + wa.height - height)) });
      e.manualSize = e.manualMove = true;
    }
    if (this.live().length > 1) this.arrange(!!saved);
    const save = () => {
      if (!(e.manualMove || e.manualSize) || e.win.isDestroyed()) return;
      const layouts = { ...(this.options.getLayouts?.() || {}), [e.key]: e.win.getBounds() };
      this.options.saveLayouts?.(Object.fromEntries(Object.entries(layouts).slice(-100)));
    };
    require('../windowGeometry').watchGeometry(e.win, save);
    this.options.motion?.watchWindow(e.win, this.target(e));
    return e;
  }
  target(e) {
    const card = e.card, bounds = e.win.getBounds();
    return { key: e.motionKey, alive: () => !!e.card && !e.win.isDestroyed(), position: () => e.win.getBounds(), move: (x,y) => { if (!e.win.isDestroyed()) e.win.setPosition(Math.round(x), Math.round(y)); }, close: () => e.hide(), undo: async () => { const restored = await this.show(card); restored.manualMove = restored.manualSize = true; restored.win.setBounds(bounds); } };
  }
  handTarget(point) {
    for (const e of this.live().reverse()) {
      if (!e.win.isVisible()) continue;
      const b = e.win.getBounds();
      if (point.x >= b.x && point.x <= b.x+b.width && point.y >= b.y && point.y <= b.y+b.height) return this.target(e);
    }
    return null;
  }
  hide(all = false) { for (const e of this.live()) if (all || !e.pinned) e.hide(); }
  arrange(onlyIfOverlapping = false) {
    const entries = this.live(); if (!entries.length) return;
    for (const e of entries) e.manualSize = e.manualMove = true;
    if (this.onArrange) this.onArrange(onlyIfOverlapping);
    else {
      const layout = require('../menuLayout'), windows = entries.map(e => e.win);
      if (!onlyIfOverlapping || layout.menusOverlap(windows)) layout.arrangeMenus(windows);
    }
  }
  reset() { this.options.saveLayouts?.({}); this.arrange(); }
  async action(sender, action) {
    const e = this.forSender(sender); if (!e) return { ok: false };
    if (action === 'pin') { e.pinned = !e.pinned; e.card.pinned = e.pinned; e.arm(); e.win.webContents.send('card:pin', e.pinned); return { ok: true, pinned: e.pinned }; }
    if (!['refresh', 'units'].includes(action) || e.card.kind !== 'weather' || e.refreshing) return { ok: false };
    e.refreshing = true;
    try {
      const data = await this.onRefresh?.(e.card, action === 'units' ? (e.card.units === 'c' ? 'f' : 'c') : e.card.units);
      if (!data || data.needsCity || !e.card || e.win.isDestroyed()) return { ok: false, error: 'The forecast could not be refreshed.' };
      e.card = { ...e.card, ...data }; e.win.webContents.send('card:state', 'show', e.card); return { ok: true };
    } catch { return { ok: false, error: 'Could not refresh. The previous forecast is still shown.' }; }
    finally { e.refreshing = false; }
  }
}
module.exports = { CardPanel };
