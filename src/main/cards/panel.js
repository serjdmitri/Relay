// The answer card window: a black glass panel on the right of the screen, the same look as the Recent menu, that pops out with
// its picture and facts. It takes mouse clicks (links, the close button) but never the keyboard focus, and it goes by itself.

const { BrowserWindow, screen, shell } = require('electron');
const path = require('path');
const { safeUrl } = require('./card');

const WIDTH = 468; // the window; the card inside is 420 wide, the rest is room for its shadow
const SHOW_MS = 30000;

class CardPanel {
  constructor({ preload, getHold = () => false }) {
    this.preload = preload;
    this.getHold = getHold; // true: a card stays until you close it (Esc, "ok" or the next request), with a ten minute limit
    this.win = null;
    this.card = null;
    this.timer = null;
    this.hovered = false;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: WIDTH, height: 400, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, type: 'panel',
      webPreferences: { preload: this.preload, contextIsolation: true }
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setHiddenInMissionControl?.(true);
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.ready = new Promise((resolve) => this.win.webContents.once('did-finish-load', resolve));
    this.win.loadFile(path.join(__dirname, '../../renderer/card.html'));
    this.win.on('closed', () => { this.win = null; });
    return this.win;
  }

  async show(card) {
    const win = this.ensure();
    await this.ready;
    this.card = card;
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.display = d;
    this.place(d, 320);
    win.webContents.send('card:state', 'show', card);
    win.showInactive();
    this.arm();
  }

  place(d, height) {
    if (!this.win || this.win.isDestroyed()) return;
    const wa = d.workArea;
    const h = Math.min(wa.height - 40, Math.max(220, Math.round(height) + 48));
    this.win.setBounds({ x: wa.x + wa.width - WIDTH - 10, y: wa.y + Math.round((wa.height - h) / 2), width: WIDTH, height: h });
  }

  // The page measures itself once it has laid out the card.
  setSize(h) {
    if (this.display && Number.isFinite(h)) this.place(this.display, h);
  }

  setHover(on) {
    this.hovered = !!on;
    if (!on) this.arm(); else clearTimeout(this.timer);
  }

  arm() {
    clearTimeout(this.timer);
    if (this.card?.hold) return; // a plan waiting for a yes stays until it is answered
    this.timer = setTimeout(() => this.hide(), this.getHold() ? 10 * 60 * 1000 : SHOW_MS);
  }

  hide() {
    clearTimeout(this.timer);
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return;
    this.win.webContents.send('card:state', 'hide');
    setTimeout(() => { if (this.win && !this.win.isDestroyed() && !this.card?.live) this.win.hide(); }, 520);
    this.card = null;
  }

  open(url) {
    if (typeof url === 'string' && url.startsWith('holo:')) { this.onHolo?.(url.slice(5)); return; } // a hologram from the library: brought back
    if (typeof url === 'string' && url.startsWith('file:')) { this.onFile?.(url.slice(5)); return; } // a result of a file search: opened or shown in Finder
    const u = safeUrl(url);
    if (u) shell.openExternal(u);
  }

  get visible() {
    return !!this.card;
  }
}

module.exports = { CardPanel, WIDTH };
